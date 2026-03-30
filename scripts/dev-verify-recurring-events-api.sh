#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-recurring-api.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"

require_backend_health_once || {
  log_error "backend is not running; start the dev stack before running this script."
  exit 1
}

json_field() {
  local json="$1"
  local field="$2"
  JSON_INPUT="$json" python3 - "$field" <<'PYCODE'
import json
import os
import sys

field = sys.argv[1]
data = json.loads(os.environ.get("JSON_INPUT", ""))
for part in field.split('.'):
    if isinstance(data, dict) and part in data:
        data = data[part]
    elif isinstance(data, list) and part.isdigit() and int(part) < len(data):
        data = data[int(part)]
    else:
        raise SystemExit(f"missing field: {field}")
if isinstance(data, (dict, list)):
    print(json.dumps(data, separators=(',', ':')))
elif isinstance(data, bool):
    print("true" if data else "false")
elif data is None:
    print("null")
else:
    print(data)
PYCODE
}

json_length() {
  local json="$1"
  local field="$2"
  JSON_INPUT="$json" python3 - "$field" <<'PYCODE'
import json
import os
import sys

field = sys.argv[1]
data = json.loads(os.environ.get("JSON_INPUT", ""))
for part in field.split('.'):
    if isinstance(data, dict) and part in data:
        data = data[part]
    elif isinstance(data, list) and part.isdigit() and int(part) < len(data):
        data = data[int(part)]
    else:
        raise SystemExit(f"missing field: {field}")
if not isinstance(data, (dict, list)):
    raise SystemExit(f"field is not a collection: {field}")
print(len(data))
PYCODE
}

json_array_to_csv() {
  local json="$1"
  ARRAY_JSON="$json" python3 - <<'PYCODE'
import json
import os

data = json.loads(os.environ["ARRAY_JSON"])
if not isinstance(data, list):
    raise SystemExit("expected a JSON array")
print(",".join(str(item) for item in data))
PYCODE
}

post_json() {
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
    log_error "admin login failed in recurring-api verify script"
    exit 1
  fi
}

fetch_child_dates() {
  local event_id="$1"
  php -r "if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; } require \$argv[1]; \$pdo = \\Midway\\Backend\\Database::connection(); \$stmt = \$pdo->prepare('SELECT event_date FROM events WHERE series_master_id = ? AND deleted_at IS NULL ORDER BY event_date ASC, id ASC'); \$stmt->execute([(int) \$argv[2]]); echo json_encode(\$stmt->fetchAll(PDO::FETCH_COLUMN));" \
    "$ROOT_DIR/backend/bootstrap.php" \
    "$event_id"
}

fetch_child_rows() {
  local event_id="$1"
  php -r "if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; } require \$argv[1]; \$pdo = \\Midway\\Backend\\Database::connection(); \$stmt = \$pdo->prepare('SELECT id, event_date, ticket_price, door_price, min_ticket_price, max_ticket_price, pricing_config FROM events WHERE series_master_id = ? AND deleted_at IS NULL ORDER BY event_date ASC, id ASC'); \$stmt->execute([(int) \$argv[2]]); echo json_encode(\$stmt->fetchAll(PDO::FETCH_ASSOC));" \
    "$ROOT_DIR/backend/bootstrap.php" \
    "$event_id"
}

fetch_child_publish_rows() {
  local event_id="$1"
  php -r "if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; } require \$argv[1]; \$pdo = \\Midway\\Backend\\Database::connection(); \$stmt = \$pdo->prepare('SELECT event_date, status, visibility FROM events WHERE series_master_id = ? AND deleted_at IS NULL ORDER BY event_date ASC, id ASC'); \$stmt->execute([(int) \$argv[2]]); echo json_encode(\$stmt->fetchAll(PDO::FETCH_ASSOC));" \
    "$ROOT_DIR/backend/bootstrap.php" \
    "$event_id"
}

fetch_event_response() {
  local event_id="$1"
  curl -fsS \
    -b "$ADMIN_COOKIE_JAR" \
    -H "Origin: ${ADMIN_ORIGIN}" \
    -H 'Accept: application/json' \
    "${API_BASE}/events/${event_id}"
}

fetch_public_events_response() {
  curl -fsS \
    -H 'Accept: application/json' \
    "${API_BASE}/public/events?timeframe=upcoming&archived=0&limit=200"
}

find_event_by_id() {
  local json="$1"
  local event_id="$2"
  JSON_INPUT="$json" python3 - "$event_id" <<'PYCODE'
import json
import os
import sys

payload = json.loads(os.environ.get("JSON_INPUT", ""))
events = payload.get("events", []) if isinstance(payload, dict) else payload
target = int(sys.argv[1])
for event in events:
    if int(event.get("id") or 0) == target:
        print(json.dumps(event, separators=(',', ':')))
        break
else:
    raise SystemExit(f"event not found: {target}")
PYCODE
}

assert_json_array_equals() {
  local actual_json="$1"
  local expected_csv="$2"
  ACTUAL_JSON="$actual_json" EXPECTED_CSV="$expected_csv" python3 - <<'PY'
import json
import os
actual = json.loads(os.environ['ACTUAL_JSON'])
expected = [item for item in os.environ['EXPECTED_CSV'].split(',') if item]
if actual != expected:
    raise SystemExit(f"expected {expected}, got {actual}")
PY
}

recurrence_is_null() {
  local payload="$1"
  RECURRING_JSON="$payload" python3 - <<'PY'
import json
import os
data = json.loads(os.environ['RECURRING_JSON'])
print('1' if data.get('recurrence') is None else '0')
PY
}

single_weekday_event_id=""
weekly_exception_event_id=""
multi_weekday_event_id=""
monthly_day_event_id=""
monthly_nth_event_id=""
monthly_override_event_id=""
legacy_monthly_event_id=""
public_display_event_id=""
single_event_id=""

