"""Measure unmodified upstream extractors against explicitly synthetic log fixtures.

Never discovers installations or reads the user's conversation history. The only
inputs are generated below under this experiment's own fixture directory.
"""
from __future__ import annotations

import hashlib
import importlib
import json
from pathlib import Path
import platform
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".data/research/policy-session"
VENDOR = WORK / "vendor/ai-data-extractor"
FIXTURES = WORK / "fixtures"
OUTPUT = WORK / "execution"
COMMIT = "df66cb083cf597edbedf49684f762581ce250f8e"


def dump(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def jsonl(path: Path, events: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")


def claude_event(session: str, role: str, content, **extra) -> dict:
    return {"type": role, "sessionId": session, "cwd": "/synthetic/workspace",
            "timestamp": "2026-10-21T06:00:00Z", "message": {"role": role, "content": content}, **extra}


def call(call_id: str, name="Read", **args) -> dict:
    return {"type": "tool_use", "id": call_id, "name": name, "input": args}


def result(call_id: str, content: str, failed=False) -> dict:
    return {"type": "tool_result", "tool_use_id": call_id, "content": content, "is_error": failed}


def codex_event(payload: dict, event_type="response_item") -> dict:
    return {"timestamp": "2026-10-21T06:00:00Z", "type": event_type, "payload": payload}


def codex_message(role: str, text: str) -> dict:
    return codex_event({"type": "message", "role": role,
                        "content": [{"type": "input_text" if role == "user" else "output_text", "text": text}]})


def main() -> None:
    # Verify the Git blob hashes before importing the exact downloaded code.
    manifest = json.loads((WORK / "files.json").read_text(encoding="utf-8"))
    source_records = []
    for file in manifest:
        if file["repository"] != "jatechan/ai-data-extractor":
            continue
        data = (ROOT / file["local"]).read_bytes()
        git_blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if git_blob != file["blob"] or file["commit"] != COMMIT:
            raise RuntimeError("Source provenance mismatch: " + file["path"])
        source_records.append({**file, "sha256": hashlib.sha256(data).hexdigest(),
                               "content": data.decode("utf-8")})
    if {s["path"] for s in source_records} != {
        "extractors/claude_code.py", "extractors/codex.py", "extractors/common.py", "LICENSE"
    }:
        raise RuntimeError("Required original extractor modules or license missing")
    sys.path.insert(0, str(VENDOR))
    claude = importlib.import_module("extractors.claude_code")
    codex = importlib.import_module("extractors.codex")

    fixtures: dict[str, dict] = {}

    def fixture(key: str, relative: str, events: list[dict]) -> None:
        jsonl(FIXTURES / key / relative, events)
        fixtures.setdefault(key, {})[relative] = events

    # Positive control: tool IDs, arguments, outputs, a failure and a retry.
    fixture("claude-linear", "projects/project/linear.jsonl", [
        claude_event("linear", "user", "SYNTHETIC: read the public sample; retry a failed read"),
        claude_event("linear", "assistant", [call("read-1", file_path="/synthetic/public.txt")]),
        claude_event("linear", "user", [result("read-1", "SYNTHETIC_PUBLIC")]),
        claude_event("linear", "assistant", [call("read-2", file_path="/synthetic/missing.txt")]),
        claude_event("linear", "user", [result("read-2", "SYNTHETIC_NOT_FOUND", True)]),
        claude_event("linear", "assistant", [call("read-3", file_path="/synthetic/public.txt")]),
        claude_event("linear", "user", [result("read-3", "SYNTHETIC_RETRY_OK")]),
    ])
    # A supplied session switch in one file: this is not a reproduction of #592.
    fixture("claude-switch", "projects/project/switch.jsonl", [
        claude_event("before", "user", "SYNTHETIC: start before session switch"),
        claude_event("before", "assistant", [call("before-call", file_path="/synthetic/a.txt")]),
        claude_event("before", "user", [result("before-call", "SYNTHETIC_A")]),
        claude_event("after", "assistant", [call("after-call", file_path="/synthetic/b.txt")]),
        claude_event("after", "user", [result("after-call", "SYNTHETIC_B")]),
    ])
    fixture("claude-subagent", "projects/project/root.jsonl", [
        claude_event("root", "user", "SYNTHETIC: delegate a read"),
        claude_event("root", "assistant", [call("spawn-1", "Agent", prompt="SYNTHETIC_CHILD_TASK")]),
        claude_event("root", "user", [result("spawn-1", "SYNTHETIC_CHILD_DONE")]),
    ])
    fixture("claude-subagent", "projects/project/root/subagents/agent-child.jsonl", [
        claude_event("root", "assistant", [call("child-read", file_path="/synthetic/child.txt")],
                     agentId="child", isSidechain=True, parentToolUseID="spawn-1"),
        claude_event("root", "user", [result("child-read", "SYNTHETIC_CHILD")],
                     agentId="child", isSidechain=True, parentToolUseID="spawn-1"),
    ])
    fixture("codex-tools", "sessions/rollout-tools.jsonl", [
        codex_event({"id": "codex-root", "cwd": "/synthetic/workspace"}, "session_meta"),
        codex_message("user", "SYNTHETIC: read a file and report failure"),
        codex_event({"type": "function_call", "name": "exec_command", "call_id": "exec-1",
                     "arguments": '{"cmd":"type synthetic-missing.txt"}'}),
        codex_event({"type": "function_call_output", "call_id": "exec-1",
                     "output": "SYNTHETIC_EXIT_1_NOT_FOUND"}),
        codex_message("assistant", "SYNTHETIC: the read failed"),
    ])
    fixture("codex-parent", "sessions/rollout-parent.jsonl", [
        codex_event({"id": "parent", "cwd": "/synthetic/workspace"}, "session_meta"),
        codex_message("user", "SYNTHETIC: delegate work"),
        codex_message("assistant", "SYNTHETIC_PARENT_TEXT"),
    ])
    fixture("codex-parent", "sessions/rollout-child.jsonl", [
        codex_event({"id": "child", "cwd": "/synthetic/workspace",
                     "source": {"subagent": {"spawn": {"parent_thread_id": "parent", "depth": 1}}}}, "session_meta"),
        codex_message("user", "SYNTHETIC_CHILD_PROMPT"),
        codex_message("assistant", "SYNTHETIC_CHILD_TEXT"),
    ])

    outputs = {}
    for key in fixtures:
        extractor, leaf = (claude, "projects") if key.startswith("claude-") else (codex, "sessions")
        outputs[key] = extractor.extract([FIXTURES / key / leaf])
    linear = outputs["claude-linear"][0]
    calls = [c for m in linear["messages"] for c in m.get("tool_use", [])]
    results = [c for m in linear["messages"] for c in m.get("tool_results", [])]
    positive = (len(outputs["claude-linear"]) == 1 and
                [c["id"] for c in calls] == ["read-1", "read-2", "read-3"] and
                calls[0]["input"] == {"file_path": "/synthetic/public.txt"} and
                [c["tool_use_id"] for c in results] == [c["id"] for c in calls] and
                [c["content"] for c in results] == ["SYNTHETIC_PUBLIC", "SYNTHETIC_NOT_FOUND", "SYNTHETIC_RETRY_OK"] and
                [c["is_error"] for c in results] == [False, True, False])
    if not positive:
        raise RuntimeError("Positive control failed: do not interpret negative cases")

    switch = outputs["claude-switch"]
    child_calls = [c["id"] for convo in outputs["claude-subagent"]
                   for message in convo["messages"] for c in message.get("tool_use", [])]
    codex_text = json.dumps(outputs["codex-tools"])
    codex_parent_text = json.dumps(outputs["codex-parent"])
    checks = [
        {"case": "claude-linear", "hypothesis": "Linear Claude calls/results/failure/retry retain IDs, arguments and ordering",
         "outcome": "supported", "observation": {"calls": len(calls), "results": len(results), "exactPositiveControl": positive}},
        {"case": "claude-switch", "hypothesis": "Per-event session changes remain distinguishable in normalized output",
         "outcome": "supported" if len(switch) == 2 else "refuted",
         "observation": {"inputSessionIds": ["before", "after"], "outputConversationIds": [c["session_id"] for c in switch],
                         "outputPerMessageSessionIds": [m.get("sessionId") for c in switch for m in c["messages"]]}},
        {"case": "claude-subagent", "hypothesis": "Nested subagent tool events are traversed by the public extract() entry point",
         "outcome": "supported" if "child-read" in child_calls else "refuted",
         "observation": {"inputFiles": 2, "outputConversations": len(outputs["claude-subagent"]), "retainedCallIds": child_calls}},
        {"case": "codex-tools", "hypothesis": "Codex response_item function_call and function_call_output retain call/result linkage",
         "outcome": "supported" if "exec-1" in codex_text and "SYNTHETIC_EXIT_1_NOT_FOUND" in codex_text else "refuted",
         "observation": {"inputFunctionCalls": 1, "inputFunctionOutputs": 1,
                         "outputMessages": len(outputs["codex-tools"][0]["messages"]),
                         "callIdRetained": "exec-1" in codex_text, "toolOutputRetained": "SYNTHETIC_EXIT_1_NOT_FOUND" in codex_text,
                         "textPositiveControl": "SYNTHETIC: the read failed" in codex_text}},
        {"case": "codex-parent", "hypothesis": "session_meta subagent.spawn.parent_thread_id survives normalization",
         "outcome": "supported" if "parent_thread_id" in codex_parent_text else "refuted",
         "observation": {"inputConversations": 2, "outputConversations": len(outputs["codex-parent"]),
                         "parentRelationRetained": "parent_thread_id" in codex_parent_text}},
    ]
    record = {"executedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
              "python": sys.version, "platform": platform.platform(), "extractorCommit": COMMIT,
              "inputOrigin": "Synthetic fixtures constructed by this experiment; no actual user logs and no APPA execution",
              "checks": checks, "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "limitations": ["No native agent logs were generated or independently validated; conclusions apply to the supplied encodings.",
                              "OpenAPPA was not installed or executed; this does not reproduce issue #592 or measure its current fix.",
                              "Missing data is not inferred. Historical success is not a safe-policy expectation.",
                              "No user, time-saving, adoption or willingness-to-pay validation."]}
    dump(OUTPUT / "input-fixtures.json", fixtures)
    dump(OUTPUT / "normalized.json", outputs)
    dump(OUTPUT / "vendor-sources.json", source_records)
    dump(OUTPUT / "result.json", record)
    print(json.dumps({"executedAt": record["executedAt"], "python": platform.python_version(),
                      "cases": [{"case": c["case"], "outcome": c["outcome"], "observation": c["observation"]} for c in checks]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
