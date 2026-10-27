"""Real MCP/ASGI integration probe. No replacement protocol or paid model.

Loopback, isolated SQLite, two Uvicorn servers on one loop. This launcher is
NOT the upstream runworld/Daphne thread topology, nor a concurrency solution.
"""
import faulthandler
faulthandler.dump_traceback_later(90, exit=True)
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / '.data/experiments/agent-world-service'
BASE = ROOT / '.data/experiments/agent-world-behavior'
ADAPTED = ROOT / '.data/experiments/agent-world-adaptation'


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf8')


def setup(mode, database, seed=True, service=False):
    # Windows injects a small set of process-launch variables even when the
    # parent supplies an allowlisted environment.  Keep the assertion while
    # allowing those non-secret runtime keys; no user environment is read.
    allowed_env = {
        'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'SYSTEMDRIVE',
        'HOMEDRIVE', 'HOMEPATH', 'USERPROFILE', 'USERNAME', 'USERDOMAIN',
        'LOGONSERVER', 'SYSTEMDRIVE',
    }
    assert all(k.upper() in allowed_env for k in os.environ)
    runtime_manifest = json.loads((WORK / 'runtime/runtime.json').read_text(encoding='utf8'))
    for item in runtime_manifest['wheels']:
        assert hashlib.sha256((WORK / 'runtime/wheels' / item['filename']).read_bytes()).hexdigest() == item['sha256']
    original_manifest = json.loads((BASE / 'sources.json').read_text(encoding='utf8'))
    for item in original_manifest['files']:
        data = (BASE / 'vendor' / item['path']).read_bytes()
        assert hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() == item['blob']
    adapted_manifest = json.loads((ADAPTED / 'sources.json').read_text(encoding='utf8'))
    for item in adapted_manifest['files']:
        assert hashlib.sha256((ADAPTED / 'vendor' / item['path']).read_bytes()).hexdigest() == item['sha256']
    service = json.loads((WORK / 'sources.json').read_text(encoding='utf8'))
    for item in service['files']:
        data = (WORK / 'vendor' / item['path']).read_bytes()
        assert hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() == item['blob']
    source = BASE if mode.startswith('original') else ADAPTED
    runtime = WORK / 'runtime/site-packages'
    sys.path[:0] = [str(runtime), str(runtime / 'win32'), str(runtime / 'win32/lib'), str(runtime / 'pywin32_system32'), str(source / 'vendor'),
                   str(WORK / 'vendor/environment/frontend_server'), str(WORK / 'vendor'),
                   str(ROOT / 'experiments/agent-world-adaptation'),
                   str(ROOT / 'experiments/agent-world-service')]
    from frontend_server.settings import base
    from django.conf import settings
    configured = {k: v for k, v in vars(base).items() if k.isupper()}
    configured.update(DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': str(database)}},
                      ALLOWED_HOSTS=['127.0.0.1', 'localhost'], DEBUG=False,
                      SECRET_KEY='synthetic-local-service-probe', POSTHOG_API_KEY='')
    settings.configure(**configured)
    import django
    django.setup()
    from django.core.management import call_command
    call_command('migrate', verbosity=0)
    from world.engine import WorldEngine
    if mode.startswith('original'):
        engine = WorldEngine()
        if seed:
            for name in ['Alice', 'Bob', 'Cara']:
                engine.agents.register(name, api_key='synthetic-local-' + name)
            tile = engine.grid.get_random_position_in_sector('Hobbs Cafe')
            for actor in engine.agents.agents.values():
                actor.x, actor.y = tile
                actor.zone = engine.grid.get_sector(*tile)
            engine.agents.save_all()
    else:
        from adapter import AdaptedWorld
        engine = AdaptedWorld()
        if seed:
            engine.initialize()
            # Return to wall time for a real service; do not use virtual time.
            import time
            for actor in engine.agents.agents.values():
                actor.last_seen = time.time()
            engine.save_world()
    WorldEngine._instance = engine
    if not seed and not service:
        return engine, None, None
    # Keep the async MCP boundary outside the synchronous engine/ORM.
    from async_bridge import install
    install()
    from mcp_server.server import create_app
    app = create_app(host='127.0.0.1', port=4326)
    from frontend_server.asgi import application
    return engine, app, application


