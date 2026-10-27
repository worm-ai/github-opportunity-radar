"""Probe save/load boundaries in the verified Stanford Generative Agents sources.

The probe uses only the checked-in vendor files reconstructed by
prepare-stanford-state-probe.mjs.  It intentionally supplies a tiny synthetic
state because the saved research material does not contain a complete upstream
runtime or bootstrap world.
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from types import ModuleType


ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / ".data/experiments/stanford-state-20261024/vendor"
OUT = ROOT / ".data/experiments/stanford-state-20261024/recovery-probe"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load_sources():
    # The verified files import global_methods, but the tested methods only need
    # its file-existence helper. No unverified upstream code is imported.
    global_methods = ModuleType("global_methods")
    global_methods.check_if_file_exists = lambda path: os.path.exists(path)
    sys.modules["global_methods"] = global_methods
    associative = load_module("stanford_associative_memory", VENDOR / "associative_memory.py")
    scratch = load_module("stanford_scratch", VENDOR / "scratch.py")
    return associative, scratch


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def seed_memory(path: Path):
    created = "2026-10-24 09:00:00"
    write_json(path / "embeddings.json", {"event-key": [1.0, 0.0]})
    write_json(path / "nodes.json", {
        "node_1": {
            "node_count": 1,
            "type_count": 1,
            "type": "event",
            "depth": 0,
            "created": created,
            "expiration": None,
            "subject": "Ada",
            "predicate": "sees",
            "object": "market",
            "description": "Ada sees market",
            "embedding_key": "event-key",
            "poignancy": 3,
            "keywords": ["market"],
            "filling": [],
        }
    })
    write_json(path / "kw_strength.json", {
        "kw_strength_event": {"market": 1},
        "kw_strength_thought": {},
    })


def scratch_state(scratch):
    scratch.curr_time = dt.datetime(2026, 10, 24, 10, 15, 0)
    scratch.act_start_time = dt.datetime(2026, 10, 24, 10, 0, 0)
    scratch.name = "Ada"
    scratch.first_name = "Ada"
    scratch.last_name = "Lovelace"
    scratch.age = 36
    scratch.curr_tile = [1, 2]
    scratch.daily_plan_req = "visit the market"
    scratch.daily_req = ["visit market"]
    scratch.f_daily_schedule = [["visit market", 30]]
    scratch.f_daily_schedule_hourly_org = [["visit market", 30]]
    scratch.act_address = "town:market:stall"
    scratch.act_duration = 15
    scratch.act_description = "visiting the market"
    scratch.act_pronunciatio = "walk"
    scratch.act_event = ("Ada", "visits", "market")
    scratch.act_obj_event = ("market", "is", "open")
    scratch.planned_path = [[1, 3], [1, 4]]


def run_write_normal(out: Path):
    _, scratch_module = load_sources()
    scratch = scratch_module.Scratch(str(out / "missing.json"))
    scratch_state(scratch)
    scratch.save(str(out / "scratch-normal.json"))
    return {"save": "ok", "path": str(out / "scratch-normal.json")}


def run_read_normal(out: Path):
    _, scratch_module = load_sources()
    loaded = scratch_module.Scratch(str(out / "scratch-normal.json"))
    return {
        "curr_time": loaded.curr_time.isoformat() if loaded.curr_time else None,
        "act_start_time": loaded.act_start_time.isoformat() if loaded.act_start_time else None,
        "act_address": loaded.act_address,
        "planned_path": loaded.planned_path,
    }


def run_write_memory(out: Path):
    associative, _ = load_sources()
    seed = out / "memory-seed"
    seed_memory(seed)
    memory = associative.AssociativeMemory(str(seed))
    node = memory.id_to_node["node_1"]
    node.last_accessed = dt.datetime(2026, 10, 24, 12, 34, 56)
    saved = out / "memory-saved"
    saved.mkdir(parents=True, exist_ok=True)
    memory.save(str(saved))
    return {"save": "ok", "created": node.created.isoformat(), "last_accessed_before": node.last_accessed.isoformat()}


def run_read_memory(out: Path):
    associative, _ = load_sources()
    memory = associative.AssociativeMemory(str(out / "memory-saved"))
    node = memory.id_to_node["node_1"]
    return {
        "created": node.created.isoformat(),
        "last_accessed_after": node.last_accessed.isoformat(),
    }


def write_null_action_input(out: Path):
    _, scratch_module = load_sources()
    scratch = scratch_module.Scratch(str(out / "missing.json"))
    scratch_state(scratch)
    scratch.act_start_time = None
    scratch.save(str(out / "scratch-null-action.json"))


def read_null_action_input(out: Path):
    _, scratch_module = load_sources()
    loaded = scratch_module.Scratch(str(out / "scratch-null-action-input.json"))
    return {
        "curr_time": loaded.curr_time.isoformat() if loaded.curr_time else None,
        "act_start_time": loaded.act_start_time.isoformat() if loaded.act_start_time else None,
    }


def make_null_action_input(out: Path):
    # Start with a real normal save, then set only act_start_time to JSON null.
    run_write_normal(out)
    data = json.loads((out / "scratch-normal.json").read_text(encoding="utf-8"))
    data["act_start_time"] = None
    write_json(out / "scratch-null-action-input.json", data)


def child(case: str, phase: str):
    OUT.mkdir(parents=True, exist_ok=True)
    if case == "normal" and phase == "write":
        result = run_write_normal(OUT)
    elif case == "normal" and phase == "read":
        result = run_read_normal(OUT)
    elif case == "memory" and phase == "write":
        result = run_write_memory(OUT)
    elif case == "memory" and phase == "read":
        result = run_read_memory(OUT)
    elif case == "null-action" and phase == "make":
        make_null_action_input(OUT)
        result = {"input": "created"}
    elif case == "null-action" and phase == "read":
        result = read_null_action_input(OUT)
    elif case == "null-action" and phase == "save":
        write_null_action_input(OUT)
        result = {"save": "ok"}
    else:
        raise ValueError((case, phase))
    print(json.dumps(result, sort_keys=True))


def run_child(case: str, phase: str):
    command = [sys.executable, str(Path(__file__)), "--child", case, phase]
    completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    if completed.returncode == 0 and lines:
        return {"returncode": 0, "result": json.loads(lines[-1]), "stderr": completed.stderr}
    return {"returncode": completed.returncode, "stdout": completed.stdout, "stderr": completed.stderr}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--child", nargs=2, metavar=("CASE", "PHASE"))
    args = parser.parse_args()
    if args.child:
        child(*args.child)
        return

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    results = {"observedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "sourceRoot": str(VENDOR), "cases": {}}

    normal_write = run_child("normal", "write")
    normal_read = run_child("normal", "read")
    results["cases"]["normal"] = {"write": normal_write, "read": normal_read}

    null_save = run_child("null-action", "save")
    null_make = run_child("null-action", "make")
    null_read = run_child("null-action", "read")
    results["cases"]["null_action_time"] = {"save_with_null": null_save, "load_null": {"make": null_make, "read": null_read}}

    memory_write = run_child("memory", "write")
    memory_read = run_child("memory", "read")
    results["cases"]["memory_last_accessed"] = {"write": memory_write, "read": memory_read}

    write_json(OUT / "results.json", results)
    print(json.dumps(results, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
