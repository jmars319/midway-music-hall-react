#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

API_BASE="$(backend_url)/api"

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

log_step "[payment-post-submit] locating a seating-enabled event"
event_payload="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/events?scope=public")"
seating_event_id="$(EVENTS_JSON="$event_payload" python3 - <<'PY'
import json
import os

data = json.loads(os.environ.get('EVENTS_JSON', '{}'))
for event in data.get('events', []):
    if int(event.get('seating_enabled') or 0) != 1:
        continue
    if not event.get('layout_id') and not event.get('layout_version_id'):
        continue
    print(event.get('id'))
    break
PY
)"

if [ -z "$seating_event_id" ]; then
  log_error "no seating-enabled event found via /api/events?scope=public"
  exit 1
fi

seating_payload="$(curl -fsS -H 'Accept: application/json' "${API_BASE}/seating/event/${seating_event_id}")"
seating_ok="$(SEATING_JSON="$seating_payload" python3 - <<'PY'
import json
import os

data = json.loads(os.environ.get('SEATING_JSON', '{}'))
print('1' if data.get('success') else '0')
PY
)"
if [ "$seating_ok" != "1" ]; then
  log_error "seating endpoint failed for event ${seating_event_id}"
  exit 1
fi

log_success "[payment-post-submit] API and source gates look valid"
cat <<'CHECKLIST'
[payment-post-submit] MANUAL CHECKLIST
1. Open a payment-enabled, seating-enabled event on the public site.
2. Select seats and continue to contact form.
3. Confirm no actionable payment button is visible before submitting.
4. Submit the seat request.
5. Confirm success state appears and payment panel is now actionable.
6. Confirm "Amount due" appears when total_amount is present in the response.
7. Confirm over-limit copy still appears when seat count exceeds configured payment limit.
CHECKLIST