def disk_agents(database):
    with sqlite3.connect(database) as db:
        db.row_factory = sqlite3.Row
        return [dict(r) for r in db.execute('SELECT agent_id,name,current_action,memory_json FROM world_agentrecord ORDER BY name')]


async def probe(mode, database, engine, app, frontend, output):
    import aiohttp
    import uvicorn
    from channels.layers import get_channel_layer
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client
    async def broadcast(state):
        await get_channel_layer().group_send('world_viewers', {'type': 'world.update', 'data': state})
    engine.set_broadcast_callback(broadcast)
    servers = [uvicorn.Server(uvicorn.Config(application, host='127.0.0.1', port=port, log_level='warning'))
               for application, port in [(app.streamable_http_app(), 4326), (frontend, 4325)]]
    jobs = [asyncio.create_task(server.serve()) for server in servers]
    tick = None
    try:
        async with asyncio.timeout(20):
            while not all(server.started for server in servers):
                for job in jobs:
                    if job.done(): job.result()
                await asyncio.sleep(.05)
        result = {'mode': mode, 'launcher': 'Single asyncio loop, actual FastMCP + frontend ASGI, loopback only',
                  'beforeDisk': disk_agents(database), 'calls': []}
        async with aiohttp.ClientSession() as http:
            async with http.ws_connect('http://127.0.0.1:4325/ws/world/', timeout=10) as ws:
                result['observerInitial'] = await ws.receive_json(timeout=10)
                async with streamablehttp_client('http://127.0.0.1:4326/mcp') as (reader, writer, _):
                    async with ClientSession(reader, writer) as session:
                        initialized = await session.initialize()
                        result['protocolVersion'] = initialized.protocolVersion
                        result['tools'] = [t.name for t in (await session.list_tools()).tools]
                        async def call(name, arguments):
                            response = await session.call_tool(name, arguments)
                            value = response.model_dump(mode='json')
                            result['calls'].append({'name': name, 'arguments': arguments, 'response': value})
                            return response
                        async def call_without_recording(name, arguments):
                            try:
                                response = await session.call_tool(name, arguments)
                                return response.model_dump(mode='json')
                            except Exception as error:
                                return {'error': type(error).__name__ + ': ' + str(error)}
                        await call('get_world_context', {'agent_api_key': 'synthetic-local-Alice'})
                        await call('act', {'agent_api_key': 'synthetic-local-Alice', 'action_type': 'remember', 'note': 'service persistence probe'})
                        await call('act', {'agent_api_key': 'synthetic-local-Alice', 'action_type': 'emote', 'emote': 'service-visible-probe'})
                        await call('get_world_context', {'agent_api_key': 'synthetic-local-Alice'})
                        await call('act', {'agent_api_key': 'unknown-synthetic-key', 'action_type': 'remember', 'note': 'must not persist'})
                        await call('act', {'agent_api_key': 'synthetic-local-Alice', 'action_type': 'invalid-action'})
                        # Two independent MCP clients exercise the serialized
                        # sync boundary while both agents mutate the world.
                        async with streamablehttp_client('http://127.0.0.1:4326/mcp') as (reader2, writer2, _):
                            async with ClientSession(reader2, writer2) as session2:
                                await session2.initialize()
                                async def concurrent_call(api_key, message):
                                    response = await session2.call_tool('act', {
                                        'agent_api_key': api_key, 'action_type': 'speak', 'message': message})
                                    return response.model_dump(mode='json')
                                concurrent = await asyncio.gather(
                                    concurrent_call('synthetic-local-Alice', 'concurrent Alice'),
                                    concurrent_call('synthetic-local-Bob', 'concurrent Bob'))
                                result['concurrent'] = concurrent
                        # Force a write failure after the handler has mutated
                        # state. The outer transaction must roll back both ORM
                        # rows and the in-memory graph.
                        before_failure = disk_agents(database)
                        before_memory = engine.agents.get_by_api_key('synthetic-local-Alice').memory[:]
                        engine._bridge_test_fail_next = True
                        failure = await call_without_recording('act', {
                            'agent_api_key': 'synthetic-local-Alice', 'action_type': 'remember',
                            'note': 'must rollback'})
                        after_failure = disk_agents(database)
                        result['saveFailure'] = {
                            'response': failure,
                            'diskUnchanged': before_failure == after_failure,
                            'memoryUnchanged': before_memory == engine.agents.get_by_api_key('synthetic-local-Alice').memory,
                        }
                        assert result['saveFailure']['diskUnchanged']
                        assert result['saveFailure']['memoryUnchanged']
                        await call('wait_for_event', {'agent_api_key': 'synthetic-local-New', 'agent_name': 'New', 'timeout': 1})
                        # Inject one bridge write failure and assert the
                        # rejected registration cannot become memory-only.
                        engine._bridge_test_fail_next = True
                        await call('wait_for_event', {'agent_api_key': 'synthetic-local-Rejected', 'agent_name': 'Rejected', 'timeout': 1})
                        # Run the real loop only after actions, so broadcasts carry their result.
                        tick = asyncio.create_task(engine.run_tick_loop())
                        result['observerAfter'] = await ws.receive_json(timeout=15)
                        async with http.get('http://127.0.0.1:4325/api/world_state/') as response:
                            result['restStatus'] = response.status
                            result['restAfter'] = await response.json()
                        result['afterDisk'] = disk_agents(database)
                        result['inMemory'] = {a.name: a.to_full() for a in engine.agents.agents.values()}
                        write(output, result)
        return result
    finally:
        if tick:
            engine.request_shutdown();tick.cancel()
            await asyncio.gather(tick, return_exceptions=True)
        for server in servers: server.should_exit = True
        await asyncio.gather(*jobs, return_exceptions=True)


