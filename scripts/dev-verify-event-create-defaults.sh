#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-event-create-defaults.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"
created_event_id=""

cleanup() {
  if [ -n "$created_event_id" ]; then
    curl -fsS -X DELETE \
      -b "$ADMIN_COOKIE_JAR" \
      -H "Origin: ${ADMIN_ORIGIN}" \
      -H 'Accept: application/json' \
      "${API_BASE}/events/${created_event_id}" >/dev/null 2>&1 || true
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

admin_get_json() {
  local path="$1"
  curl -fsS \
    -b "$ADMIN_COOKIE_JAR" \
    -H "Origin: ${ADMIN_ORIGIN}" \
    -H 'Accept: application/json' \
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
    log_error "admin login failed in event-create-defaults verify script"
    exit 1
  fi
}

admin_login

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

log_step "[event-create-defaults] creating event without status/visibility"
create_payload="$(cat <<JSON
{
  "artist_name": "Defaults Verify $(date -u +%s)",
  "event_date": "$(date -u +%F)",
  "event_time": "20:00:00",
  "door_time": "$(date -u +%F) 18:00:00",
  "timezone": "America/New_York",
  "ticket_type": "reserved_seating",
  "layout_id": ${layout_id},
  "seating_enabled": true
}
JSON
)"
create_response="$(post_json "POST" "/events" "$create_payload")"
create_success="$(json_field "$create_response" success)"
if [ "$create_success" != "true" ]; then
  log_error "event create failed: $create_response"
  exit 1
fi
created_event_id="$(json_field "$create_response" id)"

log_step "[event-create-defaults] asserting non-null defaults on event fetch"
event_response="$(admin_get_json "/events/${created_event_id}")"
event_status="$(json_field "$event_response" event.status)"
event_visibility="$(json_field "$event_response" event.visibility)"
if [ "$event_status" != "draft" ]; then
  log_error "expected status=draft, got ${event_status}"
  exit 1
fi
if [ "$event_visibility" != "private" ]; then
  log_error "expected visibility=private, got ${event_visibility}"
  exit 1
fi

log_step "[event-create-defaults] asserting event appears in admin draft list"
draft_list="$(admin_get_json "/events?scope=admin&status=draft&limit=500")"
found="$(DRAFT_JSON="$draft_list" TARGET_ID="$created_event_id" python3 - <<'PY'
import json
import os

data = json.loads(os.environ.get('DRAFT_JSON', '{}'))
target = int(os.environ.get('TARGET_ID', '0'))
ids = {int(row.get('id', 0)) for row in data.get('events', []) if row.get('id') is not None}
print('1' if target in ids else '0')
PY
)"
if [ "$found" != "1" ]; then
  log_error "new event ${created_event_id} not present in admin draft list"
  exit 1
fi

log_success "[event-create-defaults] defaults and draft list behavior verified"
