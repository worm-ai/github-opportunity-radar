"""Execute pinned upstream function bodies; provider/prompt/stream dependencies are stubs.

This is an isolated control-flow experiment, not an installed-library or live LLM run.
"""
from __future__ import annotations

import ast
import asyncio
from contextlib import redirect_stdout
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import platform
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / ".data/experiments/gpt-researcher-report-failure-20261022"


def require_nonblank_report(report):
    if not isinstance(report, str) or not report.strip():
        raise ValueError("Report output is empty or invalid; stop delivery.")
    return report


def load_functions(snapshot):
    functions = []
    origins = []
    for source in snapshot["sources"]:
        path = DIRECTORY / source["name"]
        data = path.read_bytes()
        assert hashlib.sha256(data).hexdigest() == source["sha256"], path
        tree = ast.parse(data.decode("utf-8"), filename=str(path))
        if source["path"].endswith("report_generation.py"):
            selected = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "generate_report")
        else:
            selected = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "ReportGenerator")
            # Retain the exact constructor and write_report bodies; omit unrelated skills.
            selected.body = [node for node in selected.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in {"__init__", "write_report"}]
        functions.append(selected)
        origins.append({"path": source["path"], "sha256": source["sha256"], "startLine": selected.lineno, "endLine": selected.end_lineno, "url": source["url"]})
    future = ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)
    module = ast.fix_missing_locations(ast.Module(body=[future, *functions], type_ignores=[]))
    return compile(module, "pinned_upstream_function_bodies", "exec", dont_inherit=True), origins


async def execute_case(code, name, responses, context):
    calls = []
    events = []

    async def completion(**kwargs):
        calls.append({"roles": [message["role"] for message in kwargs["messages"]]})
        if len(calls) > len(responses):
            raise AssertionError("Unexpected provider call")
        response = responses[len(calls) - 1]
        if isinstance(response, Exception):
            raise response
        return response

    async def stream_output(*args, **kwargs):
        events.append({"kind": args[0], "event": args[1], "text": args[2]})

    namespace = {"PromptFamily": type("PromptFamilyStub", (), {}),
        "get_prompt_by_report_type": lambda *args: lambda *args, **kwargs: "Fixture prompt",
        "create_chat_completion": completion, "stream_output": stream_output, "json": json}
    exec(code, namespace)
    config = SimpleNamespace(agent_role=None, report_format="markdown", total_words=100, language="english",
        smart_llm_model="fixture-only", smart_llm_provider="fixture-only", smart_token_limit=512, llm_kwargs={})
    researcher = SimpleNamespace(query="What is solar power?", cfg=config, role="Research assistant",
        report_type="research_report", report_source="web", tone=None, websocket=None, headers={},
        get_research_images=lambda: [], verbose=True, context=context, add_costs=lambda *args: None, kwargs={})
    output = io.StringIO()
    with redirect_stdout(output):
        report = await namespace["ReportGenerator"](researcher).write_report()
    try:
        require_nonblank_report(report)
        gate = "accepted"
    except ValueError:
        gate = "rejected"
    return {"case": name, "returned": report, "providerCalls": len(calls), "messageRoles": calls,
        "reportWrittenEvent": any(event["event"] == "report_written" for event in events),
        "exceptionEscaped": False, "printed": output.getvalue(), "nonblankGate": gate, "events": events}


async def main():
    manifest = json.loads((DIRECTORY / "sources.json").read_text(encoding="utf-8"))
    snapshot = next(item for item in manifest["snapshots"] if item["label"] == "current")
    reported = next(item for item in manifest["snapshots"] if item["label"] == "reported")
    code, origins = load_functions(snapshot)
    context = "Solar panels turn sunlight into electricity."
    cases = [
        ("normal_report", ["# Solar power\nA fixture report."], context),
        ("both_connection_failures", [ConnectionError("fixture refusal 1"), ConnectionError("fixture refusal 2")], context),
        ("programming_error_then_success", [TypeError("fixture bad argument"), "Recovered fixture report."], context),
        ("whitespace_output", [" \n\t"], context),
        ("none_output", [None], context),
        ("no_source_material", [], ""),
    ]
    results = [await execute_case(code, *case) for case in cases]
    by_name = {result["case"]: result for result in results}
    normal = by_name["normal_report"]
    assert normal["nonblankGate"] == "accepted" and normal["providerCalls"] == 1
    failure = by_name["both_connection_failures"]
    assert failure["returned"] == "" and failure["providerCalls"] == 2
    assert failure["reportWrittenEvent"] and failure["nonblankGate"] == "rejected"
    assert failure["messageRoles"] == [{"roles": ["system", "user"]}, {"roles": ["user"]}]
    for name in ["whitespace_output", "none_output"]:
        assert by_name[name]["reportWrittenEvent"] and by_name[name]["nonblankGate"] == "rejected"
    programming = by_name["programming_error_then_success"]
    assert programming["providerCalls"] == 2 and programming["nonblankGate"] == "accepted"
    abstention = by_name["no_source_material"]
    assert abstention["providerCalls"] == 0 and not abstention["reportWrittenEvent"]
    assert abstention["returned"].startswith("I could not gather any source material")
    assert abstention["nonblankGate"] == "accepted"
    result = {"executedAt": datetime.now(timezone.utc).isoformat(), "python": platform.python_version(),
        "mode": "unchanged_upstream_functions_with_dependency_stubs", "commit": snapshot["commit"],
        "reportedAndCurrentCommitSame": snapshot["commit"] == reported["commit"], "sources": origins, "cases": results,
        "liveModelRequests": 0, "productionWrites": 0,
        "limitations": ["No installed GPT Researcher dependency stack or live provider request was executed.",
            "Provider failures, prompts, streaming transport, config and researcher are controlled stubs.",
            "A nonblank gate catches empty outputs but accepts abstention text and cannot establish report accuracy, completeness or user value.",
            "Default-branch source was inspected at collection time; releases and other branches were not exhaustively audited."]}
    (DIRECTORY / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"commit": result["commit"], "reportedAndCurrentCommitSame": result["reportedAndCurrentCommitSame"],
        "cases": [{key: item[key] for key in ["case", "providerCalls", "reportWrittenEvent", "nonblankGate"]} for item in results],
        "liveModelRequests": 0, "productionWrites": 0}))


if __name__ == "__main__":
    asyncio.run(main())
