#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-pay-verify.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"

created_event_ids=()
target_category_id=""
target_category_name=""
original_payment_response=""

cleanup_resources() {
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
    restore_payloads="$(ORIGINAL_JSON="$original_payment_response" TARGET_CATEGORY_ID="$target_category_id" python3 - <<'PY'
import json
import os

original = json.loads(os.environ.get('ORIGINAL_JSON', '{}'))
target_category_id = int(os.environ.get('TARGET_CATEGORY_ID', '0') or 0)

def default_payload(scope, provider_type, category_id=None):
    return {
        'scope': scope,
        'category_id': category_id,
        'enabled': False,
        'provider_type': provider_type,
        'provider_label': '',
        'payment_url': '',
        'paypal_currency': 'USD',
        'square_enable_cash_app_pay': False,
        'button_text': 'Pay Online',
        'limit_seats': 6,
        'over_limit_message': '',
        'fine_print': '',
    }

def payload_for(scope, provider_type, category_id=None):
    for item in original.get('payment_settings', []):
        if item.get('scope') != scope:
            continue
        if str(item.get('provider_type') or '') != provider_type:
            continue
        if scope == 'category' and int(item.get('category_id') or 0) != int(category_id or 0):
            continue
        payload = default_payload(scope, provider_type, category_id)
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
        return payload
    return default_payload(scope, provider_type, category_id)

payloads = [
    payload_for('category', 'external_link', target_category_id),
    payload_for('category', 'paypal_orders', target_category_id),
    payload_for('global', 'external_link'),
]
print(json.dumps(payloads))
PY
)"
    while IFS= read -r payload; do
      [ -n "$payload" ] || continue
      admin_post_json "PUT" "/admin/payment-settings" "$payload" >/dev/null 2>&1 || true
    done < <(printf '%s' "$restore_payloads" | python3 - <<'PY'
import json
import sys
for item in json.loads(sys.stdin.read() or '[]'):
    print(json.dumps(item))
PY
)
  fi

  rm -rf "$TMP_DIR"
}
trap cleanup_resources EXIT

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
  local login_payload login_response login_ok
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
  login_ok=$(LOGIN_JSON="$login_response" python3 - <<'PY'
import json
import os
payload = json.loads(os.environ.get('LOGIN_JSON', '{}'))
print('1' if payload.get('success') else '0')
PY
)
  if [ "$login_ok" != "1" ]; then
    log_error "admin login failed in payment verification"
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
  local payment_flag="$2"
  local event_date payload response event_id
  event_date="$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc).date() + timedelta(days=3)).isoformat())
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
  "payment_enabled": ${payment_flag},
  "category_id": ${target_category_id},
  "ticket_type": "general_admission"
}
JSON
)"
  response="$(admin_post_json "POST" "/events" "$payload")"
  event_id="$(json_field "$response" "id")"
  if [ -z "$event_id" ] || [ "$event_id" = "null" ]; then
    log_error "failed creating payment verification event: ${response}"
    exit 1
  fi
  created_event_ids+=("$event_id")
  printf '%s\n' "$event_id"
}

save_provider() {
  local scope="$1"
  local category_id="$2"
  local provider_type="$3"
  local enabled="$4"
  local provider_label="$5"
  local payment_url="$6"
  local button_text="$7"
  local limit="$8"
  local over_limit="$9"
  local fine_print="${10}"
  local extra_square_cash_app="${11:-false}"
  local payload
  payload="$(cat <<JSON
{
  "scope": "${scope}",
  "category_id": ${category_id},
  "enabled": ${enabled},
  "provider_type": "${provider_type}",
  "provider_label": "${provider_label}",
  "payment_url": "${payment_url}",
  "paypal_currency": "USD",
  "square_enable_cash_app_pay": ${extra_square_cash_app},
  "button_text": "${button_text}",
  "limit_seats": ${limit},
  "over_limit_message": "${over_limit}",
  "fine_print": "${fine_print}"
}
JSON
)"
  admin_post_json "PUT" "/admin/payment-settings" "$payload" >/dev/null
}

admin_login

payment_response="$(admin_get_json "/admin/payment-settings")"
original_payment_response="$payment_response"

if [ "$(json_field "$payment_response" "has_table")" != "true" ]; then
  log_error "payment_settings table not detected. Run database/20250326_payment_settings.sql + database/20251212_schema_upgrade.sql before this script."
  exit 1
fi
if [ "$(json_field "$payment_response" "capabilities.provider_scope_key")" != "true" ] || [ "$(json_field "$payment_response" "capabilities.multi_provider")" != "true" ]; then
  log_error "multi-provider payment settings are not available. Run database/20260414_payment_provider_matrix.sql."
  exit 1
