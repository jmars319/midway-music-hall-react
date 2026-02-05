#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-paypal-verify.XXXXXX")"

target_category_id=""
original_category_config_b64=""
restore_needed=0
created_event_id=""

cleanup_resources() {
  if [ -n "$created_event_id" ]; then
    curl -fsS -X DELETE -H 'Accept: application/json' "${API_BASE}/events/${created_event_id}" >/dev/null 2>&1 || true
  fi

  if [ "$restore_needed" -eq 1 ] && [ -n "$target_category_id" ]; then
    python3 - "$original_category_config_b64" "$target_category_id" "$API_BASE" <<'PY'
import base64
import json
import sys
import urllib.request

raw = sys.argv[1]
category_id = int(sys.argv[2])
api_base = sys.argv[3]

payload = {
    'scope': 'category',
    'category_id': category_id,
    'enabled': False,
    'provider_type': 'external_link',
    'provider_label': '',
    'payment_url': '',
    'paypal_hosted_button_id': '',
    'paypal_currency': 'USD',
    'paypal_enable_venmo': False,
    'button_text': 'Pay Online',
    'limit_seats': 6,
    'over_limit_message': '',
    'fine_print': '',
}

if raw:
    data = json.loads(base64.b64decode(raw.encode()).decode())
    payload.update({
        'enabled': bool(data.get('enabled')),
        'provider_type': data.get('provider_type') or 'external_link',
        'provider_label': data.get('provider_label') or '',
        'payment_url': data.get('payment_url') or '',
        'paypal_hosted_button_id': data.get('paypal_hosted_button_id') or '',
        'paypal_currency': data.get('paypal_currency') or 'USD',
        'paypal_enable_venmo': bool(data.get('paypal_enable_venmo')),
        'button_text': data.get('button_text') or 'Pay Online',
        'limit_seats': int(data.get('limit_seats') or 6),
        'over_limit_message': data.get('over_limit_message') or '',
        'fine_print': data.get('fine_print') or '',
    })

req = urllib.request.Request(
    f"{api_base}/admin/payment-settings",
    data=json.dumps(payload).encode(),
    headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
    method='PUT'
)
try:
    urllib.request.urlopen(req).read()
except Exception as exc:
    sys.stderr.write(f"[cleanup] Failed to restore category payment config: {exc}\n")
PY
  fi

  rm -rf "$TMP_DIR"
}
trap cleanup_resources EXIT

require_backend_health_once || {
  log_error "backend is not running; start dev stack via scripts/dev-start.sh"
  exit 1
}

log_step "[paypal-api] checking payment settings schema capabilities"
payment_settings_payload=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/admin/payment-settings")
PAYMENT_SETTINGS_JSON="$payment_settings_payload" python3 - <<'PY'
import json
import os
import sys

data = json.loads(os.environ['PAYMENT_SETTINGS_JSON'])
if not data.get('has_table'):
    print('payment_settings table missing; run database/20250326_payment_settings.sql and database/20251212_schema_upgrade.sql', file=sys.stderr)
    raise SystemExit(1)
caps = data.get('capabilities', {})
required = [
    'provider_type',
    'paypal_hosted_button_id',
    'paypal_currency',
    'paypal_enable_venmo',
]
missing = [key for key in required if caps.get(key) is False]
if missing:
    print('payment_settings PayPal columns missing: ' + ', '.join(missing), file=sys.stderr)
    raise SystemExit(1)
PY

category_payload=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/event-categories")
target_category_id=$(CATEGORY_JSON="$category_payload" python3 - <<'PY'
import json
import os

data = json.loads(os.environ['CATEGORY_JSON'])
for item in data.get('categories', []):
    if item.get('is_active', 1):
        print(item.get('id'))
        break
PY
)

if [ -z "$target_category_id" ]; then
  log_error "no active category found for PayPal verification"
  exit 1
fi

original_category_config_b64=$(PAYMENT_JSON="$payment_settings_payload" python3 - "$target_category_id" <<'PY'
import base64
import json
import os
import sys

data = json.loads(os.environ['PAYMENT_JSON'])
target = str(sys.argv[1])
for item in data.get('payment_settings', []):
    if str(item.get('category_id')) == target and item.get('scope') == 'category':
        print(base64.b64encode(json.dumps(item).encode()).decode())
        break
else:
    print('')
PY
)

log_step "[paypal-api] saving category payment setting as paypal_hosted_button"
paypal_payload=$(cat <<JSON
{
  "scope": "category",
  "category_id": ${target_category_id},
  "enabled": true,
  "provider_type": "paypal_hosted_button",
  "provider_label": "PayPal",
  "payment_url": "",
  "paypal_hosted_button_id": "U7GKCHLN5VH66",
  "paypal_currency": "USD",
  "paypal_enable_venmo": true,
  "button_text": "Pay with PayPal",
  "limit_seats": 6,
  "over_limit_message": "Please contact staff for larger parties.",
  "fine_print": "Online payment available after seat selection."
}
JSON
)
curl -fsS -X PUT -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$paypal_payload" "${API_BASE}/admin/payment-settings" >/dev/null
restore_needed=1

future_date=$(python3 - <<'PY'
import datetime
print((datetime.datetime.now() + datetime.timedelta(days=14)).strftime('%Y-%m-%d'))
PY
)

event_payload=$(cat <<JSON
{
  "artist_name": "PayPal Verify $(date +%s)",
  "title": "PayPal Verify",
  "event_date": "${future_date}",
  "event_time": "20:00:00",
  "door_time": "${future_date} 18:00:00",
  "status": "published",
  "visibility": "public",
  "category_id": ${target_category_id},
  "payment_enabled": 1,
  "ticket_type": "general_admission"
}
JSON
)

create_event_response=$(curl -fsS -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$event_payload" "${API_BASE}/events")
created_event_id=$(CREATE_EVENT_JSON="$create_event_response" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ['CREATE_EVENT_JSON'])
print(payload.get('id') or '')
PY
)

if [ -z "$created_event_id" ]; then
  log_error "failed to create event for PayPal verification"
  exit 1
fi

log_step "[paypal-api] verifying payment_option payload on public event"
public_event_payload=$(curl -fsS -H 'Accept: application/json' "${API_BASE}/events/${created_event_id}")
PUBLIC_EVENT_JSON="$public_event_payload" python3 - <<'PY'
import json
import os
import sys

payload = json.loads(os.environ['PUBLIC_EVENT_JSON'])
event = payload.get('event') or {}
payment = event.get('payment_option') or {}
if payment.get('provider_type') != 'paypal_hosted_button':
    print('payment_option.provider_type mismatch', file=sys.stderr)
    raise SystemExit(1)
paypal = payment.get('paypal') or {}
if paypal.get('hosted_button_id') != 'U7GKCHLN5VH66':
    print('payment_option.paypal.hosted_button_id missing or incorrect', file=sys.stderr)
    raise SystemExit(1)
if str(paypal.get('currency') or '').upper() != 'USD':
    print('payment_option.paypal.currency missing or incorrect', file=sys.stderr)
    raise SystemExit(1)
if not bool(paypal.get('enable_venmo')):
    print('payment_option.paypal.enable_venmo missing or false', file=sys.stderr)
    raise SystemExit(1)
PY

log_success "[paypal-api] hosted-button payment option wiring verified"
