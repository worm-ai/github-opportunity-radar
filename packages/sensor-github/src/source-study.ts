import { createHash } from "node:crypto";

export type SourceInventory = {
  fullName: string; commitSha: string; observedAt: string; complete: boolean; warnings: string[];
  files: Array<{ path: string; sha: string; size: number }>;
};
export type SourceText = {
  path: string; sha: string; commitSha: string; url: string; observedAt: string;
  content: string; startLine: number; endLine: number; totalLines: number; truncated: boolean;
};
type Request = <T>(url: URL) => Promise<T>;
type Tree = { truncated?: boolean; tree: Array<{ path: string; type: string; sha: string; size?: number; mode?: string }> };
const shaPattern = /^[a-f0-9]{40}$/i;
export function sourcePath(path: string): boolean {
  return path.length <= 300 && !/[\\\u0000-\u001f?#%]/u.test(path) && !path.split("/").some(part => !part || part === "." || part === ".." || part.startsWith(".") || ["node_modules", "vendor", "dist", "build", "site-packages", "__pycache__"].includes(part))
    && /\.(?:gd|py|ts|tsx|js|jsx|mjs|cjs|go|rs|java|cs|cpp|c|h|hpp|rb|php|swift|kt|lua|ex|exs|sh|sql|md|mdx|rst|txt|json|yaml|yml|toml|godot|tscn)$/i.test(path);
}
function validRepository(fullName: string) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new Error("Invalid source repository");
}

/** All paths originate in a pinned Git tree; symlinks and submodules are excluded. */
export async function sourceInventory(fullName: string, request: Request, base: string): Promise<SourceInventory> {
  validRepository(fullName);
  const repo = await request<{ private?: boolean }>(new URL(`${base}/repos/${fullName}`));
  if (repo.private !== false) throw new Error("Source research requires a public repository");
  const commit = await request<{ sha: string; commit: { tree: { sha: string } } }>(new URL(`${base}/repos/${fullName}/commits/HEAD`));
  if (!shaPattern.test(commit.sha) || !shaPattern.test(commit.commit?.tree?.sha)) throw new Error("Invalid source commit");
  const result: SourceInventory = { fullName, commitSha: commit.sha, observedAt: new Date().toISOString(), complete: true, files: [], warnings: [] };
  const seen = new Set<string>();
  const add = (entries: Tree["tree"], prefix = "") => {
    for (const file of entries) {
      const path = prefix + file.path;
      if (file.type === "blob" && file.mode !== "120000" && shaPattern.test(file.sha) && sourcePath(path) && Number.isSafeInteger(file.size) && file.size! <= 512_000) {
        if (seen.has(path)) continue;
        if (result.files.length >= 2000) { result.complete = false; continue; }
        seen.add(path);
        result.files.push({ path, sha: file.sha, size: file.size! });
      }
    }
  };
  {
    // GitHub's recursive tree is both more complete and cheaper than spending a
    // shallow-directory budget before reaching nested source such as persona/. 
    // Fall back to the bounded walk only when the recursive response is truncated
    // or unavailable; an incomplete listing never becomes absence evidence.
    let recursiveComplete = false;
    try {
      const recursive = await request<Tree>(new URL(`${base}/repos/${fullName}/git/trees/${commit.commit.tree.sha}?recursive=1`));
      if (recursive.truncated) {
        result.complete = false;
        result.warnings.push("递归目录被 GitHub 截断，继续使用有界目录读取；未列出不代表不存在");
      } else {
        add(recursive.tree);
        // A directory-only fixture can contain slash-separated names too; only
        // actual blobs prove that the recursive response is usable as a listing.
        recursiveComplete = recursive.tree.some(item => item.type === "blob");
      }
    } catch (error) {
      result.complete = false;
      result.warnings.push(`递归目录读取失败：${error instanceof Error ? error.message : "未知网络错误"}`);
    }
    if (recursiveComplete) {
      result.warnings.push("目录按固定提交的递归树读取；排除隐藏目录及依赖/构建目录，仅列出支持的文本类型");
      if (result.files.length >= 2000) result.complete = false;
      result.files.sort((a, b) => a.path.localeCompare(b.path));
      return result;
    }
    // Large recursive trees can exceed GitHub or transport limits before truncation is inspectable.
    // Traverse actual shallow trees from the start; retain successes if one directory fails.
    const pending = [{ sha: commit.commit.tree.sha, prefix: "" }];
    const priority = (path: string) => {
      const parts = path.toLowerCase().split("/");
      if (parts.some(part => /^(assets?|textures?|sprites?|images?|audio|fonts?|docs?|public|static|locales?)$/.test(part))) return 2;
      if (parts.some(part => /^(src|source|scripts?|app|apps|packages|lib|core|server|backend_server|frontend_server|reverie|world|sdk|ai|agent|agents|persona|personas|cognitive|cognitive_modules|memory|memory_structures|planning|planner|engine|simulation)$/.test(part))) return 0;
      return 1;
    };
    let reads = 0;
    while (pending.length && reads < 12 && result.files.length < 2000) {
      const directory = pending.shift()!;
      reads++;
      let tree: Tree;
      try { tree = await request<Tree>(new URL(`${base}/repos/${fullName}/git/trees/${directory.sha}`)); }
      catch (error) {
        result.complete = false;
        result.warnings.push(`${directory.prefix || "/"} 目录读取失败：${error instanceof Error ? error.message : "未知网络错误"}`);
        continue;
      }
      if (tree.truncated) { result.complete = false; result.warnings.push(`${directory.prefix || "/"} 目录被 GitHub 截断，未列出不代表不存在`); }
      add(tree.tree, directory.prefix);
      for (const item of tree.tree) if (item.type === "tree" && shaPattern.test(item.sha) && !item.path.split("/").some(part => part.startsWith(".") || ["node_modules", "vendor", "dist", "build", "site-packages", "__pycache__"].includes(part))) {
        pending.push({ sha: item.sha, prefix: `${directory.prefix}${item.path}/` });
      }
      pending.sort((a, b) => priority(a.prefix) - priority(b.prefix));
    }
    if (pending.length) result.complete = false;
    result.warnings.push("目录按实际子目录有界读取，最多 12 次；排除隐藏目录及依赖/构建目录，仅列出支持的文本类型，不能推断未列出能力不存在");
  }
  result.files.sort((a, b) => a.path.localeCompare(b.path));
  if (!result.complete) result.warnings.push("目录达到读取边界，不能据此断言源码或行为不存在");
  return result;
}