cleanup() {
  local event_id
  for event_id in "$single_weekday_event_id" "$weekly_exception_event_id" "$multi_weekday_event_id" "$monthly_day_event_id" "$monthly_nth_event_id" "$monthly_override_event_id" "$legacy_monthly_event_id" "$public_display_event_id" "$single_event_id"; do
    if [ -n "$event_id" ]; then
      curl -fsS -X DELETE \
        -b "$ADMIN_COOKIE_JAR" \
        -H "Origin: ${ADMIN_ORIGIN}" \
        -H 'Accept: application/json' \
        "${API_BASE}/events/${event_id}" >/dev/null 2>&1 || true
    fi
  done
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mark_children_imported() {
  local event_id="$1"
  php -r "if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; } require \$argv[1]; \$pdo = \\Midway\\Backend\\Database::connection(); \$stmt = \$pdo->prepare(\"UPDATE events SET change_note = 'imported from events.json', updated_by = 'verify' WHERE series_master_id = ? AND deleted_at IS NULL\"); \$stmt->execute([(int) \$argv[2]]);" \
    "$ROOT_DIR/backend/bootstrap.php" \
    "$event_id"
}

apply_legacy_monthly_rule_shape() {
  local event_id="$1"
  local starts_on="$2"
  local ends_on="$3"
  local rule_payload="$4"
  php -r "if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; } require \$argv[1]; \$pdo = \\Midway\\Backend\\Database::connection(); \$stmt = \$pdo->prepare('UPDATE event_recurrence_rules SET frequency = ?, byweekday = ?, bymonthday = NULL, bysetpos = NULL, starts_on = ?, ends_on = ?, rule_payload = ?, updated_by = ?, change_note = ? WHERE event_id = ?'); \$stmt->execute(['monthly', 'SU', \$argv[3], \$argv[4], \$argv[5], 'verify', 'legacy monthly compatibility verify', (int) \$argv[2]]);" \
    "$ROOT_DIR/backend/bootstrap.php" \
    "$event_id" \
    "$starts_on" \
    "$ends_on" \
    "$rule_payload"
}

tamper_child_occurrence_date() {
  local child_id="$1"
  local new_date="$2"
  php -r "if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; } require \$argv[1]; \$pdo = \\Midway\\Backend\\Database::connection(); \$stmt = \$pdo->prepare('SELECT event_time, timezone, door_time, end_datetime FROM events WHERE id = ? LIMIT 1'); \$stmt->execute([(int) \$argv[2]]); \$row = \$stmt->fetch(PDO::FETCH_ASSOC); if (!\$row) { fwrite(STDERR, \"child not found\\n\"); exit(1); } \$time = \$row['event_time'] ?: '18:00:00'; \$tz = new DateTimeZone((string) (\$row['timezone'] ?: 'America/New_York')); \$start = new DateTimeImmutable(\$argv[3] . ' ' . \$time, \$tz); \$existingEnd = !empty(\$row['end_datetime']) ? new DateTimeImmutable((string) \$row['end_datetime'], \$tz) : \$start->modify('+4 hours'); \$duration = max(3600, \$existingEnd->getTimestamp() - \$start->getTimestamp()); \$door = null; if (!empty(\$row['door_time'])) { \$doorDt = new DateTimeImmutable((string) \$row['door_time'], \$tz); \$door = new DateTimeImmutable(\$argv[3] . ' ' . \$doorDt->format('H:i:s'), \$tz); } \$update = \$pdo->prepare('UPDATE events SET event_date = ?, start_datetime = ?, end_datetime = ?, door_time = ?, updated_by = ?, change_note = ? WHERE id = ?'); \$update->execute([\$argv[3], \$start->format('Y-m-d H:i:s'), \$start->modify('+' . \$duration . ' seconds')->format('Y-m-d H:i:s'), \$door ? \$door->format('Y-m-d H:i:s') : null, 'verify', 'tampered stale child for public recurrence verify', (int) \$argv[2]]);" \
    "$ROOT_DIR/backend/bootstrap.php" \
    "$child_id" \
    "$new_date"
}

admin_login

date_info="$(python3 - <<'PY'
import json
import calendar
from datetime import date, timedelta

today = date.today()

def next_weekday(start, weekday):
    return start + timedelta(days=(weekday - start.weekday()) % 7)

def recurring_dates(start, weekdays, end):
    current = start
    out = []
    weekday_set = set(weekdays)
    while current <= end:
        if current.weekday() in weekday_set:
            out.append(current.isoformat())
        current += timedelta(days=1)
    return out

def nth_weekday_of_month(year, month, weekday, nth):
    matches = []
    for week in calendar.monthcalendar(year, month):
        day_value = week[weekday]
        if day_value:
            matches.append(date(year, month, day_value))
    if nth == -1:
        return matches[-1] if matches else None
    if 1 <= nth <= len(matches):
        return matches[nth - 1]
    return None

def monthly_day_dates(start, monthdays, count):
    current = date(start.year, start.month, 1)
    out = []
    seen = set()
    while len(out) < count:
        days_in_month = calendar.monthrange(current.year, current.month)[1]
        for monthday in monthdays:
            if monthday > days_in_month:
                continue
            candidate = date(current.year, current.month, monthday)
            if candidate < start or candidate in seen:
                continue
            out.append(candidate.isoformat())
            seen.add(candidate)
            if len(out) >= count:
                break
        if current.month == 12:
            current = date(current.year + 1, 1, 1)
        else:
            current = date(current.year, current.month + 1, 1)
    return out

def monthly_nth_dates(start, weekday, positions, count):
    current = date(start.year, start.month, 1)
    out = []
    seen = set()
    while len(out) < count:
        for position in positions:
            candidate = nth_weekday_of_month(current.year, current.month, weekday, position)
            if candidate is None or candidate < start or candidate in seen:
                continue
            out.append(candidate.isoformat())
            seen.add(candidate)
            if len(out) >= count:
                break
        if current.month == 12:
            current = date(current.year + 1, 1, 1)
        else:
            current = date(current.year, current.month + 1, 1)
    return sorted(out)

single_start_on = today + timedelta(days=1)
single_first = next_weekday(single_start_on, 3)  # Thursday, where Monday=0
single_second = single_first + timedelta(days=7)
single_third = single_first + timedelta(days=14)
weekly_override_date = (single_second + timedelta(days=1)).isoformat()
weekly_override_dates = [single_first.isoformat(), weekly_override_date, single_third.isoformat()]

multi_start_on = next_weekday(today + timedelta(days=1), 4)  # Friday
multi_first = next_weekday(multi_start_on, 5)  # Saturday
multi_second_saturday = multi_first + timedelta(days=7)
multi_third_saturday = multi_first + timedelta(days=14)
multi_initial_dates = recurring_dates(multi_start_on, [3, 5], multi_third_saturday)
multi_trimmed_dates = recurring_dates(multi_start_on, [5], multi_second_saturday)

monthly_day_start_on = today + timedelta(days=1)
monthly_day_number = 15
monthly_day_dates_list = monthly_day_dates(monthly_day_start_on, [monthly_day_number], 3)
monthly_day_end_on = monthly_day_dates_list[-1]

monthly_nth_start_on = today + timedelta(days=1)
monthly_nth_dates_list = monthly_nth_dates(monthly_nth_start_on, 4, [2, 4], 4)  # Friday
monthly_nth_end_on = monthly_nth_dates_list[-1]

monthly_override_start_on = today + timedelta(days=1)
monthly_override_base_dates = monthly_nth_dates(monthly_override_start_on, 6, [2], 3)  # Sunday
override_exception_date = monthly_override_base_dates[1]
override_month = date.fromisoformat(override_exception_date)
override_date = nth_weekday_of_month(override_month.year, override_month.month, 6, 3).isoformat()
monthly_override_dates = [monthly_override_base_dates[0], override_date, monthly_override_base_dates[2]]
monthly_override_end_on = monthly_override_base_dates[-1]

legacy_monthly_start_on = today + timedelta(days=1)
legacy_monthly_dates = monthly_nth_dates(legacy_monthly_start_on, 6, [2], 4)
legacy_monthly_end_on = legacy_monthly_dates[-1]
legacy_trim_end_on = legacy_monthly_dates[1]
legacy_trimmed_dates = legacy_monthly_dates[:2]

payload = {
    "single_start_on": single_start_on.isoformat(),
    "single_first_occurrence": single_first.isoformat(),
    "single_second_occurrence": single_second.isoformat(),
    "single_third_occurrence": single_third.isoformat(),
    "weekly_override_date": weekly_override_date,
    "weekly_override_dates": weekly_override_dates,
    "multi_start_on": multi_start_on.isoformat(),
    "multi_first_occurrence": multi_first.isoformat(),
    "multi_initial_end_on": multi_third_saturday.isoformat(),
    "multi_initial_dates": multi_initial_dates,
    "multi_trim_end_on": multi_second_saturday.isoformat(),
    "multi_trimmed_dates": multi_trimmed_dates,
    "monthly_day_start_on": monthly_day_start_on.isoformat(),
    "monthly_day_number": monthly_day_number,
    "monthly_day_end_on": monthly_day_end_on,
    "monthly_day_dates": monthly_day_dates_list,
    "monthly_nth_start_on": monthly_nth_start_on.isoformat(),
    "monthly_nth_end_on": monthly_nth_end_on,
    "monthly_nth_dates": monthly_nth_dates_list,
    "monthly_override_start_on": monthly_override_start_on.isoformat(),
    "monthly_override_end_on": monthly_override_end_on,
    "monthly_override_base_dates": monthly_override_base_dates,
    "monthly_override_dates": monthly_override_dates,
    "override_exception_date": override_exception_date,
    "override_date": override_date,
    "legacy_monthly_start_on": legacy_monthly_start_on.isoformat(),
    "legacy_monthly_end_on": legacy_monthly_end_on,
    "legacy_monthly_dates": legacy_monthly_dates,
    "legacy_trim_end_on": legacy_trim_end_on,
    "legacy_trimmed_dates": legacy_trimmed_dates,
}
print(json.dumps(payload))
PY
)"

