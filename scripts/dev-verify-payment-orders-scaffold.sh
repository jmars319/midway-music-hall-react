#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-paypal-orders-verify.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"

created_event_ids=()
target_category_id=""
original_payment_response=""

cleanup() {
  if [ "${#created_event_ids[@]}" -gt 0 ]; then
    for event_id in "${created_event_ids[@]}"; do
      curl -fsS -X DELETE \
        -b "$ADMIN_COOKIE_JAR" \
        -H "Origin: ${ADMIN_ORIGIN}" \
        -H 'Accept: application/json' \
        "${API_BASE}/events/${event_id}" >/dev/null 2>&1 || true
    done
  fi

  if [ -n "$original_payment_response" ] && [ -n "$target_category_id" ]; then
    restore_payload="$(ORIGINAL_JSON="$original_payment_response" TARGET_CATEGORY_ID="$target_category_id" python3 - <<'PY'
import json
import os

original = json.loads(os.environ.get('ORIGINAL_JSON', '{}'))
target_category_id = int(os.environ.get('TARGET_CATEGORY_ID', '0') or 0)

payload = {
    'scope': 'category',
    'category_id': target_category_id,
    'enabled': False,
    'provider_type': 'paypal_orders',
    'provider_label': '',
    'payment_url': '',
    'paypal_currency': 'USD',
    'square_enable_cash_app_pay': False,
    'button_text': 'Pay Online',
    'limit_seats': 6,
    'over_limit_message': '',
    'fine_print': '',
}

for item in original.get('payment_settings', []):
    if item.get('scope') != 'category':
        continue
    if int(item.get('category_id') or 0) != target_category_id:
        continue
    if str(item.get('provider_type') or '') != 'paypal_orders':
        continue
    payload.update({
        'enabled': bool(item.get('enabled')),
        'provider_label': item.get('provider_label') or '',
        'payment_url': item.get('payment_url') or '',
        'paypal_currency': item.get('paypal_currency') or 'USD',
        'square_enable_cash_app_pay': bool(item.get('square_enable_cash_app_pay')),
        'button_text': item.get('button_text') or 'Pay Online',
        'limit_seats': int(item.get('limit_seats') or 6),
        'over_limit_message': item.get('over_limit_message') or '',
        'fine_print': item.get('fine_print') or '',
    })
    break

print(json.dumps(payload))
PY
)"
    admin_post_json "PUT" "/admin/payment-settings" "$restore_payload" >/dev/null 2>&1 || true
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
  local login_payload login_response ok
  login_payload=$(python3 - "$ADMIN_LOGIN_ID" "$ADMIN_LOGIN_PASSWORD" <<'PY'
import json
import sys
print(json.dumps({"email": sys.argv[1], "password": sys.argv[2]}))
PY
)
  login_response=$(curl -fsS \
    -c "$ADMIN_COOKIE_JAR" \
    -H "Origin: ${ADMIN_ORIGIN}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -d "$login_payload" \
    "${API_BASE}/login")
  ok=$(LOGIN_JSON="$login_response" python3 - <<'PY'
import json
import os
payload = json.loads(os.environ.get('LOGIN_JSON', '{}'))
print('1' if payload.get('success') else '0')
PY
)
  if [ "$ok" != "1" ]; then
    log_error "admin login failed in PayPal orders verification"
    exit 1
  fi
}

public_event_json() {
  local event_id="$1"
  local payload
  payload="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/public/events?limit=500&timeframe=all&archived=all")"
  EVENTS_JSON="$payload" TARGET_EVENT_ID="$event_id" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ.get('EVENTS_JSON', '{}'))
target = int(os.environ.get('TARGET_EVENT_ID', '0'))
for event in payload.get('events', []):
    if int(event.get('id') or 0) == target:
        print(json.dumps(event))
        break
else:
    print('{}')
PY
}

create_event() {
  local label="$1"
  local event_date payload response event_id
  event_date="$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc).date() + timedelta(days=7)).isoformat())
PY
)"
  payload="$(cat <<JSON
{
  "artist_name": "${label}",
  "title": "${label}",
  "event_date": "${event_date}",
  "event_time": "20:00:00",
  "door_time": "${event_date} 18:00:00",
  "timezone": "America/New_York",
  "status": "published",
  "visibility": "public",
  "category_id": ${target_category_id},
  "payment_enabled": true,
  "ticket_type": "general_admission"
}
JSON
)"
  response="$(admin_post_json "POST" "/events" "$payload")"
  event_id="$(json_field "$response" "id")"
  if [ -z "$event_id" ] || [ "$event_id" = "null" ]; then
    log_error "failed to create event for PayPal orders verification: ${response}"
    exit 1
  fi
  created_event_ids+=("$event_id")
  printf '%s\n' "$event_id"
}

