# AGENTS.md

Instructions for every AI coding agent working in this repo (Claude Code,
Gemini CLI, Codex, Cursor, Copilot, Windsurf, and others). Tool-specific notes
live in `CLAUDE.md` and `GEMINI.md`. The multi-LLM setup is described in
`.ai/README.md`.

## Project

`aahvya-job-aggregator` is a self-hosted job-search app.

- `server/` holds the Node 22.13+ TypeScript engine (ESM, `NodeNext`): an Express API
  (`httpServer.ts`), an MCP server (`index.ts`), Playwright browser automation
  (`browser.ts`, `formFiller.ts`, `platforms/*`), resume parsing and generation
  (`resume/*`), multi-provider LLM calls (`llm.ts`, `aiTailor.ts`), and SQLite
  storage through `node:sqlite` (`db.ts`).
- `web/` holds the Angular 18 app, built from standalone components and signals.
  Feature screens live in `web/src/app/features/*`. The API client is
  `core/api.service.ts`, and its models are in `core/models.ts`.

Run it with `./start.sh`, which starts the API on :4000 and the web app on :4200.

## Hard rules

1. **Never auto-submit on LinkedIn, Naukri, or Indeed.** `server/src/platforms/{linkedin,naukri,indeed}.ts`
   may click the entry button (Easy Apply / Apply) and fill fields. They must
   never click Submit, Review, Next, or Send, never press Enter in a form, and
   never call `form.submit()` or `requestSubmit()`. `AUTO_SUBMIT_ALLOWED` in
   `types.ts` holds only `greenhouse`, `lever`, and `workday`. `policy.ts` has no
   env var that loosens this. `node .ai/scripts/check-invariants.mjs` enforces it.
2. **Never read, print, or commit personal data.** This covers `server/config/profile.yaml`,
   `server/data/**` (SQLite DB, uploads, tailored resumes), and API keys.
3. **Keep server and web types in sync.** When an API payload changes, update
   `server/src/types.ts` *and* `web/src/app/core/models.ts` in the same change.
4. **Don't edit generated output.** That means `dist/`, `node_modules/`, `.angular/`,
   and the generated agent files listed in `.ai/README.md`.
5. Match the surrounding code: its comment density, naming, and idioms. Make small,
   focused diffs.

## Verify

```bash
.ai/scripts/verify.sh          # typecheck server + web, run safety invariants
.ai/scripts/verify.sh --build  # also run full builds
```

`web` unit tests (`ng test`) are still the Angular template stubs and are not
part of the gate.

## Development flow: orchestrator

For any non-trivial change (more than one file, a new feature, or a bug with an
unclear cause), the **main session acts as orchestrator**. It plans, delegates,
and integrates; it does not write large changes itself. The full spec is
`.ai/workflow.md`, and the `orchestrate` skill runs it.

```
            ┌──────────── orchestrator (main session) ────────────┐
 request ─▶ │ 1 PLAN      planner        → plan + task list        │
            │ 2 BUILD     server-dev / web-dev (parallel if split) │
            │ 3 VERIFY    verifier       → verify.sh results       │
            │ 4 REVIEW    reviewer       (+ optional 2nd-LLM opinion)│
            │ 5 LOOP      fix → 3, at most 2 rounds, then escalate │
            │ 6 REPORT                                             │
            │ 7 SHIP      pr-manager → branch, commit, push, PR    │
            │             (only when the user asks)                │
            └──────────────────────────────────────────────────────┘
```

Subagents (same names in every tool):

| Agent | Writes? | Job |
|---|---|---|
| `planner` | no | Reads code and returns a step-by-step plan with files, risks, and the server/web split |
| `server-dev` | `server/` only | Implements server tasks |
| `web-dev` | `web/` only | Implements Angular tasks |
| `verifier` | no | Runs `.ai/scripts/verify.sh` and reports failures with file:line |
| `reviewer` | no | Reviews the diff (or a PR/branch) for correctness, the hard rules, and type sync |
| `pr-manager` | git/gh only | Scopes the changes, creates a branch from `main`, commits, pushes, and opens the PR through `.ai/scripts/ship.sh` |

Small, single-file fixes can skip the flow. Make the change and run `verify.sh`.

## Git

Commit, push, and open PRs only when asked. Do it through the `create-pr` skill
(`pr-manager` → `.ai/scripts/ship.sh`). That creates `<type>/<slug>` from
`origin/main`, commits only the task's files with a conventional subject
(`feat:`, `fix:`, `refactor:`…), and opens a PR against `main`. Never force-push,
push to `main`, or merge. Review PRs with the `review-pr` skill.
