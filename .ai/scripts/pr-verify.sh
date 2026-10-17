#!/usr/bin/env bash
# Run verify.sh against a PR or branch in a throwaway git worktree, so the
# review never touches your working tree or current branch.
#
#   .ai/scripts/pr-verify.sh 42              # GitHub PR #42
#   .ai/scripts/pr-verify.sh feat/some-branch
#   .ai/scripts/pr-verify.sh 42 --build      # extra flags go to verify.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
target="${1:?usage: pr-verify.sh <pr-number|branch> [verify.sh flags]}"; shift

if [[ "$target" =~ ^[0-9]+$ ]]; then
  git fetch --quiet origin "pull/$target/head" || { echo "could not fetch PR #$target" >&2; exit 1; }
else
  git fetch --quiet origin "$target" 2>/dev/null || true
  git rev-parse --verify --quiet "origin/$target" >/dev/null || git rev-parse --verify --quiet "$target" >/dev/null \
    || { echo "unknown branch: $target" >&2; exit 1; }
fi
ref="$( [[ "$target" =~ ^[0-9]+$ ]] && git rev-parse FETCH_HEAD || git rev-parse "origin/$target" 2>/dev/null || git rev-parse "$target")"

dir="$(git rev-parse --absolute-git-dir)/ai-review/$(echo "$target" | tr '/' '-')"
git worktree remove --force "$dir" >/dev/null 2>&1 || true
git worktree add --quiet --detach "$dir" "$ref" || exit 1
trap 'git -C "$ROOT" worktree remove --force "$dir" >/dev/null 2>&1' EXIT

# Reuse the main checkout's dependencies instead of a fresh npm install.
for pkg in server web; do
  [ -d "$ROOT/$pkg/node_modules" ] && ln -s "$ROOT/$pkg/node_modules" "$dir/$pkg/node_modules"
done

echo "Verifying $target at $(git rev-parse --short "$ref")"
if [ -x "$dir/.ai/scripts/verify.sh" ]; then
  "$dir/.ai/scripts/verify.sh" "$@"
else
  echo "(that ref predates .ai/scripts; running this checkout's verify.sh against it)"
  ( cd "$dir/server" && npx --no-install tsc -p . --noEmit ) && ( cd "$dir/web" && npx --no-install tsc -p tsconfig.app.json --noEmit ) && echo PASS
fi
