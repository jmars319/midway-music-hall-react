#!/usr/bin/env bash
set -euo pipefail

# Clean restart: stop, verify stopped, then start
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT_DIR/scripts/dev-backend-stop.sh"

# ensure stopped
DEV_DIR="$ROOT_DIR/.dev"
PID_FILE="$DEV_DIR/backend.pid"
if [ -f "$PID_FILE" ]; then
  echo "failed to stop"
  exit 1
fi

"$ROOT_DIR/scripts/dev-backend-start.sh"

echo "restarted"
