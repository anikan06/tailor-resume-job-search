---
name: second-opinion
description: Get a read-only review or answer from a different LLM CLI (Claude Code, Codex, or Gemini CLI) via .ai/scripts/ask.sh, so code isn't only checked by the model that wrote it. Use for risky changes or when the user asks what another model thinks.
---
# Second opinion from another LLM

```bash
.ai/scripts/ask.sh codex  review                  # Codex reviews the uncommitted diff (read-only sandbox)
.ai/scripts/ask.sh gemini review                  # Gemini CLI, --approval-mode plan
.ai/scripts/ask.sh claude review                  # Claude Code, --permission-mode plan
.ai/scripts/ask.sh gemini "why might X break?"    # any question, read-only
```

- Pick an LLM **other than the one you are**. If its CLI isn't installed (exit 127),
  try another, or tell the user which one to install.
- These calls go to that provider's API on the user's own account. Don't send them
  anything from `server/data` or `profile.yaml` (the guard hook blocks it anyway).
- Treat what comes back as *candidate* findings. Check each one against the code
  before reporting or acting on it, and say which model raised it.
- The call can take a minute or two. Run it in the background if your tool allows that.
