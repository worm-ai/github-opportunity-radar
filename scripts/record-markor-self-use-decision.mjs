import { randomUUID } from "node:crypto";

const base = "http://127.0.0.1:4349/api/v1";
const demandId = "0666eca1-4065-4251-bfd7-5895bcd84a94";
const catalog = await (await fetch(`${base}/demands/${demandId}/note-sources`)).json();
const source = catalog.sources.find((item) => item.ref?.projectId === "101451042" && item.ref.kind === "demand_source" && item.ref.sourceId.endsWith(":readme:1"));
if (!source) throw new Error("Markor README source unavailable");
const quotes = [
  "🌲 Work completely offline -- whenever, wherever",
  "👀 Convert, preview, and share documents as HTML and PDF",
].filter((quote) => source.text.includes(quote));
if (quotes.length !== 2) throw new Error("Expected Markor offline/export quotes were not found");
const existing = (await (await fetch(`${base}/research-notes`)).json()).find((note) => note.title === "Markor 本地离线笔记选型：先做运行验收");
if (existing) { console.log(JSON.stringify({ id: existing.id, reused: true, evidenceStates: existing.evidenceStates }, null, 2)); process.exit(0); }
const payload = {
  requestId: randomUUID(), author: "assistant",
  title: "Markor 本地离线笔记选型：先做运行验收",
  question: "Markor 是否能在 Android 目标环境中离线创建、保存、跨笔记正文搜索并导出 Markdown 笔记？当前资料是否足以直接采用？",
  projectIds: ["101451042"], originDemandId: demandId, decision: "watch",
  conclusion: "Markor 是当前最适合先验证的单项目候选：README 明确声明离线工作、文件夹存储和 HTML/PDF 导出；但这些是固定资料自述，尚未证明目标设备上的创建、重开、跨笔记正文检索、编辑删除后的索引更新或导出文件可被应用外读取。因此暂不推荐直接采用，也没有证据要求组合其他项目。",
  nextAction: "在 Android 测试环境固定版本并关闭网络，准备三篇标题不含测试词的 Markdown 笔记；依次验证创建、修改、关闭重开、正文关键词搜索、修改/删除后的结果更新，以及 HTML/PDF 导出后用其他应用打开。任一核心步骤失败就记录具体边界并停止把 Markor 当作满足方案；全部通过后再记录一次可重复的任务耗时。",
  evidence: quotes.map((quote) => ({ ref: source.ref, quote })),
};
const response = await fetch(`${base}/research-notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
const body = await response.text();
if (response.status !== 201) throw new Error(`${response.status}: ${body}`);
const saved = JSON.parse(body);
console.log(JSON.stringify({ id: saved.id, title: saved.title, decision: saved.decision, evidenceStates: saved.evidenceStates }, null, 2));
