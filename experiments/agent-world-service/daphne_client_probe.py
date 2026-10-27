"""Small MCP client for the unmodified upstream runworld probe."""
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / ".data" / "experiments" / "agent-world-service" / "runtime" / "site-packages"
sys.path[:0] = [str(RUNTIME), str(RUNTIME / "win32"), str(RUNTIME / "win32" / "lib"), str(RUNTIME / "pywin32_system32")]

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client


def text(response):
    values = []
    for item in response.content:
        if getattr(item, "type", None) == "text":
            values.append(item.text)
    return "\n".join(values)


async def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4328/mcp"
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    mode = sys.argv[3] if len(sys.argv) > 3 else "write"
    result = {"url": url, "calls": []}
    try:
        async with streamablehttp_client(url) as (reader, writer, _):
            async with ClientSession(reader, writer) as session:
                initialized = await session.initialize()
                result["protocolVersion"] = initialized.protocolVersion
                result["tools"] = [item.name for item in (await session.list_tools()).tools]

                async def call(name, arguments):
                    try:
                        response = await session.call_tool(name, arguments)
                        value = {"content": response.model_dump(mode="json"), "text": text(response)}
                    except Exception as error:
                        value = {"error": type(error).__name__ + ": " + str(error)}
                    result["calls"].append({"name": name, "arguments": arguments, "response": value})
                    return value

                if mode == "resume":
                    await call("get_world_context", {"agent_api_key": "daphne-Alice"})
                    await call("wait_for_event", {"agent_api_key": "daphne-Alice", "timeout": 1})
                else:
                    await call("wait_for_event", {"agent_api_key": "daphne-Alice", "agent_name": "Alice", "timeout": 1})
                    await call("wait_for_event", {"agent_api_key": "daphne-Bob", "agent_name": "Bob", "timeout": 1})
                    await call("act", {"agent_api_key": "daphne-Alice", "action_type": "remember", "note": "daphne persistence probe"})
                    await call("get_world_context", {"agent_api_key": "daphne-Alice"})
                    await call("act", {"agent_api_key": "daphne-Alice", "action_type": "whisper", "message": "hello from Daphne", "target": "Bob"})
                    await call("get_relationships", {"agent_api_key": "daphne-Alice"})
    except Exception as error:
        result["fatal"] = type(error).__name__ + ": " + str(error)
    if output:
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf8")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if "fatal" not in result else 2


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