fi

target_category_id="$(PAYMENT_JSON="$payment_response" python3 - <<'PY'
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
  log_error "no active categories available for payment verification"
  exit 1
fi
target_category_name="$(PAYMENT_JSON="$payment_response" TARGET_CATEGORY_ID="$target_category_id" python3 - <<'PY'
import json
import os
target = str(os.environ.get('TARGET_CATEGORY_ID', ''))
data = json.loads(os.environ.get('PAYMENT_JSON', '{}'))
for item in data.get('categories', []):
    if str(item.get('id')) == target:
        print(item.get('name') or f'Category {target}')
        break
PY
)"

paypal_ready="$(json_field "$payment_response" "capabilities.paypal_status.ready_to_enable")"

log_step "[payment-settings] configuring category providers for ${target_category_name}"
save_provider "global" "null" "external_link" "true" "Global Payment Link" "https://example.com/global-pay" "Pay Online" 6 "Please contact staff for larger parties." "Global fine print"
save_provider "category" "$target_category_id" "external_link" "true" "Category Payment Link" "https://example.com/category-pay" "Pay Online" 4 "Please contact staff for larger parties." "Category fine print"
save_provider "category" "$target_category_id" "paypal_orders" "true" "PayPal" "" "Pay with PayPal" 4 "Please contact staff for larger parties." "PayPal dynamic checkout"

event_enabled_id="$(create_event "Verify Payment Providers Enabled $(date -u +%s)" "true")"
event_disabled_id="$(create_event "Verify Payment Providers Disabled $(date -u +%s)" "false")"

enabled_event_payload="$(public_event_json "$event_enabled_id")"
disabled_event_payload="$(public_event_json "$event_disabled_id")"

ENABLED_EVENT_JSON="$enabled_event_payload" PAYPAL_READY="$paypal_ready" python3 - <<'PY'
import json
import os
import sys

event = json.loads(os.environ.get('ENABLED_EVENT_JSON', '{}'))
paypal_ready = os.environ.get('PAYPAL_READY') == 'true'
payment_options = event.get('payment_options') or []
provider_types = [item.get('provider_type') for item in payment_options if isinstance(item, dict)]

if 'external_link' not in provider_types:
    print('external_link provider missing from payment_options', file=sys.stderr)
    raise SystemExit(1)

if paypal_ready and 'paypal_orders' not in provider_types:
    print('paypal_orders provider missing despite PayPal being ready', file=sys.stderr)
    raise SystemExit(1)

if (not paypal_ready) and 'paypal_orders' in provider_types:
    print('paypal_orders provider exposed even though PayPal is not ready', file=sys.stderr)
    raise SystemExit(1)

primary = (event.get('payment_option') or {}).get('provider_type')
expected_primary = 'paypal_orders' if paypal_ready else 'external_link'
if primary != expected_primary:
    print(f'payment_option primary mismatch: {primary} != {expected_primary}', file=sys.stderr)
    raise SystemExit(1)
PY
log_success "[payment-settings] public payment provider list matches readiness gating"

DISABLED_EVENT_JSON="$disabled_event_payload" python3 - <<'PY'
import json
import os
import sys
event = json.loads(os.environ.get('DISABLED_EVENT_JSON', '{}'))
if event.get('payment_options'):
    print('payment_options unexpectedly present when event payment_enabled is false', file=sys.stderr)
    raise SystemExit(1)
if event.get('payment_option'):
    print('payment_option unexpectedly present when event payment_enabled is false', file=sys.stderr)
    raise SystemExit(1)
PY
log_success "[payment-settings] payment providers stay hidden when event payment is disabled"

log_step "[payment-settings] verifying category external-link disable suppresses global fallback"
save_provider "category" "$target_category_id" "external_link" "false" "Category Payment Link" "https://example.com/category-pay" "Pay Online" 4 "Please contact staff for larger parties." "Category fine print"
suppressed_event_id="$(create_event "Verify Payment Fallback Suppressed $(date -u +%s)" "true")"
suppressed_event_payload="$(public_event_json "$suppressed_event_id")"
SUPPRESSED_EVENT_JSON="$suppressed_event_payload" python3 - <<'PY'
import json
import os
import sys
event = json.loads(os.environ.get('SUPPRESSED_EVENT_JSON', '{}'))
provider_types = [item.get('provider_type') for item in (event.get('payment_options') or []) if isinstance(item, dict)]
if 'external_link' in provider_types:
    print('external_link unexpectedly present after category-specific disable should suppress global fallback', file=sys.stderr)
    raise SystemExit(1)
PY
log_success "[payment-settings] category-specific provider disable suppresses global fallback for that provider"

log_success "[payment-settings] completed successfully"