admin_login

payment_json="$(admin_get_json "/admin/payment-settings")"
original_payment_response="$payment_json"

if [ "$(json_field "$payment_json" "has_table")" != "true" ]; then
  log_error "payment_settings table missing; run database/20250326_payment_settings.sql and database/20251212_schema_upgrade.sql"
  exit 1
fi
if [ "$(json_field "$payment_json" "capabilities.provider_type_paypal_orders")" != "true" ]; then
  log_error "payment_settings.provider_type does not support paypal_orders; run database/20251212_schema_upgrade.sql"
  exit 1
fi
if [ "$(json_field "$payment_json" "capabilities.multi_provider")" != "true" ]; then
  log_error "payment provider matrix migration is missing; run database/20260414_payment_provider_matrix.sql"
  exit 1
fi

target_category_id="$(PAYMENT_JSON="$payment_json" python3 - <<'PY'
import json
import os
data = json.loads(os.environ.get('PAYMENT_JSON', '{}'))
for item in data.get('categories', []):
    if item.get('is_active', 1):
        print(item.get('id'))
        break
PY
)"
if [ -z "$target_category_id" ]; then
  log_error "no active category available for PayPal orders verification"
  exit 1
fi

log_step "[payment-orders] verifying source wiring"
if ! rg -n "POST', '/api/webhooks/paypal'" "$ROOT_DIR/backend/index.php" >/dev/null; then
  log_error "PayPal webhook route is missing from backend/index.php"
  exit 1
fi
if ! rg -n "PAYPAL_CLIENT_ID|PAYPAL_CLIENT_SECRET|PAYPAL_WEBHOOK_ID|PAYPAL_CHECKOUT_RETURN_URL|PAYPAL_CHECKOUT_CANCEL_URL" "$ROOT_DIR/backend/.env.production.example" >/dev/null; then
  log_error "PayPal production env keys are missing from backend/.env.production.example"
  exit 1
fi
if ! rg -n "provider=paypal_orders|Finalizing your PayPal payment|payment/capture" "$ROOT_DIR/frontend/src/pages/PaymentStatusPage.js" >/dev/null; then
  log_error "PayPal return/finalize flow is missing from PaymentStatusPage"
  exit 1
fi
if ! rg -n "payment_access_token|PAYMENT_ACCESS_SECRET" "$ROOT_DIR/backend/index.php" "$ROOT_DIR/frontend/src/pages/PaymentStatusPage.js" "$ROOT_DIR/backend/.env.production.example" >/dev/null; then
  log_error "PayPal payment flow is missing protected payment access token wiring"
  exit 1
fi
if ! rg -n "providerType === 'paypal_orders'|Pay with PayPal" "$ROOT_DIR/frontend/src/components/EventSeatingModal.js" >/dev/null; then
  log_error "PayPal launch flow is missing from EventSeatingModal"
  exit 1
fi

log_step "[payment-orders] enabling temporary PayPal Orders config"
payload="$(cat <<JSON
{
  "scope": "category",
  "category_id": ${target_category_id},
  "enabled": true,
  "provider_type": "paypal_orders",
  "provider_label": "PayPal",
  "payment_url": "",
  "paypal_currency": "USD",
  "square_enable_cash_app_pay": false,
  "button_text": "Pay with PayPal",
  "limit_seats": 6,
  "over_limit_message": "Please contact staff for larger parties.",
  "fine_print": "PayPal dynamic checkout"
}
JSON
)"
admin_post_json "PUT" "/admin/payment-settings" "$payload" >/dev/null

event_id="$(create_event "PayPal Orders Verify $(date -u +%s)")"
public_event_payload="$(public_event_json "$event_id")"
paypal_ready="$(json_field "$payment_json" "capabilities.paypal_status.ready_to_enable")"

PUBLIC_EVENT_JSON="$public_event_payload" PAYPAL_READY="$paypal_ready" python3 - <<'PY'
import json
import os
import sys

event = json.loads(os.environ.get('PUBLIC_EVENT_JSON', '{}'))
paypal_ready = os.environ.get('PAYPAL_READY') == 'true'
provider_types = [item.get('provider_type') for item in (event.get('payment_options') or []) if isinstance(item, dict)]

if paypal_ready and 'paypal_orders' not in provider_types:
    print('paypal_orders provider missing from payment_options even though PayPal is ready', file=sys.stderr)
    raise SystemExit(1)
if (not paypal_ready) and 'paypal_orders' in provider_types:
    print('paypal_orders provider exposed despite PayPal readiness being false', file=sys.stderr)
    raise SystemExit(1)
PY

log_success "[payment-orders] PayPal Orders readiness gating verified"
