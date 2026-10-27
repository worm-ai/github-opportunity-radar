import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const configFile = resolve(root, ".env");
if (existsSync(configFile)) process.loadEnvFile(configFile);
const directory = resolve(root, process.env.DATA_DIR || ".data");
const source = resolve(directory, "opportunity-radar.sqlite");
if (!existsSync(source)) throw new Error("Database not found; start the application first");
const target = resolve(directory, "backups", `opportunity-radar-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
mkdirSync(dirname(target), { recursive: true });
const db = new DatabaseSync(source);
try { db.exec(`PRAGMA busy_timeout=5000; VACUUM INTO '${target.replace(/'/g, "''")}'`); }
finally { db.close(); }
const backup = new DatabaseSync(target, { readOnly: true });
try {
  const integrity = backup.prepare("PRAGMA integrity_check").get().integrity_check;
  if (integrity !== "ok") throw new Error("Backup integrity check failed");
  console.log(JSON.stringify({ backup: target, integrity, schema: backup.prepare("PRAGMA user_version").get().user_version }));
} finally { backup.close(); }
