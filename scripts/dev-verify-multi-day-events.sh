#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-multi-day-verify.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"
created_event_ids=()

cleanup() {
  for event_id in "${created_event_ids[@]:-}"; do
    [ -n "$event_id" ] || continue
    curl -fsS -X DELETE \
      -b "$ADMIN_COOKIE_JAR" \
      -H "Origin: ${ADMIN_ORIGIN}" \
      -H 'Accept: application/json' \
      "${API_BASE}/events/${event_id}" >/dev/null 2>&1 || true
  done
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
PY
}

json_python() {
  local json="$1"
  shift
  JSON_INPUT="$json" python3 - "$@"
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

public_post_with_status() {
  local path="$1"
  local body="$2"
  curl -sS -X POST \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "$body" \
    -w '\n%{http_code}' \
    "${API_BASE}${path}"
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
    log_error "admin login failed in multi-day verify script"
    exit 1
  fi
}

future_dates_json="$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
base = datetime.now(timezone.utc).date() + timedelta(days=14)
print(__import__('json').dumps({
    'day_one': base.isoformat(),
    'day_two': (base + timedelta(days=1)).isoformat(),
    'day_three': (base + timedelta(days=2)).isoformat(),
}))
PY
)"
DAY_ONE="$(json_field "$future_dates_json" day_one)"
DAY_TWO="$(json_field "$future_dates_json" day_two)"
DAY_THREE="$(json_field "$future_dates_json" day_three)"

layout_id="$(php -r "
if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; }
require '$ROOT_DIR/backend/bootstrap.php';
\$pdo = \\Midway\\Backend\\Database::connection();
\$id = (int) \$pdo->query('SELECT id FROM seating_layouts ORDER BY id ASC LIMIT 1')->fetchColumn();
echo \$id;
")"
if [ -z "$layout_id" ] || [ "$layout_id" = "0" ]; then
  log_error "no seating_layouts found"
  exit 1
fi

admin_login

create_admin_event() {
  local payload="$1"
  local response
  response="$(admin_post_json "POST" "/events" "$payload")"
  local success
  success="$(json_field "$response" success)"
  if [ "$success" != "true" ]; then
    log_error "event create failed: $response"
    exit 1
  fi
  local event_id
  event_id="$(json_field "$response" id)"
  created_event_ids+=("$event_id")
  printf '%s\n' "$event_id"
}

count_public_rows_for_event() {
  local json="$1"
  local event_id="$2"
  JSON_INPUT="$json" TARGET_EVENT_ID="$event_id" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ.get('JSON_INPUT', '{}'))
target = int(os.environ.get('TARGET_EVENT_ID', '0'))
rows = [row for row in payload.get('events', []) if int(row.get('id', 0) or 0) == target]
print(len(rows))
PY
}

assert_public_rows_distinct() {
  local json="$1"
  local event_id="$2"
  JSON_INPUT="$json" TARGET_EVENT_ID="$event_id" python3 - <<'PY'
import json
import os
import sys

payload = json.loads(os.environ.get('JSON_INPUT', '{}'))
target = int(os.environ.get('TARGET_EVENT_ID', '0'))
rows = [row for row in payload.get('events', []) if int(row.get('id', 0) or 0) == target]
keys = [str(row.get('occurrence_key') or '') for row in rows]
if len(keys) != len(set(keys)):
    sys.exit(1)
PY
}

assert_public_door_times() {
  local json="$1"
  local event_id="$2"
  local expected_csv="$3"
  JSON_INPUT="$json" TARGET_EVENT_ID="$event_id" EXPECTED_DOOR_TIMES="$expected_csv" python3 - <<'PY'
import json
import os
import sys

payload = json.loads(os.environ.get('JSON_INPUT', '{}'))
target = int(os.environ.get('TARGET_EVENT_ID', '0'))
expected = [token for token in os.environ.get('EXPECTED_DOOR_TIMES', '').split(',') if token]
rows = [row for row in payload.get('events', []) if int(row.get('id', 0) or 0) == target]
rows.sort(key=lambda row: str(row.get('start_datetime') or row.get('event_date') or ''))
actual = []
for row in rows:
    raw = str(row.get('door_time') or '').strip()
    if 'T' in raw:
        actual.append(raw.split('T', 1)[1])
    elif ' ' in raw:
        actual.append(raw.rsplit(' ', 1)[-1])
    else:
        actual.append(raw)
if actual != expected:
    print(f"Expected door_time sequence {expected}, got {actual}", file=sys.stderr)
    sys.exit(1)
PY
}

find_request_event_id() {
  local json="$1"
  local request_id="$2"
  JSON_INPUT="$json" TARGET_REQUEST_ID="$request_id" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ.get('JSON_INPUT', '{}'))
target = int(os.environ.get('TARGET_REQUEST_ID', '0'))
for row in payload.get('requests', []):
    if int(row.get('id', 0) or 0) == target:
        print(row.get('event_id'))
        raise SystemExit(0)
