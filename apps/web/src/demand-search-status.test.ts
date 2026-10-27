import { describe, expect, it } from "vitest";
import type { DemandRun, DemandSnapshot } from "./api";
import { demandSearchStatus } from "./demand-search-status";

const search = (status: "failed" | "succeeded" | "running", error: string | null = null) => ({ status, error, items: [] });
const run = (searches: unknown[], extra: Partial<DemandSnapshot> = {}, status: DemandRun["status"] = "partial") => ({ status, snapshot: { searches, projects: [], ...extra } }) as DemandRun;

describe("search failure decision boundaries", () => {
  it("explains certificate failures without claiming no implementation exists", () => {
    const notice = demandSearchStatus(run([search("failed", "UNABLE_TO_VERIFY_LEAF_SIGNATURE")]));
    expect(notice?.title).toContain("搜索全部失败");
    expect(notice?.reason).toContain("证书");
    expect(notice?.next).toContain("保留证书校验");
  });
  it("does not diagnose mixed network failures as a certificate-only problem", () => {
    expect(demandSearchStatus(run([search("failed", "CERT_HAS_EXPIRED"), search("failed", "ECONNRESET")]))?.reason).not.toContain("证书");
  });
  it.each(["CERT_NOT_YET_VALID", "UNABLE_TO_GET_ISSUER_CERT", "ERR_TLS_CERT_ALTNAME_INVALID"])("explains stopped certificate retries for %s", code => {
    const notice = demandSearchStatus(run([search("failed", `GitHub certificate verification failed (${code}); automatic retries stopped`)]));
    expect(notice?.reason).toContain("证书");
    expect(notice?.next).toContain("保留证书校验");
  });
  it("does not classify an unknown code with a certificate prefix as a known certificate error", () => {
    expect(demandSearchStatus(run([search("failed", "CERT_HAS_EXPIRED_UNKNOWN")]))?.reason).not.toContain("证书");
  });
  it("distinguishes successful zero matches and partial acquisition from total failure", () => {
    const empty = demandSearchStatus(run([search("succeeded")]));
    expect(empty?.title).toContain("未取得候选");
    expect(empty?.next).toContain("不能证明相关实现不存在");
    expect(demandSearchStatus(run([search("succeeded"), search("failed")]))?.reason).toContain("部分搜索失败");
  });
  it("does not overwrite acquired evidence or report unfinished searches as terminal", () => {
    expect(demandSearchStatus(run([search("failed")], { projects: [{ id: "1" }] as DemandSnapshot["projects"] }))).toBeNull();
    expect(demandSearchStatus(run([search("failed")], {}, "running"))).toBeNull();
    expect(demandSearchStatus(run([search("running")], {}, "interrupted"))).toBeNull();
    expect(demandSearchStatus(run([]))).toBeNull();
    expect(demandSearchStatus(run([{ ...search("succeeded"), items: [{}] }]))).toBeNull();
  });
});
