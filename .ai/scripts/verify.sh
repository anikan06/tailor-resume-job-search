#!/usr/bin/env bash
# The repo's verification gate, shared by every AI tool and by humans.
#   .ai/scripts/verify.sh            typecheck server + web, safety invariants
#   .ai/scripts/verify.sh --build    also run full builds
#   .ai/scripts/verify.sh --changed  only check packages with uncommitted changes
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD=false CHANGED=false
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=true ;;
    --changed) CHANGED=true ;;
    *) echo "unknown flag: $arg" >&2; exit 64 ;;
  esac
done

touched() {
  $CHANGED || return 0
  [ -n "$(git -C "$ROOT" status --porcelain -- "$1" 2>/dev/null)" ]
}

failed=()
run() {
  local name="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    echo "✔ $name"
  else
    echo "✘ $name"
    echo "$out" | head -40 | sed 's/^/    /'
    failed+=("$name")
  fi
}

for pkg in server web; do
  if touched "$pkg" && [ ! -d "$ROOT/$pkg/node_modules" ]; then
    echo "✘ $pkg: node_modules missing - run (cd $pkg && npm install)"
    failed+=("$pkg deps")
  fi
done

if touched server; then
  run "server typecheck" bash -c "cd '$ROOT/server' && npx --no-install tsc -p . --noEmit"
  $BUILD && run "server build" bash -c "cd '$ROOT/server' && npm run build --silent"
fi
if touched web; then
  run "web typecheck" bash -c "cd '$ROOT/web' && npx --no-install tsc -p tsconfig.app.json --noEmit"
  $BUILD && run "web build" bash -c "cd '$ROOT/web' && npx --no-install ng build --configuration development"
fi
run "safety invariants" node "$ROOT/.ai/scripts/check-invariants.mjs"
run "agents in sync" node "$ROOT/.ai/scripts/sync-agents.mjs" --check

if [ ${#failed[@]} -gt 0 ]; then
  echo "FAIL: ${failed[*]}"
  exit 1
fi
echo "PASS"
