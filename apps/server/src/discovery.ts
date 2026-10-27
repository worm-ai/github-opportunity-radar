import type { ProjectRecord, ProjectObservation } from "@radar/storage";

type Rule = { id: string; label: string; pattern: RegExp; nextCheck: string };
const rules: Rule[] = [
  { id: "maps", label: "地图生成", pattern: /\b(data maps?|city posters?|geospatial|map (?:rendering|generation|visualization))\b|地图(?:生成|渲染|可视化)/i, nextCheck: "核对输入地区标识、导出格式与未匹配数据的处理方式。" },
  { id: "office", label: "Office 文档处理", pattern: /\b(office suite|docx|xlsx|pptx|document (?:generation|editing)|pdf (?:editor|extraction|parser))\b|文档(?:生成|编辑)|表格编辑/i, nextCheck: "核对文件输入输出、自动化接口和保存后的格式保真边界。" },
  { id: "video", label: "视频与音频制作", pattern: /\b(video (?:workspace|editor|editing|generation)|timeline editing|audio mixing|speech synthesis|text[- ]to[- ]speech)\b|视频(?:编辑|生成)|语音合成/i, nextCheck: "核对媒体格式、模型与硬件依赖，以及能否脱离界面批量运行。" },
  { id: "images", label: "图像编辑与生成", pattern: /\b(photo editor|image (?:editor|editing|generation)|image[- ]to[- ]image)\b|图像(?:编辑|生成)/i, nextCheck: "核对图片格式、批处理接口与输出质量，区分编辑器和可调用组件。" },
  { id: "data-movement", label: "数据同步与连接", pattern: /\b(data movement|elt pipelines?|etl (?:pipelines?|framework)|data (?:integration|replication)|database connectors?)\b|数据(?:同步|集成|连接器)/i, nextCheck: "核对连接器、增量同步、权限和失败后的恢复方式。" },
  { id: "data-api", label: "公开数据 API", pattern: /\b(?:market|financial|weather|exchange rates?) API\b|API.{0,100}\b(?:exchange rates?|historical (?:data|JSON))\b|公开数据接口/i, nextCheck: "核对原始数据来源、更新频率、使用许可与接口稳定性。" },
  { id: "analytics", label: "数据分析与可视化", pattern: /\b(data visualization|data exploration|business intelligence|analytics platform)\b|数据(?:分析|可视化)平台/i, nextCheck: "核对数据接入、图表导出和嵌入接口，比较已有分析工具。" },
  { id: "browser", label: "浏览器自动化", pattern: /\b(browser automation|browser control|browser agent|web testing and automation|(?:javascript )?API for Chrome and Firefox)\b|浏览器(?:自动化|控制)/i, nextCheck: "核对浏览器接口、登录态、等待条件和失败时的可观察结果。" },
  { id: "collection", label: "网页与内容采集", pattern: /\b(web scraping|web crawler|data extraction|read & search|archive them as local Markdown)\b|网页(?:采集|抓取)|公众号盯采/i, nextCheck: "核对来源接口、认证与限流、结构化输出和采集失败的识别。" },
  { id: "code-review", label: "代码评审", pattern: /\b(code review|pull request review|AI review)\b|代码(?:审查|评审)/i, nextCheck: "核对可导出的评审结果、代码行引用和现有检查的覆盖范围。" },
  { id: "knowledge", label: "知识与笔记管理", pattern: /\b(knowledge workspace|knowledge base|note[- ]taking|local Markdown notes)\b|知识(?:管理|工作空间)|笔记管理/i, nextCheck: "核对数据存储、导入导出、同步边界与插件接口。" },
  { id: "workflow", label: "流程编排", pattern: /\b(workflow (?:engine|orchestration|automation)|durable execution|orchestration & scheduling|schedule, and monitor workflows|agentic workflows)\b|工作流(?:引擎|编排|自动化)/i, nextCheck: "核对任务输入输出、调度、重试、幂等与状态持久化。" },
  { id: "retrieval", label: "检索与记忆", pattern: /\b(vector (?:database|store|search)|retrieval[- ]augmented generation|rag pipelines?|long[- ]term memory)\b|向量(?:数据库|检索)|长期记忆/i, nextCheck: "核对数据写入、检索接口、权限隔离和评估样本。" },
  { id: "agent", label: "Agent 与开发工具", pattern: /\b(agent (?:framework|runtime|sdk|orchestration)|coding agent|multi[- ]agent|AI agents?|autonomous agents?)\b|智能体(?:框架|运行时)|多 Agent 编排/i, nextCheck: "核对工具调用协议、部署依赖、可组合接口和实际任务边界。" },
];

