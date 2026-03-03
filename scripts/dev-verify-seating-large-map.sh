#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"

require_backend_health_once || {
  log_error "backend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

log_step "[seating-large-map] checking events endpoint"
events_response="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/events?limit=200")" || {
  log_error "failed to fetch /api/events"
  exit 1
}

target_event_id="$(JSON_INPUT="$events_response" python3 - <<'PY'
import json
import os
import sys

try:
    data = json.loads(os.environ.get("JSON_INPUT", ""))
except Exception:
    print("")
    raise SystemExit(0)

candidates = []
if isinstance(data, dict):
    if isinstance(data.get('events'), list):
        candidates = data['events']
    elif isinstance(data.get('data'), dict) and isinstance(data['data'].get('events'), list):
        candidates = data['data']['events']

for event in candidates:
    if not isinstance(event, dict):
        continue
    event_id = event.get('id')
    seating_enabled = event.get('seating_enabled')
    layout_id = event.get('layout_id')
    if event_id is None:
        continue
    enabled = False
    if isinstance(seating_enabled, bool):
        enabled = seating_enabled
    elif isinstance(seating_enabled, (int, float)):
        enabled = int(seating_enabled) == 1
    elif isinstance(seating_enabled, str):
        enabled = seating_enabled.strip().lower() in {'1', 'true', 'yes'}
    if enabled and layout_id not in (None, '', 0, '0'):
        print(event_id)
        raise SystemExit(0)

print("")
PY
)"

if [ -z "$target_event_id" ]; then
  log_error "no seating-enabled event with a layout_id was found via /api/events"
  log_info "create or enable one event with seating, then re-run this script"
  exit 1
fi

log_step "[seating-large-map] checking seating payload for event ${target_event_id}"
seating_response="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/seating/event/${target_event_id}")" || {
  log_error "failed to fetch /api/seating/event/${target_event_id}"
  exit 1
}

seating_ok="$(JSON_INPUT="$seating_response" python3 - <<'PY'
import json
import os
import sys

try:
    data = json.loads(os.environ.get("JSON_INPUT", ""))
except Exception:
    print("0")
    raise SystemExit(0)

ok = bool(data.get('success')) and isinstance(data.get('seating'), list)
print('1' if ok else '0')
PY
)"

if [ "$seating_ok" != "1" ]; then
  log_error "seating endpoint did not return expected payload shape for event ${target_event_id}"
  exit 1
fi

log_success "[seating-large-map] required endpoints are available"

cat <<GUIDE

Manual QA guide (pass/fail):
1. Open frontend: $(frontend_url)
2. Open an event that uses seating and launch EventSeatingModal.
3. Click "Open large map".
   Pass: overlay fully covers seating modal content (no tap-through).
4. In large map mode, press Escape (desktop).
   Pass: large map closes (main seating modal remains open).
5. Re-open large map and select seats, then Exit large map.
   Pass: selected seats persist exactly.
6. Mobile checks (Android + iOS):
   - Pinch inside map area.
   - Pan/scroll map area.
   Pass: map remains navigable and usable with large text settings.
7. Confirm "Fit seats to screen" still recenters correctly in both modes.

If any step fails, mark this verify as failed.
GUIDE

log_success "[seating-large-map] guided verification script completed"
