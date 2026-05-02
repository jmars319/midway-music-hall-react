#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"
auto_now="$(date -u +%s)"
future_event_date="$(date -u -v+1d +%F 2>/dev/null || date -u -d '+1 day' +%F)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mmh-payment-authority-foundation.XXXXXX")"
ADMIN_COOKIE_JAR="${TMP_DIR}/admin-cookies.txt"
ADMIN_ORIGIN="$(frontend_url)"
ADMIN_LOGIN_ID="${MMH_VERIFY_LOGIN_EMAIL:-${MMH_VERIFY_ADMIN_EMAIL:-admin}}"
ADMIN_LOGIN_PASSWORD="${MMH_VERIFY_LOGIN_PASSWORD:-${MMH_VERIFY_ADMIN_PASSWORD:-admin123}}"
created_event_ids=()
created_layout_id=""
target_category_id=""
original_payment_config_b64=""
restore_config_needed=0
LAST_STATUS=""
LAST_BODY=""
BACKEND_ENV_FILE="$ROOT_DIR/backend/.env"
BACKEND_ENV_BACKUP="$TMP_DIR/backend.env.backup"
backend_env_existed=0
square_stub_port=""
square_stub_pid=""
square_verify_access_token="verify-square-access-token"
square_verify_location_id="verify-square-location"
square_verify_signature_key="verify-square-signature-key"
square_verify_notification_url="$(backend_url)/api/webhooks/square"
square_verify_redirect_url="$(frontend_url)/square-checkout-return"

cleanup() {
  if [ -n "$square_stub_pid" ] && kill -0 "$square_stub_pid" >/dev/null 2>&1; then
    kill "$square_stub_pid" >/dev/null 2>&1 || true
    wait "$square_stub_pid" >/dev/null 2>&1 || true
  fi
  if [ -f "$BACKEND_ENV_BACKUP" ]; then
    if [ "$backend_env_existed" -eq 1 ]; then
      cp "$BACKEND_ENV_BACKUP" "$BACKEND_ENV_FILE"
    else
      rm -f "$BACKEND_ENV_FILE"
    fi
  fi
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
    'paypal_currency': 'USD',
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
        'paypal_currency': data.get('paypal_currency') or 'USD',
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

request_json_by_id() {
  local json="$1"
  local request_id="$2"
  REQUESTS_JSON="$json" python3 - "$request_id" <<'PY'
import json
import os
import sys

payload = json.loads(os.environ.get('REQUESTS_JSON', '{}'))
target = int(sys.argv[1])
for item in payload.get('requests', []):
    if int(item.get('id') or 0) == target:
        print(json.dumps(item))
        break
else:
    print('{}')
PY
}

json_array_contains() {
  local json="$1"
  local field="$2"
  local expected="$3"
  JSON_INPUT="$json" python3 - "$field" "$expected" <<'PY'
import json
import os
import sys

value = json.loads(os.environ.get('JSON_INPUT', '{}'))
for part in sys.argv[1].split('.'):
    if isinstance(value, list):
        value = value[int(part)]
    else:
        value = value.get(part)
items = value if isinstance(value, list) else []
print('1' if sys.argv[2] in items else '0')
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

public_post_with_status() {
  local path="$1"
  local body="${2:-}"
  local body_file
  body_file="$(mktemp "${TMPDIR:-/tmp}/mmh-payment-authority-post.XXXXXX")"
  if [ -n "$body" ]; then
    LAST_STATUS="$(curl -sS -o "$body_file" -w "%{http_code}" -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$body" "${API_BASE}${path}")"
  else
    LAST_STATUS="$(curl -sS -o "$body_file" -w "%{http_code}" -X POST -H 'Accept: application/json' "${API_BASE}${path}")"
  fi
  LAST_BODY="$(cat "$body_file")"
  rm -f "$body_file"
}

payment_start_payload() {
  local access_token="$1"
  python3 - "$access_token" <<'PY'
import json
import sys
print(json.dumps({"payment_access_token": sys.argv[1]}))
PY
}

payment_access_token_from_request_json() {
  local request_json="$1"
  json_field "$request_json" "seat_request.payment_access_token"
}

restore_backend_env() {
  if [ ! -f "$BACKEND_ENV_BACKUP" ]; then
    return
  fi
  if [ "$backend_env_existed" -eq 1 ]; then
    cp "$BACKEND_ENV_BACKUP" "$BACKEND_ENV_FILE"
  else
    rm -f "$BACKEND_ENV_FILE"
  fi
}

start_square_stub() {
  square_stub_port="$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
)"
  cat > "$TMP_DIR/square-stub.py" <<'PY'
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])
RUN_TOKEN = sys.argv[2]
STATE = {"links": {}, "counter": 0}