export type CapabilityClue = { id: string; label: string; source: "description" | "readme"; quote: string; url: string; observedAt: string; nextCheck: string };

function matchingQuote(text: string, pattern: RegExp) {
  const match = pattern.exec(text);
  return match ? text.slice(Math.max(0, match.index - 85), match.index + match[0].length + 145).trim() : null;
}

export function discoveryProfile(project: ProjectRecord) {
  const description = project.description ?? "";
  // Prefer the project's own description. README mentions can describe dependencies or examples.
  const source = rules.some((rule) => rule.pattern.test(description)) ? "description" : "readme";
  const text = source === "description" ? description : (project.readmeExcerpt ?? "").slice(0, 6000);
  const clues: CapabilityClue[] = rules.flatMap((rule) => {
    const quote = matchingQuote(text, rule.pattern);
    return quote ? [{ id: rule.id, label: rule.label, source, quote, url: `${project.url}${source === "readme" ? "#readme" : ""}`, observedAt: project.observedAt, nextCheck: rule.nextCheck }] : [];
  });
  const resourceQuote = matchingQuote(description, /\b(course|tutorial|textbook|curated (?:list|collection)|learning resources)\b|人生指南|动手学|从\s*0\s*写/i);
  return { kind: resourceQuote ? "resource_hint" as const : source === "description" && clues.length ? "capability_hint" as const : "unclassified" as const, resourceQuote, clues };
}

export function observationSummary(observations: ProjectObservation[]) {
  const sorted = [...observations].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const latest = sorted[0];
  const previous = sorted.find((item) => latest && item.observedAt < latest.observedAt);
  const comparison = latest && previous ? {
    from: previous.observedAt, to: latest.observedAt,
    stars: latest.stars - previous.stars,
    forks: latest.forks - previous.forks,
    openIssues: latest.openIssues - previous.openIssues,
  } : null;
  // null → tag is often recovery from a failed initial API fetch; it cannot prove a release.
  const releaseChange = latest?.releaseTag && previous?.releaseTag && latest.releaseTag !== previous.releaseTag ? {
    from: previous.releaseTag, to: latest.releaseTag, fromObservedAt: previous.observedAt, toObservedAt: latest.observedAt,
  } : null;
  return { count: sorted.length, comparison, releaseChange };
}

export function buildDiscoveryBrief(projects: ProjectRecord[], observations: ProjectObservation[], scan: { id: string; startedAt: string; finishedAt: string | null } | null) {
  const byProject = new Map<string, ProjectObservation[]>();
  for (const item of observations) {
    const items = byProject.get(item.projectId) ?? [];
    items.push(item); byProject.set(item.projectId, items);
  }
  const items = projects.map((project) => ({
    id: project.id, fullName: project.fullName, description: project.description, url: project.url,
    createdAt: project.createdAt, firstSeenAt: project.firstSeenAt, observedAt: project.observedAt,
    license: project.license, releaseTag: project.releaseTag, releaseUrl: project.releaseUrl,
    issueCount: project.issues?.length ?? 0, issuesFetchedAt: project.issuesFetchedAt ?? null,
    documentationCount: project.documentation?.documents.filter((document) => !document.stale).length ?? 0,
    ...discoveryProfile(project), observation: observationSummary(byProject.get(project.id) ?? []),
    firstSeenInScan: Boolean(scan?.finishedAt && project.firstSeenAt && project.firstSeenAt >= scan.startedAt && project.firstSeenAt <= scan.finishedAt),
  })).sort((a, b) => (b.firstSeenAt ?? b.observedAt).localeCompare(a.firstSeenAt ?? a.observedAt) || a.fullName.localeCompare(b.fullName));
  return {
    scan,
    summary: { total: items.length, withClues: items.filter((item) => item.kind === "capability_hint").length, resources: items.filter((item) => item.kind === "resource_hint").length, unclassified: items.filter((item) => item.kind === "unclassified").length, firstSeenInScan: items.filter((item) => item.firstSeenInScan).length, releaseChanges: items.filter((item) => item.observation.releaseChange).length },
    categories: rules.flatMap((rule) => {
      const count = items.filter((item) => item.kind === "capability_hint" && item.clues.some((clue) => clue.id === rule.id)).length;
      return count ? [{ id: rule.id, label: rule.label, count }] : [];
    }),
    items,
  };
}
