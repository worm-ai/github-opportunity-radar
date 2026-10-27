import type { Completion, CompletionTransport } from "./transport.js";
import { OpenCodeUnavailableError } from "./opencode.js";

/**
 * Conservative degraded transport used when no model can complete a study.
 * It never recommends a project or claims runtime support. Its only purpose is
 * to keep acquisition useful: search real repositories, collect their bounded
 * sources, and finish with an explicit insufficient-evidence evaluation.
 */
export class EvidenceOnlyTransport implements CompletionTransport {
  readonly provider = "local-cli" as const;
  readonly model = "rules/evidence-only";

  async complete(_system: string, input: unknown, outputSchema: unknown): Promise<Completion> {
    const properties = (outputSchema as { properties?: Record<string, unknown> } | null)?.properties ?? {};
    const data = (input && typeof input === "object" ? input : {}) as Record<string, any>;
    let value: unknown;
    if ("capabilities" in properties && "queries" in properties && "summary" in properties) value = this.plan(data);
    else if ("selected" in properties && "skipped" in properties) value = this.selection(data);
    // Source synthesis has a nested contract. Handle it before the generic
    // review fallback so zod receives both required objects.
    else if ("evaluation" in properties && "review" in properties) value = this.sourceSynthesis();
    else if ("paths" in properties && "gapQueries" in properties) value = this.evaluation();
    else if ("queries" in properties) throw new Error("模型不可用，无法可靠扩宽或改写检索；已保存的查询、候选和材料仍可核查，请恢复模型后重试。零结果不代表没有相关实现");
    else value = { reviews: [], recommendedPathId: null, conclusion: "证据优先降级模式未执行反方审查，因为没有可推荐路径" };
    return { content: JSON.stringify(value), finishReason: "stop", model: this.model };
  }

  private plan(data: Record<string, any>) {
    const question = typeof data.question === "string" ? data.question.trim() : "";
    // Rules cannot infer a domain or translate a requirement. Only reuse
    // explicit quoted search phrases, repository names, and Latin identifiers
    // embedded in Chinese. Unmarked English prose is not a keyword list.
    const clues: string[] = [];
    const add = (value: string) => {
      const query = value.trim();
      if (query.length >= 2 && query.length <= 96 && query.split(/\s+/u).length <= 4
        && !/[:<>\r\n]/u.test(query) && !/^(github|open source|and|or|not)$/i.test(query)
        && !clues.some(item => item.toLowerCase() === query.toLowerCase())) clues.push(query);
    };
    for (const match of question.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)/gi)) add(match[1]!);
    for (const match of question.matchAll(/[`"“「]([^`"”」\r\n]+)[`"”」]/gu)) add(match[1]!);
    const withoutUrls = question.replace(/https?:\/\/\S+/gi, "");
    if (!clues.length && /\p{Script=Han}/u.test(question)) {
      for (const match of withoutUrls.matchAll(/[a-z][a-z0-9_.+-]*/gi)) add(match[0]);
    }
    if (!clues.length) throw new Error("模型不可用，无法可靠拆解需求并生成 GitHub 检索词；未套用其他场景或开始搜索。请恢复模型后重试，也可在需求中明确引用检索短语或 GitHub 仓库地址后重试");
    return {
      summary: "模型不可用：保留原始需求，仅按输入中明确出现的检索线索采集资料；未完成语义拆解或方案推荐",
      capabilities: (question.match(/[\s\S]{1,1500}/gu) ?? []).map((description, index) => ({
        id: `user-requirement-${index + 1}`, description: `用户原文（未语义拆解）：${description}`, required: true, origin: "user",
      })),
      constraints: [],
      assumptions: ["只做有界检索和资料采集；原文中的词仅为召回线索，不表示已识别能力或满足需求"],
      questions: [],
      queries: clues.slice(0, 4).map(query => ({ query, reason: "逐字使用用户输入中的检索线索；模型不可用，相关性和能力覆盖尚未评估" })),
    };
  }

  private selection(data: Record<string, any>) {
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const selected = candidates.slice(0, 4).map((item: any) => ({
      fullName: String(item.fullName ?? ""),
      reason: "按真实 GitHub 搜索结果进入有界资料采集；不代表已运行或兼容",
    })).filter((item: { fullName: string }) => item.fullName.length > 0);
    const selectedNames = new Set(selected.map((item: { fullName: string }) => item.fullName.toLowerCase()));
    const skipped = candidates.slice(4).map((item: any) => ({
      fullName: String(item.fullName ?? ""),
      reason: "本轮有界采集名额有限，保留为未采集候选",
    })).filter((item: { fullName: string }) => item.fullName.length > 0 && !selectedNames.has(item.fullName.toLowerCase()));
    return { selected, skipped };
  }

  private evaluation() {
    return {
      paths: [],
      gapQueries: [],
      conclusion: "已采集候选资料，但没有模型完成逐项能力评估；证据不足，不能推荐单项目或组合方案",
    };
  }

  private sourceSynthesis() {
    return {
      evaluation: {
        paths: [],
        gapQueries: [],
        conclusion: "已保留固定提交源码和逐项核查发现，但模型不可用，未完成方案综合；证据不足，不能推荐实现路径。下一步按原需求执行最小运行实验并记录可观察结果、失败与恢复行为",
      },
      review: {
        reviews: [],
        recommendedPathId: null,
        conclusion: "证据优先降级模式未执行方案反方审查，也不生成推荐；请核对已保存的源码发现，再通过受控实验消除剩余不确定性",
      },
    };
  }

}

/** Preserve the configured provider identity while using evidence-only output
 * after every model-scoped OpenCode availability failure has been exhausted. */
export class EvidenceFallbackTransport implements CompletionTransport {
  readonly provider: CompletionTransport["provider"];
  readonly model: string;
  usedEvidenceFallback = false;
  constructor(private readonly primary: CompletionTransport) {
    this.provider = primary.provider;
    this.model = primary.model;
  }
  async complete(system: string, input: unknown, outputSchema: unknown): Promise<Completion> {
    try { return await this.primary.complete(system, input, outputSchema); }
    catch (error) {
      const providerUnavailable = error instanceof OpenCodeUnavailableError
        || (error instanceof Error && /OpenCode 模型调用失败（HTTP 400）/.test(error.message));
      if (!providerUnavailable) throw error;
      this.usedEvidenceFallback = true;
      return new EvidenceOnlyTransport().complete(system, input, outputSchema);
    }
  }
}