export async function sourceText(inventory: SourceInventory, path: string, request: Request, base: string, maxChars = 12000, startLine = 1): Promise<SourceText> {
  validRepository(inventory.fullName);
  const entry = inventory.files.find(file => file.path === path);
  if (!entry || !sourcePath(path) || !shaPattern.test(entry.sha) || !shaPattern.test(inventory.commitSha)) throw new Error("Source path is not in the pinned inventory");
  if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 12000 || !Number.isSafeInteger(startLine) || startLine < 1) throw new Error("Invalid source text range");
  const blob = await request<{ sha: string; encoding: string; content: string; size: number }>(new URL(`${base}/repos/${inventory.fullName}/git/blobs/${entry.sha}`));
  if (blob.sha !== entry.sha || blob.encoding !== "base64" || blob.size > 512000) throw new Error("Invalid source blob");
  const bytes = Buffer.from(blob.content, "base64");
  const hash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (hash !== entry.sha || bytes.length !== entry.size || bytes.length !== blob.size) throw new Error("Source blob hash or length mismatch");
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (decoded.includes("\0")) throw new Error("Binary source is not supported");
  const allLines = decoded.split("\n");
  if (startLine > allLines.length) throw new Error("Source line is beyond the pinned file");
  // Keep original line endings and only whole lines so every citation can resolve exactly.
  let content = "", endLine = startLine - 1;
  for (let i = startLine - 1; i < allLines.length; i++) {
    const next = (content ? "\n" : "") + allLines[i];
    if (content.length + next.length > maxChars) break;
    content += next; endLine = i + 1;
  }
  if (!content.trim()) throw new Error("No complete nonempty source line fits the text budget");
  return { path, sha: entry.sha, commitSha: inventory.commitSha,
    url: `https://github.com/${inventory.fullName}/blob/${inventory.commitSha}/${path.split("/").map(encodeURIComponent).join("/")}#L${startLine}-L${endLine}`,
    content, startLine, endLine, totalLines: allLines.length, truncated: endLine < allLines.length, observedAt: new Date().toISOString() };
}
