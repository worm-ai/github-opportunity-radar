"""Real core/ORM/SQLite probe; separate processes for each restart and condition."""
import faulthandler
# Bound startup too: subprocess timeouts cannot diagnose a parent import hang.
faulthandler.dump_traceback_later(45, exit=True)
import asyncio  # Initialize Windows networking runtime before clearing the child environment.
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
faulthandler.cancel_dump_traceback_later()

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / '.data/experiments/agent-world-adaptation'
BASE = ROOT / '.data/experiments/agent-world-behavior'


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf8')


def verify():
    manifest = json.loads((WORK / 'sources.json').read_text(encoding='utf8'))
    for item in manifest['files']:
        assert hashlib.sha256((WORK / 'vendor' / item['path']).read_bytes()).hexdigest() == item['sha256']
    for item in manifest['upstream']['files']:
        data = (BASE / 'vendor' / item['path']).read_bytes()
        assert hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() == item['blob']
    assert hashlib.sha256((WORK / 'upstream.patch').read_bytes()).hexdigest() == manifest['patchSha256']
    for item in json.loads((BASE / 'runtime/runtime.json').read_text())['wheels']:
        assert hashlib.sha256((BASE / 'runtime' / (item['filename'] + '.zip')).read_bytes()).hexdigest() == item['sha256']
    return manifest


def setup(database):
    verify()
    # The driver supplies only these OS keys. Keep Windows runtime variables
    # intact rather than mutating the C process environment after imports.
    assert all(key.upper() in ['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'] for key in os.environ)
    sys.path[:0] = [str(Path(__file__).resolve().parent), str(WORK / 'vendor'),
                   str(BASE / 'runtime/site-packages')]
    import django
    from django.conf import settings
    settings.configure(INSTALLED_APPS=['world'], DATABASES={'default': {
        'ENGINE': 'django.db.backends.sqlite3', 'NAME': str(database)}},
        SECRET_KEY='isolated-synthetic-adaptation', USE_TZ=True)
    django.setup()


def phase(name, database, argument):
    setup(database)
    from django.core.management import call_command
    from django.db import connection
    from adapter import AdaptedWorld
    if name == 'initialize':
        call_command('migrate', verbosity=0)
    if name == 'expect-corruption':
        try:
            AdaptedWorld()
        except (AssertionError, ValueError) as error:
            return {'rejected': True, 'error': str(error)}
        raise AssertionError('Corrupt world silently loaded')
    world = AdaptedWorld()
    if name == 'initialize':
        world.initialize()
    elif name == 'talk':
        from unittest.mock import patch
        alice = next(a for a in world.agents.agents.values() if a.name == 'Alice')
        with patch('time.time', return_value=1_000_011):
            assert world.handle_action(alice.id, {'type': 'whisper', 'target': 'Bob', 'message': 'Persistence probe.'})['ok']
    elif name == 'ticks':
        for _ in range(int(argument)):
            world.step()
    elif name == 'intervention':
        from unittest.mock import patch
        from world.events import WorldEvent
        condition = json.loads(argument)
        by_name = {a.name: a for a in world.agents.agents.values()}
        by_name['Alice'].relationships[by_name['Bob'].id] = condition.get('relationship', 80)
        by_name['Cara'].memory = ['pipe valve map'] if condition.get('memory', False) else []
        if condition.get('event'):
            world.water_event()
        # Same physical resource and agent position in every paired condition.
        with patch('time.time', return_value=1_000_011):
            rows = world.decision_step(condition.get('disabled'))
        return {'condition': condition, 'decisions': rows, 'state': world.payload()}
    elif name == 'queue-event':
        world.water_event()
        world.save_world()
    elif name == 'rollback':
        from world.models import AgentRecord, WorldCheckpoint
        before = WorldCheckpoint.objects.get(pk=1).payload
        expected = {a.agent_id: (a.name, a.memory_json) for a in AgentRecord.objects.all()}
        for a in world.agents.agents.values():
            a.memory.append('must roll back')
        failed = False
        if argument == 'database':
            with connection.cursor() as cursor:
                cursor.execute("CREATE TRIGGER reject_bob BEFORE UPDATE ON world_agentrecord "
                               "WHEN OLD.name = 'Bob' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END")
        try:
            world.save_world(fail_after_agents=argument == 'checkpoint')
        except Exception as error:
            failed = True
            message = str(error)
        assert failed, 'Save failure was swallowed'
        if argument == 'database':
            with connection.cursor() as cursor:
                cursor.execute('DROP TRIGGER reject_bob')
        assert WorldCheckpoint.objects.get(pk=1).payload == before
        actual = {a.agent_id: (a.name, a.memory_json) for a in AgentRecord.objects.all()}
        assert actual == expected
        return {'errorPropagated': True, 'agentsRolledBack': True,
                'checkpointUnchanged': True, 'error': message}
    return world.payload()


