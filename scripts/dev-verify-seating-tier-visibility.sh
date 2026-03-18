#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR/frontend"
CI=1 npm test -- --watch=false --runInBand --runTestsByPath src/components/__tests__/EventSeatingModal.tierVisibility.test.js src/utils/__tests__/seatingTierTheme.test.js