single_start_on="$(json_field "$date_info" single_start_on)"
single_first_occurrence="$(json_field "$date_info" single_first_occurrence)"
single_second_occurrence="$(json_field "$date_info" single_second_occurrence)"
single_third_occurrence="$(json_field "$date_info" single_third_occurrence)"
single_expected_dates_csv="${single_first_occurrence},${single_second_occurrence},${single_third_occurrence}"
weekly_override_date="$(json_field "$date_info" weekly_override_date)"
weekly_override_dates_csv="$(json_array_to_csv "$(json_field "$date_info" weekly_override_dates)")"

multi_start_on="$(json_field "$date_info" multi_start_on)"
multi_first_occurrence="$(json_field "$date_info" multi_first_occurrence)"
multi_initial_end_on="$(json_field "$date_info" multi_initial_end_on)"
multi_trim_end_on="$(json_field "$date_info" multi_trim_end_on)"
multi_initial_dates_csv="$(json_array_to_csv "$(json_field "$date_info" multi_initial_dates)")"
multi_trimmed_dates_csv="$(json_array_to_csv "$(json_field "$date_info" multi_trimmed_dates)")"

monthly_day_start_on="$(json_field "$date_info" monthly_day_start_on)"
monthly_day_number="$(json_field "$date_info" monthly_day_number)"
monthly_day_end_on="$(json_field "$date_info" monthly_day_end_on)"
monthly_day_dates_csv="$(json_array_to_csv "$(json_field "$date_info" monthly_day_dates)")"

monthly_nth_start_on="$(json_field "$date_info" monthly_nth_start_on)"
monthly_nth_end_on="$(json_field "$date_info" monthly_nth_end_on)"
monthly_nth_dates_csv="$(json_array_to_csv "$(json_field "$date_info" monthly_nth_dates)")"

monthly_override_start_on="$(json_field "$date_info" monthly_override_start_on)"
monthly_override_end_on="$(json_field "$date_info" monthly_override_end_on)"
monthly_override_base_dates_csv="$(json_array_to_csv "$(json_field "$date_info" monthly_override_base_dates)")"
monthly_override_dates_csv="$(json_array_to_csv "$(json_field "$date_info" monthly_override_dates)")"
override_exception_date="$(json_field "$date_info" override_exception_date)"
override_date="$(json_field "$date_info" override_date)"

legacy_monthly_start_on="$(json_field "$date_info" legacy_monthly_start_on)"
legacy_monthly_end_on="$(json_field "$date_info" legacy_monthly_end_on)"
legacy_monthly_dates_csv="$(json_array_to_csv "$(json_field "$date_info" legacy_monthly_dates)")"
legacy_trim_end_on="$(json_field "$date_info" legacy_trim_end_on)"
legacy_trimmed_dates_csv="$(json_array_to_csv "$(json_field "$date_info" legacy_trimmed_dates)")"

single_series_payload="$(python3 - "$single_start_on" "$single_third_occurrence" "$(date +%s)" <<'PY'
import json
import sys

start_on, end_on, stamp = sys.argv[1:4]
print(json.dumps({
    "artist_name": f"Verify Recurring Single {stamp}",
    "event_date": start_on,
    "event_time": "20:00:00",
    "door_time": f"{start_on} 18:00:00",
    "timezone": "America/New_York",
    "status": "draft",
    "visibility": "private",
    "ticket_type": "general_admission",
    "series_schedule_label": "Thursdays · 8:00 PM",
    "series_summary": "Recurring API verification",
    "series_footer_note": "Generated by dev verification",
    "ticket_price": 17.50,
    "door_price": 22.00,
    "is_series_master": 1,
    "recurrence": {
        "enabled": 1,
        "byweekday": "TH",
        "starts_on": start_on,
        "ends_on": end_on,
    },
}))
PY
)"

