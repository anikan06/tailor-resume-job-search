# Multi-LLM development setup

One orchestrator flow, six roles, shared skills and hooks, wired natively into each
AI coding tool. **Edit the sources and regenerate. Never hand-edit the generated files.**

## Sources of truth

| What | Where |
|---|---|
| Project rules + flow summary | `AGENTS.md` |
| Orchestrator flow spec | `.ai/workflow.md` |
| Agent roles | `.ai/roles/*.md` (frontmatter: `name`, `description`, `access: read\|shell\|write`) |
| Skills | `.agents/skills/*/SKILL.md` |
| Hook logic | `.ai/hooks/*.mjs` (one script per hook, accepts every tool's payload) |
| Verification gate | `.ai/scripts/verify.sh`, `.ai/scripts/check-invariants.mjs` |
| Cross-LLM second opinion | `.ai/scripts/ask.sh` (uncommitted diff, PR number, or branch) |
| Ship a PR | `.ai/scripts/ship.sh` (driven by the `pr-manager` agent / `create-pr` skill) |
| Verify a PR in isolation | `.ai/scripts/pr-verify.sh <pr#\|branch>` (throwaway worktree) |

After you change a role, run `node .ai/scripts/sync-agents.mjs`. `verify.sh` fails
if the generated agents are stale.

## What each tool gets

| | Instructions | Agents (generated) | Skills | Hooks |
|---|---|---|---|---|
| **Claude Code** | `CLAUDE.md` → imports `AGENTS.md` | `.claude/agents/*.md` | `.claude/skills` → symlink to `.agents/skills` | `.claude/settings.json` |
| **Gemini CLI** | `GEMINI.md` → imports `AGENTS.md` | `.gemini/agents/*.md` | `.agents/skills` (native) | `.gemini/settings.json` |
| **Codex** (CLI, IDE, ChatGPT cloud) | `AGENTS.md` (native) | `.codex/agents/*.toml` | `.agents/skills` (native) | `.codex/hooks.json` |
| **ChatGPT** (Projects / custom GPT) | `.ai/chatgpt/project-instructions.md` (paste) | roles played in turn | n/a | n/a, so run `verify.sh` yourself |
| **Cursor, Copilot, Windsurf, Aider, Jules…** | `AGENTS.md` (read natively) | roles played in turn (see the `orchestrate` skill) | if the tool supports `.agents/skills` | n/a |

Hooks, which are identical in behaviour across Claude, Gemini, and Codex:

| Hook | Claude | Gemini | Codex | Does |
|---|---|---|---|---|
| `session-context.mjs` | SessionStart | SessionStart | SessionStart | Injects the branch, files that were already dirty, and the flow reminder |
| `guard.mjs` | PreToolUse | BeforeTool | PreToolUse | Blocks `profile.yaml`, `server/data/**`, and `.env`; edits to `dist`/`node_modules`/generated agents; `reset --hard`, force-push, `rm -rf .`, piping downloads into a shell |
| `stop-verify.mjs` | Stop | AfterAgent | Stop | Runs `verify.sh --changed`. On failure, exits 2 so the agent keeps fixing. Once per turn (`stop_hook_active`), and caches a passing tree |

The guard is a tripwire, not a sandbox. It pattern-matches commands and paths, so
a determined workaround can get past it. The real protection for the apply policy
is `check-invariants.mjs`, which runs in the Stop gate and in `verify.sh`.

## First run per tool

- **Claude Code**: nothing to do. Project settings load automatically, and `/agents` lists the team.
- **Gemini CLI**: approve the project hooks when prompted (or use `/hooks`). `/agents` and `/skills list` show the rest.
- **Codex**: trust the project (so `.codex/` loads), then run `/hooks` and trust the three hooks.

## The flow

```
request → orchestrator (main session, `orchestrate` skill)
   1 PLAN    planner      Goal / Tasks [server|web] / Contract / Risks / Verify
   2 BUILD   server-dev ∥ web-dev     (serial if web needs new API types)
   3 VERIFY  verifier     verify.sh → PASS | failures with file:line
   4 REVIEW  reviewer     (+ ask.sh <other-llm> review for risky changes)
   5 LOOP    fixes → 3, max 2 rounds, then escalate to the user
   6 REPORT
   7 SHIP    pr-manager   (on request) ship.sh: branch from main → verify → commit → push → PR
```

The orchestrator is the main session, not a subagent, because none of the three
CLIs lets a subagent spawn more subagents.
