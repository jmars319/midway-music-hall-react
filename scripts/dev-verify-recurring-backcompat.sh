#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-recurring-backcompat.XXXXXX")"
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
    log_error "admin login failed in recurring-backcompat verify script"
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

fetch_event_response() {
  local event_id="$1"
  curl -fsS \
    -b "$ADMIN_COOKIE_JAR" \
    -H "Origin: ${ADMIN_ORIGIN}" \
    -H 'Accept: application/json' \
    "${API_BASE}/events/${event_id}"
}

move_generated_child_to_date() {
  local child_id="$1"
  local target_date="$2"
  php -r '
if (!isset($_SERVER["REQUEST_METHOD"])) { $_SERVER["REQUEST_METHOD"] = "CLI"; }
require $argv[1];
$pdo = \Midway\Backend\Database::connection();
$childId = (int) $argv[2];
$targetDate = (string) $argv[3];
$stmt = $pdo->prepare("SELECT event_time, timezone, door_time, start_datetime, end_datetime FROM events WHERE id = ? LIMIT 1");
$stmt->execute([$childId]);
$row = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$row) {
    fwrite(STDERR, "child event not found\n");
    exit(2);
}
$timezone = new DateTimeZone((string) ($row["timezone"] ?? "America/New_York"));
$eventTime = trim((string) ($row["event_time"] ?? ""));
if ($eventTime === "" && !empty($row["start_datetime"])) {
    $eventTime = substr((string) $row["start_datetime"], 11, 8);
}
if ($eventTime === "") {
    $eventTime = "20:00:00";
}
try {
    $start = new DateTimeImmutable($targetDate . " " . $eventTime, $timezone);
} catch (Throwable $error) {
    fwrite(STDERR, "invalid target date\n");
    exit(3);
}
$durationSeconds = 4 * 3600;
if (!empty($row["start_datetime"]) && !empty($row["end_datetime"])) {
    try {
        $originalStart = new DateTimeImmutable((string) $row["start_datetime"], $timezone);
        $originalEnd = new DateTimeImmutable((string) $row["end_datetime"], $timezone);
        $durationSeconds = max(3600, $originalEnd->getTimestamp() - $originalStart->getTimestamp());
    } catch (Throwable $error) {
    }
}
$doorTime = null;
if (!empty($row["door_time"])) {
    $doorTimeValue = (string) $row["door_time"];
    $doorTimeOfDay = strlen($doorTimeValue) >= 19 ? substr($doorTimeValue, 11, 8) : trim($doorTimeValue);
    if ($doorTimeOfDay !== "") {
        try {
            $doorDateTime = new DateTimeImmutable($targetDate . " " . $doorTimeOfDay, $timezone);
            $doorTime = $doorDateTime->format("Y-m-d H:i:s");
        } catch (Throwable $error) {
            $doorTime = null;
        }
    }
}
$update = $pdo->prepare("UPDATE events SET event_date = ?, start_datetime = ?, end_datetime = ?, door_time = ?, change_note = ?, updated_by = ? WHERE id = ?");
$update->execute([
    $targetDate,
    $start->format("Y-m-d H:i:s"),
    $start->modify("+" . $durationSeconds . " seconds")->format("Y-m-d H:i:s"),
    $doorTime,
    "generated by recurrence|" . $targetDate,
    "dev-verify",
    $childId,
]);
' "$ROOT_DIR/backend/bootstrap.php" "$child_id" "$target_date"
}

