// Keep original text spans; prioritize usable interfaces over long screenshot galleries.
export function readmeEvidenceExcerpt(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const sections: Array<{ start: number; end: number; priority: number }> = [];
  const headings = [...value.matchAll(/^#{1,4}\s+(.+)$/gm)];
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index]!;
    const title = heading[1]!;
    const priority = /command.?line|\bcli\b|\bapi\b|\bmcp\b|interface|接口|命令行/i.test(title) ? 4 : /quick.?start|usage|getting.started|installation|install|deploy|architecture|limit|requirement|license|使用|部署|限制|许可/i.test(title) ? 3 : /feature|capabilit|功能|能力/i.test(title) ? 2 : 0;
    sections.push({ start: heading.index!, end: headings[index + 1]?.index ?? value.length, priority });
  }
  if (!sections.some((section) => section.priority >= 3)) return value.slice(0, limit);
  const introEnd = Math.min(1800, Math.floor(limit * .22));
  const spans = [{ start: 0, end: introEnd }];
  let remaining = limit - introEnd;
  for (const section of sections.sort((a, b) => b.priority - a.priority || a.start - b.start)) {
    if (!section.priority || remaining <= 48 || section.end <= introEnd) continue;
    const start = Math.max(section.start, introEnd);
    const size = Math.min(section.end - start, Math.min(3200, remaining - 32));
    spans.push({ start, end: start + size });
    remaining -= size + 32;
  }
  return spans.sort((a, b) => a.start - b.start).map((span) => value.slice(span.start, span.end)).join("\n\n[... omitted README text ...]\n\n").slice(0, limit);
}