def semantic(value):
    if isinstance(value, dict):
        return {key: semantic(item) for key, item in value.items() if key not in ['timestamp', '_ts']}
    if isinstance(value, list):
        return [semantic(item) for item in value]
    return value


def clone(source, target):
    with sqlite3.connect(source) as current, sqlite3.connect(target) as destination:
        current.backup(destination)


def main():
    manifest = verify()
    execution = WORK / ('execution-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    execution.mkdir(parents=True)
    count = 0

    def run(name, database, argument='', label=None):
        nonlocal count
        count += 1
        label = label or f'{count:02d}-{name}'
        output = execution / (label + '.json')
        process = subprocess.run([sys.executable, '-I', '-B', '-X', 'utf8', str(Path(__file__).resolve()),
                                  '--phase', name, str(database), str(output), argument],
                                 env={k: v for k, v in os.environ.items() if k.upper() in ['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']},
                                 capture_output=True, text=True, encoding='utf8', timeout=60)
        (execution / (label + '.stderr.txt')).write_text(process.stderr, encoding='utf8')
        (execution / (label + '.stdout.txt')).write_text(process.stdout, encoding='utf8')
        assert process.returncode == 0, f'{label} exit {process.returncode}: {process.stderr[-3500:]} {process.stdout[-1000:]}'
        assert 'closed database' not in process.stderr
        return json.loads(output.read_text(encoding='utf8'))

    seed = execution / 'seed.sqlite3'
    initial = run('initialize', seed, label='initial')
    uninterrupted, split = execution / 'continuous.sqlite3', execution / 'split.sqlite3'
    clone(seed, uninterrupted)
    clone(seed, split)
    end = run('ticks', uninterrupted, '30', 'continuous-30')
    halfway = run('ticks', split, '13', 'split-13')
    reopened = run('load', split, label='reload-13')
    assert semantic(halfway) == semantic(reopened), 'Fresh process lost state at checkpoint'
    resumed = run('ticks', split, '17', 'resumed-30')
    assert semantic(end) == semantic(resumed), 'Restart changed the semantic trajectory'
    assert len(end['agents']) == 3 and len(end['decisions']) == 90
    assert end['tickCount'] == 30 and end['clock'] == {'day': 1, 'hour': 13, 'minute': 30}
    assert any(row['selected'] == 'repair' for row in end['decisions'])
    assert any(row['selected'] == 'ration' for row in end['decisions'])
    assert end['water']['damaged'] is False
    assert any('pipe valve map' in agent['memory'] for agent in end['agents'].values())
    assert all(agent['relationships'] for agent in end['agents'].values())

    talking_db = execution / 'talk.sqlite3'
    clone(seed, talking_db)
    talking = run('talk', talking_db, label='talk')
    assert semantic(talking) == semantic(run('load', talking_db, label='reload-after-talk'))
    actors = {a['name']: a for a in talking['agents'].values()}
    assert actors['Alice']['relationships'][actors['Bob']['id']] == 1
    assert actors['Bob']['relationships'][actors['Alice']['id']] == 1

    # Pending input is part of continuity, not just clock/agent field snapshots.
    queued_db = execution / 'queued.sqlite3'
    clone(seed, queued_db)
    queued = run('queue-event', queued_db, label='queued-event')
    assert semantic(queued) == semantic(run('load', queued_db, label='reloaded-event'))

    trials, effects = [], []
    cases = [('event', 'Bob', False, True), ('relationship', 'Alice', -80, 80),
             ('memory', 'Cara', False, True)]
    for dimension, actor, low, high in cases:
        pair = []
        for disabled in [None, dimension]:
            selected = []
            for index, value in enumerate([low, high]):
                database = execution / f'{dimension}-{disabled}-{index}.sqlite3'
                clone(seed, database)
                condition = {'event': True, 'relationship': 80, 'memory': False,
                             dimension: value, 'disabled': disabled}
                result = run('intervention', database, json.dumps(condition),
                             f'{dimension}-{disabled}-{index}')
                decision = next(row for row in result['decisions'] if row['agent'] == actor)
                selected.append(decision['selected'])
                trials.append({'dimension': dimension, 'actor': actor, 'condition': condition,
                               'selected': decision['selected'], 'allDecisions': result['decisions']})
            if disabled is None:
                assert selected[0] != selected[1], (dimension, selected)
            else:
                assert selected[0] == selected[1], (dimension, 'ablation did not remove effect', selected)
            pair.append({'disabled': disabled, 'actions': selected})
        effects.append({'dimension': dimension, 'actor': actor, 'pairs': pair})
    write(execution / 'interventions.json', trials)

    failures = []
    for mode in ['checkpoint', 'database']:
        database = execution / f'rollback-{mode}.sqlite3'
        clone(seed, database)
        failures.append(run('rollback', database, mode, f'rollback-{mode}'))
        assert semantic(initial) == semantic(run('load', database, label=f'reload-after-{mode}-failure'))
    for mode in ['checksum', 'mixed-agent']:
        database = execution / f'corrupt-{mode}.sqlite3'
        clone(seed, database)
        with sqlite3.connect(database) as db:
            if mode == 'checksum':
                db.execute("UPDATE world_worldcheckpoint SET payload = '{}' WHERE id=1")
            else:
                db.execute("UPDATE world_agentrecord SET memory_json = '[\"out-of-band\"]' WHERE name='Bob'")
        failures.append(run('expect-corruption', database, label=f'corrupt-{mode}'))
    write(execution / 'failures.json', failures)
    scripts = {name: hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest()
               for name in ['prepare.py', 'adapter.py', 'run.py']}
    result = {'executedAt': datetime.now(timezone.utc).isoformat(),
              'repository': manifest['upstream']['repository'], 'commit': manifest['upstream']['commit'],
              'upstreamFilesUnchanged': len(manifest['upstream']['files']), 'patchSha256': manifest['patchSha256'],
              'scripts': scripts, 'subprocesses': count, 'agents': 3, 'ticks': 30, 'decisions': 90,
              'checkpointReloadEqual': True, 'resumedTrajectoryEqual': True, 'queuedEventsRestored': True,
              'singleActionSavesBothRelationshipSides': True,
              'clock': end['clock'], 'water': end['water'], 'effects': effects,
              'atomicFailureAndCorruptionChecks': failures,
              'scope': 'Adapted core + authored deterministic rules, real ORM/SQLite/map/actions. No LLM or full web/MCP app.',
              'limitations': [
                  'Synthetic rule policy and resource semantics are NEW adapter code, not upstream capability or emergent intelligence.',
                  'Virtual 11-second steps; no wall-clock performance, real player or independent time-saving measurement.',
                  'Only serial completed-step checkpoints and injected transaction failures; no concurrent server, OS kill mid-tick, power-loss or production migration validation.',
                  'Trajectory equality ignores event timestamps only; actual durable state, random generator, relations, memories, pending inputs and decisions are compared.',
                  'No external model, Godot graphics, MCP networking, full game acceptance or repair-cost comparison against Microverse.'
              ]}
    write(execution / 'result.json', result)
    verify()
    write(WORK / 'latest.json', {'directory': str(execution)})
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--phase':
        write(Path(sys.argv[4]), phase(sys.argv[2], Path(sys.argv[3]), sys.argv[5]))
    else:
        main()
