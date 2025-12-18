#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

"$ROOT_DIR/scripts/dev-frontend-stop.sh"

DEV_DIR="$ROOT_DIR/.dev"
PID_FILE="$DEV_DIR/frontend.pid"
if [ -f "$PID_FILE" ]; then
  echo "failed to stop frontend (pid file remains)"
  exit 1
fi
if port_in_use "$DEV_FRONTEND_PORT"; then
  echo "failed to stop: port ${DEV_FRONTEND_PORT} still listening"
  exit 1
fi

"$ROOT_DIR/scripts/dev-frontend-start.sh"

echo "restarted"
