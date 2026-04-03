#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-payment-post-submit.XXXXXX")"
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

log_step "[payment-post-submit] validating payment gating in EventSeatingModal source"
if ! rg -n "const showPaymentPanel = postSubmitPaymentReady" "$ROOT_DIR/frontend/src/components/EventSeatingModal.js" >/dev/null; then
  log_error "showPaymentPanel is not gated by postSubmitPaymentReady"
  exit 1
fi
if ! rg -n "Online payment available after submitting your seat request\." "$ROOT_DIR/frontend/src/components/EventSeatingModal.js" >/dev/null; then
  log_error "pre-submit non-actionable payment notice is missing"
  exit 1
fi
if ! rg -n "Amount due" "$ROOT_DIR/frontend/src/components/EventSeatingModal.js" >/dev/null; then
  log_error "post-submit amount due display token is missing"
  exit 1
fi
if ! rg -n "paymentProviderType === 'square'" "$ROOT_DIR/frontend/src/components/EventSeatingModal.js" >/dev/null; then
  log_error "Square post-submit payment branch is missing from EventSeatingModal"
  exit 1
fi
if ! rg -n 'seat-requests/\$\{submittedSeatRequestId\}/payment/start' "$ROOT_DIR/frontend/src/components/EventSeatingModal.js" >/dev/null; then
  log_error "Square payment start route is not used by EventSeatingModal"
  exit 1
fi
if ! rg -n "Opening Square|Pay with Square" "$ROOT_DIR/frontend/src/components/EventSeatingModal.js" >/dev/null; then
  log_error "Square launch action copy is missing from EventSeatingModal"
  exit 1
fi
if ! rg -n 'option value=\"square\"' "$ROOT_DIR/frontend/src/admin/PaymentSettingsModule.js" >/dev/null; then
  log_error "Square provider option is missing from PaymentSettingsModule"
  exit 1
fi
if ! rg -n "Square hosted checkout" "$ROOT_DIR/frontend/src/admin/EventsModule.js" >/dev/null; then
  log_error "Square provider summary is missing from EventsModule"
  exit 1
fi
if ! rg -n "Paid / pending confirmation" "$ROOT_DIR/frontend/src/admin/SeatRequestsModule.js" >/dev/null; then
  log_error "paid / pending confirmation admin label is missing"
  exit 1
fi
if ! rg -n "Does not expire after payment" "$ROOT_DIR/frontend/src/admin/SeatRequestsModule.js" >/dev/null; then
  log_error "non-expiring paid request admin copy is missing"
  exit 1
fi

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
    log_error "admin login failed in payment post-submit verification"
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
  log_error "no seating layout found for payment post-submit verification"
  exit 1
fi

admin_login

event_date="$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc).date() + timedelta(days=3)).isoformat())
PY
)"
verify_label="Verify Payment Post-Submit $(date -u +%s)"
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
  "seating_enabled": true,
  "payment_enabled": true
}
JSON
)"
create_response="$(admin_post_json "POST" "/events" "$event_payload")"
create_success="$(json_field "$create_response" success)"
if [ "$create_success" != "true" ]; then
  log_error "failed to create payment post-submit verification event: $create_response"
  exit 1
fi
created_event_id="$(json_field "$create_response" id)"
if [ "$created_event_id" = "null" ] || [ -z "$created_event_id" ]; then
  log_error "payment post-submit verification event missing id: $create_response"
  exit 1
fi

seating_payload="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/seating/event/${created_event_id}")"
seating_ok="$(SEATING_JSON="$seating_payload" python3 - <<'PY'
import json
import os

data = json.loads(os.environ.get('SEATING_JSON', '{}'))
print('1' if data.get('success') else '0')
PY
)"
if [ "$seating_ok" != "1" ]; then
  log_error "seating endpoint failed for event ${created_event_id}"
  exit 1
fi

log_success "[payment-post-submit] API and source gates look valid"
cat <<'CHECKLIST'
[payment-post-submit] MANUAL CHECKLIST
1. In admin payment settings, choose `Square hosted checkout` for a sandbox category and save it.
2. Open the verification event created by this script on the public site.
3. Select seats and continue to contact form.
4. Confirm no actionable payment button is visible before submitting.
5. Submit the seat request.
6. If Square sandbox is configured, confirm the post-submit panel shows a Square launch action and opens Square checkout.
7. If Square sandbox is not configured, confirm the panel shows the backend block reason and does not show a misleading pay-now action.
8. Confirm "Amount due" appears when total_amount is present in the response.
9. Confirm over-limit copy still appears when seat count exceeds configured payment limit.
10. Open Seat Requests admin and confirm paid requests remain visibly distinct as "Paid / pending confirmation" and show "Does not expire after payment."
CHECKLIST
if [ "$KEEP_FIXTURES" != "1" ]; then
  log_info "[payment-post-submit] temporary verification event will be deleted on exit; rerun with MMH_VERIFY_KEEP_FIXTURES=1 for manual walkthroughs"
fi
