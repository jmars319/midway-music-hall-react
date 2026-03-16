#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-seating-zoom-verify.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"
KEEP_FIXTURES="${MMH_VERIFY_KEEP_FIXTURES:-0}"
created_event_id=""

cleanup() {
  if [ "$KEEP_FIXTURES" != "1" ] && [ -n "$created_event_id" ]; then
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
    log_error "admin login failed in seating zoom verification"
    exit 1
  fi
}

layout_id="$(php -r "
if (!isset(\$_SERVER['REQUEST_METHOD'])) { \$_SERVER['REQUEST_METHOD'] = 'CLI'; }
require '$ROOT_DIR/backend/bootstrap.php';
\$pdo = \\Midway\\Backend\\Database::connection();
\$id = (int) \$pdo->query('SELECT id FROM seating_layouts ORDER BY id ASC LIMIT 1')->fetchColumn();
echo \$id;
")"
if [ -z "$layout_id" ] || [ "$layout_id" = "0" ]; then
  log_error "no seating layout found for seating zoom verification"
  exit 1
fi

admin_login

event_date="$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat())
PY
)"
verify_label="Verify Seating Zoom $(date -u +%s)"
event_payload="$(cat <<JSON
{
  "artist_name": "${verify_label}",
  "title": "${verify_label}",
  "event_date": "${event_date}",
  "event_time": "20:00:00",
  "door_time": "${event_date} 18:00:00",
  "timezone": "America/New_York",
  "status": "published",
  "visibility": "public",
  "ticket_type": "reserved_seating",
  "layout_id": ${layout_id},
  "seating_enabled": true
}
JSON
)"
create_response="$(admin_post_json "POST" "/events" "$event_payload")"
create_success="$(json_field "$create_response" success)"
if [ "$create_success" != "true" ]; then
  log_error "failed to create seating zoom verification event: $create_response"
  exit 1
fi
created_event_id="$(json_field "$create_response" id)"
if [ "$created_event_id" = "null" ] || [ -z "$created_event_id" ]; then
  log_error "seating zoom verification event missing id: $create_response"
  exit 1
fi

log_step "[seating-zoom-controls] checking /api/seating/event/${created_event_id}"
seating_response="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/seating/event/${created_event_id}")" || {
  log_error "failed to fetch /api/seating/event/${created_event_id}"
  exit 1
}

shape_ok="$(JSON_INPUT="$seating_response" python3 - <<'PY'
import json
import os

try:
    data = json.loads(os.environ.get('JSON_INPUT', ''))
except Exception:
    print('0')
    raise SystemExit(0)

ok = (
    isinstance(data, dict)
    and bool(data.get('success'))
    and isinstance(data.get('seating'), list)
)
print('1' if ok else '0')
PY
)"

if [ "$shape_ok" != "1" ]; then
  log_error "seating payload invalid for event ${created_event_id}; expected success=true with seating array"
  exit 1
fi

log_success "[seating-zoom-controls] required endpoints and payload shape validated"

cat <<GUIDE

Manual QA checklist (pass/fail):
1. Open frontend: $(frontend_url)
2. Open the verification event "${verify_label}" (event #${created_event_id}) and launch EventSeatingModal.
3. In normal mode, tap/click '+' twice.
   Pass: map visibly zooms in; no UI overlap blocks map.
4. Pan/drag the map, then select one available seat.
   Pass: pan still works and seat toggle still works.
5. Tap/click '-' once, then tap/click 'Fit seats to screen'.
   Pass: zoom decreases, then map recenters/resets predictably.
6. Tap/click 'Open large map'.
   Pass: overlay is on top; underlying modal is not interactable.
7. Repeat steps 3-5 in large map mode, then tap/click 'Exit large map'.
   Pass: selected seat state is preserved after exit.
8. Mobile device checks (Android + iOS): repeat steps 3-7.
   Pass: controls remain reachable and do not block panning.

If any step fails, mark this verify as failed.
GUIDE

if [ "$KEEP_FIXTURES" != "1" ]; then
  log_info "[seating-zoom-controls] temporary verification event will be deleted on exit; rerun with MMH_VERIFY_KEEP_FIXTURES=1 for manual walkthroughs"
fi
log_success "[seating-zoom-controls] guided verification script completed"