def respond(handler, status, payload=None):
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.end_headers()
    if payload is not None:
        handler.wfile.write(json.dumps(payload).encode("utf-8"))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            respond(self, 200, {"ok": True})
            return
        if self.path.startswith("/v2/online-checkout/payment-links/"):
            link_id = self.path.rsplit("/", 1)[-1]
            link = STATE["links"].get(link_id)
            if not link:
                respond(self, 404, {"errors": [{"detail": "Not found"}]})
                return
            respond(self, 200, link)
            return
        respond(self, 404, {"errors": [{"detail": "Unknown path"}]})

    def do_POST(self):
        if self.path != "/v2/online-checkout/payment-links":
            respond(self, 404, {"errors": [{"detail": "Unknown path"}]})
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        payload = json.loads(raw or "{}")
        STATE["counter"] += 1
        suffix = str(STATE["counter"])
        order = payload.get("order") or {}
        link_id = f"verify-link-{RUN_TOKEN}-{suffix}"
        order_id = f"verify-order-{RUN_TOKEN}-{suffix}"
        record = {
            "payment_link": {
                "id": link_id,
                "url": f"http://127.0.0.1:{PORT}/checkout/{link_id}",
                "order_id": order_id,
            },
            "related_resources": {
                "orders": [{
                    "id": order_id,
                    "reference_id": order.get("reference_id"),
                }]
            }
        }
        STATE["links"][link_id] = record
        respond(self, 200, record)

    def do_DELETE(self):
        if self.path.startswith("/v2/online-checkout/payment-links/"):
            link_id = self.path.rsplit("/", 1)[-1]
            STATE["links"].pop(link_id, None)
            respond(self, 200, {"success": True})
            return
        respond(self, 404, {"errors": [{"detail": "Unknown path"}]})

    def log_message(self, fmt, *args):
        return


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
PY
  python3 "$TMP_DIR/square-stub.py" "$square_stub_port" "$auto_now" >"$TMP_DIR/square-stub.log" 2>&1 &
  square_stub_pid=$!
  for _ in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${square_stub_port}/health" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  log_error "Square verify stub failed to start"
  exit 1
}

configure_square_verify_env() {
  if [ -f "$BACKEND_ENV_FILE" ]; then
    cp "$BACKEND_ENV_FILE" "$BACKEND_ENV_BACKUP"
    backend_env_existed=1
  else
    : > "$BACKEND_ENV_BACKUP"
    backend_env_existed=0
  fi
  {
    if [ "$backend_env_existed" -eq 1 ]; then
      cat "$BACKEND_ENV_BACKUP"
      printf '\n'
    fi
    printf '# Square verify overrides\n'
    printf 'SQUARE_ENVIRONMENT=sandbox\n'
    printf 'SQUARE_ACCESS_TOKEN=%s\n' "$square_verify_access_token"
    printf 'SQUARE_LOCATION_ID=%s\n' "$square_verify_location_id"
    printf 'SQUARE_CHECKOUT_REDIRECT_URL=%s\n' "$square_verify_redirect_url"
    printf 'SQUARE_WEBHOOK_SIGNATURE_KEY=%s\n' "$square_verify_signature_key"
    printf 'SQUARE_WEBHOOK_NOTIFICATION_URL=%s\n' "$square_verify_notification_url"
    printf 'SQUARE_API_BASE_URL=http://127.0.0.1:%s\n' "$square_stub_port"
    printf 'PAYMENT_ACCESS_SECRET=verify-payment-access-secret-000000000000\n'
  } > "$BACKEND_ENV_FILE"
}

