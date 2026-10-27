import { describe, expect, it } from "vitest";
import { projectCacheHandoff } from "./project-cache.js";

describe("project cache handoff", () => {
  it("exports the same query boundary, expanded terms, excerpts, and manual next steps", () => {
    const markdown = projectCacheHandoff({
      query: "agent memory missing",
      observedAt: "2026-10-27T00:00:00Z",
      expandedQueries: ["agent", "memory"],
      items: [{ fullName: "sample/agent-memory", url: "https://github.com/sample/agent-memory", observedAt: "2026-10-26T00:00:00Z", matchedFields: ["description", "readmeExcerpt"], matchedEvidence: [{ field: "description", excerpt: "Persistent memory *for* agents" }, { field: "readmeExcerpt", excerpt: "Restart-safe `checkpoint` notes" }] }],
    });
    expect(markdown).toContain("模式：local_cache");
    expect(markdown).toContain("扩展查询：agent、memory");
    expect(markdown).toContain("项目描述：Persistent memory \\*for\\* agents");
    expect(markdown).toContain("README 摘录：Restart\\-safe \\`checkpoint\\` notes");
    expect(markdown).toContain("下一步人工核验");
    expect(markdown).toContain("不是实时 GitHub 结果、推荐、可运行证明或接口兼容证明");
  });

  it("states the empty-cache boundary without inventing a candidate", () => {
    const markdown = projectCacheHandoff({ query: "unknown", observedAt: null, expandedQueries: [], items: [] });
    expect(markdown).toContain("没有命中已保存档案");
    expect(markdown).not.toContain("### 1.");
  });
});
