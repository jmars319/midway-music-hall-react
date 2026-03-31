#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-admin-api.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"
trap 'rm -rf "$TMP_DIR"' EXIT

created_event_id=""
created_layout_id=""

cleanup_resources() {
  if [ -n "$created_event_id" ]; then
    curl -fsS -X DELETE \
      -b "$ADMIN_COOKIE_JAR" \
      -H "Origin: ${ADMIN_ORIGIN}" \
      -H 'Accept: application/json' \
      "${API_BASE}/events/${created_event_id}" >/dev/null 2>&1 || true
    created_event_id=""
  fi
  if [ -n "$created_layout_id" ]; then
    curl -fsS -X DELETE \
      -b "$ADMIN_COOKIE_JAR" \
      -H "Origin: ${ADMIN_ORIGIN}" \
      -H 'Accept: application/json' \
      "${API_BASE}/seating-layouts/${created_layout_id}" >/dev/null 2>&1 || true
    created_layout_id=""
  fi
}
trap cleanup_resources EXIT

require_backend_health_once || {
  log_error "backend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

log_step "[admin-api] verifying CORS allowlist behavior"
cors_allowed_headers="$(curl -sS -D - -o /dev/null -H "Origin: ${ADMIN_ORIGIN}" "${API_BASE}/health")"
if ! printf '%s' "$cors_allowed_headers" | grep -Fqi "Access-Control-Allow-Origin: ${ADMIN_ORIGIN}"; then
  log_error "[admin-api] expected matched origin to receive Access-Control-Allow-Origin"
  exit 1
fi
cors_denied_headers="$(curl -sS -D - -o /dev/null -H 'Origin: https://untrusted.example' "${API_BASE}/health")"
if printf '%s' "$cors_denied_headers" | grep -qi '^Access-Control-Allow-Origin:'; then
  log_error "[admin-api] unexpected Access-Control-Allow-Origin for untrusted origin"
  exit 1
fi

json_field() {
  local json="$1"
  local field="$2"
  JSON_INPUT="$json" python3 - "$field" <<'PYCODE'
import json
import os
import sys

field = sys.argv[1]
try:
    data = json.loads(os.environ.get("JSON_INPUT", ""))
except Exception as exc:
    raise SystemExit(f"invalid json: {exc}")

for part in field.split('.'):
    if isinstance(data, dict) and part in data:
        data = data[part]
    else:
        raise SystemExit(f"missing field: {field}")

if isinstance(data, bool):
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
    log_error "admin login failed in admin-api verify script"
    exit 1
  fi
}

admin_login

log_step "[admin-api] verifying untrusted origins are rejected for admin mutations"
csrf_probe_status="$(curl -sS -o "${TMP_DIR}/csrf-probe.json" -w '%{http_code}' \
  -b "$ADMIN_COOKIE_JAR" \
  -H 'Origin: https://untrusted.example' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{"current_password":"x","new_password":"y","confirm_password":"y"}' \
  "${API_BASE}/admin/change-password")"
if [ "$csrf_probe_status" != "403" ]; then
  log_error "[admin-api] expected 403 for admin mutation from untrusted origin, got ${csrf_probe_status}"
  exit 1
fi

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
  "stage_position": { "x": 24, "y": 16 },
  "stage_size": { "width": 210, "height": 95 },
  "canvas_settings": { "preset": "standard", "width": 1200, "height": 800 }
}
JSON
)

log_step "[admin-api] creating seating layout"
layout_response=$(post_json "POST" "/seating-layouts" "$layout_payload")
created_layout_id="$(json_field "$layout_response" id)"
log_success "[admin-api] created layout ${created_layout_id}"

log_step "[admin-api] verifying created layout metadata persisted"
created_layout_response="$(curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/seating-layouts/${created_layout_id}")"
if [ "$(json_field "$created_layout_response" 'layout.stage_position.x')" != "24" ] || \
   [ "$(json_field "$created_layout_response" 'layout.stage_position.y')" != "16" ] || \
   [ "$(json_field "$created_layout_response" 'layout.stage_size.width')" != "210" ] || \
   [ "$(json_field "$created_layout_response" 'layout.stage_size.height')" != "95" ] || \
   [ "$(json_field "$created_layout_response" 'layout.canvas_settings.width')" != "1200" ] || \
   [ "$(json_field "$created_layout_response" 'layout.canvas_settings.height')" != "800" ]; then
  log_error "[admin-api] created layout did not persist stage/canvas metadata"
  exit 1
fi

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
  "stage_position": { "x": 30, "y": 18 },
  "stage_size": { "width": 180, "height": 88 },
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
curl -fsS \
  -b "$ADMIN_COOKIE_JAR" \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Accept: application/json' \
  "${API_BASE}/events/${created_event_id}" >/dev/null

log_step "[admin-api] verifying forgiving login throttle"
throttle_identifier="verify-throttle-$(date +%s)@example.com"
throttle_payload=$(python3 - "$throttle_identifier" <<'PY'
import json
import sys
print(json.dumps({"email": sys.argv[1], "password": "definitely-wrong"}))
PY
)
for attempt in $(seq 1 10); do
  status_code="$(curl -sS -o "${TMP_DIR}/throttle-${attempt}.json" -w '%{http_code}' \
    -H "Origin: ${ADMIN_ORIGIN}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "$throttle_payload" \
    "${API_BASE}/login")"
  if [ "$status_code" != "401" ]; then
    log_error "[admin-api] expected 401 on failed login attempt ${attempt}, got ${status_code}"
    exit 1
  fi
done
status_code="$(curl -sS -o "${TMP_DIR}/throttle-blocked.json" -w '%{http_code}' \
  -H "Origin: ${ADMIN_ORIGIN}" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d "$throttle_payload" \
  "${API_BASE}/login")"
if [ "$status_code" != "429" ]; then
  log_error "[admin-api] expected 429 after generous failed-login threshold, got ${status_code}"
  exit 1
fi
retry_after="$(python3 - <<'PY' "${TMP_DIR}/throttle-blocked.json"
import json
import sys
with open(sys.argv[1], 'r', encoding='utf-8') as fh:
    payload = json.load(fh)
value = int(payload.get('retry_after_seconds') or 0)
print(value)
PY
)"
if [ "$retry_after" -le 0 ]; then
  log_error "[admin-api] expected retry_after_seconds on throttled login response"
  exit 1
fi

log_success "[admin-api] verification flow completed successfully"