post_square_webhook() {
  local order_id="$1"
  local payment_id="$2"
  local payload
  payload="$(python3 - "$order_id" "$payment_id" <<'PY'
import json
import sys

print(json.dumps({
    "type": "payment.updated",
    "data": {
        "object": {
            "payment": {
                "id": sys.argv[2],
                "order_id": sys.argv[1],
                "status": "COMPLETED",
            }
        }
    }
}))
PY
)"
  local signature
  signature="$(python3 - "$square_verify_notification_url" "$square_verify_signature_key" "$payload" <<'PY'
import base64
import hashlib
import hmac
import sys

message = (sys.argv[1] + sys.argv[3]).encode("utf-8")
digest = hmac.new(sys.argv[2].encode("utf-8"), message, hashlib.sha256).digest()
print(base64.b64encode(digest).decode("ascii"))
PY
)"
  curl -fsS -X POST \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -H "X-Square-HmacSha256-Signature: ${signature}" \
    -d "$payload" \
    "${API_BASE}/webhooks/square" >/dev/null
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
    log_error "admin login failed in payment authority foundation verify script"
    exit 1
  fi
}

create_event() {
  local title="$1"
  local ticket_price="$2"
  local payload
  payload=$(cat <<JSON
{
  "artist_name": "${title}",
  "event_date": "${future_event_date}",
  "event_time": "20:00:00",
  "door_time": "${future_event_date} 18:00:00",
  "timezone": "America/New_York",
  "status": "published",
  "visibility": "public",
  "ticket_type": "reserved_seating",
  "layout_id": ${created_layout_id},
  "seating_enabled": true,
  "payment_enabled": true,
  "ticket_price": ${ticket_price},
  "category_id": ${target_category_id}
}
JSON
)
  local response
  response="$(admin_post_json "POST" "/events" "$payload")"
  local event_id
  event_id="$(json_field "$response" "id")"
  if [ -z "$event_id" ] || [ "$event_id" = "null" ]; then
    log_error "failed to create verification event: $response"
    exit 1
  fi
  created_event_ids+=("$event_id")
  printf '%s\n' "$event_id"
}

submit_request() {
  local event_id="$1"
  local email="$2"
  local seats_json="$3"
  post_json "POST" "/seat-requests" "$(cat <<JSON
{
  "event_id": ${event_id},
  "customer_name": "Payment Verify",
  "contact": {
    "email": "${email}",
    "phone": "555-555-2222"
  },
  "selected_seats": ${seats_json},
  "special_requests": ""
}
JSON
)"
}

set_request_pending_payment_refs() {
  local request_id="$1"
  ROOT_DIR_ENV="$ROOT_DIR" php -r 'if (!isset($_SERVER["REQUEST_METHOD"])) { $_SERVER["REQUEST_METHOD"] = "CLI"; } require getenv("ROOT_DIR_ENV") . "/backend/bootstrap.php"; $pdo = \Midway\Backend\Database::connection(); $stmt = $pdo->prepare("UPDATE seat_requests SET payment_provider = ?, payment_status = ?, payment_order_id = ?, payment_capture_id = ?, payment_updated_at = NOW(), updated_by = ?, change_note = ? WHERE id = ?"); $stmt->execute(["square", "pending", "verify-order-pending", "verify-capture-pending", "verify", "seed pending payment refs", (int) $argv[1]]);' "$request_id"
}

