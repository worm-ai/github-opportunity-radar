# Report failure control-flow comparison

Purpose: check whether the GPT Researcher report failure in Issue #2218 is better addressed first by existing-library error handling and a small output gate. This does not validate a standalone delivery product or its target users.

From the repository root:

```powershell
node --use-system-ca experiments/gpt-researcher-report/prepare.mjs
& .data/experiments/actual-ecommerce-noter/python/python.exe -I -B -X utf8 experiments/gpt-researcher-report/run.py
```

The preparation script retrieves two public source files at the reported commit and the observed default-branch commit, validates Git blob hashes, and archives full SHA-256 manifests. It optionally loads the configured GitHub token; it never prints credentials. A new preparation run updates the observed current commit.

The Python script verifies the archived checksums and executes the exact upstream `generate_report`, `ReportGenerator.__init__`, and `write_report` bodies through Python AST compilation. Only unrelated imports and methods are omitted. Provider calls, prompts, config, researcher, and output transport are explicit stubs. No upstream package or model service is installed or called.

Cases cover normal output, two connection exceptions, a programming exception followed by success, whitespace, `None`, and missing source context. The empty-output guard is deliberately minimal: it rejects invalid or blank strings, but accepts the upstream nonempty abstention message. It cannot establish report accuracy, usability, or market demand.

Raw sources, manifest, stdout observations, call counts, writer events and results are saved under `.data/experiments/gpt-researcher-report-failure-20261022/`. Run results are technical evidence only.

Run `node experiments/gpt-researcher-report/publish.mjs` to archive the checked result for the local application. Publication copies checksummed evidence to `.data/technical-experiments/gpt-researcher-report-failure-20261022/`, refuses to overwrite a different archived record, and does not change any opportunity's market status.

Run `node experiments/gpt-researcher-report/verify.mjs` against the currently running local app to verify the four artifact downloads, the related opportunity report, and the existing #2218 research note's saved boundary notices. This verification performs GET requests only.
