#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

log_step "[recurring-homepage] running focused recurring homepage display tests"
( cd "$ROOT_DIR/frontend" && CI=1 npm test -- --watch=false --runInBand --runTestsByPath src/utils/__tests__/recurringSeriesDisplay.test.js src/components/__tests__/RecurringEvents.test.js )
log_success "[recurring-homepage] recurring homepage display tests passed"
