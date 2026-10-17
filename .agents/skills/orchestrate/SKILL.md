---
name: orchestrate
description: Run this repo's orchestrator development flow - plan with the planner agent, implement with server-dev/web-dev, verify with verifier, review with reviewer, loop up to 2 fix rounds, then report. Use for any feature, multi-file change, or bug with an unclear cause in the job-aggregator (server/ Express + web/ Angular).
---
# Orchestrate a change

You are the **orchestrator**: the main session. Plan, delegate, integrate, and
report. Don't write large changes yourself; your subagents can't spawn other
agents, so the coordinating is your job. The full spec is `.ai/workflow.md`.

## Steps

1. **Triage.** If the change is one file with an obvious fix, do it directly, run
   `.ai/scripts/verify.sh`, and stop. If an ambiguity would change the design, ask
   the user one question.
2. **Plan.** Delegate to the `planner` agent with the user's request word for word.
   Check that the plan has Goal, Tasks tagged `[server]`/`[web]`, Contract, Risks,
   and Verify. If the Risks mention LinkedIn/Naukri/Indeed, `policy.ts`, or personal
   data, re-read the hard rules in `AGENTS.md` and tighten the tasks.
3. **Build.**
   - Server tasks go to `server-dev`, web tasks to `web-dev`. Give each one its tasks
     and the Contract, verbatim.
   - If the web tasks consume a new or changed endpoint, run server-dev first and
     pass web-dev the *final* types. Otherwise run both in parallel.
4. **Verify.** Delegate to `verifier`. Add `--build` if build config or `start.sh` changed.
5. **Review.** Delegate to `reviewer`. For risky changes (platforms, policy, LLM
   calls, DB schema), also run the `second-opinion` skill with a *different* LLM
   than the one you're running on.
6. **Loop.** Route each failure or `high` finding to the dev that owns the file, with
   the exact text. Then repeat steps 4 and 5. Stop after **2 fix rounds** and escalate
   whatever is left.
7. **Report.** Cover the files changed (one line each), the checks run and their
   results, any findings you left open and why, and how the user can try it (from
   the plan's Verify). Don't commit unless asked.
8. **Ship (only if the user asked for a PR).** Run the `create-pr` skill. It hands
   off to `pr-manager`, which branches from `main`, commits only this task's files,
   pushes, and opens the PR.

## How to delegate in each tool

| Tool | How |
|---|---|
| Claude Code | Agent tool with `subagent_type: planner` (or `server-dev`, `web-dev`, `verifier`, `reviewer`, `pr-manager`) |
| Gemini CLI | Ask for the subagent by name ("use the planner agent to…"). Its tools are `.gemini/agents/*` |
| Codex | Ask Codex to spawn the named agent ("spawn the planner agent to…"). Agents are defined in `.codex/agents/*.toml` |
| No subagents (ChatGPT, Cursor, others) | Play each role in turn, reading `.ai/roles/<name>.md` before each phase, and keep the phases separate |

Pass each subagent everything it needs in its prompt. It doesn't see your conversation.
