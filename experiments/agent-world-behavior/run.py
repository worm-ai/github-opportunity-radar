"""Bounded execution of unmodified pinned upstream core, not the web/MCP app."""
import asyncio
import copy
import hashlib
import json
import os
from pathlib import Path
import random
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / '.data/experiments/agent-world-behavior'
VENDOR = WORK / 'vendor'
RUNTIME = WORK / 'runtime'


def verify():
    manifest = json.loads((WORK / 'sources.json').read_text(encoding='utf8'))
    for item in manifest['files']:
        data = (VENDOR / item['path']).read_bytes()
        assert hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() == item['blob']
    assert len(manifest['files']) == 36
    for item in json.loads((RUNTIME / 'runtime.json').read_text())['wheels']:
        assert hashlib.sha256((RUNTIME / (item['filename'] + '.zip')).read_bytes()).hexdigest() == item['sha256']
    return manifest


def setup(database):
    verify()
    # Keep credentials out of upstream execution; no network is needed by this core.
    os.environ.clear()
    sys.path[:0] = [str(VENDOR), str(RUNTIME / 'site-packages')]
    import django
    from django.conf import settings
    settings.configure(INSTALLED_APPS=['world'], DATABASES={'default': {
        'ENGINE': 'django.db.backends.sqlite3', 'NAME': str(database)}},
        SECRET_KEY='local-behavior-experiment-only', USE_TZ=True)
    django.setup()


def snapshot(engine):
    return {'clock': engine.clock, 'agents': {a.name: {
        'relationships': {engine.agents.agents[k].name: v for k, v in a.relationships.items()},
        'memory': list(a.memory), 'position': [a.x, a.y], 'status': a.status,
    } for a in engine.agents.agents.values()}}


def phase(name, database):
    setup(database)
    from world.engine import WorldEngine
    if name == 'action':
        from django.core.management import call_command
        call_command('migrate', verbosity=0)
    engine = WorldEngine()
    if name == 'action':
        a = engine.agents.register('Alice')
        b = engine.agents.register('Bob')
        for agent in [a, b]:
            result = engine.handle_action(agent.id, {'type': 'move', 'zone': 'Hobbs Cafe'})
            assert result.get('ok'), result
        assert engine.handle_action(a.id, {'type': 'speak', 'message': 'Let us meet here tomorrow.'})['ok']
        assert engine.handle_action(a.id, {'type': 'remember', 'note': 'Meet Bob at Hobbs Cafe tomorrow.'})['ok']
        return snapshot(engine)
    if name == 'flush':
        # This phase follows a reload, so restore lost listener state through a NEW
        # action, then use the same save_all path called by runworld.shutdown.
        for agent in engine.agents.agents.values():
            engine.agents.reconnect(agent.api_key)
        alice = next(a for a in engine.agents.agents.values() if a.name == 'Alice')
        assert engine.handle_action(alice.id, {'type': 'speak', 'message': 'Second meeting.'})['ok']
        before = snapshot(engine)
        engine.agents.save_all()
        return before
    if name == 'ticks':
        for agent in engine.agents.agents.values():
            engine.agents.reconnect(agent.api_key)
        for _ in range(12):
            asyncio.run(engine.tick())
        from world.models import WorldLog
        return {'state': snapshot(engine), 'worldLogs': WorldLog.objects.count(),
                'events': {a.name: [e.type for e in engine.events.drain(a.id)]
                           for a in engine.agents.agents.values()}}
    if name == 'individual-save':
        for agent in engine.agents.agents.values():
            engine.agents.reconnect(agent.api_key)
        alice = next(a for a in engine.agents.agents.values() if a.name == 'Alice')
        assert engine.handle_action(alice.id, {'type': 'speak', 'message': 'Individual-save positive control.'})['ok']
        for agent_id in engine.agents.agents:
            engine.agents.save_agent(agent_id)
        return snapshot(engine)
    if name == 'npc':
        engine.initialize_npcs(1)
        npc = next(a for a in engine.agents.agents.values() if a.is_npc)
        user = next(a for a in engine.agents.agents.values() if a.name == 'Alice')
        for agent in engine.agents.agents.values():
            agent.status = 'offline'
        user.status = npc.status = 'active'
        user.x, user.y = npc.x, npc.y
        user.zone = npc.zone
        baseline = copy.deepcopy(engine.agents.agents)
        from world.events import EventQueue
        trials = []
        for seed in range(20):
            for score in [-80, 80]:
                for event in ['none', 'world_event', 'message']:
                    engine.agents.agents = copy.deepcopy(baseline)
                    engine.events = EventQueue()
                    engine._action_timestamps = {}
                    engine._recent_events = []
                    engine.initialize_npcs(1)
                    live_npc = engine.agents.agents[npc.id]
                    live_user = engine.agents.agents[user.id]
                    live_npc.relationships = {user.id: score}
                    live_user.relationships = {npc.id: score}
                    if event == 'world_event':
                        random.seed(seed + 1000)
                        engine._trigger_world_event()
                    if event == 'message':
                        result = engine.handle_action(user.id, {'type': 'speak', 'message': 'The cafe is closing. Can you help?'})
                        assert result.get('ok'), result
                    # Hold randomness fixed AFTER delivering the intervention.
                    random.seed(seed)
                    engine.npc_manager.tick()
                    outgoing = [e.to_dict() for e in engine.events.drain(user.id) if e.type in ['message', 'emote']]
                    actions = [{k: v for k, v in e.items() if k != '_ts'} for e in outgoing]
                    trials.append({'seed': seed, 'initialRelationship': score, 'event': event,
                                   'actions': actions, 'npcAction': live_npc.current_action,
                                   'position': [live_npc.x, live_npc.y]})
        return trials
    return snapshot(engine)