single_series_response="$(post_json "POST" "/events" "$single_series_payload")"
single_weekday_event_id="$(json_field "$single_series_response" id)"
log_success "[recurring-api] created single-weekday recurring series master ${single_weekday_event_id}"

single_recurrence_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${single_weekday_event_id}/recurrence")"

if [ "$(json_field "$single_recurrence_response" 'recurrence.byweekday')" != "TH" ] \
  || [ "$(json_field "$single_recurrence_response" 'recurrence.starts_on')" != "$single_start_on" ] \
  || [ "$(json_field "$single_recurrence_response" 'recurrence.ends_on')" != "$single_third_occurrence" ] \
  || [ "$(json_length "$single_recurrence_response" 'recurrence.byweekday_set')" != "1" ] \
  || [ "$(json_field "$single_recurrence_response" 'recurrence.byweekday_set.0')" != "TH" ]; then
  log_error "single-weekday recurrence rule did not round-trip through API."
  exit 1
fi

single_preview_payload="$(python3 - "$single_start_on" "$single_third_occurrence" <<'PY'
import json
import sys

start_on, end_on = sys.argv[1:3]
print(json.dumps({
    "recurrence": {
        "enabled": 1,
        "frequency": "weekly",
        "byweekday": "TH",
        "starts_on": start_on,
        "ends_on": end_on,
    },
}))
PY
)"

single_preview_response="$(post_json "POST" "/recurrence/preview" "$single_preview_payload")"
assert_json_array_equals "$(json_field "$single_preview_response" 'occurrence_candidates')" "$single_expected_dates_csv"
log_success "[recurring-api] weekly recurrence preview exposes selector-ready occurrence choices"

single_child_dates="$(fetch_child_dates "$single_weekday_event_id")"
assert_json_array_equals "$single_child_dates" "$single_expected_dates_csv"
log_success "[recurring-api] existing single-weekday recurrence still generates expected dates"

single_master_response="$(fetch_event_response "$single_weekday_event_id")"
if [ "$(json_field "$single_master_response" 'event.event_date')" != "$single_first_occurrence" ]; then
  log_error "single-weekday series master event_date should align to the first generated occurrence."
  exit 1
fi

single_child_rows="$(fetch_child_rows "$single_weekday_event_id")"
single_first_child_id="$(json_field "$single_child_rows" '0.id')"
single_child_response="$(fetch_event_response "$single_first_child_id")"
SINGLE_CHILD_RESPONSE="$single_child_response" python3 - <<'PY'
import json
import os
from decimal import Decimal

event = json.loads(os.environ["SINGLE_CHILD_RESPONSE"])["event"]

def as_money(value):
    if value in (None, "", "null"):
        return None
    return f"{Decimal(str(value)):.2f}"

if as_money(event.get("ticket_price")) != "17.50":
    raise SystemExit("flat recurring child lost ticket_price")
if as_money(event.get("door_price")) != "22.00":
    raise SystemExit("flat recurring child lost door_price")
if as_money(event.get("min_ticket_price")) != "17.50":
    raise SystemExit("flat recurring child lost min_ticket_price")
if as_money(event.get("max_ticket_price")) != "22.00":
    raise SystemExit("flat recurring child lost max_ticket_price")
if event.get("pricing_config") is not None:
    raise SystemExit("flat recurring child should not have tiered pricing_config")
PY
log_success "[recurring-api] flat pricing remains intact on generated recurring children"

single_child_publish_rows="$(fetch_child_publish_rows "$single_weekday_event_id")"
SINGLE_CHILD_PUBLISH_ROWS="$single_child_publish_rows" python3 - <<'PY'
import json
import os

rows = json.loads(os.environ["SINGLE_CHILD_PUBLISH_ROWS"])
if not rows:
    raise SystemExit("expected generated recurring children to exist")
for row in rows:
    if row.get("status") != "published":
        raise SystemExit(f"child {row.get('event_date')} was not auto-published")
    if row.get("visibility") != "public":
        raise SystemExit(f"child {row.get('event_date')} was not auto-published to public visibility")
PY
log_success "[recurring-api] generated recurring children auto-publish by default"

post_json "PUT" "/events/${single_weekday_event_id}" '{"status":"published","visibility":"public"}' >/dev/null
single_child_publish_rows="$(fetch_child_publish_rows "$single_weekday_event_id")"
SINGLE_CHILD_PUBLISH_ROWS="$single_child_publish_rows" python3 - <<'PY'
import json
import os

rows = json.loads(os.environ["SINGLE_CHILD_PUBLISH_ROWS"])
if not rows:
    raise SystemExit("expected generated recurring children to exist")
for row in rows:
    if row.get("status") != "published":
        raise SystemExit(f"child {row.get('event_date')} lost published status after master publish")
    if row.get("visibility") != "public":
        raise SystemExit(f"child {row.get('event_date')} lost public visibility after master publish")
PY
log_success "[recurring-api] publishing the series master keeps generated recurring children public"

weekly_exception_series_payload="$(python3 - "$single_start_on" "$single_third_occurrence" "$single_second_occurrence" "$weekly_override_date" "$(date +%s)" <<'PY'
import json
import sys

start_on, end_on, exception_date, override_date, stamp = sys.argv[1:6]
print(json.dumps({
    "artist_name": f"Verify Recurring Weekly Exception {stamp}",
    "event_date": start_on,
    "event_time": "20:00:00",
    "door_time": f"{start_on} 18:00:00",
    "timezone": "America/New_York",
    "status": "draft",
    "visibility": "private",
    "ticket_type": "general_admission",
    "series_schedule_label": "Thursdays with one moved date",
    "series_summary": "Weekly recurring exception verification",
    "series_footer_note": "Generated by dev verification",
    "is_series_master": 1,
    "recurrence": {
        "enabled": 1,
        "frequency": "weekly",
        "byweekday": "TH",
        "starts_on": start_on,
        "ends_on": end_on,
        "exceptions": [
            {
                "exception_date": exception_date,
                "override_date": override_date,
                "notes": "Move one Thursday to Friday",
            }
        ],
    },
}))
PY
)"

weekly_exception_series_response="$(post_json "POST" "/events" "$weekly_exception_series_payload")"
weekly_exception_event_id="$(json_field "$weekly_exception_series_response" id)"
log_success "[recurring-api] created weekly recurring series with one exception ${weekly_exception_event_id}"

