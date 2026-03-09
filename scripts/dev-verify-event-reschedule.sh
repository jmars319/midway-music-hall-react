#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-reschedule-verify.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"

created_event_id=""

cleanup_resources() {
  if [ -n "$created_event_id" ]; then
    curl -fsS -X DELETE \
      -b "$ADMIN_COOKIE_JAR" \
      -H "Origin: ${ADMIN_ORIGIN}" \
      -H 'Accept: application/json' \
      "${API_BASE}/events/${created_event_id}" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup_resources EXIT

require_backend_health_once || {
  log_error "backend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

admin_get_json() {
  local path="$1"
  curl -fsS \
    -b "$ADMIN_COOKIE_JAR" \
    -H "Origin: ${ADMIN_ORIGIN}" \
    -H 'Accept: application/json' \
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
    log_error "admin login failed in event-reschedule verify script"
    exit 1
  fi
}

admin_login

schema_payload=$(admin_get_json "/debug/schema-check" 2>/dev/null || true)
if [ -n "$schema_payload" ]; then
  schema_ok=$(printf '%s' "$schema_payload" | python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("0")
    raise SystemExit(0)
print("1" if data.get("success") else "0")
')
  if [ "$schema_ok" = "1" ]; then
    has_archived=$(printf '%s' "$schema_payload" | python3 -c 'import json, sys
data = json.load(sys.stdin)
print("1" if data.get("has_archived_at") else "0")
')
    if [ "$has_archived" != "1" ]; then
      log_error "events.archived_at column missing; run database/20251212_schema_upgrade.sql before verifying reschedule behavior"
      exit 1
    fi
  fi
else
  log_warn "schema-check endpoint unavailable; unable to validate archived_at presence"
fi

post_json() {
  local method="$1"
  local path="$2"
  local body="$3"
  admin_post_json "$method" "$path" "$body"
}

json_field() {
  local json="$1"
  local field="$2"
  printf '%s' "$json" | python3 -c 'import json, sys
field = sys.argv[1]
data = json.load(sys.stdin)
value = data
for part in field.split("."):
    if isinstance(value, dict):
        value = value.get(part)
    else:
        value = None
        break
if isinstance(value, bool):
    print("true" if value else "false")
elif value is None:
    print("")
else:
    print(value)
' "$field"
}

date_parts=$(python3 - <<'PY'
import datetime
now = datetime.datetime.now()
past = now - datetime.timedelta(days=1)
future = now + datetime.timedelta(days=3)
print(past.strftime('%Y-%m-%d'))
print(future.strftime('%Y-%m-%d'))
PY
)
past_date=$(printf '%s' "$date_parts" | sed -n '1p')
future_date=$(printf '%s' "$date_parts" | sed -n '2p')

event_time="20:00:00"
door_time_past="${past_date} 18:00:00"
door_time_future="${future_date} 18:00:00"

event_title="Reschedule Verify $(date +%s)"
event_payload=$(cat <<JSON
{
  "artist_name": "${event_title}",
  "title": "${event_title}",
  "event_date": "${past_date}",
  "event_time": "${event_time}",
  "door_time": "${door_time_past}",
  "timezone": "America/New_York",
  "ticket_type": "general_admission",
  "status": "published",
  "visibility": "public"
}
JSON
)

log_step "[reschedule] creating published past event"
create_response=$(post_json "POST" "/events" "$event_payload")
created_event_id="$(json_field "$create_response" id)"
log_success "[reschedule] created event ${created_event_id}"

log_step "[reschedule] running auto-archive routine"
admin_post_json "POST" "/events/archive-past" '{}' >/dev/null

log_step "[reschedule] confirming event archived"
event_response=$(admin_get_json "/events/${created_event_id}")
archived_flag=$(printf '%s' "$event_response" | python3 -c 'import json, sys
data = json.load(sys.stdin)
event = data.get("event", {})
archived_at = event.get("archived_at")
status = (event.get("status") or "").lower()
print("1" if archived_at or status == "archived" else "0")
')
if [ "$archived_flag" != "1" ]; then
  log_error "event did not archive as expected"
  exit 1
fi

log_step "[reschedule] restoring archived event to draft"
post_json "POST" "/events/${created_event_id}/restore" '{"status":"draft","visibility":"private"}' >/dev/null
event_response=$(admin_get_json "/events/${created_event_id}")
status_value=$(printf '%s' "$event_response" | python3 -c 'import json, sys
data = json.load(sys.stdin)
event = data.get("event", {})
print((event.get("status") or "").lower())
')
if [ "$status_value" != "draft" ]; then
  log_error "event did not restore to draft"
  exit 1
fi

log_step "[reschedule] restoring archived event to published"
post_json "POST" "/events/${created_event_id}/restore" '{"status":"published","visibility":"public"}' >/dev/null

log_step "[reschedule] updating schedule into the future"
update_payload=$(cat <<JSON
{
  "event_date": "${future_date}",
  "event_time": "${event_time}",
  "door_time": "${door_time_future}",
  "timezone": "America/New_York"
}
JSON
)
post_json "PUT" "/events/${created_event_id}" "$update_payload" >/dev/null

log_step "[reschedule] running auto-archive routine again"
admin_post_json "POST" "/events/archive-past" '{}' >/dev/null

log_step "[reschedule] confirming event stays unarchived"
event_response=$(admin_get_json "/events/${created_event_id}")
archived_flag=$(printf '%s' "$event_response" | python3 -c 'import json, sys
data = json.load(sys.stdin)
event = data.get("event", {})
archived_at = event.get("archived_at")
status = (event.get("status") or "").lower()
print("1" if archived_at or status == "archived" else "0")
')
if [ "$archived_flag" != "0" ]; then
  log_error "event re-archived after reschedule"
  exit 1
fi

log_success "[reschedule] auto-archive honors updated schedule and restore targets"
