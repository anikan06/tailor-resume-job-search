@AGENTS.md

## Claude Code specifics

- You are the orchestrator for multi-file work. Run the `orchestrate` skill
  (`/orchestrate`) and delegate with the Agent tool to `planner`, `server-dev`,
  `web-dev`, `verifier`, and `reviewer` (generated into `.claude/agents/`).
- Skills: `.claude/skills` is a symlink to the shared `.agents/skills/`, so Codex
  and Gemini CLI use the same ones.
- Hooks (`.claude/settings.json`) do three things. A guard blocks personal data,
  generated files, and destructive git commands. A Stop gate runs `verify.sh` on
  changed packages. A SessionStart hook injects branch and dirty-file context.
  If the Stop gate fails, fix the errors it reports; don't just stop.
- For a second opinion from another model: `.ai/scripts/ask.sh codex review` or `.ai/scripts/ask.sh gemini review`.
