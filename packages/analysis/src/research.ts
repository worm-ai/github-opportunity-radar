import { z } from "zod";
import { collectedResearchIssues, type IssueContext } from "@radar/contracts";

export const researchProfileSchema = z.object({
  targetUser: z.string().trim().max(240).refine(hasReadableContent, "Must contain readable text"),
  recurringWork: z.string().trim().max(400).refine(hasReadableContent, "Must contain readable text"),
  constraints: z.string().trim().max(400).refine(hasReadableContent, "Must contain readable text"),
}).strict();

function hasReadableContent(value: string): boolean {
  return value.length === 0 || (!value.includes("\uFFFD") && !/\?{3,}/u.test(value) && /[\p{L}\p{N}]/u.test(value));
}

export type ResearchProfile = z.infer<typeof researchProfileSchema>;

export function canonicalResearchProfile(profile?: ResearchProfile | null): ResearchProfile | null {
  if (!profile) return null;
  const parsed = researchProfileSchema.parse(profile);
  return Object.values(parsed).some(Boolean) ? parsed : null;
}

export const researchFocusSchema = z.object({
  projectIds: z.array(z.string().trim().min(1).max(80)).min(2).max(3).refine((ids) => new Set(ids).size === ids.length, "Select distinct projects"),
  question: z.string().trim().min(12).max(1200).refine(hasReadableContent, "Must contain readable text"),
  originIssue: z.object({ projectId: z.string().trim().min(1).max(80), issueNumber: z.number().int().positive() }).strict().optional(),
}).strict().refine((focus) => !focus.originIssue || focus.projectIds.includes(focus.originIssue.projectId), "The origin issue must belong to a selected project");

export type ResearchFocus = z.infer<typeof researchFocusSchema>;

export function canonicalResearchFocus(focus?: ResearchFocus | null): ResearchFocus | null {
  if (!focus) return null;
  const parsed = researchFocusSchema.parse(focus);
  return { ...parsed, projectIds: [...parsed.projectIds].sort() };
}

export function researchOriginAvailable(focus: ResearchFocus | null | undefined, projects: Array<{ id: string; issues?: Array<{ number: number }>; issueContexts?: Record<string, IssueContext> }>) {
  const origin = focus?.originIssue;
  return !origin || projects.some((project) => project.id === origin.projectId && collectedResearchIssues(project).some((issue) => issue.number === origin.issueNumber));
}