def main():
    manifest = verify()
    execution = WORK / ('execution-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    execution.mkdir(parents=True)
    database = execution / 'world.sqlite3'
    outputs = {}
    # Each phase imports upstream in a NEW process. No shutdown hook is installed
    # in action: it models a process ending before periodic/graceful flushing.
    for name in ['action', 'load-after-action', 'flush', 'load-after-flush', 'individual-save', 'load-after-individual-save', 'ticks', 'load-after-ticks', 'npc']:
        output = execution / (name + '.json')
        process = subprocess.run([sys.executable, '-I', '-B', '-X', 'utf8', str(Path(__file__).resolve()),
                                  '--phase', name, str(database), str(output)],
                                 env={k: v for k, v in os.environ.items() if k.upper() in ['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']},
                                 capture_output=True, text=True, encoding='utf8', timeout=45)
        (execution / (name + '.stderr.txt')).write_text(process.stderr, encoding='utf8')
        assert process.returncode == 0, process.stderr[-3000:]
        outputs[name] = json.loads(output.read_text(encoding='utf8'))
    a = outputs['action']['agents']
    reloaded = outputs['load-after-action']['agents']
    assert a['Alice']['relationships']['Bob'] == a['Bob']['relationships']['Alice'] == 2
    assert reloaded['Alice']['relationships']['Bob'] == 2
    assert reloaded['Bob']['relationships'].get('Alice', 0) == 0
    assert reloaded['Alice']['memory'] == a['Alice']['memory']
    assert outputs['flush']['agents']['Bob']['relationships'].get('Alice', 0) == 2
    assert outputs['load-after-flush']['agents']['Bob']['relationships'].get('Alice', 0) == 0
    assert 'Cannot operate on a closed database' in (execution / 'flush.stderr.txt').read_text()
    for field in ['relationships', 'memory', 'position']:
        for agent in ['Alice', 'Bob']:
            assert outputs['individual-save']['agents'][agent][field] == outputs['load-after-individual-save']['agents'][agent][field]
    assert outputs['ticks']['worldLogs'] == 1
    assert all('world_event' in events for events in outputs['ticks']['events'].values())
    trials = outputs['npc']
    def outcome(t):
        return {k: t[k] for k in ['actions', 'npcAction', 'position']}
    by = {(t['seed'], t['initialRelationship'], t['event']): t for t in trials}
    relationship_differences = sum(outcome(by[s,-80,e]) != outcome(by[s,80,e]) for s in range(20) for e in ['none','world_event','message'])
    world_differences = sum(outcome(by[s,r,'none']) != outcome(by[s,r,'world_event']) for s in range(20) for r in [-80,80])
    message_differences = sum(outcome(by[s,r,'none']) != outcome(by[s,r,'message']) for s in range(20) for r in [-80,80])
    assert relationship_differences == world_differences == 0
    assert message_differences > 0  # Positive control: actual NPC event response works.
    result = {'executedAt': datetime.now(timezone.utc).isoformat(), 'repository': manifest['repository'],
              'commit': manifest['commit'], 'verifiedFiles': len(manifest['files']),
              'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'scope': 'Unmodified upstream core + real Django ORM/SQLite/map; synthetic characters and interventions; no web/MCP/LLM execution.',
              'relationshipAction': {'inMemory': [2,2], 'reloadBeforeFlush': [2,0], 'memoryRestored': True},
              'explicitSaveAllRestoresAgentFields': False,
              'saveAllError': 'Cannot operate on a closed database (Django default CONN_MAX_AGE=0, same as pinned upstream base settings).',
              'individualSaveRestoresAgentFields': True,
              'clock': {'beforeRestart': outputs['ticks']['state']['clock'], 'afterRestart': outputs['load-after-ticks']['clock']},
              'worldEventDeliveredToBoth': True, 'npcTrials': len(trials),
              'relationshipChangedAction': {'differences': relationship_differences, 'pairs': 60},
              'worldEventChangedAction': {'differences': world_differences, 'pairs': 40},
              'messageChangedAction': {'differences': message_differences, 'pairs': 40},
              'limitations': ['NPCManager.tick called synchronously; not the async server scheduling path.',
                              '20 fixed seeds per intervention are controlled examples, not statistical coverage.',
                              'save_all uses the shutdown save primitive; the full command and OS signal were not executed.',
                              'No external LLM agent, complete game, user time savings or market validation.']}
    (execution / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    (WORK / 'latest.json').write_text(json.dumps({'directory': str(execution)}, indent=2), encoding='utf8')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--phase':
        answer = phase(sys.argv[2], Path(sys.argv[3]))
        Path(sys.argv[4]).write_text(json.dumps(answer, ensure_ascii=False, indent=2), encoding='utf8')
    else:
        main()
