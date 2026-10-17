#!/usr/bin/env bash
# Starts the API server (http://localhost:4000) and the Angular app
# (http://localhost:4200) together. Ctrl+C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for dir in server web; do
  if [ ! -d "$ROOT/$dir/node_modules" ]; then
    echo "[start] Installing $dir dependencies..."
    (cd "$ROOT/$dir" && npm install)
  fi
done

echo "[start] Building server..."
(cd "$ROOT/server" && npm run build)

pids=()
cleanup() {
  trap - INT TERM EXIT
  echo
  echo "[start] Shutting down..."
  # Signal the whole process group so npm/node/ng children die too.
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd "$ROOT/server" && npm run start:api 2>&1 | sed -u 's/^/[server] /') &
pids+=($!)

(cd "$ROOT/web" && npm start 2>&1 | sed -u 's/^/[web]    /') &
pids+=($!)

echo "[start] API: http://localhost:4000  |  App: http://localhost:4200"

# Exit (and stop the other process) as soon as either one dies.
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[start] A process exited; stopping the other."
      exit 1
    fi
  done
  sleep 1
done