print('null')
PY
}

log_step "[multi-day] creating single-day event and verifying one-day compatibility"
single_payload="$(cat <<JSON
{
  "artist_name": "Multi-Day Verify Single $(date +%s)",
  "event_date": "${DAY_ONE}",
  "event_time": "19:30:00",
  "door_time": "${DAY_ONE} 18:00:00",
  "timezone": "America/New_York",
  "status": "published",
  "visibility": "public",
  "ticket_type": "reserved_seating",
  "layout_id": ${layout_id},
  "seating_enabled": true,
  "ticket_price": 25.00
}
JSON
)"
single_event_id="$(create_admin_event "$single_payload")"
single_event_json="$(admin_get_json "/events/${single_event_id}")"
single_occurrence_count="$(json_field "$single_event_json" event.occurrence_count)"
if [ "$single_occurrence_count" != "1" ]; then
  log_error "expected single-day event to report occurrence_count=1, got ${single_occurrence_count}"
  exit 1
fi

log_step "[multi-day] creating seat request before single-day -> multi-day conversion"
single_request_payload="$(cat <<JSON
{
  "event_id": ${single_event_id},
  "customer_name": "Multi-Day Verify",
  "contact": {
    "email": "multi-day-verify@example.com",
    "phone": "555-555-1200"
  },
  "selected_seats": ["Multi-${single_event_id}-A", "Multi-${single_event_id}-B"],
  "special_requests": ""
}
JSON
)"
single_request_response="$(public_post_with_status "/seat-requests" "$single_request_payload")"
single_request_status="$(printf '%s' "$single_request_response" | tail -n1)"
single_request_body="$(printf '%s' "$single_request_response" | sed '$d')"
if [ "$single_request_status" != "200" ]; then
  log_error "seat request create failed before conversion: ${single_request_body}"
  exit 1
fi
single_request_total="$(json_field "$single_request_body" seat_request.total_amount)"
single_request_id="$(json_field "$single_request_body" seat_request.id)"
if [ "$single_request_total" != "50.00" ]; then
  log_error "expected pre-conversion total_amount 50.00, got ${single_request_total}"
  exit 1
fi

log_step "[multi-day] converting existing event to multi-day without changing parent event id"
convert_payload="$(cat <<JSON
{
  "multi_day_enabled": true,
  "timezone": "America/New_York",
  "event_date": "${DAY_ONE}",
  "event_time": "19:30:00",
  "door_time": "${DAY_ONE} 18:00:00",
  "occurrences": [
    { "event_date": "${DAY_ONE}", "event_time": "19:30:00" },
    { "event_date": "${DAY_TWO}", "event_time": "20:00:00" }
  ]
}
JSON
)"
admin_post_json "PUT" "/events/${single_event_id}" "$convert_payload" >/dev/null
converted_event_json="$(admin_get_json "/events/${single_event_id}")"
converted_occurrence_count="$(json_field "$converted_event_json" event.occurrence_count)"
converted_is_multi_day="$(json_field "$converted_event_json" event.is_multi_day)"
if [ "$converted_occurrence_count" != "2" ] || [ "$converted_is_multi_day" != "1" ]; then
  log_error "single-day conversion did not persist multi-day metadata: ${converted_event_json}"
  exit 1
fi
seat_requests_json="$(admin_get_json "/seat-requests?limit=500")"
request_event_id="$(find_request_event_id "$seat_requests_json" "$single_request_id")"
if [ "$request_event_id" != "$single_event_id" ]; then
  log_error "seat request ${single_request_id} did not stay attached to parent event ${single_event_id}"
  exit 1
fi
public_upcoming_json="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/public/events?timeframe=upcoming&archived=0&limit=200")"
single_public_count="$(count_public_rows_for_event "$public_upcoming_json" "$single_event_id")"
if [ "$single_public_count" != "2" ]; then
  log_error "expected converted event ${single_event_id} to appear twice on public schedule, got ${single_public_count}"
  exit 1
fi
assert_public_rows_distinct "$public_upcoming_json" "$single_event_id" || {
  log_error "converted multi-day event ${single_event_id} does not expose distinct occurrence keys"
  exit 1
}

