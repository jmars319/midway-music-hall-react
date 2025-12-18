#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

"$ROOT_DIR/scripts/dev-backend-start.sh"

if ! wait_for_backend_ready; then
  echo "ERROR: backend failed readiness after start"
  exit 1
fi

if ! "$ROOT_DIR/scripts/dev-frontend-start.sh"; then
  echo "ERROR: frontend failed to start; stopping backend"
  "$ROOT_DIR/scripts/dev-backend-stop.sh"
  exit 1
fi

DEV_DIR="$ROOT_DIR/.dev"
if [ -f "$DEV_DIR/backend.pid" ] && [ -f "$DEV_DIR/frontend.pid" ]; then
  if verify_proxy_chain; then
    echo "dev servers started (proxy OK)"
    exit 0
  fi
fi

echo "ERROR: startup verification failed; stopping backend"
"$ROOT_DIR/scripts/dev-backend-stop.sh"
exit 2