set_request_currency_invalid() {
  local request_id="$1"
  ROOT_DIR_ENV="$ROOT_DIR" php -r 'if (!isset($_SERVER["REQUEST_METHOD"])) { $_SERVER["REQUEST_METHOD"] = "CLI"; } require getenv("ROOT_DIR_ENV") . "/backend/bootstrap.php"; $pdo = \Midway\Backend\Database::connection(); $stmt = $pdo->prepare("UPDATE seat_requests SET currency = ?, updated_by = ?, change_note = ? WHERE id = ?"); $stmt->execute(["US", "verify", "seed invalid currency for payment authority verify", (int) $argv[1]]);' "$request_id"
}

set_request_hold_past() {
  local request_id="$1"
  ROOT_DIR_ENV="$ROOT_DIR" php -r 'if (!isset($_SERVER["REQUEST_METHOD"])) { $_SERVER["REQUEST_METHOD"] = "CLI"; } require getenv("ROOT_DIR_ENV") . "/backend/bootstrap.php"; $pdo = \Midway\Backend\Database::connection(); $stmt = $pdo->prepare("UPDATE seat_requests SET hold_expires_at = DATE_SUB(NOW(), INTERVAL 2 DAY), updated_by = ?, change_note = ? WHERE id = ?"); $stmt->execute(["verify", "seed expired hold for paid-request verify state", (int) $argv[1]]);' "$request_id"
}

mark_request_unpaid_expired() {
  local request_id="$1"
  ROOT_DIR_ENV="$ROOT_DIR" php -r 'if (!isset($_SERVER["REQUEST_METHOD"])) { $_SERVER["REQUEST_METHOD"] = "CLI"; } require getenv("ROOT_DIR_ENV") . "/backend/bootstrap.php"; $pdo = \Midway\Backend\Database::connection(); $stmt = $pdo->prepare("UPDATE seat_requests SET status = ?, hold_expires_at = DATE_SUB(NOW(), INTERVAL 2 DAY), updated_by = ?, change_note = ? WHERE id = ?"); $stmt->execute(["waiting", "verify", "seed expired unpaid hold verify state", (int) $argv[1]]);' "$request_id"
}

admin_login

log_step "[payment-authority-foundation] checking schema capabilities"
schema_json="$(admin_get_json "/debug/schema-check")"
for field in has_seat_request_payment_provider has_seat_request_payment_status has_seat_request_payment_order_id has_seat_request_payment_capture_id has_seat_request_payment_updated_at; do
  value="$(json_field "$schema_json" "$field")"
  if [ "$value" != "true" ]; then
    log_error "schema missing ${field}; run database/20251212_schema_upgrade.sql"
    exit 1
  fi
done
if [ "$(json_field "$schema_json" "has_payment_provider_type_square")" != "true" ]; then
  log_error "payment_settings.provider_type does not support square; run database/20251212_schema_upgrade.sql"
  exit 1
fi

log_step "[payment-authority-foundation] selecting active category and enabling dynamic Square payment"
category_json="$(admin_get_json "/event-categories")"
target_category_id="$(CATEGORY_JSON="$category_json" python3 - <<'PY'
import json
import os

for item in json.loads(os.environ.get('CATEGORY_JSON', '{}')).get('categories', []):
    if item.get('is_active', 1):
        print(item.get('id'))
        break
PY
)"
if [ -z "$target_category_id" ]; then
  log_error "no active categories available for payment authority verification"
  exit 1
fi

log_step "[payment-authority-foundation] starting Square verify stub and applying temporary backend env overrides"
start_square_stub
configure_square_verify_env

payment_json="$(admin_get_json "/admin/payment-settings")"
original_payment_config_b64="$(PAYMENT_JSON="$payment_json" python3 - "$target_category_id" <<'PY'
import base64
import json
import os
import sys

data = json.loads(os.environ.get('PAYMENT_JSON', '{}'))
target = sys.argv[1]
for item in data.get('payment_settings', []):
    if (
        str(item.get('category_id')) == str(target)
        and item.get('scope') == 'category'
        and str(item.get('provider_type') or '') == 'square'
    ):
        print(base64.b64encode(json.dumps(item).encode()).decode())
        break
