import { expect, it } from "vitest";
import { readmeEvidenceExcerpt } from "./excerpts.js";

it("retains late CLI, deployment and license evidence when screenshots dominate the start", () => {
  const source = `# Product\nReal office editing.\n\n## Gallery\n${"<img alt='demo' src='shot.png'>\n".repeat(1200)}\n## Command line and agent skill\ngenoffice create --type xlsx --from table.json --out sales.xlsx\n\n## Deployment requirements\nRequires Linux x86_64 and glibc 2.34+.\n\n## License\nApache-2.0\n`;
  const excerpt = readmeEvidenceExcerpt(source, 8500);
  expect(excerpt.length).toBeLessThanOrEqual(8500);
  expect(excerpt).toContain("Real office editing.");
  expect(excerpt).toContain("genoffice create --type xlsx");
  expect(excerpt).toContain("glibc 2.34+");
  expect(excerpt).toContain("Apache-2.0");
});

it("does not rewrite short sources or invent text inside source spans", () => {
  const source = "A short README with no headings.";
  expect(readmeEvidenceExcerpt(source, 8500)).toBe(source);
});
