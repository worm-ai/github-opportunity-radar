import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const engineVersion = "0.24.5";
export function startEngine() {
  const local = resolve(root, `.tools/iii-${engineVersion}/${process.platform === "win32" ? "iii.exe" : "iii"}`);
  const binary = process.env.III_BIN || (existsSync(local) ? local : "iii");
  const child = spawn(binary, ["--config", resolve(root, "iii-config.yaml"), "--no-update-check"], { cwd: root, stdio: "inherit", windowsHide: true });
  child.on("error", (error) => {
    console.error(`Cannot start iii Engine ${engineVersion}: ${error.message}. On Windows run corepack pnpm engine:install; otherwise install iii ${engineVersion} or set III_BIN.`);
    process.exitCode = 1;
  });
  return child;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const child = startEngine();
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
}
