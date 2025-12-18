#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEV_DIR="$ROOT_DIR/.dev"
PID_FILE="$DEV_DIR/frontend.pid"
LOG_FILE="$DEV_DIR/frontend.log"

if [ ! -f "$PID_FILE" ]; then
  echo "not running"
  exit 0
fi

pid=$(cat "$PID_FILE")
if ! kill -0 "$pid" >/dev/null 2>&1; then
  rm -f "$PID_FILE"
  echo "not running"
  exit 0
fi

kill "$pid" >/dev/null 2>&1 || true
if command -v pkill >/dev/null 2>&1; then
  pkill -P "$pid" >/dev/null 2>&1 || true
fi

for i in {1..8}; do
  if kill -0 "$pid" >/dev/null 2>&1; then
    sleep 1
  else
    break
  fi
done

if kill -0 "$pid" >/dev/null 2>&1; then
  kill -9 "$pid" >/dev/null 2>&1 || true
fi

rm -f "$PID_FILE"
echo "stopped"
