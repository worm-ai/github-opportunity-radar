export type AnalysisOutcomeInput = {
  status: "running" | "succeeded" | "failed";
  opportunities: number;
  rejected: number;
  candidateAudits?: unknown[] | null | undefined;
  selection?: { groups?: unknown[] } | null | undefined;
};

export type AnalysisOutcome = { label: string; detail: string };

export function explainAnalysisOutcome(run: AnalysisOutcomeInput): AnalysisOutcome {
  if (run.status === "running") return { label: "分析仍在进行", detail: "等待当前任务完成后再判断结果。" };
  if (run.status === "failed") return { label: "分析未完成", detail: "本次运行失败，不能把它解释为没有机会。" };

  if (run.selection?.groups?.length === 0 && (run.opportunities > 0 || run.rejected > 0 || (run.candidateAudits?.length ?? 0) > 0)) {
    return { label: "结果材料不完整", detail: "目录选择记录显示没有深读组合，但同时存在候选或计数记录；这些字段相互矛盾，无法判断本轮实际走到了哪一步。" };
  }
  if (run.selection?.groups?.length === 0) {
    return { label: "本轮未选出深读组合", detail: "目录筛选没有选择项目组，因此没有进入候选生成；这不是证据审查淘汰，也不能说明市场没有机会。" };
  }
  if (run.candidateAudits == null) {
    return run.rejected > 0
      ? { label: "结果材料不完整", detail: `计数字段记录淘汰 ${run.rejected} 项，但缺少候选快照，无法复核提案与审查记录的对应关系，也不能判断模型是否还有未记录的提案。` }
      : { label: "结果材料不完整", detail: "本次运行缺少候选快照，无法判断模型是否提出候选。" };
  }
  if (run.candidateAudits.length === 0) {
    if (run.opportunities > 0 || run.rejected > 0) {
      return { label: "结果材料不完整", detail: `候选快照为空，但计数字段记录保留 ${run.opportunities} 项、淘汰 ${run.rejected} 项；无法判断这些提案是否曾被完整记录或审查。` };
    }
    return { label: "本轮未生成候选", detail: "已保存的候选快照为空；这只说明本轮没有形成可审查提案，不代表证据门槛淘汰了候选或市场没有机会。" };
  }
  if (run.opportunities === 0) {
    return { label: "候选未通过审查", detail: `本轮有 ${run.candidateAudits.length} 个候选快照，淘汰 ${run.rejected} 个，未保留方向。可查看原文核验与反方审查记录。` };
  }
  return { label: `本轮保留 ${run.opportunities} 个方向`, detail: `候选仍是待验证假设；本轮另淘汰 ${run.rejected} 个候选，不能据此推断市场或付费成立。` };
}
