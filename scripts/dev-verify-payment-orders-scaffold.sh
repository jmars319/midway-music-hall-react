#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
auto_now="$(date -u +%s)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-paypal-orders-verify.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"
created_event_ids=()
created_layout_id=""
target_category_id=""
original_payment_config_b64=""
restore_config_needed=0

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
  if [ -n "$created_layout_id" ]; then
    curl -fsS -X DELETE \
      -b "$ADMIN_COOKIE_JAR" \
      -H "Origin: ${ADMIN_ORIGIN}" \
      -H 'Accept: application/json' \
      "${API_BASE}/seating-layouts/${created_layout_id}" >/dev/null 2>&1 || true
  fi
  if [ "$restore_config_needed" -eq 1 ] && [ -n "$target_category_id" ]; then
    restore_payload=$(python3 - "$original_payment_config_b64" "$target_category_id" <<'PY'
import base64, json, sys
raw = sys.argv[1]
category_id = int(sys.argv[2])
payload = {
    'scope': 'category',
    'category_id': category_id,
    'enabled': False,
    'provider_type': 'external_link',
    'payment_url': '',
    'paypal_hosted_button_id': '',
    'paypal_currency': 'USD',
    'paypal_enable_venmo': False,
    'button_text': 'Pay Online',
    'limit_seats': 6,
    'over_limit_message': '',
    'fine_print': '',
    'provider_label': '',
}
if raw:
    data = json.loads(base64.b64decode(raw.encode()).decode())
    provider_type = data.get('provider_type') or 'external_link'
    payload.update({
        'enabled': bool(data.get('enabled')),
        'provider_type': provider_type,
        'payment_url': data.get('payment_url') or '',
        'paypal_hosted_button_id': data.get('paypal_hosted_button_id') or '',
        'paypal_currency': data.get('paypal_currency') or 'USD',
        'paypal_enable_venmo': bool(data.get('paypal_enable_venmo')),
        'button_text': data.get('button_text') or 'Pay Online',
        'limit_seats': data.get('limit_seats') or 6,
        'over_limit_message': data.get('over_limit_message') or '',
        'fine_print': data.get('fine_print') or '',
        'provider_label': data.get('provider_label') or '',
    })
print(json.dumps(payload))
PY
)
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

post_json() {
  local method="$1"
  local path="$2"
  local body="$3"
  curl -fsS -X "$method" -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$body" "${API_BASE}${path}"
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
    log_error "admin login failed in payment orders scaffold verify script"
    exit 1
  fi
}

admin_login

log_step "[payment-orders-scaffold] checking schema capabilities"
if ! schema_json="$(admin_get_json "/debug/schema-check")"; then
  log_error "debug schema-check endpoint unavailable; ensure APP_DEBUG=true for scaffold verification"
  exit 1
fi
for field in has_seat_request_payment_provider has_seat_request_payment_status has_seat_request_payment_order_id has_seat_request_payment_capture_id has_seat_request_payment_updated_at; do
  value="$(json_field "$schema_json" "$field")"
  if [ "$value" != "true" ]; then
    log_error "schema missing ${field}; run database/20251212_schema_upgrade.sql"
    exit 1
  fi
done

log_step "[payment-orders-scaffold] selecting category"
category_json="$(admin_get_json "/event-categories")"
target_category_id="$(CATEGORY_JSON="$category_json" python3 - <<'PY'
import json, os
for item in json.loads(os.environ.get('CATEGORY_JSON', '{}')).get('categories', []):
    if item.get('is_active', 1):
        print(item.get('id'))
        break
PY
)"
if [ -z "$target_category_id" ]; then
  log_error "no active categories available for payment scaffold verify"
  exit 1
fi

payment_json="$(admin_get_json "/admin/payment-settings")"
original_payment_config_b64="$(PAYMENT_JSON="$payment_json" python3 - "$target_category_id" <<'PY'
import base64, json, os, sys
data = json.loads(os.environ.get('PAYMENT_JSON', '{}'))
target = sys.argv[1]
for item in data.get('payment_settings', []):
    if str(item.get('category_id')) == str(target) and item.get('scope') == 'category':
        print(base64.b64encode(json.dumps(item).encode()).decode())
        break
else:
    print('')
PY
)"

log_step "[payment-orders-scaffold] enabling paypal_orders provider"
payload="$(cat <<JSON
{
  "scope": "category",
  "category_id": ${target_category_id},
  "enabled": true,
  "provider_type": "paypal_orders",
  "payment_url": "",
  "paypal_hosted_button_id": "",
  "paypal_currency": "USD",
  "paypal_enable_venmo": false,
  "button_text": "Pay Online",
  "limit_seats": 6,
  "over_limit_message": "",
  "fine_print": "",
  "provider_label": "PayPal"
}
JSON
)"
admin_post_json "PUT" "/admin/payment-settings" "$payload" >/dev/null
restore_config_needed=1

