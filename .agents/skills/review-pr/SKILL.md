---
name: review-pr
description: Review a GitHub pull request or branch against main - fetch the diff with gh, run verify.sh on it in an isolated worktree, check correctness, the repo's hard safety rules, type sync, scope and PR description quality, optionally get a second LLM's opinion, and output ranked findings with a verdict (posting to GitHub only on request). Use when asked to review a PR, a PR number/URL, or a branch.
---
# Review a PR

The target is a PR number or URL (`42`, `https://github.com/.../pull/42`) or a branch
name. With no target, review the current branch's open PR (`gh pr view --json number`).
If there is none, use the `review-changes` skill instead.

1. **Context.**
   - For a PR, run `gh pr view <n> --json number,title,body,author,headRefName,baseRefName,files,commits,url`.
   - For a branch, run `git log --oneline origin/main..<branch>`.
2. **Diff.** Use `gh pr diff <n>`, or `git diff origin/main...<branch>` for a branch.
   Read changed files at the PR's head with `git show <ref>:<path>`. Don't check the
   branch out over the user's working tree.
3. **Gate.** Run `.ai/scripts/pr-verify.sh <n|branch>`. It runs `verify.sh` in a
   throwaway worktree and cleans up afterwards.
4. **Code review.** Delegate to the `reviewer` agent with the PR number or branch.
   It knows how to read a PR. In tools without subagents, follow
   `.ai/roles/reviewer.md` yourself.
5. **PR-level checks.** Do these yourself:
   - **Scope**: every file belongs to the stated purpose, and there are no stray debug
     edits, lockfile churn, or unrelated refactors.
   - **Description**: Summary, Changes, Verification, and Risk & safety are present
     and true. Check that the claims match the diff and the gate result.
   - **Safety**: nothing under `server/data/` or `profile.yaml`, no keys, and any
     change to `platforms/`, `policy.ts`, or `AUTO_SUBMIT_ALLOWED` is called out
     in the description.
   - **Commits**: conventional subjects, and no "wip"/"fix typo" noise that should be squashed.
6. **Second opinion** (for risky PRs that touch platforms, policy, LLM calls, or DB):
   run `.ai/scripts/ask.sh <other-llm> review <n|branch>`. Verify each point it raises
   before including it.

## Output

```
PR #<n> <title> - <url>
Gate: PASS | FAIL (<failing check>)
Findings:
[high|medium|low] <file>:<line> - <defect>
  scenario: <inputs/state> -> <wrong result>
PR hygiene: <scope / description / commits issues, or "ok">
VERDICT: APPROVE | CHANGES REQUESTED
```

## Posting to GitHub

Only post if the user asks you to; it is public. Use
`gh pr review <n> --comment --body-file <file>`. Use `--request-changes` only if
they ask for it. Never `--approve` a PR you or another agent in this session authored.
