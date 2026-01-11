#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-admin-api.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

created_event_id=""
created_layout_id=""

cleanup_resources() {
  if [ -n "$created_event_id" ]; then
    curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/events/${created_event_id}" >/dev/null 2>&1 || true
    created_event_id=""
  fi
  if [ -n "$created_layout_id" ]; then
    curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/seating-layouts/${created_layout_id}" >/dev/null 2>&1 || true
    created_layout_id=""
  fi
}
trap cleanup_resources EXIT

require_backend_health_once || {
  log_error "backend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

json_field() {
  local json="$1"
  local field="$2"
  printf '%s' "$json" | python3 -c 'import json, sys
field = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception as exc:
    raise SystemExit(f"invalid json: {exc}")
if field not in data:
    raise SystemExit(f"missing field: {field}")
value = data[field]
if isinstance(value, bool):
    print("true" if value else "false")
else:
    print(value)' "$field"
}

post_json() {
  local method="$1"
  local path="$2"
  local body="$3"
  curl -fsS -X "$method" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "$body" \
    "${API_BASE}${path}"
}

layout_name="Dev Verify Layout $(date +%s)"
layout_payload=$(cat <<JSON
{
  "name": "${layout_name}",
  "description": "Temporary verification layout",
  "layout_data": [
    {
      "id": "dev-verify-marker",
      "element_type": "marker",
      "label": "Verify Marker",
      "section_name": "Layout",
      "seat_type": "general",
      "total_seats": 0,
      "pos_x": 10,
      "pos_y": 10,
      "rotation": 0,
      "width": 120,
      "height": 80,
      "color": "#6b7280",
      "seat_labels": {}
    }
  ],
  "canvas_settings": { "preset": "standard", "width": 1200, "height": 800 }
}
JSON
)

log_step "[admin-api] creating seating layout"
layout_response=$(post_json "POST" "/seating-layouts" "$layout_payload")
created_layout_id="$(json_field "$layout_response" id)"
log_success "[admin-api] created layout ${created_layout_id}"

log_step "[admin-api] updating layout metadata"
update_layout_payload=$(cat <<JSON
{
  "name": "${layout_name} Updated",
  "description": "Updated via admin-api verify script",
  "layout_data": [
    {
      "id": "dev-verify-marker",
      "element_type": "marker",
      "label": "Verify Marker",
      "section_name": "Layout",
      "seat_type": "general",
      "total_seats": 0,
      "pos_x": 12,
      "pos_y": 12,
      "rotation": 0,
      "width": 120,
      "height": 80,
      "color": "#6b7280",
      "seat_labels": {}
    }
  ],
  "canvas_settings": { "preset": "standard", "width": 1200, "height": 800 }
}
JSON
)
post_json "PUT" "/seating-layouts/${created_layout_id}" "$update_layout_payload" >/dev/null

event_title="Dev Verify Event $(date +%s)"
event_date="$(date -u +%F)"
door_time="$(date -u -v+0H '+%F 18:00:00' 2>/dev/null || date -u '+%F 18:00:00')"
event_payload=$(cat <<JSON
{
  "artist_name": "${event_title}",
  "title": "${event_title}",
  "event_date": "${event_date}",
  "event_time": "20:00:00",
  "door_time": "${door_time}",
  "timezone": "America/New_York",
  "status": "draft",
  "visibility": "private",
  "seating_enabled": true,
  "layout_id": ${created_layout_id},
  "ticket_type": "reserved_seating"
}
JSON
)

log_step "[admin-api] creating event"
event_create_response=$(post_json "POST" "/events" "$event_payload")
created_event_id="$(json_field "$event_create_response" id)"
log_success "[admin-api] created event ${created_event_id}"

log_step "[admin-api] updating event layout + notes"
event_update_payload=$(cat <<JSON
{
  "layout_id": ${created_layout_id},
  "seating_enabled": true,
  "notes": "updated via admin-api verify",
  "change_note": "admin-api verify script"
}
JSON
)
post_json "PUT" "/events/${created_event_id}" "$event_update_payload" >/dev/null

log_step "[admin-api] fetching event by id"
curl -fsS -H 'Accept: application/json' "${API_BASE}/events/${created_event_id}" >/dev/null

log_success "[admin-api] verification flow completed successfully"