weekly_exception_recurrence_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${weekly_exception_event_id}/recurrence")"

if [ "$(json_length "$weekly_exception_recurrence_response" 'exceptions')" != "1" ] \
  || [ "$(json_field "$weekly_exception_recurrence_response" 'exceptions.0.exception_date')" != "$single_second_occurrence" ] \
  || [ "$(json_field "$weekly_exception_recurrence_response" 'exceptions.0.override_date')" != "$weekly_override_date" ]; then
  log_error "weekly recurring exception did not round-trip through API."
  exit 1
fi

weekly_exception_child_dates="$(fetch_child_dates "$weekly_exception_event_id")"
assert_json_array_equals "$weekly_exception_child_dates" "$weekly_override_dates_csv"
log_success "[recurring-api] weekly recurring exceptions move one generated occurrence without breaking the base series"

multi_series_payload="$(python3 - "$multi_start_on" "$multi_initial_end_on" "$(date +%s)" <<'PY'
import json
import sys

start_on, end_on, stamp = sys.argv[1:4]
print(json.dumps({
    "artist_name": f"Verify Recurring Multi {stamp}",
    "event_date": start_on,
    "event_time": "19:30:00",
    "door_time": f"{start_on} 18:00:00",
    "timezone": "America/New_York",
    "status": "draft",
    "visibility": "private",
    "ticket_type": "general_admission",
    "series_schedule_label": "Thursday + Saturday · 7:30 PM",
    "series_summary": "Multi-weekday recurring API verification",
    "series_footer_note": "Generated by dev verification",
    "pricing_config": {
        "mode": "tiered",
        "tiers": [
            {"id": "vip", "label": "VIP", "price": 55.00, "color": "#F59E0B"},
            {"id": "main", "label": "Main", "price": 45.00, "color": "#06B6D4"},
            {"id": "back", "label": "Back", "price": 35.00, "color": "#10B981"},
        ],
        "assignments": {},
    },
    "is_series_master": 1,
    "recurrence": {
        "enabled": 1,
        "byweekday": ["SA", "TH", "TH"],
        "starts_on": start_on,
        "ends_on": end_on,
    },
}))
PY
)"

multi_series_response="$(post_json "POST" "/events" "$multi_series_payload")"
multi_weekday_event_id="$(json_field "$multi_series_response" id)"
log_success "[recurring-api] created multi-weekday recurring series master ${multi_weekday_event_id}"

multi_recurrence_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${multi_weekday_event_id}/recurrence")"

if [ "$(json_field "$multi_recurrence_response" 'recurrence.byweekday')" != "TH,SA" ] \
  || [ "$(json_field "$multi_recurrence_response" 'recurrence.starts_on')" != "$multi_start_on" ] \
  || [ "$(json_field "$multi_recurrence_response" 'recurrence.ends_on')" != "$multi_initial_end_on" ] \
  || [ "$(json_length "$multi_recurrence_response" 'recurrence.byweekday_set')" != "2" ] \
  || [ "$(json_field "$multi_recurrence_response" 'recurrence.byweekday_set.0')" != "TH" ] \
  || [ "$(json_field "$multi_recurrence_response" 'recurrence.byweekday_set.1')" != "SA" ]; then
  log_error "multi-weekday recurrence rule did not round-trip through API."
  exit 1
fi

multi_child_dates="$(fetch_child_dates "$multi_weekday_event_id")"
assert_json_array_equals "$multi_child_dates" "$multi_initial_dates_csv"
log_success "[recurring-api] multi-weekday recurrence generates sorted, deduplicated future dates"

multi_master_response="$(fetch_event_response "$multi_weekday_event_id")"
if [ "$(json_field "$multi_master_response" 'event.event_date')" != "$multi_first_occurrence" ]; then
  log_error "multi-weekday series master event_date should align to the next valid selected weekday."
  exit 1
fi

multi_child_rows="$(fetch_child_rows "$multi_weekday_event_id")"
multi_first_child_id="$(json_field "$multi_child_rows" '0.id')"
multi_child_response="$(fetch_event_response "$multi_first_child_id")"
MULTI_CHILD_RESPONSE="$multi_child_response" python3 - <<'PY'
import json
import os
from decimal import Decimal

event = json.loads(os.environ["MULTI_CHILD_RESPONSE"])["event"]
pricing = event.get("pricing_config") or {}

def as_money(value):
    if value in (None, "", "null"):
        return None
    return f"{Decimal(str(value)):.2f}"

if pricing.get("mode") != "tiered":
    raise SystemExit("tiered recurring child lost pricing_config.mode")
tiers = pricing.get("tiers") or []
if len(tiers) != 3:
    raise SystemExit("tiered recurring child lost pricing tiers")
if as_money(event.get("min_ticket_price")) != "35.00":
    raise SystemExit("tiered recurring child lost min_ticket_price")
if as_money(event.get("max_ticket_price")) != "55.00":
    raise SystemExit("tiered recurring child lost max_ticket_price")
PY
log_success "[recurring-api] tiered pricing remains intact on generated recurring children"

multi_update_payload="$(python3 - "$multi_start_on" "$multi_trim_end_on" <<'PY'
import json
import sys

start_on, end_on = sys.argv[1:3]
print(json.dumps({
    "event_date": start_on,
    "event_time": "19:30:00",
    "door_time": f"{start_on} 18:00:00",
    "is_series_master": 1,
    "recurrence": {
        "enabled": 1,
        "byweekday": ["SA"],
        "starts_on": start_on,
        "ends_on": end_on,
    },
}))
PY
)"

post_json "PUT" "/events/${multi_weekday_event_id}" "$multi_update_payload" >/dev/null
multi_updated_child_dates="$(fetch_child_dates "$multi_weekday_event_id")"
assert_json_array_equals "$multi_updated_child_dates" "$multi_trimmed_dates_csv"
log_success "[recurring-api] weekday changes and end-date trimming resync future generated children"

monthly_day_series_payload="$(python3 - "$monthly_day_start_on" "$monthly_day_end_on" "$monthly_day_number" "$(date +%s)" <<'PY'
import json
import sys