else:
    print('')
PY
)"

payment_payload="$(cat <<JSON
{
  "scope": "category",
  "category_id": ${target_category_id},
  "enabled": true,
  "provider_type": "square",
  "payment_url": "",
  "paypal_currency": "USD",
  "button_text": "Pay Online",
  "limit_seats": 6,
  "over_limit_message": "",
  "fine_print": "",
  "provider_label": "Square"
}
JSON
)"
admin_post_json "PUT" "/admin/payment-settings" "$payment_payload" >/dev/null
restore_config_needed=1

log_step "[payment-authority-foundation] creating temporary seating layout"
layout_payload='{"name":"Verify Payment Authority Layout","description":"verify","is_default":false,"layout_data":[{"id":"verify-table-19","element_type":"table","section_name":"Verify","row_label":"19","total_seats":2,"table_shape":"table-2","is_active":true},{"id":"verify-table-20","element_type":"table","section_name":"Verify","row_label":"20","total_seats":2,"table_shape":"table-2","is_active":true},{"id":"verify-table-21","element_type":"table","section_name":"Verify","row_label":"21","total_seats":2,"table_shape":"table-2","is_active":true}],"canvas_settings":{"width":1000,"height":700}}'
layout_json="$(admin_post_json "POST" "/seating-layouts" "$layout_payload")"
created_layout_id="$(json_field "$layout_json" "id")"
if [ -z "$created_layout_id" ] || [ "$created_layout_id" = "null" ]; then
  log_error "failed to create verification layout"
  exit 1
fi

log_step "[payment-authority-foundation] creating priced and unpriced events"
priced_event_id="$(create_event "Verify Payment Authority Priced ${auto_now}" "15.00")"
unpriced_event_id="$(create_event "Verify Payment Authority Unpriced ${auto_now}" "null")"

log_step "[payment-authority-foundation] verifying request creation stores authoritative totals and valid payment summary"
priced_request_json="$(submit_request "$priced_event_id" "payment-authority-priced@example.com" '["Verify-19-1"]')"
priced_request_id="$(json_field "$priced_request_json" "seat_request.id")"
priced_payment_access_token="$(payment_access_token_from_request_json "$priced_request_json")"
if [ -z "$priced_request_id" ] || [ "$priced_request_id" = "null" ]; then
  log_error "failed to create priced seat request: $priced_request_json"
  exit 1
fi
if [ -z "$priced_payment_access_token" ] || [ "$priced_payment_access_token" = "null" ]; then
  log_error "priced request did not include a payment access token"
  exit 1
fi
if [ "$(json_field "$priced_request_json" "seat_request.total_amount")" != "15.00" ]; then
  log_error "priced request total_amount was not stored as 15.00"
  exit 1
fi
if [ "$(json_field "$priced_request_json" "seat_request.currency")" != "USD" ]; then
  log_error "priced request currency was not stored as USD"
  exit 1
fi
if [ "$(json_field "$priced_request_json" "seat_request.payment_summary.can_offer_payment")" != "true" ]; then
  log_error "priced request payment_summary did not allow payment"
  exit 1
fi

public_post_with_status "/seat-requests/${priced_request_id}/payment/start"
if [ "$LAST_STATUS" != "403" ] || [ "$(json_field "$LAST_BODY" "code")" != "PAYMENT_ACCESS_DENIED" ]; then
  log_error "payment/start did not reject a missing payment access token: ${LAST_BODY}"
  exit 1
fi
public_post_with_status "/seat-requests/${priced_request_id}/payment/start" "$(payment_start_payload "$priced_payment_access_token")"
if [ "$LAST_STATUS" != "200" ]; then
  log_error "expected payment/start to succeed for valid Square-backed request, got ${LAST_STATUS}: ${LAST_BODY}"
  exit 1
