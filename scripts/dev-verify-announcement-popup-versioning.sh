#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

POPUP_FILE="$ROOT_DIR/frontend/src/components/AnnouncementPopup.js"

log_step "[popup-versioning] verifying versioned localStorage dismissal key"
if ! rg -n "POPUP_DISMISS_KEY_PREFIX" "$POPUP_FILE" >/dev/null; then
  log_error "POPUP_DISMISS_KEY_PREFIX is missing"
  exit 1
fi
if ! rg -n "popupVersionHash|dismissStorageKey" "$POPUP_FILE" >/dev/null; then
  log_error "popup version/hash helpers are missing"
  exit 1
fi
if ! rg -n "window\.localStorage\.setItem\(popupDismissKey" "$POPUP_FILE" >/dev/null; then
  log_error "dismiss action is not writing to versioned popupDismissKey"
  exit 1
fi

log_step "[popup-versioning] verifying synchronous modal suppression and no polling"
if ! rg -n "useLayoutEffect" "$POPUP_FILE" >/dev/null; then
  log_error "useLayoutEffect modal suppression check is missing"
  exit 1
fi
if ! rg -n "hasAnyModalOpen\(\)|shouldBlockForOpenDialogs\(" "$POPUP_FILE" >/dev/null; then
  log_error "popup does not synchronously check for open dialog state"
  exit 1
fi
if rg -n "setInterval|250" "$POPUP_FILE" >/dev/null; then
  log_error "polling loop detected; expected MutationObserver-based suppression only"
  exit 1
fi
if ! rg -n "new MutationObserver" "$POPUP_FILE" >/dev/null; then
  log_error "MutationObserver suppression wiring is missing"
  exit 1
fi

log_step "[popup-versioning] verifying anti-thrash guards"
if ! rg -n "isOpenLatched|setIsOpenLatched" "$POPUP_FILE" >/dev/null; then
  log_error "open latch anti-thrash guard is missing"
  exit 1
fi
if ! rg -n "data-announcement-popup-dialog|POPUP_DIALOG_DATA_ATTR" "$POPUP_FILE" >/dev/null; then
  log_error "popup self-dialog exclusion marker is missing"
  exit 1
fi
if ! rg -n "data-announcement-popup-backdrop" "$POPUP_FILE" >/dev/null; then
  log_error "popup backdrop marker is missing"
  exit 1
fi

log_step "[popup-versioning] running popup stability harness"
( cd "$ROOT_DIR/frontend" && CI=true npm test -- --watch=false --runInBand src/components/__tests__/AnnouncementPopup.stability.test.js )

log_success "[popup-versioning] versioned cooldown + stable modal suppression verified"
