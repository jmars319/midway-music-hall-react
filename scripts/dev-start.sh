#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Start backend first, wait for readiness, then start frontend

# Start backend
"$ROOT_DIR/scripts/dev-backend-start.sh"

# readiness check: prefer /api/health if available; fallback to short sleep
if command -v curl >/dev/null 2>&1; then
  # wait up to 8s for backend
  for i in {1..8}; do
    if curl -sSf --connect-timeout 1 http://localhost:8080/api/health >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
else
  sleep 1
fi

# Start frontend
if ! "$ROOT_DIR/scripts/dev-frontend-start.sh"; then
  echo "ERROR: frontend failed to start; stopping backend"
  "$ROOT_DIR/scripts/dev-backend-stop.sh"
  exit 1
fi

# Only report success if both PID files exist
if [ -f "$ROOT_DIR/.dev/backend.pid" ] && [ -f "$ROOT_DIR/.dev/frontend.pid" ]; then
  echo "dev servers started"
else
  echo "ERROR: one or more PID files missing after startup; stopping backend"
  "$ROOT_DIR/scripts/dev-backend-stop.sh"
  exit 2
fi
