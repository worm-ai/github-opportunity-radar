import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { z } from "zod";

const text = z.string().trim().min(1).max(2400);
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const filenameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.(png|pptx|json|csv|md)$/);
export const experimentSchema = z.object({
  id: idSchema, title: text, question: text, conclusion: text,
  executedAt: z.string().datetime(), environment: text, inputOrigin: text,
  projectIds: z.array(z.string().regex(/^\d+$/)).min(1).max(3),
  sources: z.array(z.object({ repository: text, commit: z.string().regex(/^[a-f0-9]{40}$/),
    modification: z.object({ artifact: filenameSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/), description: text }).strict().optional(),
  })).min(1).max(3),
  checks: z.array(z.object({ label: text, observation: text, outcome: z.enum(["supported", "refuted", "inconclusive"]) })).min(1).max(20),
  limitations: z.array(text).min(1).max(12), nextAction: text,
  artifacts: z.array(z.object({ name: filenameSchema, label: text, sha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(16),
}).strict().superRefine((record, context) => {
  for (const [index, source] of record.sources.entries()) {
    if (source.modification && !record.artifacts.some(artifact => artifact.name === source.modification!.artifact && artifact.sha256 === source.modification!.sha256)) {
      context.addIssue({ code: "custom", path: ["sources", index, "modification"], message: "Local modifications must reference an archived artifact with the same hash" });
    }
  }
});
export type TechnicalExperiment = z.infer<typeof experimentSchema>;
const mime: Record<string, string> = { png: "image/png", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", json: "application/json", csv: "text/csv; charset=utf-8", md: "text/markdown; charset=utf-8" };

function checkedPath(root: string, ...parts: string[]) {
  const base = realpathSync(root);
  const path = realpathSync(resolve(base, ...parts));
  if (!path.startsWith(`${base}${sep}`)) throw new Error("Experiment path is outside the archive");
  return path;
}

export function readExperiment(root: string, id: string): TechnicalExperiment {
  idSchema.parse(id);
  const path = checkedPath(root, id, "record.json");
  if (statSync(path).size > 256 * 1024) throw new Error("Experiment record is too large");
  const record = experimentSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (record.id !== id) throw new Error("Experiment identity mismatch");
  return record;
}

export function experimentArtifact(root: string, id: string, name: string) {
  filenameSchema.parse(name);
  const record = readExperiment(root, id);
  const artifact = record.artifacts.find((item) => item.name === name);
  if (!artifact) return null;
  const path = checkedPath(root, id, name);
  if (statSync(path).size > 20 * 1024 * 1024) throw new Error("Experiment artifact is too large");
  const bytes = readFileSync(path);
  if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error("Experiment artifact integrity mismatch");
  return { bytes, type: mime[name.split(".").at(-1)!]!, name };
}

export function listExperiments(root: string) {
  const records: TechnicalExperiment[] = [];
  const warnings: string[] = [];
  if (!existsSync(root)) return { records, warnings };
  const directories = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).slice(0, 50);
  for (const directory of directories) {
    try {
      const record = readExperiment(root, directory.name);
      for (const artifact of record.artifacts) experimentArtifact(root, record.id, artifact.name);
      records.push(record);
    } catch { warnings.push(`${directory.name}：实测记录不完整或产物校验失败，请检查本地归档。`); }
  }
  records.sort((a, b) => b.executedAt.localeCompare(a.executedAt));
  return { records, warnings };
}