start_on, end_on, monthday, stamp = sys.argv[1:5]
print(json.dumps({
    "artist_name": f"Verify Recurring Monthly Day {stamp}",
    "event_date": start_on,
    "event_time": "18:30:00",
    "door_time": f"{start_on} 17:00:00",
    "timezone": "America/New_York",
    "status": "draft",
    "visibility": "private",
    "ticket_type": "general_admission",
    "ticket_price": 24.00,
    "door_price": 30.00,
    "series_schedule_label": "Monthly on day 15",
    "series_summary": "Monthly day-of-month recurring API verification",
    "series_footer_note": "Generated by dev verification",
    "is_series_master": 1,
    "recurrence": {
        "enabled": 1,
        "frequency": "monthly",
        "monthly_mode": "day_of_month",
        "bymonthday": int(monthday),
        "starts_on": start_on,
        "ends_on": end_on,
        "exceptions": [],
    },
}))
PY
)"

monthly_day_series_response="$(post_json "POST" "/events" "$monthly_day_series_payload")"
monthly_day_event_id="$(json_field "$monthly_day_series_response" id)"
log_success "[recurring-api] created monthly day-of-month recurring series master ${monthly_day_event_id}"

monthly_day_recurrence_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${monthly_day_event_id}/recurrence")"

if [ "$(json_field "$monthly_day_recurrence_response" 'recurrence.frequency')" != "monthly" ] \
  || [ "$(json_field "$monthly_day_recurrence_response" 'recurrence.monthly_mode')" != "day_of_month" ] \
  || [ "$(json_field "$monthly_day_recurrence_response" 'recurrence.bymonthday')" != "$monthly_day_number" ] \
  || [ "$(json_length "$monthly_day_recurrence_response" 'recurrence.bymonthday_set')" != "1" ] \
  || [ "$(json_field "$monthly_day_recurrence_response" 'recurrence.bymonthday_set.0')" != "$monthly_day_number" ]; then
  log_error "monthly day-of-month recurrence rule did not round-trip through API."
  exit 1
fi

monthly_day_preview_payload="$(python3 - "$monthly_day_start_on" "$monthly_day_end_on" "$monthly_day_number" <<'PY'
import json
import sys

start_on, end_on, monthday = sys.argv[1:4]
print(json.dumps({
    "recurrence": {
        "enabled": 1,
        "frequency": "monthly",
        "monthly_mode": "day_of_month",
        "bymonthday": int(monthday),
        "starts_on": start_on,
        "ends_on": end_on,
    },
}))
PY
)"

monthly_day_preview_response="$(post_json "POST" "/recurrence/preview" "$monthly_day_preview_payload")"
assert_json_array_equals "$(json_field "$monthly_day_preview_response" 'occurrence_candidates')" "$monthly_day_dates_csv"
log_success "[recurring-api] monthly recurrence preview exposes selector-ready occurrence choices"

monthly_day_child_dates="$(fetch_child_dates "$monthly_day_event_id")"
assert_json_array_equals "$monthly_day_child_dates" "$monthly_day_dates_csv"
log_success "[recurring-api] monthly day-of-month recurrence generates the expected dates"

monthly_day_child_rows="$(fetch_child_rows "$monthly_day_event_id")"
monthly_day_first_child_id="$(json_field "$monthly_day_child_rows" '0.id')"
monthly_day_child_response="$(fetch_event_response "$monthly_day_first_child_id")"
MONTHLY_DAY_CHILD_RESPONSE="$monthly_day_child_response" python3 - <<'PY'
import json
import os
from decimal import Decimal

event = json.loads(os.environ["MONTHLY_DAY_CHILD_RESPONSE"])["event"]

def as_money(value):
    if value in (None, "", "null"):
        return None
    return f"{Decimal(str(value)):.2f}"

if as_money(event.get("ticket_price")) != "24.00":
    raise SystemExit("monthly recurring child lost ticket_price")
if as_money(event.get("door_price")) != "30.00":
    raise SystemExit("monthly recurring child lost door_price")
if as_money(event.get("min_ticket_price")) != "24.00":
    raise SystemExit("monthly recurring child lost min_ticket_price")
if as_money(event.get("max_ticket_price")) != "30.00":
    raise SystemExit("monthly recurring child lost max_ticket_price")
PY
log_success "[recurring-api] monthly generated children retain configured flat pricing"

monthly_nth_series_payload="$(python3 - "$monthly_nth_start_on" "$monthly_nth_end_on" "$(date +%s)" <<'PY'
import json
import sys

start_on, end_on, stamp = sys.argv[1:4]
print(json.dumps({
    "artist_name": f"Verify Recurring Monthly Nth {stamp}",
    "event_date": start_on,
    "event_time": "19:00:00",
    "door_time": f"{start_on} 17:30:00",
    "timezone": "America/New_York",
    "status": "draft",
    "visibility": "private",
    "ticket_type": "general_admission",
    "series_schedule_label": "2nd & 4th Fridays",
    "series_summary": "Monthly nth-weekday recurring API verification",
    "series_footer_note": "Generated by dev verification",
    "is_series_master": 1,
    "recurrence": {
        "enabled": 1,
        "frequency": "monthly",
        "monthly_mode": "nth_weekday",
        "byweekday": "FR",
        "bysetpos": [2, 4],
        "starts_on": start_on,
        "ends_on": end_on,
        "exceptions": [],
    },
}))
PY
)"

monthly_nth_series_response="$(post_json "POST" "/events" "$monthly_nth_series_payload")"
monthly_nth_event_id="$(json_field "$monthly_nth_series_response" id)"
log_success "[recurring-api] created monthly nth-weekday recurring series master ${monthly_nth_event_id}"

monthly_nth_recurrence_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${monthly_nth_event_id}/recurrence")"

if [ "$(json_field "$monthly_nth_recurrence_response" 'recurrence.frequency')" != "monthly" ] \
  || [ "$(json_field "$monthly_nth_recurrence_response" 'recurrence.monthly_mode')" != "nth_weekday" ] \
  || [ "$(json_field "$monthly_nth_recurrence_response" 'recurrence.byweekday')" != "FR" ] \
  || [ "$(json_field "$monthly_nth_recurrence_response" 'recurrence.bysetpos')" != "2,4" ] \
  || [ "$(json_length "$monthly_nth_recurrence_response" 'recurrence.bysetpos_set')" != "2" ] \
  || [ "$(json_field "$monthly_nth_recurrence_response" 'recurrence.bysetpos_set.0')" != "2" ] \
  || [ "$(json_field "$monthly_nth_recurrence_response" 'recurrence.bysetpos_set.1')" != "4" ]; then
  log_error "monthly nth-weekday recurrence rule did not round-trip through API."
  exit 1
fi

monthly_nth_child_dates="$(fetch_child_dates "$monthly_nth_event_id")"
assert_json_array_equals "$monthly_nth_child_dates" "$monthly_nth_dates_csv"
log_success "[recurring-api] monthly nth-weekday recurrence supports multiple monthly positions"

