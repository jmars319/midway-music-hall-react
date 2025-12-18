#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT_DIR/scripts/dev-frontend-stop.sh"

DEV_DIR="$ROOT_DIR/.dev"
PID_FILE="$DEV_DIR/frontend.pid"
if [ -f "$PID_FILE" ]; then
  echo "failed to stop"
  exit 1
fi

"$ROOT_DIR/scripts/dev-frontend-start.sh"

echo "restarted"
