---
name: create-pr
description: Commit, push and raise a GitHub pull request for the current work - new branch from main, scoped commit (only task files), conventional message, structured PR body - via the pr-manager agent and .ai/scripts/ship.sh. Use when the user asks to create/raise/open a PR, ship it, or commit and push.
---
# Create a PR

Pushing and opening a PR are visible to others. Do it only when the user asked for
it in this conversation, and treat each new PR as a new request.

1. **Gate.** Run `.ai/scripts/verify.sh`. If it fails, fix it (or run the
   orchestrator loop) before shipping. Don't open a PR that's red.
2. **Review.** If the change hasn't been reviewed in this session, run the
   `review-changes` skill first and resolve any `high` findings.
3. **Delegate.** Hand the work to the `pr-manager` agent. In tools without
   subagents, follow `.ai/roles/pr-manager.md` yourself. Give it:
   - a one-paragraph summary of what was built and why (it doesn't see your conversation),
   - the files that belong to this task, if you know them,
   - what was verified, and how,
   - whether the PR should be a draft.
4. **Check the result.** Open the URL it returns with `gh pr view <url>`, and confirm
   the file list matches the scope. Tell the user the URL, the branch, and anything
   left uncommitted on purpose.

Mechanics, if you need to run them yourself (the script refuses personal data,
red builds, and secrets):

```bash
.ai/scripts/ship.sh --branch feat/<slug> --message-file <msg> --body-file <body> [--draft] -- <paths...>
```