monthly_override_series_payload="$(python3 - "$monthly_override_start_on" "$monthly_override_end_on" "$override_exception_date" "$override_date" "$(date +%s)" <<'PY'
import json
import sys

start_on, end_on, exception_date, override_date, stamp = sys.argv[1:6]
print(json.dumps({
    "artist_name": f"Verify Recurring Monthly Override {stamp}",
    "event_date": start_on,
    "event_time": "13:00:00",
    "door_time": f"{start_on} 11:30:00",
    "timezone": "America/New_York",
    "status": "draft",
    "visibility": "private",
    "ticket_type": "general_admission",
    "series_schedule_label": "2nd Sunday monthly",
    "series_summary": "Monthly override recurring API verification",
    "series_footer_note": "Generated by dev verification",
    "is_series_master": 1,
    "recurrence": {
        "enabled": 1,
        "frequency": "monthly",
        "monthly_mode": "nth_weekday",
        "byweekday": "SU",
        "bysetpos": [2],
        "starts_on": start_on,
        "ends_on": end_on,
        "exceptions": [
            {
                "exception_date": exception_date,
                "override_date": override_date,
                "notes": "Shift one month to the third Sunday",
            }
        ],
    },
}))
PY
)"

monthly_override_series_response="$(post_json "POST" "/events" "$monthly_override_series_payload")"
monthly_override_event_id="$(json_field "$monthly_override_series_response" id)"
log_success "[recurring-api] created monthly recurring series with one override exception ${monthly_override_event_id}"

monthly_override_recurrence_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${monthly_override_event_id}/recurrence")"

if [ "$(json_length "$monthly_override_recurrence_response" 'exceptions')" != "1" ] \
  || [ "$(json_field "$monthly_override_recurrence_response" 'exceptions.0.exception_date')" != "$override_exception_date" ] \
  || [ "$(json_field "$monthly_override_recurrence_response" 'exceptions.0.override_date')" != "$override_date" ]; then
  log_error "monthly override exception did not round-trip through recurrence API."
  exit 1
fi

monthly_override_preview_payload="$(python3 - "$monthly_override_start_on" "$monthly_override_end_on" "$override_exception_date" "$override_date" <<'PY'
import json
import sys

start_on, end_on, exception_date, override_date = sys.argv[1:5]
print(json.dumps({
    "recurrence": {
        "enabled": 1,
        "frequency": "monthly",
        "monthly_mode": "nth_weekday",
        "byweekday": "SU",
        "bysetpos": [2],
        "starts_on": start_on,
        "ends_on": end_on,
        "exceptions": [
            {
                "exception_date": exception_date,
                "override_date": override_date,
            }
        ],
    },
}))
PY
)"

monthly_override_preview_response="$(post_json "POST" "/recurrence/preview" "$monthly_override_preview_payload")"
assert_json_array_equals "$(json_field "$monthly_override_preview_response" 'occurrence_candidates')" "$monthly_override_base_dates_csv"
log_success "[recurring-api] recurrence preview keeps original occurrence choices available when exceptions already exist"

monthly_override_child_dates="$(fetch_child_dates "$monthly_override_event_id")"
assert_json_array_equals "$monthly_override_child_dates" "$monthly_override_dates_csv"
log_success "[recurring-api] monthly override exceptions replace the base occurrence date"

monthly_override_clear_payload="$(python3 - "$monthly_override_start_on" "$monthly_override_end_on" <<'PY'
import json
import sys

start_on, end_on = sys.argv[1:3]
print(json.dumps({
    "event_date": start_on,
    "event_time": "13:00:00",
    "door_time": f"{start_on} 11:30:00",
    "is_series_master": 1,
    "recurrence": {
        "enabled": 1,
        "frequency": "monthly",
        "monthly_mode": "nth_weekday",
        "byweekday": "SU",
        "bysetpos": [2],
        "starts_on": start_on,
        "ends_on": end_on,
        "exceptions": [],
    },
}))
PY
)"

post_json "PUT" "/events/${monthly_override_event_id}" "$monthly_override_clear_payload" >/dev/null
monthly_override_cleared_dates="$(fetch_child_dates "$monthly_override_event_id")"
assert_json_array_equals "$monthly_override_cleared_dates" "$monthly_override_base_dates_csv"
log_success "[recurring-api] clearing monthly overrides resyncs future occurrences back to the base monthly rule"

legacy_monthly_series_payload="$(python3 - "$legacy_monthly_start_on" "$legacy_monthly_end_on" "$(date +%s)" <<'PY'
import json
import sys

start_on, end_on, stamp = sys.argv[1:4]
print(json.dumps({
    "artist_name": f"Verify Recurring Legacy Monthly {stamp}",
    "event_date": start_on,
    "event_time": "14:00:00",
    "door_time": f"{start_on} 12:30:00",
    "timezone": "America/New_York",
    "status": "draft",
    "visibility": "private",
    "ticket_type": "general_admission",
    "series_schedule_label": "Legacy monthly compatibility",
    "series_summary": "Legacy monthly recurring compatibility verification",
    "series_footer_note": "Generated by dev verification",
    "is_series_master": 1,
    "recurrence": {
        "enabled": 1,
        "frequency": "monthly",
        "monthly_mode": "nth_weekday",
        "byweekday": "SU",
        "bysetpos": [2],
        "starts_on": start_on,
        "ends_on": end_on,
        "exceptions": [],
    },
}))
PY
)"

legacy_monthly_series_response="$(post_json "POST" "/events" "$legacy_monthly_series_payload")"
legacy_monthly_event_id="$(json_field "$legacy_monthly_series_response" id)"
mark_children_imported "$legacy_monthly_event_id"
legacy_rule_payload="$(python3 - <<'PY'
import json
print(json.dumps({
    "notes": "Legacy monthly compatibility verify",
    "setpos": [2],
    "overrides": [],
    "raw_day_of_week": "2nd Sunday",
}, separators=(',', ':')))
PY
)"
apply_legacy_monthly_rule_shape "$legacy_monthly_event_id" "$legacy_monthly_start_on" "$legacy_monthly_end_on" "$legacy_rule_payload"

legacy_monthly_recurrence_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${legacy_monthly_event_id}/recurrence")"

