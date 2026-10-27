"""Async MCP boundary for the synchronous Agent World engine.

The world engine and Django ORM are synchronous. MCP handlers run in an
asyncio event loop, so every operation that touches engine state or the ORM
must cross one thread-sensitive sync boundary. Keeping that boundary here
also makes failed writes visible to the caller instead of leaving memory-only
state behind.
"""
import copy
import json

from asgiref.sync import sync_to_async
from mcp.server.fastmcp import FastMCP
from world.engine import INSTRUCTIONS, MAX_AGENTS, WorldEngine
from world.events import WorldEvent
from world import analytics


def register_tools(app: FastMCP):
    engine = WorldEngine.get_instance()

    async def sync_call(fn, *args, **kwargs):
        return await sync_to_async(fn, thread_sensitive=True)(*args, **kwargs)

    def persist_all_direct():
        """Persist the complete agent graph inside the caller's transaction."""
        from django.db import connections
        from world.models import AgentRecord
        if getattr(engine, "_bridge_test_fail_next", False):
            engine._bridge_test_fail_next = False
            raise RuntimeError("injected bridge persistence failure")
        connection = connections["default"]
        if not connection.in_atomic_block:
            connection.close()
            connection.connect()
        for agent in engine.agents.agents.values():
            AgentRecord.objects.update_or_create(agent_id=agent.id, defaults={
                "api_key": agent.api_key, "name": agent.name, "x": agent.x, "y": agent.y,
                "status": agent.status, "sprite_index": agent.sprite_index,
                "current_action": agent.current_action or "", "last_seen": agent.last_seen,
                "relationships_json": json.dumps(agent.relationships),
                "memory_json": json.dumps(agent.memory), "is_npc": agent.is_npc,
            })

    def persist_state():
        """Use the adapted checkpoint or the upstream-compatible full row save."""
        if getattr(engine, "_bridge_test_fail_next", False):
            engine._bridge_test_fail_next = False
            raise RuntimeError("injected bridge persistence failure")
        if hasattr(engine, "save_world"):
            engine.save_world()
        else:
            persist_all_direct()

    def snapshot_state():
        pending = {}
        for agent_id in list(engine.agents.agents) + list(engine.events._queues):
            if agent_id in pending:
                continue
            events = engine.events.drain(agent_id)
            pending[agent_id] = events
            for event in events:
                engine.events.push(agent_id, event)
        return {
            "agents": copy.deepcopy(engine.agents.agents),
            "keys": dict(engine.agents._key_to_id),
            "pending": pending,
            "recent": copy.deepcopy(engine._recent_events),
            "action_times": copy.deepcopy(engine._action_timestamps),
        }

    def restore_state(snapshot):
        engine.agents.agents = snapshot["agents"]
        engine.agents._key_to_id = snapshot["keys"]
        for agent_id in list(engine.events._queues):
            engine.events.drain(agent_id)
        for agent_id, events in snapshot["pending"].items():
            for event in events:
                engine.events.push(agent_id, event)
        engine._recent_events = snapshot["recent"]
        engine._action_timestamps = snapshot["action_times"]

    # The local adaptation has a world checkpoint in addition to agent rows.
    # Persist after every completed service tick so a restart cannot observe a
    # newer in-memory clock than the checkpoint.
    if hasattr(engine, "save_world") and not getattr(engine, "_service_tick_bridge", False):
        original_tick = engine.tick

        async def tick_with_checkpoint():
            await original_tick()
            await sync_call(engine.save_world)

        engine.tick = tick_with_checkpoint
        engine._service_tick_bridge = True

    @app.tool(name="wait_for_event", description="Wait for an event, then inspect and act in the world.")
    async def wait_for_event(agent_api_key: str, agent_name: str = "", timeout: int = 30) -> str:
        def prepare():
            agent = engine.agents.get_by_api_key(agent_api_key)
            is_new = False
            if not agent and agent_name:
                snapshot = snapshot_state()
                try:
                    # Upstream register() swallows its own persistence error;
                    # retry explicitly inside the bridge so an accepted
                    # registration is never memory-only.
                    agent = engine.agents.register(name=agent_name, api_key=agent_api_key, max_agents=MAX_AGENTS)
                    if agent:
                        from django.db import transaction
                        with transaction.atomic():
                            persist_state()
                except Exception:
                    restore_state(snapshot)
                    try:
                        from django.db import connections
                        from world.models import AgentRecord
                        connection = connections["default"]
                        if not connection.is_usable():
                            connection.connect()
                        AgentRecord.objects.filter(api_key=agent_api_key).delete()
                    except Exception:
                        # Preserve the original registration failure; the
                        # probe records cleanup failure as a hard boundary.
                        pass
                    raise
                if agent:
                    is_new = True
            if agent:
                engine.agents.mark_active(agent.id)
            return agent, is_new

        agent, is_new = await sync_call(prepare)
        if not agent:
            return json.dumps({"error": "Unknown API key or registration failed.", "instructions": INSTRUCTIONS})
        if is_new:
            analytics.identify(agent.id, {"name": agent.name, "zone": agent.zone})
            analytics.capture(agent.id, "agent_registered", {"agent_name": agent.name})
        event = await engine.events.wait(agent.id, timeout=min(max(1, timeout), 30))
        result = {"result": event.to_dict(), "agent_id": agent.id, "instructions": INSTRUCTIONS}
        if is_new:
            result["api_key"] = agent.api_key
        return json.dumps(result)

    @app.tool(name="act", description="Take a speak, move, remember, emote, or whisper action.")
    async def act(agent_api_key: str, action_type: str, message: str = "", zone: str = "", x: int = None,
                  y: int = None, note: str = "", emote: str = "", target: str = "") -> str:
        action = {"type": action_type, "message": message, "zone": zone, "note": note, "emote": emote, "target": target}
        if x is not None:
            action["x"] = x
        if y is not None:
            action["y"] = y

        def run_action():
            agent = engine.agents.get_by_api_key(agent_api_key)
            if not agent:
                return {"error": "Unknown API key"}
            snapshot = snapshot_state()
            engine.agents.mark_active(agent.id)
            try:
                from django.db import transaction
                with transaction.atomic():
                    # Invoke the upstream handler without its best-effort
                    # per-agent save. The bridge owns the transaction and
                    # commits the complete graph below.
                    rate_error = engine._check_rate_limit(agent.id)
                    if rate_error:
                        result = rate_error
                    else:
                        handler = {
                            "speak": engine._handle_speak,
                            "move": engine._handle_move,
                            "emote": engine._handle_emote,
                            "remember": engine._handle_remember,
                            "whisper": engine._handle_whisper,
                        }.get(action.get("type", ""))
                        result = {"error": f"Unknown action type: {action.get('type', '')}"} if not handler else handler(agent, action)
                    if "error" not in result:
                        # A whisper mutates both participants. Keep the whole
                        # graph in one transaction and restore memory on failure.
                        persist_state()
            except Exception:
                restore_state(snapshot)
                raise
            return result

        result = await sync_call(run_action)
        return json.dumps({"result": result, "instructions": INSTRUCTIONS})

    @app.tool(name="inject_world_event", description="Inject a player/controller event into every active agent's durable event queue.")
    async def inject_world_event(agent_api_key: str, category: str, description: str) -> str:
        def inject():
            controller = engine.agents.get_by_api_key(agent_api_key)
            if not controller:
                return {"error": "Unknown API key"}
            category_value = str(category).strip()[:80]
            description_value = str(description).strip()[:500]
            if not category_value or not description_value:
                return {"error": "category and description are required"}
            snapshot = snapshot_state()
            try:
                from django.db import transaction
                with transaction.atomic():
                    event = WorldEvent("world_event", {
                        "category": category_value,
                        "description": description_value,
                        "source": "player",
                    })
                    for agent in engine.agents.agents.values():
                        engine.events.push(agent.id, event)
                    if hasattr(engine, "_add_recent_event"):
                        engine._add_recent_event("world_event", f"[{category_value.upper()}] {description_value}")
                    persist_state()
            except Exception:
                restore_state(snapshot)
                raise
            return {"ok": True, "category": category_value, "recipients": len(engine.agents.agents),
                    "clock": copy.deepcopy(engine.clock)}

        result = await sync_call(inject)
        return json.dumps({"result": result, "instructions": INSTRUCTIONS})

    @app.tool(name="get_world_context", description="Get the agent's current world context.")
    async def get_world_context(agent_api_key: str) -> str:
        def read_context():
            agent = engine.agents.get_by_api_key(agent_api_key)
            if not agent:
                return {"error": "Unknown API key"}
            engine.agents.mark_active(agent.id)
            return {"result": engine.get_agent_context(agent.id)}

        result = await sync_call(read_context)
        return json.dumps({**result, "instructions": INSTRUCTIONS})

    @app.tool(name="get_nearby", description="List agents in the same zone.")
    async def get_nearby(agent_api_key: str) -> str:
        def read_nearby():
            agent = engine.agents.get_by_api_key(agent_api_key)
            if not agent:
                return {"error": "Unknown API key"}
            engine.agents.mark_active(agent.id)
            return {"result": {"nearby": [n.to_summary() for n in engine.agents.get_nearby_agents(agent.id)], "your_zone": agent.zone}}

        result = await sync_call(read_nearby)
        return json.dumps({**result, "instructions": INSTRUCTIONS})

    @app.tool(name="get_relationships", description="Get relationship scores with other agents.")
    async def get_relationships(agent_api_key: str) -> str:
        def read_relationships():
            agent = engine.agents.get_by_api_key(agent_api_key)
            if not agent:
                return {"error": "Unknown API key"}
            engine.agents.mark_active(agent.id)
            from world.relationships import get_relationship_label
            relationships = {}
            for other_id, score in agent.relationships.items():
                other = engine.agents.get_by_id(other_id)
                if other:
                    relationships[other.name] = {"score": score, "label": get_relationship_label(score)}
            return {"result": relationships}

        result = await sync_call(read_relationships)
        return json.dumps({**result, "instructions": INSTRUCTIONS})


def install():
    """Replace the upstream handlers for the isolated service probe only."""
    import mcp_server.tools as tools
    tools.register_tools = register_tools
