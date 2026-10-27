"""Run the upstream manage.py with the isolated, pinned probe runtime."""
from pathlib import Path
import os
import runpy
import sys

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".data" / "experiments" / "agent-world-service"
BEHAVIOR = ROOT / ".data" / "experiments" / "agent-world-behavior"
RUNTIME = WORK / "runtime"
sys.path[:0] = [
    str(RUNTIME / "site-packages"),
    str(RUNTIME / "site-packages" / "win32"),
    str(RUNTIME / "site-packages" / "win32" / "lib"),
    str(RUNTIME / "site-packages" / "pywin32_system32"),
    str(WORK / "vendor"),
    str(WORK / "vendor" / "environment" / "frontend_server"),
    str(BEHAVIOR / "vendor"),
]
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "frontend_server.settings")
runpy.run_path(str(WORK / "vendor" / "environment" / "frontend_server" / "manage.py"), run_name="__main__")
