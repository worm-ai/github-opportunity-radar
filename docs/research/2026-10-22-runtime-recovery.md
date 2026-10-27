# 2026-10-22 Runtime Recovery and Focused Research

This note records a real production-workspace run on `127.0.0.1:4317`. It is an operational and research record, not market validation.

## Runtime recovery

The main workspace had 102 collected projects, but the latest scan was partial because the configured OpenCode binary path no longer existed. The installed CLI was found at `C:\Users\1003584\AppData\Local\Programs\@opencodedesktop\resources\opencode-cli.exe` and reported version 2.1.2. The local `.env` path was corrected without changing the GitHub token or database directory.

An all-project analysis then failed closed: first the model returned invalid JSON, and a second run exhausted the available free-model timeouts and rate limits. Neither run saved an opportunity. Anonymous GitHub REST access was also rate limited, so Issue status was refreshed through the application's configured read-only GitHub client.

The service was switched from explicit `opencode` mode to the designed `local` mode. OpenCode remains the zero-price first choice; the already configured local Codex CLI is the bounded fallback. The settings API reports `opencode/minimax-m3.1-flash-free -> codex/gpt-6.1-sol`, `codexFallback: true`, and iii connected. Codex use may consume the existing configured service quota; it is not described as free. No DeepSeek API call was made.

## Focused run

Focused research run `023aad7c-cf83-4091-bbba-8d57173e3450` completed on the main database. It used `opencode/minimax-m3.1-flash-free` and `codex/gpt-6.1-sol`, reported 49,349 input and 2,595 output tokens, passed the exact-source gate and all six adversarial review checks, and saved one candidate with one verbatim citation to `firecrawl/anydoc#191`. The candidate remains `candidate` with `marketStatus: unvalidated`.

Issue #191 was refreshed at `2026-10-22T02:43:39.453Z`: it is open, last updated `2026-10-15T08:24:24Z`, has zero comments with a complete comment sample, and the sampled discussion references no PRs. The issue is one author's report. Open state does not prove the defect remains, and no customer identity, adoption scale, willingness to pay, or market demand was established.

The saved hypothesis is a DOCX review-comment preservation layer: AnyDoc supplies the Markdown body while GenOffice is investigated as a separate comment-reading path. Its main alternatives are a direct AnyDoc fix or GenOffice alone. The JSON fields, anchor precision, variant coverage, operating cost, and necessity of combining both projects remain untested.

## Next decision

Do not start another broad model analysis while free-model availability is unstable. The next high-information action is a small, fixed DOCX fixture with one known comment: record source XML, AnyDoc output, and GenOffice `docs read --comments --json` output. Stop the combination direction if AnyDoc already preserves the comment, GenOffice cannot recover it, or GenOffice alone is sufficient. Only after the technical test should an actual document-workflow user assess whether the separate comment appendix helps their work. That conversation or trial has not happened yet.

## Verification

- Main workspace Edge verification passed on `127.0.0.1:4317`: 51 Issue samples, 6 technical experiments, 3 research leads, no page errors, no mobile overflow, and no API writes from the browser verifier.
- Prior code verification after the append-only validation-history change: 27 test files and 273 tests passed; server and web builds and web typecheck passed.
- Main workspace remains on `.data`; isolated preview remains on `.data/local-cli-preview` at `127.0.0.1:4321`.
