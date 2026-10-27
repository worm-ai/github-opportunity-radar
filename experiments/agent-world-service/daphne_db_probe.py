"""Read the isolated upstream SQLite rows without importing Django."""
import json
import sqlite3
import sys

path = sys.argv[1]
with sqlite3.connect(path) as connection:
    connection.row_factory = sqlite3.Row
    rows = [dict(row) for row in connection.execute("SELECT name, api_key, memory_json, current_action FROM world_agentrecord ORDER BY name")]
print(json.dumps(rows, ensure_ascii=False))
