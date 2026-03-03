#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

MODAL_FILE="$ROOT_DIR/frontend/src/components/EventSeatingModal.js"

log_step "[seating-overlay-gating] verifying Show seating chart gated path"
if ! rg -n "overlayOnlySeatChart" "$MODAL_FILE" >/dev/null; then
  log_error "overlayOnlySeatChart state missing"
  exit 1
fi
if ! rg -n "Show seating chart" "$MODAL_FILE" >/dev/null; then
  log_error "Show seating chart button path missing"
  exit 1
fi
if ! rg -n "seatSelectionContentRef|MIN_INLINE_MAP_HEIGHT" "$MODAL_FILE" >/dev/null; then
  log_error "DOM measurement gate for inline chart size missing"
  exit 1
fi

log_step "[seating-overlay-gating] verifying dialog semantics and keyboard close"
if ! rg -n "role=\"dialog\"" "$MODAL_FILE" >/dev/null; then
  log_error "dialog role missing on large-map overlay"
  exit 1
fi
if ! rg -n "aria-modal=\"true\"" "$MODAL_FILE" >/dev/null; then
  log_error "aria-modal=true missing on large-map overlay"
  exit 1
fi
if ! rg -n "event\.key === 'Escape'" "$MODAL_FILE" >/dev/null; then
  log_error "Escape-close handling missing for large-map overlay"
  exit 1
fi

log_step "[seating-overlay-gating] verifying single source of truth for seat selection"
if ! rg -n "const \[selectedSeats, setSelectedSeats\]" "$MODAL_FILE" >/dev/null; then
  log_error "selectedSeats state missing"
  exit 1
fi
if ! rg -n "renderSeatWorkspace\(\{ expanded: true \}\)|renderSeatWorkspace\(\)" "$MODAL_FILE" >/dev/null; then
  log_error "normal/overlay chart modes do not share renderSeatWorkspace"
  exit 1
fi

cat <<'CHECKLIST'
[seating-overlay-gating] MANUAL CHECKLIST
1. Open a seating-enabled event and launch EventSeatingModal.
2. In a narrow/mobile viewport, confirm inline map is replaced by "Show seating chart".
3. Open the chart, select seats, press "Confirm seats", and verify selection summary persists.
4. Continue to contact form and submit; confirm post-submit flow remains intact.
5. Verify Escape closes the large-map overlay on desktop.
6. Verify underlay controls cannot be interacted with while overlay is open.
CHECKLIST

log_success "[seating-overlay-gating] static gating checks passed"
