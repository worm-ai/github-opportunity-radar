import { posix } from "node:path";

export function documentationRef(value: string): string | null {
  if (!/^[A-Za-z0-9_@][A-Za-z0-9_@./+-]{0,159}$/.test(value) || value.includes("..") || value === "@") return null;
  if (value.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock"))) return null;
  return value;
}

// Repo paths only. Never send a GitHub credential to a README's arbitrary URL.
export function documentationPath(value: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  if (!decoded || decoded.length > 240 || /[\\\x00-\x1f?#:]/.test(decoded) || decoded.startsWith("/")) return null;
  const path = posix.normalize(decoded.replace(/^\.\//, ""));
  if (path === ".." || path.startsWith("../") || !/\.(md|mdx|rst|txt)$/i.test(path) || /(^|\/)(\.env|node_modules|\.git)(\/|$)/i.test(path)) return null;
  return path;
}

export function linkedDocumentation(fullName: string, markdown: string, readmePath = "README.md", readmeUrl?: string): string[] {
  const candidates = new Map<string, number>();
  let branchPrefix: string | null = null;
  try {
    const url = new URL(readmeUrl ?? "");
    const prefix = `/${fullName}/blob/`;
    if (url.hostname === "github.com" && url.pathname.startsWith(prefix) && url.pathname.endsWith(`/${readmePath}`)) branchPrefix = url.pathname.slice(0, -readmePath.length);
  } catch { /* Relative links do not require a branch hint. */ }
  const withoutFences = markdown.replace(/^\s*```[^\n]*\n[\s\S]*?^\s*```\s*$/gm, "");
  for (const match of withoutFences.matchAll(/(?<!!)\[([^\]\n]{1,160})\]\(<?([^\s)>]+)>?(?:\s+"[^"\n]*")?\)/g)) {
    const label = match[1]!;
    let target = match[2]!.split(/[?#]/)[0]!;
    if (/^(https?:)?\/\//i.test(target)) {
      try {
        const url = new URL(target);
        if (url.protocol !== "https:" || url.hostname !== "github.com" || !branchPrefix || !url.pathname.startsWith(branchPrefix)) continue;
        target = url.pathname.slice(branchPrefix.length);
      } catch { continue; }
    } else if (target.startsWith("/")) continue;
    else target = posix.join(posix.dirname(readmePath), target);
    const path = documentationPath(target);
    if (!path || path === readmePath || /(^|\/)(changelog|license|contributing|code_of_conduct)(\.|\/)/i.test(path)) continue;
    const words = `${label} ${path}`;
    const priority = /\b(cli|api|mcp)\b|command.line|interface|接口|命令行/i.test(words) ? 5 : /spec|usage|quick.?start|用法|规范/i.test(words) ? 4 : /integration|reference/i.test(words) ? 3 : /docs?|guide|文档/i.test(words) ? 2 : 0;
    if (priority) candidates.set(path, Math.max(priority, candidates.get(path) ?? 0));
  }
  return [...candidates].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([path]) => path);
}
