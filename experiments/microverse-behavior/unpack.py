"""Extract only tree-verified upstream files into an isolated directory."""
import hashlib
import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
work = root / '.data/experiments/microverse-behavior'
manifest = json.loads((work / 'preparation.json').read_text(encoding='utf8'))
tree = json.loads((root / '.data/research/microverse-source/tree.json').read_text(encoding='utf8'))
assert not tree['truncated']
files = []
vendor = work / 'vendor'
with zipfile.ZipFile(work / 'source.zip') as archive:
    prefix = 'Microverse-' + manifest['commit'] + '/'
    for item in tree['tree']:
        if item['type'] != 'blob':
            continue
        target = (vendor / item['path']).resolve()
        assert target.is_relative_to(vendor.resolve())
        content = archive.read(prefix + item['path'])
        blob = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
        assert blob == item['sha'], item['path']
        assert len(content) == item['size'], item['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        files.append({'path': item['path'], 'blob': blob, 'bytes': len(content)})
engine_dir = work / 'runtime'
with zipfile.ZipFile(work / manifest['engineArchive']) as archive:
    for info in archive.infolist():
        target = (engine_dir / info.filename).resolve()
        assert target.is_relative_to(engine_dir.resolve())
        if not info.is_dir():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(info))
(work / 'sources.json').write_text(json.dumps({**manifest, 'files': files}, indent=2), encoding='utf8')
print(json.dumps({'verifiedFiles': len(files), 'engine': manifest['engineVersion']}))
