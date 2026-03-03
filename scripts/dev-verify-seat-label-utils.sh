#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

log_step "[seat-label-utils] verifying canonical seat label mapping"

node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const modulePath = path.join(rootDir, 'frontend', 'src', 'utils', 'seatLabelUtils.js');
const mod = await import(pathToFileURL(modulePath).href);

const assertEq = (label, actual, expected) => {
  if (actual !== expected) {
    throw new Error(`${label} expected "${expected}" but got "${actual}"`);
  }
};

if (typeof mod.formatSeatLabel !== 'function') {
  throw new Error('formatSeatLabel export is missing');
}

assertEq('19-1', mod.formatSeatLabel('19-1', { mode: 'seat' }), '19A');
assertEq('19-2', mod.formatSeatLabel('19-2', { mode: 'seat' }), '19B');
assertEq('19-6', mod.formatSeatLabel('19-6', { mode: 'seat' }), '19F');
assertEq('table mode 19-6', mod.formatSeatLabel('19-6', { mode: 'table' }), '19');

const nonSeatInputs = ['door', 'pole', 'dancefloor'];
for (const token of nonSeatInputs) {
  const out = mod.formatSeatLabel(token, { mode: 'seat' });
  if (typeof out !== 'string') {
    throw new Error(`non-seat token ${token} returned non-string output`);
  }
  if (out !== token) {
    throw new Error(`non-seat token ${token} should remain unchanged but became ${out}`);
  }
}

const seatCountRegex = /total_seats\s*[:=]\s*(\d+)/g;
const scanDirs = [path.join(rootDir, 'frontend'), path.join(rootDir, 'backend')];
let hasTenPlusSeats = false;

const shouldScan = (filePath) => {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.js') || lower.endsWith('.json') || lower.endsWith('.php') || lower.endsWith('.sql');
};

const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!shouldScan(fullPath)) continue;
    let content = '';
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }
    seatCountRegex.lastIndex = 0;
    let match;
    while ((match = seatCountRegex.exec(content)) !== null) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value >= 10) {
        hasTenPlusSeats = true;
        return;
      }
    }
    if (hasTenPlusSeats) return;
  }
};

for (const dir of scanDirs) {
  walk(dir);
  if (hasTenPlusSeats) break;
}

if (hasTenPlusSeats) {
  assertEq('19-10', mod.formatSeatLabel('19-10', { mode: 'seat' }), '19J');
  console.log('[seat-label-utils] detected >=10 seat tables in repo metadata; validated 19-10 -> 19J');
} else {
  console.log('[seat-label-utils] no >=10 seat table metadata found in repo; skipped 19-10 assertion');
}

console.log('[seat-label-utils] seat label checks passed');
NODE

log_step "[seat-label-utils] verifying admin fallback does not expose raw seat ids"
if rg -n "if \\(!snapshotRows\\.length\\) \\{[[:space:]]*return seats;[[:space:]]*\\}" "$ROOT_DIR/frontend/src/admin/SeatRequestsModule.js" >/dev/null; then
  log_error "[seat-label-utils] SeatRequestsModule fallback returns raw seats; expected describeSeatSelection mapping"
  exit 1
fi

log_step "[seat-label-utils] verifying seat_display_labels path is normalized"
if rg -n "return request\\.seat_display_labels;" "$ROOT_DIR/frontend/src/admin/SeatRequestsModule.js" >/dev/null; then
  log_error "[seat-label-utils] SeatRequestsModule returns raw seat_display_labels; expected describeSeatSelection mapping"
  exit 1
fi
if ! rg -n "request\\.seat_display_labels\\.map\\(\\(label\\) => describeSeatSelection\\(label\\)\\)" "$ROOT_DIR/frontend/src/admin/SeatRequestsModule.js" >/dev/null; then
  log_error "[seat-label-utils] Missing normalized seat_display_labels mapping in SeatRequestsModule"
  exit 1
fi

log_success "[seat-label-utils] verification complete"
