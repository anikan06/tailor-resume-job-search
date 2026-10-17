# Orchestrator workflow

The orchestrator is the **main session** of whichever tool you use. In Claude
Code, Gemini CLI, and Codex alike, subagents cannot spawn further subagents, so
orchestration cannot live in a subagent. It is driven by the `orchestrate` skill.

## 0. Triage

- Is it a trivial change (one file, obvious fix)? Do it directly, run `.ai/scripts/verify.sh`, and stop.
- Is the request ambiguous in a way that changes the design? Ask the user one focused question first.

## 1. Plan: `planner`

Send the planner the user's request word for word, plus any constraints you know.
It returns:

- **Goal**: one sentence.
- **Tasks**: a numbered list, each tagged `[server]` or `[web]`, naming the exact files to touch.
- **Contract**: any API shape that changes (request/response types), written once
  so both devs build against the same thing.
- **Risks**: hard-rule exposure (auto-submit, personal data), migrations, and behaviour changes.

Read the plan. If it touches `platforms/linkedin|naukri|indeed`, `policy.ts`, or
`AUTO_SUBMIT_ALLOWED`, re-read the hard rules in `AGENTS.md` before going on.

## 2. Build: `server-dev`, `web-dev`

- Give each dev **only its tasks plus the Contract**. If they don't depend on
  each other, run them in parallel.
- When web depends on a new endpoint, run server-dev first, then pass web-dev the final types.
- Devs must stay inside their package. The single exception is web-dev mirroring
  types into `web/src/app/core/models.ts`.

## 3. Verify: `verifier`

The verifier runs `.ai/scripts/verify.sh` (add `--build` when the change touches
build config, Angular templates heavily, or `start.sh`). It returns PASS, or a list
of failures with file:line and the first error line.

## 4. Review: `reviewer`

The reviewer reads `git diff` (plus untracked files) against the plan. It returns
findings ranked by severity, each with file:line and a concrete failure scenario.
It covers:

- Correctness bugs and unhandled edge cases
- Hard-rule violations (auto-submit, personal data, server/web type drift)
- Code that doesn't match the surrounding style or that leaves dead code

**Optional second opinion:** for risky changes, ask a *different* LLM to review the
same diff with `.ai/scripts/ask.sh <claude|codex|gemini> review`. Treat its output
as extra findings, and verify each one before acting on it.

## 5. Loop

- Any verifier failure or reviewer finding rated `high` goes back to the owning dev
  with the exact finding. Then repeat steps 3 and 4.
- Stop after **2 fix rounds**. If something is still failing, stop and report to
  the user what remains and why.

## 6. Report

Tell the user what changed (by file), what was verified and how, any open findings
you chose not to fix (and why), and the suggested next step. Don't commit unless asked.

## 7. Ship: `pr-manager` (only when the user asks)

Use the `create-pr` skill. Give `pr-manager` a summary of the work, the files in
scope, and what was verified. It runs `.ai/scripts/ship.sh`, which:

- creates `<type>/<slug>` from `origin/main`,
- re-runs `verify.sh`,
- commits only the listed paths,
- scans for secrets,
- pushes, and opens the PR.

Relay the PR URL, plus anything left uncommitted on purpose.

To review someone else's PR (or your own before merging), use the `review-pr`
skill. It checks the diff and runs `.ai/scripts/pr-verify.sh` in an isolated
worktree, then `reviewer` covers the code and the skill covers PR hygiene.
