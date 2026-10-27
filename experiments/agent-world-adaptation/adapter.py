"""Synthetic rule-based prototype. These capabilities are NOT upstream features.

The adapter reuses the real upstream tick/map/action/relationship/event/ORM code.
It adds a single checkpoint and explicit, inspectable policies, not an LLM.
Single-threaded, at completed-step boundaries only; not production concurrency.
"""
import asyncio
import copy
from dataclasses import asdict
import hashlib
import json
import random
from unittest.mock import patch

from django.db import close_old_connections, connection, transaction
from world.engine import WorldEngine
from world.events import WorldEvent
from world.models import AgentRecord, WorldCheckpoint


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def tuples(value):
    return tuple(tuples(v) for v in value) if isinstance(value, list) else value


def choose(context, disabled=None):
    """Deliberately small, authored strategy for a falsifiable integration probe."""
    context = copy.deepcopy(context)
    if disabled == 'event':
        context['events'] = []
    if disabled == 'relationship':
        context['agent']['relationships'] = {}
    if disabled == 'memory':
        context['agent']['memory'] = []
    agent = context['agent']
    emergency = any(e['type'] == 'world_event' and e.get('category') == 'water_outage'
                    for e in context['events'])
    if agent['name'] == 'Alice':
        bob = next(a for a in context['nearby'] if a['name'] == 'Bob')
        return 'coordinate' if agent['relationships'].get(bob['id'], 0) >= 0 else 'withhold'
    if agent['name'] == 'Bob':
        return 'ration' if emergency else 'normal-use'
    if emergency:
        return 'repair' if 'pipe valve map' in agent['memory'] else 'inspect'
    return 'observe'


