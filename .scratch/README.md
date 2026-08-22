# Verification records

This directory stores evidence from the ERPBridge SDK verification app. It is intentionally local and is not a product runtime data store.

Record every unexpected setup result, documentation mismatch, compatibility issue, regression, workaround, flaky test, and confirmed root cause.

Each saved finding has one Markdown file and one JSON object in `index.jsonl`. Use UTC timestamps and stable IDs. Reports must include the component, SDK/server artifact identity, command or UI action, expected behavior, actual behavior, evidence, reproduction steps, workaround, RCA status, regression status, and follow-up.

Never write credentials, tokens, cookies, authorization values, raw secret-bearing server responses, or unredacted environment values. Use `[REDACTED]`.

Categories:

- `issues/`: one-off failures or defects
- `rca/`: confirmed root-cause analyses
- `regressions/`: behavior drift between versions or documentation
- `runs/`: summarized test runs and final compatibility reports
- `artifacts/`: ignored SDK tarballs and manifests