log_step "[multi-day] creating multi-day event directly"
direct_payload="$(cat <<JSON
{
  "artist_name": "Multi-Day Verify Direct $(date +%s)",
  "event_date": "${DAY_ONE}",
  "event_time": "19:00:00",
  "door_time": "${DAY_ONE} 17:30:00",
  "timezone": "America/New_York",
  "status": "published",
  "visibility": "public",
  "ticket_type": "reserved_seating",
  "layout_id": ${layout_id},
  "seating_enabled": true,
  "ticket_price": 30.00,
  "multi_day_enabled": true,
  "occurrences": [
    { "event_date": "${DAY_ONE}", "event_time": "19:00:00" },
    { "event_date": "${DAY_TWO}", "event_time": "19:30:00", "door_time": "18:00:00" },
    { "event_date": "${DAY_THREE}", "event_time": "20:00:00", "door_time": "18:30:00" }
  ]
}
JSON
)"
direct_event_id="$(create_admin_event "$direct_payload")"
direct_event_json="$(admin_get_json "/events/${direct_event_id}")"
direct_occurrence_count="$(json_field "$direct_event_json" event.occurrence_count)"
if [ "$direct_occurrence_count" != "3" ]; then
  log_error "expected direct multi-day event to report occurrence_count=3, got ${direct_occurrence_count}"
  exit 1
fi
public_upcoming_json="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/public/events?timeframe=upcoming&archived=0&limit=200")"
direct_public_count="$(count_public_rows_for_event "$public_upcoming_json" "$direct_event_id")"
if [ "$direct_public_count" != "3" ]; then
  log_error "expected direct multi-day event ${direct_event_id} to appear three times on public schedule, got ${direct_public_count}"
  exit 1
fi
assert_public_rows_distinct "$public_upcoming_json" "$direct_event_id" || {
  log_error "direct multi-day event ${direct_event_id} does not expose distinct occurrence keys"
  exit 1
}
assert_public_door_times "$public_upcoming_json" "$direct_event_id" "17:30:00,18:00:00,18:30:00" || {
  log_error "direct multi-day event ${direct_event_id} did not preserve per-occurrence door times"
  exit 1
}

log_step "[multi-day] verifying one reservation total for the whole run"
direct_request_payload="$(cat <<JSON
{
  "event_id": ${direct_event_id},
  "customer_name": "Multi-Day Direct Verify",
  "contact": {
    "email": "multi-day-direct@example.com",
    "phone": "555-555-1300"
  },
  "selected_seats": ["Direct-${direct_event_id}-A", "Direct-${direct_event_id}-B"],
  "special_requests": ""
}
JSON
)"
direct_request_response="$(public_post_with_status "/seat-requests" "$direct_request_payload")"
direct_request_status="$(printf '%s' "$direct_request_response" | tail -n1)"
direct_request_body="$(printf '%s' "$direct_request_response" | sed '$d')"
if [ "$direct_request_status" != "200" ]; then
  log_error "direct multi-day seat request failed: ${direct_request_body}"
  exit 1
fi
direct_request_total="$(json_field "$direct_request_body" seat_request.total_amount)"
direct_request_event_id="$(json_field "$direct_request_body" seat_request.event_id)"
if [ "$direct_request_total" != "60.00" ]; then
  log_error "expected direct multi-day total_amount 60.00, got ${direct_request_total}"
  exit 1
fi
if [ "$direct_request_event_id" != "$direct_event_id" ]; then
  log_error "seat request attached to wrong parent event: expected ${direct_event_id}, got ${direct_request_event_id}"
  exit 1
fi

log_step "[multi-day] verifying same seats cannot be reserved twice within the run"
conflict_payload="$(cat <<JSON
{
  "event_id": ${direct_event_id},
  "customer_name": "Multi-Day Direct Verify Conflict",
  "contact": {
    "email": "multi-day-direct-conflict@example.com",
    "phone": "555-555-1301"
  },
  "selected_seats": ["Direct-${direct_event_id}-A", "Direct-${direct_event_id}-B"],
  "special_requests": ""
}
JSON
)"
conflict_response="$(public_post_with_status "/seat-requests" "$conflict_payload")"
conflict_status="$(printf '%s' "$conflict_response" | tail -n1)"
conflict_body="$(printf '%s' "$conflict_response" | sed '$d')"
if [ "$conflict_status" != "409" ]; then
  log_error "expected second request for identical seats to fail with 409, got ${conflict_status}: ${conflict_body}"
  exit 1
fi

log_step "[multi-day] verifying featured and beach promo surfaces disclose multi-day runs"
if ! rg -n "formatEventRunSummary|isMultiDayEvent|Multi-day run" "$ROOT_DIR/frontend/src/components/FeaturedEvents.js" >/dev/null; then
  log_error "FeaturedEvents is missing the multi-day promo summary wiring"
  exit 1
fi
if ! rg -n "formatEventRunSummary|isMultiDayEvent|Multi-day run" "$ROOT_DIR/frontend/src/components/BeachSeriesShowcase.js" >/dev/null; then
  log_error "BeachSeriesShowcase is missing the multi-day promo summary wiring"
  exit 1
fi

log_step "[multi-day] verifying varying door-time helper behavior"
( cd "$ROOT_DIR/frontend" && CI=1 npm test -- --watch=false --runInBand --runTestsByPath src/utils/__tests__/eventFormat.doors.test.js )

log_success "[multi-day] create, convert, schedule expansion, shared reservation context, and pricing behavior verified"
