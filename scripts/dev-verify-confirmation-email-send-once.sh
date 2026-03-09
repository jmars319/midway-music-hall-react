#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-confirm-email-once.XXXXXX")"
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
    log_error "admin login failed in confirm-email-once verify script"
    exit 1
  fi
}

admin_login

log_step "[confirm-email-once] checking seat_requests confirmation email columns"
column_check="$(php -r "
if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; }
require '$ROOT_DIR/backend/bootstrap.php';
\$pdo = \\Midway\\Backend\\Database::connection();
\$stmt = \$pdo->prepare('SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name IN (?, ?)');
\$stmt->execute(['seat_requests', 'confirmation_email_sent_at', 'confirmation_email_message_id']);
echo (int) \$stmt->fetchColumn();
")"
if [ "$column_check" -lt 1 ]; then
  log_error "seat_requests.confirmation_email_sent_at is missing; run database/20251212_schema_upgrade.sql first"
  exit 1
fi

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

future_event_date="$(date -u -v+1d +%F 2>/dev/null || date -u -d '+1 day' +%F)"

create_event_payload="$(cat <<JSON
{
  "artist_name": "Confirm Email Verify $(date -u +%s)",
  "event_date": "${future_event_date}",
  "event_time": "20:00:00",
  "door_time": "${future_event_date} 18:00:00",
  "timezone": "America/New_York",
  "status": "published",
  "visibility": "public",
  "ticket_type": "reserved_seating",
  "layout_id": ${layout_id},
  "seating_enabled": true
}
JSON
)"
create_event_response="$(admin_post_json "POST" "/events" "$create_event_payload")"
create_event_success="$(json_field "$create_event_response" success)"
if [ "$create_event_success" != "true" ]; then
  log_error "failed to create test event: $create_event_response"
  exit 1
fi
created_event_id="$(json_field "$create_event_response" id)"
if [ "$created_event_id" = "null" ] || [ -z "$created_event_id" ]; then
  log_error "failed to create test event: $create_event_response"
  exit 1
fi

request_response="$(post_json "POST" "/seat-requests" "$(cat <<JSON
{
  "event_id": ${created_event_id},
  "customer_name": "Confirm Email Verify",
  "contact": {
    "email": "confirm-email-verify@example.com",
    "phone": "555-555-2222"
  },
  "selected_seats": ["Confirm-${created_event_id}-1"],
  "special_requests": ""
}
JSON
)")"
request_success="$(json_field "$request_response" success)"
if [ "$request_success" != "true" ]; then
  log_error "seat request creation failed: $request_response"
  exit 1
fi
request_id="$(json_field "$request_response" seat_request.id)"

log_step "[confirm-email-once] approving seat request first time"
first_approve_response="$(admin_post_json "POST" "/seat-requests/${request_id}/approve" "{}")"
first_success="$(json_field "$first_approve_response" success)"
if [ "$first_success" != "true" ]; then
  log_error "first approve failed: $first_approve_response"
  exit 1
fi

first_sent_at="$(php -r "
if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; }
require '$ROOT_DIR/backend/bootstrap.php';
\$pdo = \\Midway\\Backend\\Database::connection();
\$stmt = \$pdo->prepare('SELECT confirmation_email_sent_at FROM seat_requests WHERE id = ? LIMIT 1');
\$stmt->execute([(int) \$argv[1]]);
\$value = \$stmt->fetchColumn();
echo \$value ?: '';
" "$request_id")"
if [ -z "$first_sent_at" ]; then
  log_error "confirmation_email_sent_at was not set on first confirm"
  exit 1
fi

log_step "[confirm-email-once] approving seat request second time"
second_approve_response="$(admin_post_json "POST" "/seat-requests/${request_id}/approve" "{}")"
second_success="$(json_field "$second_approve_response" success)"
if [ "$second_success" != "true" ]; then
  log_error "second approve failed: $second_approve_response"
  exit 1
fi

second_sent_at="$(php -r "
if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; }
require '$ROOT_DIR/backend/bootstrap.php';
\$pdo = \\Midway\\Backend\\Database::connection();
\$stmt = \$pdo->prepare('SELECT confirmation_email_sent_at FROM seat_requests WHERE id = ? LIMIT 1');
\$stmt->execute([(int) \$argv[1]]);
\$value = \$stmt->fetchColumn();
echo \$value ?: '';
" "$request_id")"
if [ "$first_sent_at" != "$second_sent_at" ]; then
  log_error "confirmation_email_sent_at changed on second confirm (${first_sent_at} -> ${second_sent_at})"
  exit 1
fi

log_success "[confirm-email-once] confirmation email send-once gating verified"
