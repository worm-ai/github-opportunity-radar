"""Extract pinned wheels into this experiment only; do not mutate shared Python."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

base = Path(__file__).resolve().parents[2] / '.data/experiments/agent-world-behavior/runtime'
for item in json.loads((base / 'runtime.json').read_text())['wheels']:
    archive = base / (item['filename'] + '.zip')
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == item['sha256']
    with zipfile.ZipFile(archive) as wheel:
        for name in wheel.namelist():
            path = PurePosixPath(name)
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in name and ':' not in name
        wheel.extractall(base / 'site-packages')
    print('Verified and extracted', item['name'], item['version'])
