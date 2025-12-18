#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Clean restart: stop (frontend then backend), verify stopped, then start
"$ROOT_DIR/scripts/dev-frontend-stop.sh"
"$ROOT_DIR/scripts/dev-backend-stop.sh"

# verify none of the pid files remain
DEV_DIR="$ROOT_DIR/.dev"
if [ -f "$DEV_DIR/frontend.pid" ] || [ -f "$DEV_DIR/backend.pid" ]; then
  echo "failed to stop"
  exit 1
fi

"$ROOT_DIR/scripts/dev-backend-start.sh"
"$ROOT_DIR/scripts/dev-backend-start.sh"

# backend-start will perform readiness; now start frontend and ensure transactional behavior
if ! "$ROOT_DIR/scripts/dev-frontend-start.sh"; then
  echo "ERROR: frontend failed to start during restart; stopping backend"
  "$ROOT_DIR/scripts/dev-backend-stop.sh"
  exit 1
fi

# confirm both pid files exist
DEV_DIR="$ROOT_DIR/.dev"
if [ -f "$DEV_DIR/backend.pid" ] && [ -f "$DEV_DIR/frontend.pid" ]; then
  echo "dev servers restarted"
else
  echo "ERROR: one or more PID files missing after restart; stopping backend"
  "$ROOT_DIR/scripts/dev-backend-stop.sh"
  exit 2
fi
