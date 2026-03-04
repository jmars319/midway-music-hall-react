#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

log_step "[seat-label-utils] verifying canonical seat label mapping"

node --input-type=module <<'NODE'
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const modulePath = path.join(rootDir, 'frontend', 'src', 'utils', 'seatLabelUtils.js');
const mod = await import(pathToFileURL(modulePath).href);

const assertEq = (inputLabel, actual, expected) => {
  if (actual !== expected) {
    throw new Error(`[seat-label-utils] ${inputLabel} expected "${expected}" but got "${actual}"`);
  }
};

if (typeof mod.formatSeatLabel !== 'function') {
  throw new Error('[seat-label-utils] formatSeatLabel export is missing');
}
if (typeof mod.describeSeatSelection !== 'function') {
  throw new Error('[seat-label-utils] describeSeatSelection export is missing');
}

// Canonical IDs: seatIndex is authoritative.
assertEq(
  'formatSeatLabel("Section-Table 28-4")',
  mod.formatSeatLabel('Section-Table 28-4', { mode: 'seat' }),
  '28D'
);
assertEq(
  'formatSeatLabel("Section-Table 14-1")',
  mod.formatSeatLabel('Section-Table 14-1', { mode: 'seat' }),
  '14A'
);
assertEq(
  'formatSeatLabel("Section-Table 14-2")',
  mod.formatSeatLabel('Section-Table 14-2', { mode: 'seat' }),
  '14B'
);

// Deterministic >=10 seatIndex mapping.
assertEq(
  'formatSeatLabel("Section-Table 19-10")',
  mod.formatSeatLabel('Section-Table 19-10', { mode: 'seat' }),
  '19J'
);

// Regression: label-only overrides must not drop table number.
assertEq(
  'describeSeatSelection("Section-Table 28-4", "D")',
  mod.describeSeatSelection('Section-Table 28-4', 'D'),
  '28D'
);
assertEq(
  'describeSeatSelection("Section-Table 14-2", "B")',
  mod.describeSeatSelection('Section-Table 14-2', 'B'),
  '14B'
);

// Defensive behavior for non-seat tokens.
const nonSeatInputs = ['door', 'dancefloor'];
for (const token of nonSeatInputs) {
  const out = mod.formatSeatLabel(token, { mode: 'seat' });
  assertEq(`formatSeatLabel("${token}")`, out, token);
}

console.log('[seat-label-utils] seat label checks passed');
NODE

log_success "[seat-label-utils] verification complete"