fi
if [ "$(json_field "$LAST_BODY" "success")" != "true" ] \
  || [ "$(json_field "$LAST_BODY" "provider_type")" != "square" ] \
  || [ "$(json_field "$LAST_BODY" "checkout_url")" = "null" ]; then
  log_error "valid Square payment/start response was missing expected checkout details: ${LAST_BODY}"
  exit 1
fi
priced_requests_after_start="$(admin_get_json "/seat-requests?event_id=${priced_event_id}&status=all")"
priced_request_after_start="$(request_json_by_id "$priced_requests_after_start" "$priced_request_id")"
if [ "$(json_field "$priced_request_after_start" "payment_provider")" != "square" ] \
  || [ "$(json_field "$priced_request_after_start" "payment_status")" != "pending" ] \
  || [ "$(json_field "$priced_request_after_start" "payment_order_id")" = "null" ] \
  || [ "$(json_field "$priced_request_after_start" "payment_capture_id")" = "null" ]; then
  log_error "Square payment start did not persist pending provider references onto the seat request: ${priced_request_after_start}"
  exit 1
fi

log_step "[payment-authority-foundation] verifying admin seat edits recompute totals and invalidate stale payment refs"
set_request_pending_payment_refs "$priced_request_id"
admin_post_json "PUT" "/seat-requests/${priced_request_id}" '{"selected_seats":["Verify-19-1","Verify-19-2"]}' >/dev/null
priced_requests_json="$(admin_get_json "/seat-requests?event_id=${priced_event_id}&status=all")"
priced_request_after_update="$(request_json_by_id "$priced_requests_json" "$priced_request_id")"
if [ "$(json_field "$priced_request_after_update" "total_amount")" != "30.00" ]; then
  log_error "admin seat edit did not recompute total_amount to 30.00: ${priced_request_after_update}"
  exit 1
fi
if [ "$(json_field "$priced_request_after_update" "payment_status")" != "invalidated" ]; then
  log_error "admin seat edit did not invalidate stale payment_status: ${priced_request_after_update}"
  exit 1
fi
for field in payment_provider payment_order_id payment_capture_id; do
  if [ "$(json_field "$priced_request_after_update" "${field}")" != "null" ]; then
    log_error "admin seat edit did not clear ${field}: ${priced_request_after_update}"
    exit 1
  fi
done
public_post_with_status "/seat-requests/${priced_request_id}/payment/start" "$(payment_start_payload "$priced_payment_access_token")"
if [ "$LAST_STATUS" != "200" ] \
  || [ "$(json_field "$LAST_BODY" "provider_type")" != "square" ] \
  || [ "$(json_field "$LAST_BODY" "checkout_url")" = "null" ]; then
  log_error "updated request did not restart Square checkout successfully after invalidation: ${LAST_BODY}"
  exit 1
fi

log_step "[payment-authority-foundation] verifying invalid amount blocks payment start"
unpriced_request_json="$(submit_request "$unpriced_event_id" "payment-authority-unpriced@example.com" '["Verify-19-1"]')"
unpriced_request_id="$(json_field "$unpriced_request_json" "seat_request.id")"
unpriced_payment_access_token="$(payment_access_token_from_request_json "$unpriced_request_json")"
if [ -z "$unpriced_request_id" ] || [ "$unpriced_request_id" = "null" ]; then
  log_error "failed to create unpriced seat request: $unpriced_request_json"
  exit 1
fi
if [ "$(json_field "$unpriced_request_json" "seat_request.total_amount")" != "null" ]; then
  log_error "expected unpriced request total_amount to remain null"
  exit 1
fi
public_post_with_status "/seat-requests/${unpriced_request_id}/payment/start" "$(payment_start_payload "$unpriced_payment_access_token")"
if [ "$LAST_STATUS" != "422" ] || [ "$(json_field "$LAST_BODY" "code")" != "PAYMENT_AMOUNT_INVALID" ]; then
  log_error "invalid amount was not blocked by payment/start: ${LAST_BODY}"
  exit 1
fi

