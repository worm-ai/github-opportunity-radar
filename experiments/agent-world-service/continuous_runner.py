"""Crash/restart probe for the adapted Agent World service.

The probe uses the real FastMCP streamable HTTP client and the real ASGI
viewer.  It deliberately keeps the agent policy small and visible: each
cycle observes nearby agents, Alice whispers to Bob, Bob records the shared
event, Cara emits a visible action, and the world tick advances once.  The
same sequence is run continuously and across a forced process termination.
"""
import argparse
import asyncio
import copy
import faulthandler
import hashlib
import json
import os
from pathlib import Path
import sys

faulthandler.dump_traceback_later(120, exit=True)

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".data/experiments/agent-world-service"


def write(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf8")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def comparable(value):
    """Remove wall-clock fields while preserving all simulation state."""
    if isinstance(value, dict):
        return {
            key: comparable(item)
            for key, item in value.items()
            if key not in {"timestamp", "_ts", "last_seen", "actionTimes"}
        }
    if isinstance(value, list):
        return [comparable(item) for item in value]
    return value


def normalize_agent_ids(value):
    """Compare runs by named identity; UUID allocation is process-local noise."""
    mapping = {}
    if isinstance(value, dict) and isinstance(value.get("agents"), dict):
        for agent_id, agent in value["agents"].items():
            if isinstance(agent, dict) and agent.get("name"):
                mapping[agent_id] = f"agent:{agent['name']}"

    def walk(item):
        if isinstance(item, str) and item in mapping:
            return mapping[item]
        if isinstance(item, list):
            return [walk(entry) for entry in item]
        if isinstance(item, dict):
            return {mapping.get(key, key): walk(entry) for key, entry in item.items()}
        return item

    return walk(value)


def digest(value):
    normalized = normalize_agent_ids(value)
    # These collections are semantically keyed sets but are serialized in
    # UUID order by the upstream engine.  Normalize their order after UUIDs
    # become named identities; event order itself remains significant.
    if isinstance(normalized, dict):
        nearby = normalized.get("previousNearby")
        if isinstance(nearby, dict):
            for key, entries in nearby.items():
                if isinstance(entries, list):
                    nearby[key] = sorted(entries)
        if isinstance(normalized.get("colocation"), list):
            for entry in normalized["colocation"]:
                if isinstance(entry, list) and entry and isinstance(entry[0], list):
                    entry[0] = sorted(entry[0])
            normalized["colocation"] = sorted(normalized["colocation"], key=canonical)
    return hashlib.sha256(canonical(comparable(normalized)).encode("utf8")).hexdigest()


def extract_tool(response):
    """Make MCP response data easy to inspect without trusting one SDK shape."""
    value = response.model_dump(mode="json")
    texts = [item.get("text", "") for item in value.get("content", []) if item.get("type") == "text"]
    parsed = []
    for text in texts:
        try:
            parsed.append(json.loads(text))
        except Exception:
            parsed.append(text)
    return {"raw": value, "parsed": parsed}


async def serve(engine, app, frontend, web_port, mcp_port):
    import uvicorn

    async def broadcast(state):
        from channels.layers import get_channel_layer
        await get_channel_layer().group_send("world_viewers", {"type": "world.update", "data": state})

    engine.set_broadcast_callback(broadcast)
    servers = [
        uvicorn.Server(uvicorn.Config(app.streamable_http_app(), host="127.0.0.1", port=mcp_port, log_level="warning")),
        uvicorn.Server(uvicorn.Config(frontend, host="127.0.0.1", port=web_port, log_level="warning")),
    ]
    jobs = [asyncio.create_task(server.serve()) for server in servers]
    try:
        async with asyncio.timeout(30):
            while not all(server.started for server in servers):
                for job in jobs:
                    if job.done():
                        job.result()
                await asyncio.sleep(0.05)
        return servers, jobs
    except Exception:
        for server in servers:
            server.should_exit = True
        await asyncio.gather(*jobs, return_exceptions=True)
        raise


async def run_phase(args, engine, app, frontend):
    servers, jobs = await serve(engine, app, frontend, args.web_port, args.mcp_port)
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    artifact_dir = Path(args.artifact_dir).resolve() if args.artifact_dir else output.parent
    artifact_dir.mkdir(parents=True, exist_ok=True)
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client
    import aiohttp

    agents = {
        "Alice": "synthetic-local-Alice",
        "Bob": "synthetic-local-Bob",
        "Cara": "synthetic-local-Cara",
    }
    calls = []
    observations = []
    player_events = []
    player_event_visibility = []
    websocket_updates = 0
    try:
        async with aiohttp.ClientSession() as http:
            async with http.ws_connect(f"http://127.0.0.1:{args.web_port}/ws/world/", timeout=10) as ws:
                initial = await ws.receive_json(timeout=10)
                async with streamablehttp_client(f"http://127.0.0.1:{args.mcp_port}/mcp") as (reader, writer, _):
                    async with ClientSession(reader, writer) as session:
                        initialized = await session.initialize()
                        tools = [item.name for item in (await session.list_tools()).tools]

                        async def call(name, arguments):
                            result = extract_tool(await session.call_tool(name, arguments))
                            calls.append({"name": name, "arguments": arguments, "response": result})
                            return result

                        # Identity and memory are checked before any new action
                        # on a restarted process.  This is the key crash test.
                        restored = {}
                        for name, key in agents.items():
                            restored[name] = await call("get_world_context", {"agent_api_key": key})

                        for tick in range(args.start_tick, args.end_tick + 1):
                            if tick in {5, 11}:
                                player_event = await call("inject_world_event", {
                                    "agent_api_key": agents["Alice"],
                                    "category": "player_intervention",
                                    "description": f"Player opened the community shelter at cycle {tick}.",
                                })
                                player_events.append({"tick": tick, "response": player_event})
                            # A player-like external input is represented by a
                            # real MCP action, not a direct in-memory mutation.
                            await call("act", {"agent_api_key": agents["Alice"], "action_type": "whisper",
                                               "target": "Bob", "message": f"shared event at cycle {tick}"})
                            await call("act", {"agent_api_key": agents["Bob"], "action_type": "remember",
                                               "note": f"player event {tick}"})
                            await call("act", {"agent_api_key": agents["Cara"], "action_type": "emote",
                                               "emote": f"cycle-{tick}"})
                            nearby = await call("get_nearby", {"agent_api_key": agents["Alice"]})
                            observations.append({"tick": tick, "nearby": nearby})
                            await engine.tick()
                            viewer_payload = None
                            try:
                                viewer_payload = await ws.receive_json(timeout=5)
                                websocket_updates += 1
                            except Exception:
                                pass
                            if tick in {5, 11}:
                                description = f"Player opened the community shelter at cycle {tick}."
                                websocket_text = json.dumps(viewer_payload, ensure_ascii=False) if viewer_payload is not None else ""
                                async with http.get(f"http://127.0.0.1:{args.web_port}/api/world_state/") as response:
                                    http_state = await response.json()
                                    http_text = json.dumps(http_state, ensure_ascii=False)
                                    player_event_visibility.append({
                                        "tick": tick,
                                        "websocketVisible": description in websocket_text,
                                        "httpVisible": description in http_text,
                                    })
                            state = engine.payload()
                            write(artifact_dir / f"after-tick-{tick}.json", {
                                "tick": tick,
                                "digest": digest(state),
                                "state": state,
                            })
                            if args.kill_after == tick:
                                write(artifact_dir / "kill-ready.json", {
                                    "pid": os.getpid(),
                                    "tick": tick,
                                    "digest": digest(state),
                                    "state": state,
                                })
                                # Keep the process alive so the parent can use
                                # an abrupt termination instead of a graceful
                                # shutdown path.
                                await asyncio.sleep(args.kill_wait)
                            if args.cycle_delay > 0 and tick < args.end_tick:
                                await asyncio.sleep(args.cycle_delay)

                        final = engine.payload()
                        result = {
                            "phase": args.phase,
                            "pid": os.getpid(),
                            "ports": {"web": args.web_port, "mcp": args.mcp_port},
                            "protocolVersion": initialized.protocolVersion,
                            "tools": tools,
                            "initialObserver": initial,
                            "restored": restored,
                            "calls": calls,
                            "playerEvents": player_events,
                            "playerEventVisibility": player_event_visibility,
                            "observations": observations,
                            "websocketUpdates": websocket_updates,
                            "tickCount": engine._tick_count,
                            "clock": copy.deepcopy(engine.clock),
                            "state": final,
                            "digest": digest(final),
                        }
                        write(output, result)
                        return result
    finally:
        for server in servers:
            server.should_exit = True
        await asyncio.gather(*jobs, return_exceptions=True)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["seed", "resume"], required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--artifact-dir", default="")
    parser.add_argument("--start-tick", type=int, required=True)
    parser.add_argument("--end-tick", type=int, required=True)
    parser.add_argument("--kill-after", type=int, default=0)
    parser.add_argument("--kill-wait", type=float, default=60)
    parser.add_argument("--web-port", type=int, default=4335)
    parser.add_argument("--mcp-port", type=int, default=4336)
    parser.add_argument("--cycle-delay", type=float, default=1.1)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    # Django setup/migrations must happen before an asyncio loop exists; the
    # MCP/ASGI portion below is the only async section of the probe.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from run import setup
    database = Path(args.database).resolve()
    database.parent.mkdir(parents=True, exist_ok=True)
    engine, app, frontend = setup("adapted-bridged", database, seed=args.phase == "seed", service=True)
    result = asyncio.run(run_phase(args, engine, app, frontend))
    print(json.dumps({"phase": args.phase, "tickCount": result["tickCount"], "digest": result["digest"]}, ensure_ascii=False))
    faulthandler.cancel_dump_traceback_later()
