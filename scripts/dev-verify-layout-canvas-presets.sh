#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

log_step "[layout-canvas-presets] running focused canvas preset tests"
( cd "$ROOT_DIR/frontend" && CI=1 npm test -- --watch=false --runInBand --runTestsByPath src/utils/__tests__/layoutCanvasPresets.test.js )
log_success "[layout-canvas-presets] canvas preset tests passed"