log_step "[payment-authority-foundation] verifying invalid currency blocks payment start"
currency_request_json="$(submit_request "$priced_event_id" "payment-authority-currency@example.com" '["Verify-20-1"]')"
currency_request_id="$(json_field "$currency_request_json" "seat_request.id")"
currency_payment_access_token="$(payment_access_token_from_request_json "$currency_request_json")"
if [ -z "$currency_request_id" ] || [ "$currency_request_id" = "null" ]; then
  log_error "failed to create currency verification seat request: $currency_request_json"
  exit 1
fi
set_request_currency_invalid "$currency_request_id"
public_post_with_status "/seat-requests/${currency_request_id}/payment/start" "$(payment_start_payload "$currency_payment_access_token")"
if [ "$LAST_STATUS" != "422" ] || [ "$(json_field "$LAST_BODY" "code")" != "PAYMENT_CURRENCY_INVALID" ]; then
  log_error "invalid currency was not blocked by payment/start: ${LAST_BODY}"
  exit 1
fi

log_step "[payment-authority-foundation] reconciling a Square-backed paid request and preparing unpaid-expired comparison"
paid_request_json="$(submit_request "$priced_event_id" "payment-authority-paid@example.com" '["Verify-20-2"]')"
paid_request_id="$(json_field "$paid_request_json" "seat_request.id")"
paid_payment_access_token="$(payment_access_token_from_request_json "$paid_request_json")"
if [ -z "$paid_request_id" ] || [ "$paid_request_id" = "null" ]; then
  log_error "failed to create paid-pending seat request: $paid_request_json"
  exit 1
fi
public_post_with_status "/seat-requests/${paid_request_id}/payment/start" "$(payment_start_payload "$paid_payment_access_token")"
if [ "$LAST_STATUS" != "200" ] \
  || [ "$(json_field "$LAST_BODY" "provider_type")" != "square" ] \
  || [ "$(json_field "$LAST_BODY" "checkout_url")" = "null" ]; then
  log_error "paid-request Square checkout did not start successfully: ${LAST_BODY}"
  exit 1
fi
paid_request_before_webhook="$(request_json_by_id "$(admin_get_json "/seat-requests?event_id=${priced_event_id}&status=all")" "$paid_request_id")"
paid_request_order_id="$(json_field "$paid_request_before_webhook" "payment_order_id")"
if [ -z "$paid_request_order_id" ] || [ "$paid_request_order_id" = "null" ]; then
  log_error "paid-request Square checkout did not store an order id before webhook reconciliation: ${paid_request_before_webhook}"
  exit 1
fi
post_square_webhook "$paid_request_order_id" "verify-payment-completed-${auto_now}"
set_request_hold_past "$paid_request_id"

approved_request_json="$(submit_request "$priced_event_id" "payment-authority-approved@example.com" '["Verify-21-1"]')"
approved_request_id="$(json_field "$approved_request_json" "seat_request.id")"
if [ -z "$approved_request_id" ] || [ "$approved_request_id" = "null" ]; then
  log_error "failed to create approval verification seat request: $approved_request_json"
  exit 1
fi
admin_post_json "POST" "/seat-requests/${approved_request_id}/approve" '{}' >/dev/null

expired_request_json="$(submit_request "$priced_event_id" "payment-authority-expired@example.com" '["Verify-21-2"]')"
expired_request_id="$(json_field "$expired_request_json" "seat_request.id")"
if [ -z "$expired_request_id" ] || [ "$expired_request_id" = "null" ]; then
  log_error "failed to create unpaid expiry verification seat request: $expired_request_json"
  exit 1
fi
mark_request_unpaid_expired "$expired_request_id"

