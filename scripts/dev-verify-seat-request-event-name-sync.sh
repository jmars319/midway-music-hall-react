#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-seat-name-sync.XXXXXX")"

created_layout_id=""
created_event_id=""
created_request_id=""

cleanup_resources() {
  if [ -n "$created_request_id" ]; then
    curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/seat-requests/${created_request_id}" >/dev/null 2>&1 || true
  fi
  if [ -n "$created_event_id" ]; then
    curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/events/${created_event_id}" >/dev/null 2>&1 || true
  fi
  if [ -n "$created_layout_id" ]; then
    curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/seating-layouts/${created_layout_id}" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup_resources EXIT

require_backend_health_once || {
  log_error "backend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

future_date=$(python3 - <<'PY'
import datetime
print((datetime.datetime.now() + datetime.timedelta(days=10)).strftime('%Y-%m-%d'))
PY
)

layout_payload=$(cat <<JSON
{
  "name": "Seat Name Sync Layout $(date +%s)",
  "description": "Verification layout for seat request event name sync",
  "layout_data": [
    {
      "id": "sync-table",
      "element_type": "table",
      "table_shape": "table-4",
      "label": "Sync Table",
      "section_name": "Sync",
      "row_label": "A",
      "seat_type": "general",
      "total_seats": 4,
      "pos_x": 20,
      "pos_y": 20,
      "rotation": 0,
      "width": 140,
      "height": 140,
      "color": "#4b5563",
      "seat_labels": {}
    }
  ]
}
JSON
)

create_layout_response=$(curl -fsS -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$layout_payload" "${API_BASE}/seating-layouts")
created_layout_id=$(CREATE_LAYOUT_JSON="$create_layout_response" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ['CREATE_LAYOUT_JSON'])
layout = payload.get('layout') or payload
print(layout.get('id') or '')
PY
)

if [ -z "$created_layout_id" ]; then
  log_error "failed to create layout for seat-request name sync verification"
  exit 1
fi

old_name="Old Name $(date +%s)"
new_name="New Name $(date +%s)"

event_payload=$(cat <<JSON
{
  "artist_name": "${old_name}",
  "title": "${old_name}",
  "event_date": "${future_date}",
  "event_time": "20:00:00",
  "door_time": "${future_date} 18:00:00",
  "status": "published",
  "visibility": "public",
  "seating_enabled": 1,
  "layout_id": ${created_layout_id},
  "ticket_type": "reserved_seating"
}
JSON
)

create_event_response=$(curl -fsS -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$event_payload" "${API_BASE}/events")
created_event_id=$(CREATE_EVENT_JSON="$create_event_response" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ['CREATE_EVENT_JSON'])
print(payload.get('id') or '')
PY
)

if [ -z "$created_event_id" ]; then
  log_error "failed to create event for seat-request name sync verification"
  exit 1
fi

log_step "[seat-name-sync] creating seat request against original event name"
seat_request_payload=$(cat <<JSON
{
  "event_id": ${created_event_id},
  "customer_name": "Seat Name Sync Tester",
  "contact": {
    "phone": "555-867-5309",
    "email": "seat-sync@example.com"
  },
  "selected_seats": ["Sync-A-1"],
  "special_requests": "Name sync verification"
}
JSON
)

create_request_response=$(curl -fsS -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$seat_request_payload" "${API_BASE}/seat-requests")
created_request_id=$(CREATE_REQUEST_JSON="$create_request_response" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ['CREATE_REQUEST_JSON'])
request = payload.get('seat_request') or {}
print(request.get('id') or '')
PY
)

if [ -z "$created_request_id" ]; then
  log_error "failed to create seat request for name sync verification"
  exit 1
fi

log_step "[seat-name-sync] updating event artist/title"
update_payload=$(cat <<JSON
{
  "artist_name": "${new_name}",
  "title": "${new_name}"
}
JSON
)
curl -fsS -X PUT -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$update_payload" "${API_BASE}/events/${created_event_id}" >/dev/null

log_step "[seat-name-sync] confirming seat request returns current event name"
requests_payload=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/seat-requests?event_id=${created_event_id}")
REQUESTS_JSON="$requests_payload" python3 - "$new_name" <<'PY'
import json
import os
import sys

expected = sys.argv[1]
payload = json.loads(os.environ['REQUESTS_JSON'])
requests = payload.get('requests') or []
if not requests:
    print('No requests returned for event after rename', file=sys.stderr)
    raise SystemExit(1)
name = requests[0].get('event_display_name')
if name != expected:
    print(f"Expected event_display_name '{expected}', got '{name}'", file=sys.stderr)
    raise SystemExit(1)
PY

log_success "[seat-name-sync] seat requests now reflect updated event names"
