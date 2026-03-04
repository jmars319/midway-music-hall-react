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
const html = mod.buildSeatMarkerPrintHtml([...tableMarkers, ...seatMarkers, ...customMarkers], { title: 'Print Seat Markers' });

const requiredTokens = [
  'Print Seat Markers',
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