log_step "[payment-orders-scaffold] refreshing admin session before fixture creation"
admin_login
log_step "[payment-orders-scaffold] creating temporary seating layout"
layout_payload='{"name":"Verify Payment Orders Layout","description":"verify","is_default":false,"layout_data":[{"id":"verify-table","element_type":"table","section_name":"Verify","row_label":"19","total_seats":2,"table_shape":"table-2","is_active":true}],"canvas_settings":{"width":1000,"height":700}}'
layout_json="$(admin_post_json "POST" "/seating-layouts" "$layout_payload")"
created_layout_id="$(json_field "$layout_json" "id")"
if [ -z "$created_layout_id" ] || [ "$created_layout_id" = "null" ]; then
  log_error "failed creating test layout"
  exit 1
fi

log_step "[payment-orders-scaffold] creating temporary event"
event_payload="$(cat <<JSON
{
  "artist_name": "Verify PayPal Orders ${auto_now}",
  "event_date": "$(date -u -v+1d +%F 2>/dev/null || date -u -d '+1 day' +%F)",
  "event_time": "20:00:00",
  "door_time": "$(date -u -v+1d +%F 2>/dev/null || date -u -d '+1 day' +%F) 18:00:00",
  "timezone": "America/New_York",
  "status": "published",
  "visibility": "public",
  "ticket_type": "reserved_seating",
  "layout_id": ${created_layout_id},
  "seating_enabled": true,
  "payment_enabled": true,
  "ticket_price": 15.00,
  "category_id": ${target_category_id}
}
JSON
)"
event_json="$(admin_post_json "POST" "/events" "$event_payload")"
event_id="$(json_field "$event_json" "id")"
if [ -z "$event_id" ] || [ "$event_id" = "null" ]; then
  log_error "failed creating test event"
  exit 1
fi
created_event_ids+=("$event_id")

public_events_json="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/public/events?limit=500&timeframe=all&archived=all")"
public_event_json="$(PUBLIC_EVENTS_JSON="$public_events_json" TARGET_EVENT_ID="$event_id" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ.get('PUBLIC_EVENTS_JSON', '{}'))
target = int(os.environ.get('TARGET_EVENT_ID', '0'))
for event in payload.get('events', []):
    if int(event.get('id') or 0) == target:
        print(json.dumps({'event': event}))
        break
else:
    print(json.dumps({'event': {}}))
PY
)"
provider_type="$(json_field "$public_event_json" "event.payment_option.provider_type")"
supports_dynamic="$(json_field "$public_event_json" "event.payment_option.supports_dynamic_amount")"
paypal_orders_enabled="$(json_field "$public_event_json" "event.payment_option.paypal_orders_enabled")"
if [ "$provider_type" != "paypal_orders" ] || [ "$supports_dynamic" != "true" ] || [ "$paypal_orders_enabled" != "true" ]; then
  log_error "public payment_option missing paypal_orders scaffold flags"
  exit 1
fi

log_step "[payment-orders-scaffold] creating seat request and validating stub endpoints"
seat_request_json="$(post_json "POST" "/seat-requests" "$(cat <<JSON
{
  "event_id": ${event_id},
  "customer_name": "Orders Verify",
  "contact": {
    "email": "orders-verify@example.com",
    "phone": "555-555-4444"
  },
  "selected_seats": ["Verify-19-1"],
  "special_requests": ""
}
JSON
)")"
seat_request_id="$(json_field "$seat_request_json" "seat_request.id")"
if [ -z "$seat_request_id" ] || [ "$seat_request_id" = "null" ]; then
  log_error "failed to create seat request for payment scaffold test"
  exit 1
fi

call_stub() {
  local path="$1"
  local body_file
  body_file="$(mktemp "${TMPDIR:-/tmp}/mmh-payment-stub.XXXXXX")"
  local status
  status="$(curl -sS -o "$body_file" -w "%{http_code}" -X POST -H 'Accept: application/json' "${API_BASE}${path}")"
  local body
  body="$(cat "$body_file")"
  rm -f "$body_file"
  if [ "$status" = "200" ]; then
    log_error "${path} unexpectedly returned 200"
    exit 1
  fi
  message="$(json_field "$body" "message")"
  code="$(json_field "$body" "code")"
  if [ "$code" != "PAYMENT_NOT_IMPLEMENTED" ] && ! printf '%s' "$message" | grep -qi "not enabled yet"; then
    log_error "${path} did not return expected not-implemented error payload"
    exit 1
  fi
}

call_stub "/seat-requests/${seat_request_id}/payment/create-order"
call_stub "/seat-requests/${seat_request_id}/payment/capture"

log_success "[payment-orders-scaffold] schema, payload flags, and not-implemented stubs verified"
