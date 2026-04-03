#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cleanup() {
  bash ./scripts/dev-clean-verify-artifacts.sh >/dev/null 2>&1 || true
  bash ./scripts/dev-stop.sh >/dev/null 2>&1 || true
}
trap cleanup EXIT

bash ./scripts/dev-clean-verify-artifacts.sh

( cd frontend && npm run lint )
( cd frontend && npm run build )

bash ./scripts/dev-start.sh

scripts=(
  ./scripts/dev-verify-admin-api.sh
  ./scripts/dev-verify-payment-settings.sh
  ./scripts/dev-verify-paypal-hosted-buttons-api.sh
  ./scripts/dev-verify-seating-guardrails.sh
  ./scripts/dev-verify-table-layout-geometry.sh
  ./scripts/dev-verify-layout-canvas-presets.sh
  ./scripts/dev-verify-recurring-homepage.sh
  ./scripts/dev-verify-recurring-events-api.sh
  ./scripts/dev-verify-recurring-backcompat.sh
  ./scripts/dev-verify-event-images.sh
  ./scripts/dev-verify-public-surface.sh
  ./scripts/dev-verify-clearable-fields.sh
  ./scripts/dev-verify-event-reschedule.sh
  ./scripts/dev-verify-announcement-banner.sh
  ./scripts/dev-verify-announcement-popup-versioning.sh
  ./scripts/dev-verify-seat-request-event-name-sync.sh
  ./scripts/dev-verify-seat-marker-print.sh
  ./scripts/dev-verify-seat-label-utils.sh
  ./scripts/dev-verify-seating-hit-layering.sh
  ./scripts/dev-verify-seating-zoom-controls.sh
  ./scripts/dev-verify-seating-overlay-gating.sh
  ./scripts/dev-verify-payment-post-submit.sh
  ./scripts/dev-verify-payment-orders-scaffold.sh
  ./scripts/dev-verify-payment-authority-foundation.sh
  ./scripts/dev-verify-seat-request-amount.sh
  ./scripts/dev-verify-tiered-event-pricing.sh
  ./scripts/dev-verify-seating-tier-visibility.sh
  ./scripts/dev-verify-confirmation-email-send-once.sh
  ./scripts/dev-verify-event-create-defaults.sh
  ./scripts/dev-verify-admin-event-datetime-input.sh
  ./scripts/dev-verify-multi-day-events.sh
  ./scripts/dev-verify-seat-requests-hide-past-events.sh
  ./scripts/dev-verify-layout-builder-editor.sh
)

failed=0
for script in "${scripts[@]}"; do
  echo "===== RUN ${script} ====="
  if ! bash "$script"; then
    failed=1
    echo "===== FAIL ${script} ====="
  else
    echo "===== PASS ${script} ====="
  fi
  echo
done

if [ "$failed" -ne 0 ]; then
  echo "verify-all: one or more checks failed"
  exit 1
fi

echo "verify-all: all checks passed"
