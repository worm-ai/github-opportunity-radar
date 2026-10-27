# DOCX comments baseline

This experiment creates two minimal, valid OOXML DOCX files from the same script:

- `with-comments.docx` contains one anchored comment (`Reviewer`: `Needs source.`) on `Annotated phrase.`.
- `without-comments.docx` contains the same visible text without a comments part or relationship.

The script records the OOXML ground truth, SHA-256 hashes, package version, raw AnyDoc output or error, and the limitations of the result under `.data/experiments/docx-comments/`. It does not modify the application database. GenOffice is intentionally not described as executed until a complete, runnable checkout is available.

Run from the repository root:

```powershell
node experiments/docx-comments/run.mjs
```
