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

# wait for backend readiness
if command -v curl >/dev/null 2>&1; then
  for i in {1..8}; do
    if curl -sSf --connect-timeout 1 http://localhost:8080/api/health >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
else
  sleep 1
fi

"$ROOT_DIR/scripts/dev-frontend-start.sh"

echo "dev servers restarted"
