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
# Wait up to 10s for readiness
ready=0
if command -v curl >/dev/null 2>&1; then
  for i in {1..10}; do
    if curl -sSf --connect-timeout 1 http://localhost:8080/api/health >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
else
  # fallback to lsof to detect listening port
  for i in {1..10}; do
    if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
fi

if [ "$ready" -eq 1 ]; then
  # Persist PID
  echo "$pid" > "$PID_FILE"
  echo "started (pid $pid)"
else
  # failed to become ready: attempt to kill process we started
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi
  echo "ERROR: backend failed to become ready on :8080"
  exit 2
fi
