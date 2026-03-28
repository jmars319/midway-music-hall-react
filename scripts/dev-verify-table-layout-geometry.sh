#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

log_step "[table-layout-geometry] running focused table geometry tests"
( cd "$ROOT_DIR/frontend" && CI=1 npm test -- --watch=false --runInBand --runTestsByPath src/utils/__tests__/tableLayoutGeometry.test.js )
log_success "[table-layout-geometry] table geometry tests passed"
