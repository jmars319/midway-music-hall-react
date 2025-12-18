#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEV_DIR="$ROOT_DIR/.dev"
PID_FILE="$DEV_DIR/frontend.pid"
LOG_FILE="$DEV_DIR/frontend.log"

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

# Start frontend (CRA) via npm start inside frontend/
cd "$ROOT_DIR/frontend"
# Start in background, redirect logs
nohup npm start >"$LOG_FILE" 2>&1 &
pid=$!
# brief pause
sleep 0.5
# Save PID (npm is the parent process)
echo "$pid" > "$PID_FILE"

echo "started (pid $pid)"
