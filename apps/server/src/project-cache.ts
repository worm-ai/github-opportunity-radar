type CacheEvidence = { field: "fullName" | "description" | "readmeExcerpt"; excerpt: string };
type CacheItem = {
  fullName: string;
  url: string;
  observedAt: string;
  matchedFields: string[];
  matchedEvidence: CacheEvidence[];
};

export type ProjectCacheHandoff = {
  query: string;
  observedAt: string | null;
  expandedQueries: string[];
  items: CacheItem[];
};

const text = (value: unknown) => String(value ?? "").replace(/[\\`*_{}\[\]()<>#+\-|!]/g, "\\$&").replace(/\r?\n/g, " ").trim();
const fieldLabel: Record<CacheEvidence["field"], string> = { fullName: "项目名", description: "项目描述", readmeExcerpt: "README 摘录" };

export function projectCacheHandoff(input: ProjectCacheHandoff): string {
  const lines = [
    "# 本地缓存线索交接简报", "",
    "> 这是本机已保存项目档案的只读交接材料。它用于人工复核，不是实时 GitHub 结果、推荐、可运行证明或接口兼容证明。", "",
    `- 查询：${text(input.query)}`,
    `- 模式：local_cache`,
    `- 最晚观察：${text(input.observedAt || "无")}`,
    `- 扩展查询：${input.expandedQueries.length ? input.expandedQueries.map(text).join("、") : "无（精确查询）"}`,
    `- 候选数量：${input.items.length}`,
    "",
    "## 候选线索",
  ];
  if (!input.items.length) {
    lines.push("", "- 没有命中已保存档案；这不证明 GitHub 上不存在相关实现。", "");
  } else {
    for (const [index, item] of input.items.entries()) {
      lines.push("", `### ${index + 1}. ${text(item.fullName)}`, `- 项目地址：<${item.url.replace(/[<>\s]/g, "")}>`, `- 命中字段：${item.matchedFields.map(text).join("、") || "未记录"}`, `- 观察时间：${text(item.observedAt)}`);
      for (const evidence of item.matchedEvidence) lines.push(`- ${fieldLabel[evidence.field]}：${text(evidence.excerpt)}`);
    }
    lines.push("");
  }
  lines.push(
    "## 下一步人工核验",
    "",
    "1. 打开候选档案，确认固定提交、依赖、启动方式和许可证。",
    "2. 对照原需求逐项检查能力覆盖；缺少证据的能力保留为未知。",
    "3. 在隔离环境安装并运行最小样例，再记录接口、状态恢复和失败边界。",
    "",
    "## 证据边界",
    "",
    "- 观察时间描述本地缓存的新鲜度，不代表远端当前状态。",
    "- 摘录只支持筛选是否值得继续打开档案，不代表完整源码行为。",
    "- 本材料没有执行候选项目，也没有证明多个项目可以组合。",
    "",
  );
  return lines.join("\n");
}
