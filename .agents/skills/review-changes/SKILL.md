---
name: review-changes
description: Review the uncommitted diff in this repo for correctness bugs, hard-rule violations (auto-submit on LinkedIn/Naukri/Indeed, personal data, server/web type drift) and fit with surrounding code. Use when asked to review changes, before committing, or in the orchestrator REVIEW step.
---
# Review changes

1. Run `.ai/scripts/verify.sh --changed` first. A review of code that doesn't
   typecheck is wasted effort.
2. Delegate to the `reviewer` agent. If your tool has no subagents, follow
   `.ai/roles/reviewer.md` yourself against `git diff HEAD` plus the untracked files.
3. If the change touches `server/src/platforms/`, `policy.ts`, `formFiller.ts`,
   `llm.ts`, or `db.ts`, also get a second opinion (the `second-opinion` skill).
4. Merge the findings. Drop any you can't back with a concrete failure scenario
   after checking the code. Rank by severity: hard rules, then correctness, then type
   drift, then fit.

Output one line per finding: `[severity] file:line - defect`, plus a `scenario:` line.
End with `VERDICT: APPROVE` or `VERDICT: CHANGES REQUESTED`.
