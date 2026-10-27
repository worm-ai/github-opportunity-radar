"""Create a reviewable, disposable adaptation of the already verified upstream."""
import difflib
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / '.data/experiments/agent-world-behavior'
WORK = ROOT / '.data/experiments/agent-world-adaptation'


def prepare():
    manifest = json.loads((BASE / 'sources.json').read_text(encoding='utf8'))
    assert manifest['commit'] == '13d62dbdeeca07c7b5bb3b8aa264ca9834b01882'
    WORK.mkdir(parents=True, exist_ok=True)
    vendor = WORK / 'vendor'
    changes = []
    for item in manifest['files']:
        source = BASE / 'vendor' / item['path']
        data = source.read_bytes()
        assert hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() == item['blob']
        target = vendor / item['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    path = vendor / 'world/agents.py'
    original = path.read_text(encoding='utf8')
    start = original.index('    def save_agent(')
    end = original.index('    def register(', start)
    # Keep the upstream ORM fields; change transaction boundaries and error semantics.
    body_start = original.index('            AgentRecord.objects.update_or_create(', start)
    body_end = original.index('        except Exception as e:', body_start)
    body = ''.join(line[4:] if line.startswith('    ') else line
                   for line in original[body_start:body_end].splitlines(keepends=True))
    replacement = '''    def save_agent(self, agent_id: str):
        """Adaptation: propagate errors; never close a transaction's connection."""
        agent = self.agents.get(agent_id)
        if not agent:
            return
        from django.db import close_old_connections, connection
        from world.models import AgentRecord
        if not connection.in_atomic_block:
            close_old_connections()
''' + body + '''
    def save_all(self):
        from django.db import close_old_connections, connection, transaction
        if not connection.in_atomic_block:
            close_old_connections()
        with transaction.atomic():
            for agent_id in list(self.agents):
                self.save_agent(agent_id)

'''
    changed = original[:start] + replacement + original[end:]
    path.write_text(changed, encoding='utf8')
    changes.extend(difflib.unified_diff(original.splitlines(True), changed.splitlines(True),
                                      'upstream/world/agents.py', 'adapted/world/agents.py'))
    path = vendor / 'world/models.py'
    original = path.read_text(encoding='utf8')
    changed = original + '''

class WorldCheckpoint(models.Model):
    """Adaptation-only checkpoint, in the same SQLite transaction as AgentRecord."""
    payload = models.TextField()
    sha256 = models.CharField(max_length=64)

    class Meta:
        app_label = "world"
'''
    path.write_text(changed, encoding='utf8')
    changes.extend(difflib.unified_diff(original.splitlines(True), changed.splitlines(True),
                                      'upstream/world/models.py', 'adapted/world/models.py'))
    migration = '''from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("world", "0005_agentrecord_is_npc")]
    operations = [migrations.CreateModel(name="WorldCheckpoint", fields=[
        ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
        ("payload", models.TextField()), ("sha256", models.CharField(max_length=64)),
    ])]
'''
    (vendor / 'world/migrations/0006_adaptation_checkpoint.py').write_text(migration, encoding='utf8')
    changes.extend(difflib.unified_diff([], migration.splitlines(True),
                                      '/dev/null', 'adapted/world/migrations/0006_adaptation_checkpoint.py'))
    (WORK / 'upstream.patch').write_text(''.join(changes), encoding='utf8')
    files = []
    for path in sorted(vendor.rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts:
            files.append({'path': path.relative_to(vendor).as_posix(),
                          'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    result = {'upstream': manifest, 'files': files,
              'patchSha256': hashlib.sha256((WORK / 'upstream.patch').read_bytes()).hexdigest()}
    (WORK / 'sources.json').write_text(json.dumps(result, indent=2), encoding='utf8')
    print(json.dumps({'verifiedOriginalFiles': len(manifest['files']), 'adaptedFiles': len(files),
                      'patch': str(WORK / 'upstream.patch')}))


if __name__ == '__main__':
    prepare()
