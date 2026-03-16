#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-seat-requests-hide-past.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"
created_layout_id=""
created_event_ids=()
created_request_ids=()

cleanup() {
  if [ "${#created_request_ids[@]}" -gt 0 ]; then
    for request_id in "${created_request_ids[@]}"; do
      admin_delete_request "$request_id" >/dev/null 2>&1 || true
    done
  fi
  if [ "${#created_event_ids[@]}" -gt 0 ]; then
    for event_id in "${created_event_ids[@]}"; do
      curl -fsS -X DELETE \
        -b "$ADMIN_COOKIE_JAR" \
        -H "Origin: ${ADMIN_ORIGIN}" \
        -H 'Accept: application/json' \
        "${API_BASE}/events/${event_id}" >/dev/null 2>&1 || true
    done
  fi
  if [ -n "$created_layout_id" ]; then
    curl -fsS -X DELETE \
      -b "$ADMIN_COOKIE_JAR" \
      -H "Origin: ${ADMIN_ORIGIN}" \
      -H 'Accept: application/json' \
      "${API_BASE}/seating-layouts/${created_layout_id}" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
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

admin_post_json() {
  local method="$1"
  local path="$2"
  local body="$3"
  curl -fsS -X "$method" \
    -b "$ADMIN_COOKIE_JAR" \
    -H "Origin: ${ADMIN_ORIGIN}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "$body" \
    "${API_BASE}${path}"
}

admin_get_json() {
  local path="$1"
  curl -fsS \
    -b "$ADMIN_COOKIE_JAR" \
    -H "Origin: ${ADMIN_ORIGIN}" \
    -H 'Accept: application/json' \
    "${API_BASE}${path}"
}

admin_delete_request() {
  local request_id="$1"
  curl -fsS -X DELETE \
    -b "$ADMIN_COOKIE_JAR" \
    -H "Origin: ${ADMIN_ORIGIN}" \
    -H 'Accept: application/json' \
    "${API_BASE}/seat-requests/${request_id}"
}

admin_login() {
  local login_payload
  login_payload=$(python3 - "$ADMIN_LOGIN_ID" "$ADMIN_LOGIN_PASSWORD" <<'PY'
import json
import sys
print(json.dumps({"email": sys.argv[1], "password": sys.argv[2]}))
PY
)
  local login_response
  login_response=$(curl -fsS \
    -c "$ADMIN_COOKIE_JAR" \
    -H "Origin: ${ADMIN_ORIGIN}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "$login_payload" \
    "${API_BASE}/login")
  local ok
  ok=$(LOGIN_JSON="$login_response" python3 - <<'PY'
import json
import os
payload = json.loads(os.environ.get('LOGIN_JSON', '{}'))
print('1' if payload.get('success') else '0')
PY
)
  if [ "$ok" != "1" ]; then
    log_error "admin login failed in hide-past verify script"
    exit 1
  fi
}

admin_login
baseline_stats="$(admin_get_json "/dashboard-stats")"
baseline_upcoming_events="$(json_field "$baseline_stats" "stats.upcoming_events")"
if [ "$baseline_upcoming_events" = "null" ] || [ -z "$baseline_upcoming_events" ]; then
  log_error "failed to read baseline dashboard upcoming_events count"
  exit 1
fi

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
layout_response="$(admin_post_json "POST" "/seating-layouts" "$layout_payload")"
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

date_from_start() {
  python3 - "$1" <<'PY'
import datetime
import sys
value = datetime.datetime.strptime(sys.argv[1], '%Y-%m-%d %H:%M:%S')
print(value.strftime('%Y-%m-%d'))
PY
}

time_from_start() {
  python3 - "$1" <<'PY'
import datetime
import sys
value = datetime.datetime.strptime(sys.argv[1], '%Y-%m-%d %H:%M:%S')
print(value.strftime('%H:%M:%S'))
PY
}

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
  local event_date
  local event_time
  local door_time
  event_date="$(date_from_start "$start_datetime")"
  event_time="$(time_from_start "$start_datetime")"
  door_time="$(door_from_start "$start_datetime")"
  local payload
  payload="$(cat <<JSON
{
  "artist_name": "${label}",
  "title": "${label}",
  "event_date": "${event_date}",
  "event_time": "${event_time}",
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
  response="$(admin_post_json "POST" "/events" "$payload")"
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

create_multi_day_event() {
  local label="$1"
  local first_start="$2"
  local final_start="$3"
  local first_date
  local first_time
  local final_date
  local final_time
  local door_time
  first_date="$(date_from_start "$first_start")"
  first_time="$(time_from_start "$first_start")"
  final_date="$(date_from_start "$final_start")"
  final_time="$(time_from_start "$final_start")"
  door_time="$(door_from_start "$first_start")"
  local payload
  payload="$(cat <<JSON
{
  "artist_name": "${label}",
  "title": "${label}",
  "event_date": "${first_date}",
  "event_time": "${first_time}",
  "door_time": "${door_time}",
  "timezone": "America/New_York",
  "status": "published",
  "visibility": "public",
  "ticket_type": "reserved_seating",
  "layout_id": ${created_layout_id},
  "seating_enabled": true,
  "multi_day_enabled": true,
  "occurrences": [
    { "event_date": "${first_date}", "event_time": "${first_time}" },
    { "event_date": "${final_date}", "event_time": "${final_time}" }
  ]
}
JSON
)"
  local response
  response="$(admin_post_json "POST" "/events" "$payload")"
  local success
  success="$(json_field "$response" success)"
  if [ "$success" != "true" ]; then
    log_error "failed to create ${label} multi-day event: $response"
    exit 1
  fi
  local event_id
  event_id="$(json_field "$response" id)"
  if [ "$event_id" = "null" ] || [ -z "$event_id" ]; then
    log_error "${label} multi-day event missing id: $response"
    exit 1
  fi
  created_event_ids+=("$event_id")
  printf '%s\n' "$event_id"
}

past_event_id="$(create_event "Past Event Verify $(date -u +%s)" "$past_start")"
future_event_id="$(create_event "Future Event Verify $(date -u +%s)" "$future_start")"
active_multi_day_event_id="$(create_multi_day_event "Active Multi-Day Verify $(date -u +%s)" "$past_start" "$future_start")"

log_step "[seat-requests-hide-past] verifying dashboard stats count active multi-day runs until the final occurrence ends"
updated_stats="$(admin_get_json "/dashboard-stats")"
updated_upcoming_events="$(json_field "$updated_stats" "stats.upcoming_events")"
expected_upcoming_events="$((baseline_upcoming_events + 2))"
if [ "$updated_upcoming_events" != "$expected_upcoming_events" ]; then
  log_error "dashboard upcoming_events mismatch after creating one future single-day event and one active multi-day run (expected ${expected_upcoming_events}, got ${updated_upcoming_events})"
  exit 1
fi

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
active_multi_day_request_id="$(create_request "$active_multi_day_event_id" "VerifyRun-A-1")"

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

request_field() {
  local json="$1"
  local target_id="$2"
  local field="$3"
  JSON_INPUT="$json" TARGET_ID="$target_id" python3 - "$field" <<'PY'
import json
import os
import sys

payload = json.loads(os.environ.get('JSON_INPUT', '{}'))
target = int(os.environ.get('TARGET_ID', '0'))
for row in payload.get('requests', []):
    if int(row.get('id', 0) or 0) != target:
        continue
    value = row
    for part in sys.argv[1].split('.'):
        if isinstance(value, list):
            value = value[int(part)]
        elif isinstance(value, dict):
            value = value.get(part)
        else:
            value = None
            break
    if value is None:
        print('null')
    elif isinstance(value, bool):
        print('true' if value else 'false')
    else:
        print(value)
    raise SystemExit(0)
print('null')
PY
}

log_step "[seat-requests-hide-past] verifying default list keeps active multi-day runs and excludes finished single-day events"
default_list="$(admin_get_json "/seat-requests?status=all")"
future_in_default="$(contains_id "$default_list" "$future_request_id")"
past_in_default="$(contains_id "$default_list" "$past_request_id")"
active_multi_day_in_default="$(contains_id "$default_list" "$active_multi_day_request_id")"
active_multi_day_flag="$(request_field "$default_list" "$active_multi_day_request_id" "event_is_multi_day")"
active_multi_day_summary="$(request_field "$default_list" "$active_multi_day_request_id" "event_run_summary")"
if [ "$future_in_default" != "1" ]; then
  log_error "future request ${future_request_id} missing from default seat requests list"
  exit 1
fi
if [ "$past_in_default" != "0" ]; then
  log_error "past request ${past_request_id} unexpectedly present in default seat requests list"
  exit 1
fi
if [ "$active_multi_day_in_default" != "1" ]; then
  log_error "active multi-day request ${active_multi_day_request_id} missing from default seat requests list"
  exit 1
fi
if [ "$active_multi_day_flag" != "1" ]; then
  log_error "active multi-day request ${active_multi_day_request_id} did not return event_is_multi_day=1"
  exit 1
fi
if [ "$active_multi_day_summary" = "null" ] || [ -z "$active_multi_day_summary" ]; then
  log_error "active multi-day request ${active_multi_day_request_id} missing event_run_summary"
  exit 1
fi

log_step "[seat-requests-hide-past] verifying include_past=1 returns past events"
include_past_list="$(admin_get_json "/seat-requests?status=all&include_past=1")"
past_in_include="$(contains_id "$include_past_list" "$past_request_id")"
if [ "$past_in_include" != "1" ]; then
  log_error "past request ${past_request_id} not found when include_past=1"
  exit 1
fi

log_success "[seat-requests-hide-past] single-day past filtering and active multi-day run-end filtering verified"
