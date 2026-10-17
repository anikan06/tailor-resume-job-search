#!/usr/bin/env bash
# Ask a *different* LLM CLI for a read-only second opinion. The orchestrator
# uses this in the REVIEW step so a change isn't only checked by the model
# that wrote it.
#
#   .ai/scripts/ask.sh <claude|codex|gemini> review          review the uncommitted diff
#   .ai/scripts/ask.sh <claude|codex|gemini> review 42       review GitHub PR #42
#   .ai/scripts/ask.sh <claude|codex|gemini> review feat/x   review a branch against main
#   .ai/scripts/ask.sh <claude|codex|gemini> "<question>"    ask anything about the repo
#
# Every CLI runs non-interactively and must not edit files.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

llm="${1:-}"; ask="${2:-}"; target="${3:-}"
if [ -z "$llm" ] || [ -z "$ask" ]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 64
fi

if [ "$ask" = "review" ] && [ -n "$target" ]; then
  if [[ "$target" =~ ^[0-9]+$ ]]; then
    how="GitHub PR #$target: run gh pr view $target and gh pr diff $target, and read files at the PR head with git show (after git fetch origin pull/$target/head)"
  else
    how="branch $target: run git diff origin/main...$target and read files with git show $target:<path>"
  fi
  prompt="$(awk 'n >= 2 { print } /^---$/ && n < 2 { n++ }' "$ROOT/.ai/roles/reviewer.md")

You are giving a second opinion. Do not edit any files or post anything to GitHub. Review $how."
elif [ "$ask" = "review" ]; then
  if [ -z "$(git status --porcelain)" ]; then
    echo "Nothing to review: the working tree is clean." >&2
    exit 0
  fi
  prompt="$(awk 'n >= 2 { print } /^---$/ && n < 2 { n++ }' "$ROOT/.ai/roles/reviewer.md")

You are giving a second opinion. Do not edit any files. Review the current uncommitted changes in this repo now (run git diff HEAD and read untracked files)."
else
  prompt="Answer using this repository as context. Read AGENTS.md first. Do not edit any files.

$ask"
fi

case "$llm" in
  claude)
    command -v claude >/dev/null || { echo "claude CLI not installed: npm i -g @anthropic-ai/claude-code" >&2; exit 127; }
    claude -p "$prompt" --permission-mode plan
    ;;
  codex)
    command -v codex >/dev/null || { echo "codex CLI not installed: npm i -g @openai/codex" >&2; exit 127; }
    codex exec --sandbox read-only "$prompt"
    ;;
  gemini)
    command -v gemini >/dev/null || { echo "gemini CLI not installed: npm i -g @google/gemini-cli" >&2; exit 127; }
    gemini --approval-mode plan -p "$prompt"
    ;;
  *)
    echo "unknown LLM '$llm' (use claude, codex or gemini)" >&2
    exit 64
    ;;
esac
