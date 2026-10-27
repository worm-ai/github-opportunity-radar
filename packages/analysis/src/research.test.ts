import { describe, expect, it } from "vitest";
import { canonicalResearchProfile, researchFocusSchema, researchProfileSchema } from "./research.js";

describe("research profile validation", () => {
  it("accepts Chinese, English, and numeric profile content", () => {
    const profile = {
      targetUser: "独立开发者",
      recurringWork: "Review 12 repositories every week",
      constraints: "七天内验证，1 人维护",
    };

    expect(researchProfileSchema.parse(profile)).toEqual(profile);
    expect(canonicalResearchProfile(profile)).toEqual(profile);
  });

  it("rejects question-mark corruption and Unicode replacement characters", () => {
    expect(researchProfileSchema.safeParse({ targetUser: "???", recurringWork: "???", constraints: "???" }).success).toBe(false);
    expect(researchProfileSchema.safeParse({ targetUser: "�", recurringWork: "每周筛选项目", constraints: "一人交付" }).success).toBe(false);
  });

  it("keeps empty fields valid and canonicalizes an empty profile to null", () => {
    expect(canonicalResearchProfile({ targetUser: " ", recurringWork: "", constraints: "\t" })).toBeNull();
    expect(researchProfileSchema.parse({ targetUser: "", recurringWork: "", constraints: "" })).toEqual({ targetUser: "", recurringWork: "", constraints: "" });
  });

  it("rejects non-empty punctuation-only fields", () => {
    expect(researchProfileSchema.safeParse({ targetUser: "---", recurringWork: "每周筛选项目", constraints: "一人交付" }).success).toBe(false);
  });

  it("rejects corrupted focused research questions before analysis", () => {
    const ids = ["project-one", "project-two"];
    expect(researchFocusSchema.safeParse({ projectIds: ids, question: "anydoc ??? Issue #191 ??????????" }).success).toBe(false);
    expect(researchFocusSchema.safeParse({ projectIds: ids, question: "word comments are lost in markdown" }).success).toBe(true);
  });
});