if [ "$(json_field "$legacy_monthly_recurrence_response" 'recurrence.frequency')" != "monthly" ] \
  || [ "$(json_field "$legacy_monthly_recurrence_response" 'recurrence.monthly_mode')" != "nth_weekday" ] \
  || [ "$(json_field "$legacy_monthly_recurrence_response" 'recurrence.byweekday')" != "SU" ] \
  || [ "$(json_field "$legacy_monthly_recurrence_response" 'recurrence.bysetpos')" != "2" ] \
  || [ "$(json_field "$legacy_monthly_recurrence_response" 'recurrence.bysetpos_set.0')" != "2" ]; then
  log_error "legacy monthly recurrence storage did not remain compatible with the recurrence API."
  exit 1
fi

legacy_monthly_update_payload="$(python3 - "$legacy_monthly_start_on" "$legacy_trim_end_on" <<'PY'
import json
import sys

start_on, end_on = sys.argv[1:3]
print(json.dumps({
    "event_date": start_on,
    "event_time": "14:00:00",
    "door_time": f"{start_on} 12:30:00",
    "is_series_master": 1,
    "recurrence": {
        "enabled": 1,
        "frequency": "monthly",
        "monthly_mode": "nth_weekday",
        "byweekday": "SU",
        "bysetpos": [2],
        "starts_on": start_on,
        "ends_on": end_on,
        "exceptions": [],
    },
}))
PY
)"

post_json "PUT" "/events/${legacy_monthly_event_id}" "$legacy_monthly_update_payload" >/dev/null
legacy_monthly_trimmed_dates="$(fetch_child_dates "$legacy_monthly_event_id")"
assert_json_array_equals "$legacy_monthly_trimmed_dates" "$legacy_trimmed_dates_csv"
log_success "[recurring-api] legacy monthly rows with imported recurrence children remain compatible when resynced"

public_display_info="$(python3 - <<'PY'
import json
import calendar
from datetime import date, timedelta

today = date.today()
start = today + timedelta(days=1)
current = date(start.year, start.month, 1)
dates = []
seen = set()

def nth_weekday(year, month, weekday, nth):
    matches = []
    for week in calendar.monthcalendar(year, month):
        day_value = week[weekday]
        if day_value:
            matches.append(date(year, month, day_value))
    return matches[nth - 1] if len(matches) >= nth else None

while len(dates) < 3:
    for position in (2, 4):
        candidate = nth_weekday(current.year, current.month, 1, position)  # Tuesday
        if candidate is None or candidate < start or candidate in seen:
            continue
        dates.append(candidate.isoformat())
        seen.add(candidate)
        if len(dates) >= 3:
            break
    current = date(current.year + 1, 1, 1) if current.month == 12 else date(current.year, current.month + 1, 1)

print(json.dumps({
    "start_on": start.isoformat(),
    "end_on": dates[-1],
    "dates": dates,
    "tampered_date": (date.fromisoformat(dates[1]) - timedelta(days=1)).isoformat(),
}))
PY
)"

public_display_start_on="$(json_field "$public_display_info" start_on)"
public_display_end_on="$(json_field "$public_display_info" end_on)"
public_display_dates_csv="$(json_array_to_csv "$(json_field "$public_display_info" dates)")"
public_display_tampered_date="$(json_field "$public_display_info" tampered_date)"

public_display_series_payload="$(python3 - "$public_display_start_on" "$public_display_end_on" "$(date +%s)" <<'PY'
import json
import sys

start_on, end_on, stamp = sys.argv[1:4]
print(json.dumps({
    "artist_name": f"Verify Public Recurring Display {stamp}",
    "event_date": start_on,
    "event_time": "18:00:00",
    "door_time": f"{start_on} 16:30:00",
    "timezone": "America/New_York",
    "status": "published",
    "visibility": "public",
    "ticket_type": "general_admission",
    "series_schedule_label": "2nd & 4th Tuesday · 6:00 PM",
    "series_summary": "Public recurring display verification",
    "is_series_master": 1,
    "recurrence": {
        "enabled": 1,
        "frequency": "monthly",
        "monthly_mode": "nth_weekday",
        "byweekday": "TU",
        "bysetpos": [2, 4],
        "starts_on": start_on,
        "ends_on": end_on,
        "exceptions": [],
    },
}))
PY
)"

public_display_series_response="$(post_json "POST" "/events" "$public_display_series_payload")"
public_display_event_id="$(json_field "$public_display_series_response" id)"

public_display_child_rows="$(fetch_child_rows "$public_display_event_id")"
public_display_second_child_id="$(json_field "$public_display_child_rows" '1.id')"
tamper_child_occurrence_date "$public_display_second_child_id" "$public_display_tampered_date"

public_events_response="$(fetch_public_events_response)"
public_master_row="$(find_event_by_id "$public_events_response" "$public_display_event_id")"
PUBLIC_MASTER_ROW="$public_master_row" EXPECTED_DATES="$public_display_dates_csv" TAMPERED_DATE="$public_display_tampered_date" python3 - <<'PY'
import json
import os

row = json.loads(os.environ["PUBLIC_MASTER_ROW"])
expected = [value for value in os.environ["EXPECTED_DATES"].split(",") if value]
tampered = os.environ["TAMPERED_DATE"]
actual = [
    (occurrence.get("event_date") or occurrence.get("occurrence_date"))
    for occurrence in (row.get("public_recurrence_occurrences") or [])
]
if actual != expected:
    raise SystemExit(f"public recurrence preview should follow the saved rule: expected {expected}, got {actual}")
if tampered in actual:
    raise SystemExit(f"tampered child date leaked into public recurrence preview: {tampered}")
PY
log_success "[recurring-api] public recurring series preview follows admin recurrence settings even if a child row becomes stale"

single_date="$(date -u +%F)"
single_payload="$(python3 - "$single_date" "$(date +%s)" <<'PY'
import json
import sys

single_date, stamp = sys.argv[1:3]
print(json.dumps({
    "artist_name": f"Verify Single {stamp}",
    "event_date": single_date,
    "event_time": "19:00:00",
    "door_time": f"{single_date} 17:30:00",
    "timezone": "America/New_York",
    "status": "draft",
    "visibility": "private",
    "ticket_type": "general_admission",
}))
PY
)"

single_response="$(post_json "POST" "/events" "$single_payload")"
single_event_id="$(json_field "$single_response" id)"
single_event_recurrence_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${single_event_id}/recurrence")"

if [ "$(recurrence_is_null "$single_event_recurrence_response")" != "1" ]; then
  log_error "non-recurring event unexpectedly returned a recurrence rule."
  exit 1
fi

single_child_dates="$(fetch_child_dates "$single_event_id")"
assert_json_array_equals "$single_child_dates" ""
log_success "[recurring-api] non-recurring events stayed unchanged"
