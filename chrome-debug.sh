#!/usr/bin/env bash
# Opens a Chrome window the server can drive (LinkedIn/Naukri/Indeed prefill and
# the LinkedIn profile fetch). Chrome 136+ refuses remote debugging on your default
# profile, so this uses its own profile folder: log in to LinkedIn/Naukri/Indeed in
# it once and the logins stick. It runs alongside your normal Chrome.
set -euo pipefail

PORT="${CHROME_DEBUG_PORT:-9222}"
PROFILE_DIR="${CHROME_DEBUG_PROFILE:-$HOME/.job-search-agent/chrome-profile}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if curl -s "http://localhost:$PORT/json/version" >/dev/null; then
  # Open a LinkedIn tab in that window so it's easy to find among your other Chrome windows.
  curl -s -X PUT "http://localhost:$PORT/json/new?https://www.linkedin.com/feed/" >/dev/null || true
  echo "[chrome] Already running on port $PORT - opened a LinkedIn tab in that window."
  exit 0
fi

mkdir -p "$PROFILE_DIR"
"$CHROME" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE_DIR" \
  --no-first-run --no-default-browser-check "https://www.linkedin.com/login" >/dev/null 2>&1 &

for _ in $(seq 1 20); do
  if curl -s "http://localhost:$PORT/json/version" >/dev/null; then
    echo "[chrome] Ready on port $PORT (profile: $PROFILE_DIR). Log in to LinkedIn in that window if needed."
    exit 0
  fi
  sleep 0.5
done
echo "[chrome] Chrome didn't open port $PORT - check that it's installed at: $CHROME" >&2
exit 1