def main():
    assert (WORK / 'runtime/runtime.json').is_file(), 'Wait for bootstrap to exit successfully before running'
    execution = WORK / ('execution-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    execution.mkdir(parents=True)
    results = []
    for mode in ['original-bridged', 'adapted-bridged']:
        for phase in ['child', 'reload']:
            label = mode if phase == 'child' else mode + '-reload'
            command = [sys.executable, '-I', '-B', '-X', 'utf8', str(Path(__file__).resolve()),
                       '--' + phase, mode, str(execution / (mode + '.sqlite3')), str(execution / (label + '.json'))]
            env = {k: v for k, v in os.environ.items() if k.upper() in ['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']}
            child = subprocess.run(command, env=env, capture_output=True, text=True, encoding='utf8', timeout=100)
            (execution / (label + '.stderr.txt')).write_text(child.stderr, encoding='utf8')
            (execution / (label + '.stdout.txt')).write_text(child.stdout, encoding='utf8')
            results.append({'mode': mode, 'phase': phase, 'returncode': child.returncode})
            write(execution / 'processes.json', results)
            assert child.returncode == 0, f'{label} exited {child.returncode}: {child.stderr[-3000:]}'
    write(WORK / 'latest.json', {'directory': str(execution)})
    print(json.dumps({'directory': str(execution), 'processes': results}))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] in ['--child', '--reload']:
        mode, database, output = sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4])
        engine, app, frontend = setup(mode, database, seed=sys.argv[1] == '--child')
        if sys.argv[1] == '--child':
            asyncio.run(probe(mode, database, engine, app, frontend, output))
        else:
            write(output, {'clock': engine.clock, 'agents': {a.name: a.to_full() for a in engine.agents.agents.values()},
                           'disk': disk_agents(database)})
    else:
        main()
    faulthandler.cancel_dump_traceback_later()
