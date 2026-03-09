#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

require_backend_health_once || {
  log_error "backend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

log_step "[seat-marker-print] verifying seat marker print HTML renderer tokens"
node --input-type=module <<'NODE'
import path from 'node:path';

const modulePath = path.join(process.cwd(), 'frontend', 'src', 'utils', 'seatMarkerPrint.js');
const mod = await import(`file://${modulePath}`);

const sampleRequest = {
  event_id: 777,
  customer_name: 'Test Guest',
  event_title: 'Beach Band Night',
  start_datetime: '2026-06-21 19:00:00',
  selected_seats: JSON.stringify(['Orch-19-1', 'Orch-19-2']),
  seat_map_snapshot: JSON.stringify([
    { element_type: 'table', section_name: 'Orch', row_label: '19', total_seats: 2 }
  ]),
};

const customLabelRequest = {
  event_id: 778,
  customer_name: 'Custom Label Guest',
  event_title: 'Beach Band Night',
  start_datetime: '2026-06-21 19:00:00',
  selected_seats: JSON.stringify(['Section-Table 19-1', 'Section-Table 19-2']),
  seat_map_snapshot: JSON.stringify([
    {
      element_type: 'table',
      section_name: 'Section',
      row_label: 'Table 19',
      total_seats: 2,
      seat_labels: { '1': 'F', '2': 'E' }
    }
  ]),
};

const tableMarkers = mod.buildMarkersForRequest(sampleRequest, { mode: 'table' });
const seatMarkers = mod.buildMarkersForRequest(sampleRequest, { mode: 'seat' });
const customMarkers = mod.buildMarkersForRequest(customLabelRequest, { mode: 'seat' });
const additionalMarkers = mod.buildMarkersForRequest({
  ...sampleRequest,
  selected_seats: JSON.stringify(['Orch-19-3', 'Orch-19-4']),
}, { mode: 'seat' });
const allMarkers = [...tableMarkers, ...seatMarkers, ...customMarkers, ...additionalMarkers];
const html = mod.buildSeatMarkerPrintHtml(allMarkers, { title: 'Print Seat Markers' });

const requiredTokens = [
  'Print Seat Markers',
  '@page { margin: 0.25in; }',
  'grid-template-columns: 1fr 1fr;',
  'grid-template-rows: 1fr 1fr;',
  'height: 100%;',
  'class="sheet"',
  'markers-grid',
  'marker-card',
  'Seat 19-A',
  'Seat 19-B',
  'Seat 19-F',
  'Seat 19-E',
  'Test Guest',
  'Beach Band Night',
  'dashed',
];

const missing = requiredTokens.filter((token) => !html.includes(token));
if (missing.length) {
  throw new Error(`Missing expected marker print tokens: ${missing.join(', ')}`);
}

if (html.includes('50vh')) {
  throw new Error('Marker print HTML still uses viewport-based row sizing (50vh).');
}

const sheets = [...html.matchAll(/<section class="sheet">([\s\S]*?)<\/section>/g)];
const expectedSheets = Math.ceil(allMarkers.length / 4);
if (sheets.length !== expectedSheets) {
  throw new Error(`Expected ${expectedSheets} print sheets, got ${sheets.length}.`);
}
const markerCountsPerSheet = sheets.map((match) => (match[1].match(/class="marker-card\b/g) || []).length);
if (markerCountsPerSheet.some((count) => count > 4)) {
  throw new Error(`Found a print sheet with more than 4 markers: ${markerCountsPerSheet.join(', ')}`);
}
if (markerCountsPerSheet[0] !== 4) {
  throw new Error(`Expected first print sheet to contain 4 markers, got ${markerCountsPerSheet[0]}.`);
}

const seatEIndex = html.indexOf('Seat 19-E');
const seatFIndex = html.indexOf('Seat 19-F');
if (seatEIndex < 0 || seatFIndex < 0) {
  throw new Error('Expected custom seat labels Seat 19-E and Seat 19-F were not found.');
}
if (seatEIndex > seatFIndex) {
  throw new Error('Custom seat labels are not sorted alphabetically in print output (expected 19-E before 19-F).');
}
NODE

log_step "[seat-marker-print] verifying admin marker print action gating"
if ! rg -n "const confirmedVisibleRequests = useMemo" "$ROOT_DIR/frontend/src/admin/SeatRequestsModule.js" >/dev/null; then
  log_error "[seat-marker-print] missing confirmedVisibleRequests derived filter in SeatRequestsModule"
  exit 1
fi
if ! rg -n "if \\(!confirmedVisibleRequests\\.length\\) return;" "$ROOT_DIR/frontend/src/admin/SeatRequestsModule.js" >/dev/null; then
  log_error "[seat-marker-print] printSeatMarkers lacks defensive no-op when no confirmed requests exist"
  exit 1
fi
if ! rg -n "disabled=\\{confirmedVisibleRequests\\.length === 0\\}" "$ROOT_DIR/frontend/src/admin/SeatRequestsModule.js" >/dev/null; then
  log_error "[seat-marker-print] Print Seat Markers button is not disabled when no confirmed requests are visible"
  exit 1
fi
if ! rg -n "No confirmed reservations to print yet\\." "$ROOT_DIR/frontend/src/admin/SeatRequestsModule.js" >/dev/null; then
  log_error "[seat-marker-print] missing user-facing explanation for disabled Print Seat Markers action"
  exit 1
fi

log_success "[seat-marker-print] print HTML includes expected marker tokens"