assert_json_array_equals() {
  local actual_json="$1"
  local expected_csv="$2"
  ACTUAL_JSON="$actual_json" EXPECTED_CSV="$expected_csv" python3 - <<'PY'
import json
import os

actual = json.loads(os.environ["ACTUAL_JSON"])
expected = [item for item in os.environ["EXPECTED_CSV"].split(",") if item]
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

legacy_onday_event_id=""
legacy_offset_event_id=""
contrast_multi_event_id=""

cleanup() {
  local event_id
  for event_id in "$legacy_onday_event_id" "$legacy_offset_event_id" "$contrast_multi_event_id"; do
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

admin_login

date_info="$(python3 - <<'PY'
import json
from datetime import date, timedelta

today = date.today()

def next_weekday(start, weekday):
    return start + timedelta(days=(weekday - start.weekday()) % 7)

def previous_weekday(before, weekday):
    delta = (before.weekday() - weekday) % 7
    delta = delta or 7
    return before - timedelta(days=delta)

def recurring_dates(start, weekdays, end):
    current = start
    weekday_set = set(weekdays)
    out = []
    while current <= end:
        if current.weekday() in weekday_set:
            out.append(current.isoformat())
        current += timedelta(days=1)
    return out

legacy_on_start = next_weekday(today + timedelta(days=1), 3)  # Thursday, Monday=0
legacy_on_second = legacy_on_start + timedelta(days=7)
legacy_on_third = legacy_on_start + timedelta(days=14)
legacy_preserved_past = previous_weekday(today, 3)

legacy_offset_start = next_weekday(today + timedelta(days=1), 4)  # Friday
legacy_offset_first = next_weekday(legacy_offset_start, 3)
legacy_offset_second = legacy_offset_first + timedelta(days=7)

contrast_multi_start = legacy_offset_start
contrast_multi_end = next_weekday(contrast_multi_start, 5) + timedelta(days=7)  # second Saturday
contrast_multi_dates = recurring_dates(contrast_multi_start, [3, 5], contrast_multi_end)

payload = {
    "legacy_on_start": legacy_on_start.isoformat(),
    "legacy_on_second": legacy_on_second.isoformat(),
    "legacy_on_third": legacy_on_third.isoformat(),
    "legacy_preserved_past": legacy_preserved_past.isoformat(),
    "legacy_offset_start": legacy_offset_start.isoformat(),
    "legacy_offset_first": legacy_offset_first.isoformat(),
    "legacy_offset_second": legacy_offset_second.isoformat(),
    "contrast_multi_start": contrast_multi_start.isoformat(),
    "contrast_multi_end": contrast_multi_end.isoformat(),
    "contrast_multi_dates": contrast_multi_dates,
}
print(json.dumps(payload))
PY
)"

legacy_on_start="$(json_field "$date_info" legacy_on_start)"
legacy_on_second="$(json_field "$date_info" legacy_on_second)"
legacy_on_third="$(json_field "$date_info" legacy_on_third)"
legacy_preserved_past="$(json_field "$date_info" legacy_preserved_past)"
legacy_on_initial_dates_csv="${legacy_on_start},${legacy_on_second},${legacy_on_third}"
legacy_on_resynced_dates_csv="${legacy_preserved_past},${legacy_on_second}"

legacy_offset_start="$(json_field "$date_info" legacy_offset_start)"
legacy_offset_first="$(json_field "$date_info" legacy_offset_first)"
legacy_offset_second="$(json_field "$date_info" legacy_offset_second)"
legacy_offset_dates_csv="${legacy_offset_first},${legacy_offset_second}"

contrast_multi_start="$(json_field "$date_info" contrast_multi_start)"
contrast_multi_end="$(json_field "$date_info" contrast_multi_end)"
contrast_multi_dates_csv="$(json_array_to_csv "$(json_field "$date_info" contrast_multi_dates)")"

legacy_onday_payload="$(python3 - "$legacy_on_start" "$legacy_on_third" "$(date +%s)" <<'PY'
import json
import sys

start_on, end_on, stamp = sys.argv[1:4]
print(json.dumps({
    "artist_name": f"Verify Recurring Backcompat Legacy On-Day {stamp}",
    "event_date": start_on,
    "event_time": "20:00:00",
    "door_time": f"{start_on} 18:00:00",
    "timezone": "America/New_York",
    "status": "draft",
    "visibility": "private",
    "ticket_type": "general_admission",
    "ticket_price": 18.50,
    "door_price": 24.00,
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

legacy_onday_response="$(post_json "POST" "/events" "$legacy_onday_payload")"
legacy_onday_event_id="$(json_field "$legacy_onday_response" id)"
log_success "[recurring-backcompat] created legacy single-weekday series ${legacy_onday_event_id}"

legacy_on_rule_response="$(fetch_event_response "$legacy_onday_event_id")"
if [ "$(json_field "$legacy_on_rule_response" 'event.event_date')" != "$legacy_on_start" ]; then
  log_error "legacy single-weekday series failed to anchor when start date already matched the weekday."
  exit 1
fi

legacy_on_recurrence_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${legacy_onday_event_id}/recurrence")"

if [ "$(json_field "$legacy_on_recurrence_response" 'recurrence.byweekday')" != "TH" ] \
  || [ "$(json_length "$legacy_on_recurrence_response" 'recurrence.byweekday_set')" != "1" ] \
  || [ "$(json_field "$legacy_on_recurrence_response" 'recurrence.byweekday_set.0')" != "TH" ]; then
  log_error "legacy single-token byweekday did not round-trip cleanly."
  exit 1
fi

legacy_on_child_dates="$(fetch_child_dates "$legacy_onday_event_id")"
assert_json_array_equals "$legacy_on_child_dates" "$legacy_on_initial_dates_csv"
log_success "[recurring-backcompat] legacy single-token weekday still generates the expected weekday-only dates"

legacy_on_child_rows="$(fetch_child_rows "$legacy_onday_event_id")"
legacy_on_first_child_id="$(json_field "$legacy_on_child_rows" '0.id')"
legacy_on_first_child_response="$(fetch_event_response "$legacy_on_first_child_id")"
LEGACY_ON_CHILD_RESPONSE="$legacy_on_first_child_response" python3 - <<'PY'
import json
import os
from decimal import Decimal

event = json.loads(os.environ["LEGACY_ON_CHILD_RESPONSE"])["event"]

def as_money(value):
    if value in (None, "", "null"):
        return None
    return f"{Decimal(str(value)):.2f}"

if as_money(event.get("ticket_price")) != "18.50":
    raise SystemExit("legacy priced recurring child lost ticket_price")
if as_money(event.get("door_price")) != "24.00":
    raise SystemExit("legacy priced recurring child lost door_price")
if as_money(event.get("min_ticket_price")) != "18.50":
    raise SystemExit("legacy priced recurring child lost min_ticket_price")
if as_money(event.get("max_ticket_price")) != "24.00":
    raise SystemExit("legacy priced recurring child lost max_ticket_price")
if event.get("pricing_config") is not None:
    raise SystemExit("legacy flat-priced recurring child unexpectedly has pricing_config")
PY
log_success "[recurring-backcompat] pricing survives legacy single-weekday child generation"

move_generated_child_to_date "$legacy_on_first_child_id" "$legacy_preserved_past"

legacy_onday_update_payload="$(python3 - "$legacy_on_second" <<'PY'
import json
import sys

start_on = sys.argv[1]
print(json.dumps({
    "event_date": start_on,
    "event_time": "20:00:00",
    "door_time": f"{start_on} 18:00:00",
    "is_series_master": 1,
    "recurrence": {
        "enabled": 1,
        "byweekday": "TH",
        "starts_on": start_on,
        "ends_on": start_on,
    },
}))
PY
)"

post_json "PUT" "/events/${legacy_onday_event_id}" "$legacy_onday_update_payload" >/dev/null
legacy_on_updated_recurrence_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${legacy_onday_event_id}/recurrence")"

if [ "$(json_field "$legacy_on_updated_recurrence_response" 'recurrence.byweekday')" != "TH" ]; then
  log_error "legacy single-token byweekday became malformed after resync."
  exit 1
fi

legacy_on_resynced_dates="$(fetch_child_dates "$legacy_onday_event_id")"
assert_json_array_equals "$legacy_on_resynced_dates" "$legacy_on_resynced_dates_csv"
log_success "[recurring-backcompat] legacy single-weekday resync still trims future children without clobbering preserved past history"

legacy_disable_payload="$(python3 - "$legacy_on_second" <<'PY'
import json
import sys

event_date = sys.argv[1]
print(json.dumps({
    "event_date": event_date,
    "event_time": "20:00:00",
    "door_time": f"{event_date} 18:00:00",
    "is_series_master": 1,
    "recurrence": {
        "enabled": 0,
    },
}))
PY
)"

post_json "PUT" "/events/${legacy_onday_event_id}" "$legacy_disable_payload" >/dev/null
legacy_disabled_recurrence_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${legacy_onday_event_id}/recurrence")"

if [ "$(recurrence_is_null "$legacy_disabled_recurrence_response")" != "1" ]; then
  log_error "legacy recurrence disable did not remove the recurrence rule."
  exit 1
fi

legacy_on_disabled_dates="$(fetch_child_dates "$legacy_onday_event_id")"
assert_json_array_equals "$legacy_on_disabled_dates" "$legacy_preserved_past"
log_success "[recurring-backcompat] disabling legacy recurrence archives future generated children while preserving past generated history"

legacy_offset_payload="$(python3 - "$legacy_offset_start" "$legacy_offset_second" "$(date +%s)" <<'PY'
import json
import sys

start_on, end_on, stamp = sys.argv[1:4]
print(json.dumps({
    "artist_name": f"Verify Recurring Backcompat Legacy Offset {stamp}",
    "event_date": start_on,
    "event_time": "19:00:00",
    "door_time": f"{start_on} 17:00:00",
    "timezone": "America/New_York",
    "status": "draft",
    "visibility": "private",
    "ticket_type": "general_admission",
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

legacy_offset_response="$(post_json "POST" "/events" "$legacy_offset_payload")"
legacy_offset_event_id="$(json_field "$legacy_offset_response" id)"

legacy_offset_master_response="$(fetch_event_response "$legacy_offset_event_id")"
if [ "$(json_field "$legacy_offset_master_response" 'event.event_date')" != "$legacy_offset_first" ]; then
  log_error "legacy single-weekday series failed to anchor to the next matching weekday."
  exit 1
fi

legacy_offset_child_dates="$(fetch_child_dates "$legacy_offset_event_id")"
assert_json_array_equals "$legacy_offset_child_dates" "$legacy_offset_dates_csv"
log_success "[recurring-backcompat] legacy single-weekday rules still anchor to the next valid weekday when start date is off-day"

contrast_multi_payload="$(python3 - "$contrast_multi_start" "$contrast_multi_end" "$(date +%s)" <<'PY'
import json
import sys

start_on, end_on, stamp = sys.argv[1:4]
print(json.dumps({
    "artist_name": f"Verify Recurring Backcompat Contrast Multi {stamp}",
    "event_date": start_on,
    "event_time": "21:00:00",
    "door_time": f"{start_on} 19:00:00",
    "timezone": "America/New_York",
    "status": "draft",
    "visibility": "private",
    "ticket_type": "general_admission",
    "is_series_master": 1,
    "recurrence": {
        "enabled": 1,
        "byweekday": "TH,SA",
        "starts_on": start_on,
        "ends_on": end_on,
    },
}))
PY
)"

contrast_multi_response="$(post_json "POST" "/events" "$contrast_multi_payload")"
contrast_multi_event_id="$(json_field "$contrast_multi_response" id)"

contrast_multi_recurrence_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${contrast_multi_event_id}/recurrence")"

if [ "$(json_field "$contrast_multi_recurrence_response" 'recurrence.byweekday')" != "TH,SA" ] \
  || [ "$(json_length "$contrast_multi_recurrence_response" 'recurrence.byweekday_set')" != "2" ] \
  || [ "$(json_field "$contrast_multi_recurrence_response" 'recurrence.byweekday_set.0')" != "TH" ] \
  || [ "$(json_field "$contrast_multi_recurrence_response" 'recurrence.byweekday_set.1')" != "SA" ]; then
  log_error "multi-weekday contrast rule did not round-trip cleanly."
  exit 1
fi

contrast_multi_child_dates="$(fetch_child_dates "$contrast_multi_event_id")"
assert_json_array_equals "$contrast_multi_child_dates" "$contrast_multi_dates_csv"
log_success "[recurring-backcompat] multi-weekday contrast case works without breaking legacy single-token input"

curl -fsS -X DELETE \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${contrast_multi_event_id}/recurrence" >/dev/null

contrast_multi_deleted_recurrence_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${contrast_multi_event_id}/recurrence")"

if [ "$(recurrence_is_null "$contrast_multi_deleted_recurrence_response")" != "1" ]; then
  log_error "recurrence delete endpoint did not remove the contrast recurrence rule."
  exit 1
fi

contrast_multi_deleted_dates="$(fetch_child_dates "$contrast_multi_event_id")"
assert_json_array_equals "$contrast_multi_deleted_dates" ""
log_success "[recurring-backcompat] deleting recurrence also archives future generated children cleanly"
