@AGENTS.md

## Gemini CLI specifics

- You are the orchestrator for multi-file work. Activate the `orchestrate` skill
  and hand each phase to the subagent of that name: `planner`, `server-dev`,
  `web-dev`, `verifier`, `reviewer` (generated into `.gemini/agents/`).
- Skills are loaded from `.agents/skills/`, shared with Codex and Claude Code.
- Hooks (`.gemini/settings.json`) do three things. BeforeTool guards personal data,
  generated files, and destructive commands. AfterAgent runs `verify.sh` and asks
  you to retry if it fails. SessionStart adds branch context. The first time you
  run, approve them with `/hooks`.
- Tool names: shell is `run_shell_command`, edits are `replace`/`write_file`.
- For a second opinion from another model: `.ai/scripts/ask.sh claude review` or `.ai/scripts/ask.sh codex review`.
