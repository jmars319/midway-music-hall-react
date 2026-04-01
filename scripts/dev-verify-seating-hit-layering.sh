#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

log_step "[seating-hit-layering] running focused pointer-layering tests"
( cd "$ROOT_DIR/frontend" && CI=1 npm test -- --watch=false --runInBand --runTestsByPath src/components/__tests__/TableComponent.pointerEvents.test.js )
log_success "[seating-hit-layering] pointer-layering tests passed"

