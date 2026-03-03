#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
created_layout_id=""
created_event_ids=()
created_request_ids=()

cleanup() {
  if [ "${#created_request_ids[@]}" -gt 0 ]; then
    for request_id in "${created_request_ids[@]}"; do
      curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/seat-requests/${request_id}" >/dev/null 2>&1 || true
    done
  fi
  if [ "${#created_event_ids[@]}" -gt 0 ]; then
    for event_id in "${created_event_ids[@]}"; do
      curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/events/${event_id}" >/dev/null 2>&1 || true
    done
  fi
  if [ -n "$created_layout_id" ]; then
    curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/seating-layouts/${created_layout_id}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

require_backend_health_once || {
  log_error "backend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

json_field() {
  local json="$1"
  local field="$2"
  JSON_INPUT="$json" python3 - "$field" <<'PY'
import json
import os
import sys

value = json.loads(os.environ.get('JSON_INPUT', '{}'))
for part in sys.argv[1].split('.'):
    if isinstance(value, list):
        value = value[int(part)]
    else:
        value = value.get(part)
if value is None:
    print('null')
elif isinstance(value, bool):
    print('true' if value else 'false')
else:
    print(value)
PY
}

post_json_raw() {
  local path="$1"
  local body="$2"
  curl -sS -X POST \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "$body" \
    "${API_BASE}${path}"
}

log_step "[seat-requests-hide-past] creating test seating layout"
layout_payload="$(cat <<JSON
{
  "name": "Seat Requests Past Filter $(date -u +%s)",
  "description": "Verification layout",
  "layout_data": [
    {
      "id": "verify-table",
      "element_type": "table",
      "table_shape": "table-4",
      "label": "Verify Table",
      "section_name": "Verify",
      "row_label": "A",
      "seat_type": "general",
      "total_seats": 4,
      "pos_x": 25,
      "pos_y": 25,
      "rotation": 0,
      "width": 140,
      "height": 140,
      "color": "#4b5563",
      "seat_labels": {}
    }
  ]
}
JSON
)"
layout_response="$(post_json_raw "/seating-layouts" "$layout_payload")"
layout_success="$(json_field "$layout_response" success)"
if [ "$layout_success" != "true" ]; then
  log_error "failed to create layout: $layout_response"
  exit 1
fi
created_layout_id="$(json_field "$layout_response" id)"
if [ "$created_layout_id" = "null" ] || [ -z "$created_layout_id" ]; then
  log_error "layout create did not return id: $layout_response"
  exit 1
fi

past_start="$(python3 - <<'PY'
import datetime
print((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S'))
PY
)"
future_start="$(python3 - <<'PY'
import datetime
print((datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)).strftime('%Y-%m-%d %H:%M:%S'))
PY
)"

door_from_start() {
  python3 - "$1" <<'PY'
import datetime
import sys
start = datetime.datetime.strptime(sys.argv[1], '%Y-%m-%d %H:%M:%S')
print((start - datetime.timedelta(hours=2)).strftime('%Y-%m-%d %H:%M:%S'))
PY
}

create_event() {
  local label="$1"
  local start_datetime="$2"
  local door_time
  door_time="$(door_from_start "$start_datetime")"
  local payload
  payload="$(cat <<JSON
{
  "artist_name": "${label}",
  "title": "${label}",
  "start_datetime": "${start_datetime}",
  "door_time": "${door_time}",
  "timezone": "America/New_York",
  "status": "published",
  "visibility": "public",
  "ticket_type": "reserved_seating",
  "layout_id": ${created_layout_id},
  "seating_enabled": true
}
JSON
)"
  local response
  response="$(post_json_raw "/events" "$payload")"
  local success
  success="$(json_field "$response" success)"
  if [ "$success" != "true" ]; then
    log_error "failed to create ${label} event: $response"
    exit 1
  fi
  local event_id
  event_id="$(json_field "$response" id)"
  if [ "$event_id" = "null" ] || [ -z "$event_id" ]; then
    log_error "${label} event missing id: $response"
    exit 1
  fi
  created_event_ids+=("$event_id")
  printf '%s\n' "$event_id"
}

past_event_id="$(create_event "Past Event Verify $(date -u +%s)" "$past_start")"
future_event_id="$(create_event "Future Event Verify $(date -u +%s)" "$future_start")"

create_request() {
  local event_id="$1"
  local seat_id="$2"
  local payload
  payload="$(cat <<JSON
{
  "event_id": ${event_id},
  "customer_name": "Seat Requests Verify",
  "contact": {
    "email": "verify-${event_id}@example.com",
    "phone": "555-555-1212"
  },
  "selected_seats": ["${seat_id}"],
  "special_requests": ""
}
JSON
)"
  local response
  response="$(post_json_raw "/seat-requests" "$payload")"
  local success
  success="$(json_field "$response" success)"
  if [ "$success" != "true" ]; then
    log_error "failed to create seat request for event ${event_id}: $response"
    exit 1
  fi
  local request_id
  request_id="$(json_field "$response" seat_request.id)"
  if [ "$request_id" = "null" ] || [ -z "$request_id" ]; then
    log_error "seat request create missing id for event ${event_id}: $response"
    exit 1
  fi
  created_request_ids+=("$request_id")
  printf '%s\n' "$request_id"
}

past_request_id="$(create_request "$past_event_id" "VerifyPast-A-1")"
future_request_id="$(create_request "$future_event_id" "VerifyFuture-A-1")"

contains_id() {
  local json="$1"
  local target_id="$2"
  JSON_INPUT="$json" TARGET_ID="$target_id" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ.get('JSON_INPUT', '{}'))
target = int(os.environ.get('TARGET_ID', '0'))
ids = {int(row.get('id', 0)) for row in payload.get('requests', []) if row.get('id') is not None}
print('1' if target in ids else '0')
PY
}

log_step "[seat-requests-hide-past] verifying default list excludes past events"
default_list="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/seat-requests?status=all")"
future_in_default="$(contains_id "$default_list" "$future_request_id")"
past_in_default="$(contains_id "$default_list" "$past_request_id")"
if [ "$future_in_default" != "1" ]; then
  log_error "future request ${future_request_id} missing from default seat requests list"
  exit 1
fi
if [ "$past_in_default" != "0" ]; then
  log_error "past request ${past_request_id} unexpectedly present in default seat requests list"
  exit 1
fi

log_step "[seat-requests-hide-past] verifying include_past=1 returns past events"
include_past_list="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/seat-requests?status=all&include_past=1")"
past_in_include="$(contains_id "$include_past_list" "$past_request_id")"
if [ "$past_in_include" != "1" ]; then
  log_error "past request ${past_request_id} not found when include_past=1"
  exit 1
fi

log_success "[seat-requests-hide-past] default hide-past behavior verified"