class AdaptedWorld(WorldEngine):
    def __init__(self):
        super().__init__()
        # Keep simulation randomness independent from ASGI/Channels and other
        # service libraries that legitimately use Python's process-global RNG.
        # Otherwise a restart can change future world events without any
        # world input changing.
        self._simulation_rng = random.Random()
        import world.world_events as world_events
        world_events.random = self._simulation_rng
        self.water = {'stock': 12, 'capacity': 30, 'damaged': False, 'used': 0,
                      'supplied': 0, 'initial': 12, 'unmet': 0}
        self.decisions = []
        record = WorldCheckpoint.objects.filter(pk=1).first()
        if record:
            assert hashlib.sha256(record.payload.encode()).hexdigest() == record.sha256, 'Checkpoint hash mismatch'
            data = json.loads(record.payload)
            assert data['version'] == 1
            # Detect partial/out-of-band agent writes instead of silently loading a mixed world.
            actual = {str(a.agent_id): a for a in AgentRecord.objects.all()}
            assert set(actual) == set(data['agents']), 'Checkpoint agent membership mismatch'
            # ORM row order is unspecified.  Restore the checkpoint's stable
            # insertion order so event queues and nearby lists do not change
            # merely because a new process loaded the same world.
            self.agents.agents = {key: self.agents.agents[key] for key in data['agents']}
            self.agents._key_to_id = {agent.api_key: key for key, agent in self.agents.agents.items()}
            for key, saved in data['agents'].items():
                a = actual[key]
                for field in ['name', 'api_key', 'x', 'y', 'status', 'current_action', 'last_seen', 'sprite_index', 'is_npc']:
                    value = getattr(a, field)
                    expected = saved[field]
                    if field == 'current_action':
                        value, expected = value or None, expected or None
                    assert value == expected, f'Checkpoint agent field mismatch: {field}'
                assert json.loads(a.memory_json) == saved['memory'], 'Checkpoint memory mismatch'
                assert json.loads(a.relationships_json) == saved['relationships'], 'Checkpoint relationship mismatch'
                assert key in self.agents.agents, 'Upstream load failed'
                loaded = self.agents.agents[key]
                for field, value in saved.items():
                    setattr(loaded, field, value)
            self.clock = data['clock']
            self._tick_count = data['tickCount']
            self.water = data['water']
            self.decisions = data['decisions']
            self._previous_nearby = {key: set(value) for key, value in data['previousNearby'].items()}
            self.relationships._colocation_ticks = {tuple(key): value for key, value in data['colocation']}
            self._recent_events = data['recentEvents']
            self._action_timestamps = data['actionTimes']
            for key, events in data['pending'].items():
                for event in events:
                    self.events.push(key, WorldEvent(event['type'], event['data'], event['timestamp']))
            simulation_state = data.get('simulationRandom', data.get('random'))
            self._simulation_rng.setstate(tuples(simulation_state))
        elif self.agents.agents:
            raise ValueError('Refuse uncheckpointed pre-existing agents in this experiment')

    def payload(self):
        # Preserve queued events without consuming them.
        pending = {}
        for key in self.agents.agents:
            events = self.events.drain(key)
            pending[key] = [asdict(e) for e in events]
            for event in events:
                self.events.push(key, event)
        return {'version': 1, 'clock': self.clock.copy(), 'tickCount': self._tick_count,
                'agents': {key: asdict(a) for key, a in self.agents.agents.items()},
                'water': copy.deepcopy(self.water), 'decisions': copy.deepcopy(self.decisions),
                'previousNearby': {key: sorted(value) for key, value in self._previous_nearby.items()},
                'colocation': [[list(key), value] for key, value in sorted(self.relationships._colocation_ticks.items())],
                'recentEvents': copy.deepcopy(self._recent_events), 'actionTimes': copy.deepcopy(self._action_timestamps),
                'pending': pending,
                # Retain the historical field for old readers, but both
                # fields now represent the isolated simulation RNG.
                'random': self._simulation_rng.getstate(),
                'simulationRandom': self._simulation_rng.getstate()}

    def save_world(self, fail_after_agents=False):
        if not connection.in_atomic_block:
            close_old_connections()
        with transaction.atomic():
            self.agents.save_all()
            if fail_after_agents:
                raise RuntimeError('Injected checkpoint failure after agent writes')
            payload = canonical(self.payload())
            WorldCheckpoint.objects.update_or_create(pk=1, defaults={
                'payload': payload, 'sha256': hashlib.sha256(payload.encode()).hexdigest()})

    def handle_action(self, agent_id, action):
        # The real handler mutates both speakers' relationships. Persist the entire
        # completed world within the same transaction, not just the acting agent.
        with transaction.atomic():
            result = super().handle_action(agent_id, action)
            if 'error' not in result:
                self.save_world()
        return result

    def initialize(self):
        assert not self.agents.agents
        random.seed(173)
        self._simulation_rng.seed(173)
        with patch('time.time', return_value=1_000_000):
            for name in ['Alice', 'Bob', 'Cara']:
                agent = self.agents.register(name, api_key='synthetic-local-' + name)
                assert agent
            tile = self.grid.get_random_position_in_sector('Hobbs Cafe')
            for agent in self.agents.agents.values():
                agent.x, agent.y = tile
                agent.zone = self.grid.get_sector(*tile)
                agent.last_seen = 1_000_000
            self.save_world()

    def _check_proximity_events(self):
        """Keep event order stable across Python processes and hash seeds."""
        active_agents = self.agents.get_active_agents()
        current_nearby = {}
        for agent in active_agents:
            nearby_ids = set()
            for other in active_agents:
                if other.id != agent.id and self.grid.are_nearby(agent.x, agent.y, other.x, other.y):
                    nearby_ids.add(other.id)
            current_nearby[agent.id] = nearby_ids
        for agent in active_agents:
            previous = self._previous_nearby.get(agent.id, set())
            for arrived_id in sorted(current_nearby.get(agent.id, set()) - previous):
                arrived = self.agents.get_by_id(arrived_id)
                if arrived:
                    self.events.push(agent.id, WorldEvent(
                        type='agent_arrived', data={'agent': arrived.to_summary(), 'zone': agent.zone}))
            for left_id in sorted(previous - current_nearby.get(agent.id, set())):
                left = self.agents.get_by_id(left_id)
                if left:
                    self.events.push(agent.id, WorldEvent(
                        type='agent_left', data={'agent': left.to_summary()}))
        self._previous_nearby = current_nearby

    def _update_colocation_relationships(self):
        """Use sorted neighbors so threshold events have reproducible order."""
        active_agents = self.agents.get_active_agents()
        processed = set()
        for agent in active_agents:
            for other_id in sorted(self._previous_nearby.get(agent.id, set())):
                pair = tuple(sorted([agent.id, other_id]))
                if pair in processed:
                    continue
                processed.add(pair)
                count = self.relationships.track_colocation(agent.id, other_id)
                if count > 0 and count % 5 == 0:
                    events = self.relationships.update_score(self.agents.agents, agent.id, other_id, 1)
                    for event in events:
                        if event.data.get('with_id') == other_id:
                            self.events.push(agent.id, event)
                        else:
                            self.events.push(other_id, event)

    def water_event(self):
        for agent in self.agents.agents.values():
            self.events.push(agent.id, WorldEvent('world_event', {
                'category': 'water_outage', 'description': 'Synthetic shared water outage.'}))

    def decision_step(self, disabled=None):
        with transaction.atomic():
            return self._decision_step(disabled)

    def _decision_step(self, disabled=None):
        rows = []
        for agent in sorted(self.agents.agents.values(), key=lambda a: a.name):
            context = self.get_agent_context(agent.id)
            context['events'] = [e.to_dict() for e in self.events.drain(agent.id)]
            selected = choose(context, disabled)
            if selected == 'coordinate':
                action = {'type': 'whisper', 'target': 'Bob', 'message': 'I will deliver shared water.'}
            elif selected == 'inspect':
                action = {'type': 'remember', 'note': 'pipe valve map'}
            else:
                action = {'type': 'emote', 'emote': selected}
            result = self.handle_action(agent.id, action)
            assert result.get('ok'), result
            if selected == 'coordinate':
                amount = min(2, self.water['capacity'] - self.water['stock'])
                self.water['stock'] += amount
                self.water['supplied'] += amount
            elif selected in ['ration', 'normal-use']:
                requested = 1 if selected == 'ration' else 3
                used = min(requested, self.water['stock'])
                self.water['stock'] -= used
                self.water['used'] += used
                self.water['unmet'] += requested - used
            elif selected == 'repair':
                self.water['damaged'] = False
            row = {'tick': self._tick_count, 'agent': agent.name, 'selected': selected,
                   'action': action, 'waterAfter': copy.deepcopy(self.water)}
            rows.append(row)
        self.decisions.extend(rows)
        self.save_world()
        return rows

    def step(self):
        # Virtual 11-second intervals exercise the real upstream 10-second limiter
        # and idle checker without a 5-minute wall-clock wait. No rate limit bypass.
        with patch('time.time', return_value=1_000_000 + (self._tick_count + 1) * 11):
            for a in self.agents.agents.values():
                self.agents.reconnect(a.api_key)
            asyncio.run(self.tick())
            if self._tick_count == 3:
                self.water['damaged'] = True
            if self._tick_count == 16:
                supplied = min(3, self.water['capacity'] - self.water['stock'])
                self.water['stock'] += supplied
                self.water['supplied'] += supplied
            if self.water['damaged']:
                self.water_event()
            else:
                supplied = min(2, self.water['capacity'] - self.water['stock'])
                self.water['stock'] += supplied
                self.water['supplied'] += supplied
            result = self.decision_step()
            assert 0 <= self.water['stock'] <= self.water['capacity']
            assert self.water['initial'] + self.water['supplied'] - self.water['used'] == self.water['stock']
            return result
