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

log_step "[seating-zoom-controls] checking /api/events"
events_response="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/events?limit=200")" || {
  log_error "failed to fetch /api/events"
  exit 1
}

target_event_id="$(JSON_INPUT="$events_response" python3 - <<'PY'
import json
import os

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
    if event_id in (None, ''):
        continue
    seating_enabled = event.get('seating_enabled')
    layout_id = event.get('layout_id')
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
  log_error "no seating-enabled event with a layout_id found via /api/events"
  log_info "create/enable one event with seating + layout and rerun"
  exit 1
fi

log_step "[seating-zoom-controls] checking /api/seating/event/${target_event_id}"
seating_response="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/seating/event/${target_event_id}")" || {
  log_error "failed to fetch /api/seating/event/${target_event_id}"
  exit 1
}

shape_ok="$(JSON_INPUT="$seating_response" python3 - <<'PY'
import json
import os

try:
    data = json.loads(os.environ.get('JSON_INPUT', ''))
except Exception:
    print('0')
    raise SystemExit(0)

ok = (
    isinstance(data, dict)
    and bool(data.get('success'))
    and isinstance(data.get('seating'), list)
)
print('1' if ok else '0')
PY
)"

if [ "$shape_ok" != "1" ]; then
  log_error "seating payload invalid for event ${target_event_id}; expected success=true with seating array"
  exit 1
fi

log_success "[seating-zoom-controls] required endpoints and payload shape validated"

cat <<GUIDE

Manual QA checklist (pass/fail):
1. Open frontend: $(frontend_url)
2. Open a seating-enabled event and launch EventSeatingModal.
3. In normal mode, tap/click '+' twice.
   Pass: map visibly zooms in; no UI overlap blocks map.
4. Pan/drag the map, then select one available seat.
   Pass: pan still works and seat toggle still works.
5. Tap/click '-' once, then tap/click 'Fit seats to screen'.
   Pass: zoom decreases, then map recenters/resets predictably.
6. Tap/click 'Open large map'.
   Pass: overlay is on top; underlying modal is not interactable.
7. Repeat steps 3-5 in large map mode, then tap/click 'Exit large map'.
   Pass: selected seat state is preserved after exit.
8. Mobile device checks (Android + iOS): repeat steps 3-7.
   Pass: controls remain reachable and do not block panning.

If any step fails, mark this verify as failed.
GUIDE

log_success "[seating-zoom-controls] guided verification script completed"
