#!/usr/bin/env bash
set -euo pipefail

# Start backend dev server: php -S localhost:8080 -t backend
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEV_DIR="$ROOT_DIR/.dev"
PID_FILE="$DEV_DIR/backend.pid"
LOG_FILE="$DEV_DIR/backend.log"

mkdir -p "$DEV_DIR"

if [ -f "$PID_FILE" ]; then
  pid=$(cat "$PID_FILE")
  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "already running"
    exit 0
  else
    rm -f "$PID_FILE"
  fi
fi

# Start backend in background, capture PID
# Use repo-root php -S command as documented in README
cd "$ROOT_DIR"
nohup php -S localhost:8080 -t backend >"$LOG_FILE" 2>&1 &
pid=$!
# Give the server a moment to start
sleep 0.5
# Persist PID
echo "$pid" > "$PID_FILE"

echo "started (pid $pid)"