log_step "[payment-authority-foundation] verifying paid requests stop expiring while unpaid stale requests still expire"
priced_requests_json="$(admin_get_json "/seat-requests?event_id=${priced_event_id}&status=all")"
paid_request_after_seed="$(request_json_by_id "$priced_requests_json" "$paid_request_id")"
approved_request_after_approve="$(request_json_by_id "$priced_requests_json" "$approved_request_id")"
expired_request_after_seed="$(request_json_by_id "$priced_requests_json" "$expired_request_id")"
paid_request_status="$(json_field "$paid_request_after_seed" "status")"
if [ "$paid_request_status" = "expired" ] || [ "$paid_request_status" = "confirmed" ] || [ "$paid_request_status" = "closed" ] || [ "$paid_request_status" = "declined" ] || [ "$paid_request_status" = "spam" ]; then
  log_error "paid request did not remain open after stale hold expiry: ${paid_request_after_seed}"
  exit 1
fi
if [ "$(json_field "$paid_request_after_seed" "payment_provider")" != "square" ] \
  || [ "$(json_field "$paid_request_after_seed" "payment_status")" != "paid" ] \
  || [ "$(json_field "$paid_request_after_seed" "payment_capture_id")" != "verify-payment-completed-${auto_now}" ]; then
  log_error "Square webhook reconciliation did not persist the expected paid payment fields: ${paid_request_after_seed}"
  exit 1
fi
if [ "$(json_field "$paid_request_after_seed" "payment_paid_pending_confirmation")" != "true" ]; then
  log_error "paid request was not marked as paid pending confirmation: ${paid_request_after_seed}"
  exit 1
fi
if [ "$(json_field "$paid_request_after_seed" "payment_expires_normally")" != "false" ]; then
  log_error "paid request still appears to expire normally: ${paid_request_after_seed}"
  exit 1
fi
if [ "$(json_field "$approved_request_after_approve" "status")" != "confirmed" ]; then
  log_error "approved request did not stay confirmed: ${approved_request_after_approve}"
  exit 1
fi
if [ "$(json_field "$expired_request_after_seed" "status")" != "expired" ]; then
  log_error "unpaid stale request did not auto-expire: ${expired_request_after_seed}"
  exit 1
fi

public_post_with_status "/seat-requests/${paid_request_id}/payment/start" "$(payment_start_payload "$paid_payment_access_token")"
if [ "$LAST_STATUS" != "409" ] || [ "$(json_field "$LAST_BODY" "code")" != "PAYMENT_ALREADY_COMPLETED" ]; then
  log_error "paid request was not blocked from re-starting payment: ${LAST_BODY}"
  exit 1
fi

log_step "[payment-authority-foundation] verifying seating integrity remains correct across paid, unpaid, expired, and approved states"
seating_json="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/seating/event/${priced_event_id}")"
if [ "$(json_array_contains "$seating_json" "pendingSeats" "Verify-20-2")" != "1" ]; then
  log_error "paid pending request no longer blocks its seat in pendingSeats: ${seating_json}"
  exit 1
fi
if [ "$(json_array_contains "$seating_json" "pendingSeats" "Verify-21-2")" != "0" ]; then
  log_error "expired unpaid request still blocks its seat in pendingSeats: ${seating_json}"
  exit 1
fi
if [ "$(json_array_contains "$seating_json" "reservedSeats" "Verify-21-1")" != "1" ]; then
  log_error "approved request did not reserve its seat: ${seating_json}"
  exit 1
fi

log_success "[payment-authority-foundation] Square payment start, webhook reconciliation, total authority, stale payment invalidation, non-expiring paid state, and existing approval flow verified"
cat <<'CHECKLIST'
[payment-authority-foundation] MANUAL QA CHECKLIST
1. Open Seat Requests admin for a request with `status=waiting` and `payment_status=paid`; confirm it shows a distinct "Paid / pending confirmation" state.
2. Open that request's detail modal; confirm the hold controls are disabled and the UI explains the request no longer expires after payment.
3. Submit a public seat request for an event without valid pricing; confirm the post-submit panel does not offer pay-now actions and instead shows the server-provided block reason.
4. Submit a public seat request for a priced event; confirm post-submit payment UI still appears without requiring staff to send a manual link and that a completed Square payment leaves the request pending staff confirmation instead of auto-confirming seats.
CHECKLIST
