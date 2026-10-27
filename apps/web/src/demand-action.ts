import type { DemandRun, DemandSnapshot } from "./api";
import type { ResearchNoteView } from "@radar/contracts/research";

export type DemandAction = {
  kind: "running" | "blocked" | "verify" | "no_evidence";
  title: string;
  explanation: string;
  next: string;
  projectNames: string[];
  blockers: string[];
  experiment: { input: string; firstStep: string; pass: string; fail: string } | null;
};

function latestManualNote(notes: ResearchNoteView[]): ResearchNoteView | undefined {
  return notes
    .filter((note) => !note.supersededBy)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * Turns only persisted facts into a short handoff. It deliberately does not
 * infer a recommendation: a candidate can be actionable to verify while still
 * being unsafe to adopt.
 */
export function demandAction(run: DemandRun, manualNotes: ResearchNoteView[] = []): DemandAction {
  const snapshot = run.snapshot;
  if (run.status === "running" || snapshot?.status === "running") return {
    kind: "running", title: "研究仍在进行", explanation: "搜索、采集或模型评估尚未结束，当前材料不能作为最终判断。",
    next: "等待任务结束后再决定是否继续补证。", projectNames: [], blockers: [], experiment: null,
  };
  if (!snapshot) return {
    kind: "no_evidence", title: "没有可用研究材料", explanation: "任务没有保存需求、来源或候选快照。",
    next: "重新提交需求；提交前先确认 GitHub 连接和模型配置。", projectNames: [], blockers: ["缺少研究快照"], experiment: null,
  };
  const manual = latestManualNote(manualNotes);
  if (manual) {
    const staleEvidence = manual.evidenceStates.some((state) => state !== "same");
    const common = {
      projectNames: manual.projectNames,
      next: manual.nextAction,
      blockers: [
        "人工判断仍待复核",
        ...(staleEvidence ? ["保存时引用与当前材料不一致或暂不可用"] : []),
      ],
      experiment: null,
    } satisfies Pick<DemandAction, "projectNames" | "next" | "blockers" | "experiment">;
    if (manual.decision === "stop") return {
      kind: "blocked", title: "已有判断要求停止这条路线",
      explanation: manual.conclusion, ...common,
    };
    if (manual.decision === "watch") return {
      kind: "blocked", title: "等待新的可核验证据",
      explanation: manual.conclusion, ...common,
    };
    return {
      kind: "verify", title: "已有人工实测，继续验证下一步",
      explanation: manual.conclusion, ...common,
    };
  }
  const final = snapshot.evaluations.at(-1);
  if (!final?.paths.length) {
    const failedSearch = snapshot.searches.length > 0 && snapshot.searches.every(item => item.status === "failed");
    return {
      kind: "no_evidence", title: "当前不能形成实现建议",
      explanation: failedSearch ? "GitHub 搜索全部失败，现有材料不足以比较实现。" : "已有材料没有形成通过基本证据核验的候选路径。",
      next: failedSearch ? "先恢复 GitHub HTTPS 证书信任，再重新研究。" : "查看检索边界和失败原因，换用更明确的检索线索或补充源码证据。",
      projectNames: snapshot.projects.map(item => item.fullName), blockers: ["没有可核验的候选路径"], experiment: null,
    };
  }
  const path = snapshot.recommendedPathId ? final.paths.find(item => item.id === snapshot.recommendedPathId) : undefined;
  const candidate = path ?? final.paths[0]!;
  const names = candidate.projectIds.map(id => snapshot.projects.find(item => item.id === id)?.fullName ?? id);
  // Models sometimes place research-process acceptance criteria in the plan's
  // capability list. They remain visible in the full trace, but are not
  // candidate product capabilities and must not pollute the handoff.
  const productCapabilities = snapshot.plan?.capabilities.filter(capability =>
    !/^(真实搜索|固定提交|实际运行|报告支持|研究|GitHub|检索)/u.test(capability.description)
    && !/(?:github_project_evaluation|reproducible_minimal_verification|research|evaluation|verification)/iu.test(capability.id),
  ) ?? [];
  const blockers = [
    ...(candidate.constraintsFit !== "compatible" ? ["运行约束尚未确认"] : []),
    ...(candidate.coverage.filter(item => item.status !== "supported" && productCapabilities.some(capability => capability.id === item.capabilityId)).map(item => `能力“${snapshot.plan?.capabilities.find(capability => capability.id === item.capabilityId)?.description ?? item.capabilityId}”仍未完全证实`)),
    ...(candidate.projectIds.some(id => !snapshot.projects.find(item => item.id === id)?.license) ? ["至少一个候选许可证未知"] : []),
    ...(candidate.projectIds.some(id => snapshot.sources.filter(item => item.projectId === id).every(source => !source.commitSha)) ? ["候选来源未固定到提交"] : []),
  ];
  const experiment = candidate.experiment;
  return {
    kind: "verify", title: path ? "可以开始最小验证" : "有候选，但还不能推荐",
    explanation: path ? "该路径通过了当前保存的研究审查；这仍然不是运行验收。" : "当前没有路径通过完整推荐条件，下面只是证据最强的待验证候选。",
    next: experiment ? experiment.steps[0]! : "先固定版本、许可证和依赖，再设计最小可复现实验。",
    projectNames: names, blockers, experiment: experiment ? { input: experiment.input, firstStep: experiment.steps[0]!, pass: experiment.pass, fail: experiment.fail } : null,
  };
}

export function demandActionFromSnapshot(snapshot: DemandSnapshot): DemandAction {
  return demandAction({ id: "snapshot", requestId: "snapshot", question: snapshot.question, retryOf: null, status: snapshot.status, startedAt: "", updatedAt: "", finishedAt: null, error: snapshot.error, snapshot });
}
