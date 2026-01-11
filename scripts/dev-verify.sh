#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

log_step "[verify] stopping any running servers (safe)"
"$ROOT_DIR/scripts/dev-stop.sh" >/dev/null 2>&1 || true

log_step "[verify] starting dev stack"
"$ROOT_DIR/scripts/dev-start.sh"

log_step "[verify] backend health direct"
require_backend_health_once

log_step "[verify] frontend root reachable"
require_frontend_home_once

log_step "[verify] proxy path reachable"
require_proxy_health_once

log_step "[verify] restarting stack"
"$ROOT_DIR/scripts/dev-restart.sh"

log_step "[verify] backend health after restart"
require_backend_health_once

log_step "[verify] proxy health after restart"
require_proxy_health_once

log_step "[verify] stopping dev stack"
"$ROOT_DIR/scripts/dev-stop.sh"

log_success "[verify] complete"
