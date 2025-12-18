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

# Check if port 3000 is already in use. Prefer lsof for PID info; fall back to HTTP probe.
# Fast-fail if port 3000 already in use. Prefer lsof for PID info; fall back to HTTP probe.
if command -v lsof >/dev/null 2>&1; then
  if lsof -nP -t -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
    pids=$(lsof -nP -t -iTCP:3000 -sTCP:LISTEN | tr '\n' ' ')
    echo "ERROR: port 3000 already in use by PID(s): ${pids:-unknown}. Maybe a previous CRA instance is still running."
    exit 2
  fi
else
  if command -v curl >/dev/null 2>&1; then
    if curl -sS --max-time 1 http://localhost:3000/ >/dev/null 2>&1; then
      echo "ERROR: port 3000 appears to be in use (HTTP responded). Maybe a previous CRA instance is still running."
      exit 2
    fi
  fi
fi

# Start frontend (CRA) via npm start inside frontend/
cd "$ROOT_DIR/frontend"
# Start in background, redirect logs
nohup npm start >"$LOG_FILE" 2>&1 &
pid=$!
# brief pause
sleep 0.5
# Wait up to 15s for frontend readiness
ready=0
if command -v curl >/dev/null 2>&1; then
  for i in {1..15}; do
    if curl -sS --max-time 1 http://localhost:3000/ >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
else
  for i in {1..15}; do
    if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
fi

if [ "$ready" -eq 1 ] && kill -0 "$pid" >/dev/null 2>&1; then
  echo "$pid" > "$PID_FILE"
  echo "started (pid $pid)"
else
  # cleanup the process we started
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi
  echo "ERROR: frontend failed to become ready on :3000"
  exit 3
fi
