#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

echo "[verify] stopping any running servers (safe)"
"$ROOT_DIR/scripts/dev-stop.sh" >/dev/null 2>&1 || true

echo "[verify] starting dev stack"
"$ROOT_DIR/scripts/dev-start.sh"

echo "[verify] backend health direct"
require_backend_health_once

echo "[verify] frontend root reachable"
require_frontend_home_once

echo "[verify] proxy path reachable"
require_proxy_health_once

echo "[verify] restarting stack"
"$ROOT_DIR/scripts/dev-restart.sh"

echo "[verify] backend health after restart"
require_backend_health_once

echo "[verify] proxy health after restart"
require_proxy_health_once

echo "[verify] stopping dev stack"
"$ROOT_DIR/scripts/dev-stop.sh"

echo "[verify] complete"
