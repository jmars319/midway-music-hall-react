#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-recurring-series-delete.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

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
    log_error "admin login failed in recurring-series-delete verify script"
    exit 1
  fi
}

fetch_series_state() {
  local event_id="$1"
  php -r "if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; } require \$argv[1]; \$pdo = \\Midway\\Backend\\Database::connection(); \$stmt = \$pdo->prepare('SELECT e.id, e.deleted_at, e.status, e.visibility, e.is_series_master, (SELECT COUNT(*) FROM events c WHERE c.series_master_id = e.id AND c.deleted_at IS NULL) AS active_children, (SELECT COUNT(*) FROM events c WHERE c.series_master_id = e.id AND c.deleted_at IS NOT NULL) AS deleted_children, (SELECT COUNT(*) FROM event_recurrence_rules rr WHERE rr.event_id = e.id) AS recurrence_rules FROM events e WHERE e.id = ? LIMIT 1'); \$stmt->execute([(int) \$argv[2]]); echo json_encode(\$stmt->fetch(PDO::FETCH_ASSOC));" \
    "$ROOT_DIR/backend/bootstrap.php" \
    "$event_id"
}

admin_login

stamp="$(date +%s)"
start_on="$(python3 - <<'PY'
from datetime import date, timedelta
today = date.today()
offset = (3 - today.weekday()) % 7
if offset == 0:
    offset = 7
start = today + timedelta(days=offset)
print(start.isoformat())
PY
)"
end_on="$(python3 - "$start_on" <<'PY'
from datetime import date, timedelta
import sys
start = date.fromisoformat(sys.argv[1])
print((start + timedelta(days=21)).isoformat())
PY
)"

published_series_payload="$(python3 - "$start_on" "$end_on" "$stamp" <<'PY'
import json
import sys

start_on, end_on, stamp = sys.argv[1:4]
print(json.dumps({
    "artist_name": f"Verify Recurring Delete {stamp}",
    "event_date": start_on,
    "event_time": "19:00:00",
    "door_time": f"{start_on} 17:30:00",
    "timezone": "America/New_York",
    "status": "published",
    "visibility": "public",
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

create_response="$(post_json "POST" "/events" "$published_series_payload")"
series_id="$(json_field "$create_response" id)"

state_before_delete="$(fetch_series_state "$series_id")"
active_children="$(json_field "$state_before_delete" active_children)"
if [ "$active_children" -lt 1 ]; then
  log_error "recurring delete verify did not create any generated series children."
  exit 1
fi

block_code="$(curl -sS -o "$TMP_DIR/published-delete.json" -w '%{http_code}' \
  -X DELETE \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${series_id}/series")"

if [ "$block_code" != "409" ]; then
  log_error "published recurring series delete should be blocked with 409, got ${block_code}."
  exit 1
fi

block_message="$(python3 - "$TMP_DIR/published-delete.json" <<'PY'
import json
import sys
with open(sys.argv[1], 'r', encoding='utf-8') as handle:
    data = json.load(handle)
print(data.get('message', ''))
PY
)"
if [ "$block_message" != "Unpublish this recurring series before deleting it." ]; then
  log_error "published recurring series delete returned unexpected message: ${block_message}"
  exit 1
fi

unpublish_payload='{"status":"draft","visibility":"private"}'
post_json "PUT" "/events/${series_id}" "$unpublish_payload" >/dev/null

delete_response="$(curl -fsS \
  -X DELETE \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${series_id}/series")"

if [ "$(json_field "$delete_response" deleted)" != "true" ]; then
  log_error "recurring series delete endpoint did not return success."
  exit 1
fi

state_after_delete="$(fetch_series_state "$series_id")"
if [ "$(json_field "$state_after_delete" deleted_at)" = "null" ]; then
  log_error "series master was not soft-deleted by recurring series delete."
  exit 1
fi
if [ "$(json_field "$state_after_delete" active_children)" != "0" ]; then
  log_error "recurring series delete left active child dates behind."
  exit 1
fi
if [ "$(json_field "$state_after_delete" recurrence_rules)" != "0" ]; then
  log_error "recurring series delete left the recurrence rule behind."
  exit 1
fi

log_success "[recurring-series-delete] published series delete is blocked until unpublished, then soft-deletes the series master and generated dates cleanly"
