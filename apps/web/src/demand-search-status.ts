import type { DemandRun } from "./api";

export function demandSearchStatus(run: DemandRun) {
  const snapshot = run.snapshot;
  if (run.status === "running" || !snapshot || snapshot.projects.length || !snapshot.searches.length) return null;
  const searches = snapshot.searches;
  if (searches.some(search => search.status === "running")) return null;
  const failed = searches.filter(search => search.status === "failed");
  if (failed.length === searches.length) {
    const certificate = failed.every(search => /\b(?:UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|UNABLE_TO_GET_ISSUER_CERT|ERR_TLS_CERT_ALTNAME_INVALID)\b/.test(search.error ?? ""));
    return {
      title: "GitHub 搜索全部失败，尚未完成方案比较",
      reason: certificate ? "当前网络的 HTTPS 证书校验失败，未取得任何搜索结果。" : "本轮所有 GitHub 搜索请求均失败，未取得任何搜索结果。",
      next: certificate ? "先检查网络证书与系统时间；企业网络请按管理员指引配置可信 CA，保留证书校验。连接恢复后可重新研究。" : "查看下方搜索记录中的失败原因，恢复 GitHub 访问后再重新研究。",
    };
  }
  if (searches.every(search => search.items.length === 0)) return {
    title: "本轮未取得候选，尚未完成方案比较",
    reason: failed.length ? "部分搜索失败，其余请求未返回候选。检索覆盖仍不完整。" : "已执行的有限搜索没有返回候选，可能需要更换检索术语或调整需求范围。",
    next: "查看实际查询与检索边界后，编辑需求并重新研究；零候选不能证明相关实现不存在。",
  };
  return null;
}
