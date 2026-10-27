# Validation Progress Execution Record

## Change

Opportunity hypotheses now persist execution progress for each generated validation step. A user can mark a step as completed or skipped, attach an observation or skip reason, reload the page, and continue from the saved state. The opportunity list shows a small progress summary, and the opportunity report exports the execution record.

Step execution is deliberately separate from external validation. Saving a step never changes `marketStatus`, never creates a validation record, and never changes the opportunity score. When a later analysis changes the text of a step, the old record remains as historical data and is excluded from current progress until the new text is explicitly checked.

## Evidence

- SQLite migration from schema 12 to 13 passed with `PRAGMA integrity_check = ok` on the production database.
- The isolated storage and route test covers migration, restart recovery, invalid indexes, invalid payloads, step-text conflicts, revision history, reset, and separation from market evidence.
- The isolated Edge workflow covers completed and skipped steps, reload recovery, list progress, explicit reset, report download, mobile overflow, zero page errors, and three expected step writes. It uses a temporary database and rules-only analysis; production writes and model calls were zero.
- Production Edge read-only regression passed after restart. The production opportunity remains `unvalidated`, with no new analysis run and no external validation record.

## Boundary

This closes the gap between a static checklist and a resumable research task. It does not prove that a user saved time, that a candidate is wanted, or that anyone will pay. Those claims still require an authorized real-user workflow measured before and after, including missed and incorrect candidate decisions where relevant.
