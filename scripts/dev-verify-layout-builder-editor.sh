#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

log_error() {
  printf 'ERROR %s\n' "$1" >&2
}

log_step() {
  printf '==> %s\n' "$1"
}

log_success() {
  printf 'OK %s\n' "$1"
}

log_step "[layout-builder] verifying selected-object editor bindings stay mounted while editing"
if ! rg -n "editorShellRef" "$ROOT_DIR/frontend/src/admin/LayoutsModule.js" >/dev/null; then
  log_error "[layout-builder] editorShellRef guard missing from LayoutsModule"
  exit 1
fi
if ! rg -n "editorShellNode" "$ROOT_DIR/frontend/src/admin/LayoutsModule.js" >/dev/null; then
  log_error "[layout-builder] pointer handler is not checking the editor shell before clearing selection"
  exit 1
fi
if ! rg -n "updateRow\\(row\\.id, \\{ section_name: e\\.target\\.value \\}\\)" "$ROOT_DIR/frontend/src/admin/LayoutsModule.js" >/dev/null; then
  log_error "[layout-builder] Section field is not bound to updateRow"
  exit 1
fi
if ! rg -n "updateRow\\(row\\.id, \\{ row_label: e\\.target\\.value \\}\\)" "$ROOT_DIR/frontend/src/admin/LayoutsModule.js" >/dev/null; then
  log_error "[layout-builder] Row Label field is not bound to updateRow"
  exit 1
fi
if ! rg -n "updateSeatLabel\\(row\\.id, seatNumber, e\\.target\\.value\\)" "$ROOT_DIR/frontend/src/admin/LayoutsModule.js" >/dev/null; then
  log_error "[layout-builder] Seat Labels are not bound to updateSeatLabel"
  exit 1
fi

log_step "[layout-builder] verifying rotated labels are rendered upright"
if ! rg -n "textRotation = 0" "$ROOT_DIR/frontend/src/components/TableComponent.js" >/dev/null; then
  log_error "[layout-builder] TableComponent does not accept textRotation"
  exit 1
fi
if ! rg -n "textRotation=\\{-\\(draggingRow\\.rotation \\|\\| 0\\)\\}" "$ROOT_DIR/frontend/src/admin/LayoutsModule.js" >/dev/null; then
  log_error "[layout-builder] ghost table preview is not counter-rotating text"
  exit 1
fi
if ! rg -n "textRotation=\\{-\\(row\\.rotation \\|\\| 0\\)\\}" "$ROOT_DIR/frontend/src/admin/LayoutsModule.js" "$ROOT_DIR/frontend/src/components/SeatingChart.js" "$ROOT_DIR/frontend/src/components/EventSeatingModal.js" "$ROOT_DIR/frontend/src/admin/SeatRequestsModule.js" >/dev/null; then
  log_error "[layout-builder] one or more rotated seating surfaces are not counter-rotating text"
  exit 1
fi
if ! rg -n -F 'rotate(${-rotation}deg)' "$ROOT_DIR/frontend/src/admin/LayoutsModule.js" "$ROOT_DIR/frontend/src/components/SeatingChart.js" "$ROOT_DIR/frontend/src/admin/SeatRequestsModule.js" >/dev/null; then
  log_error "[layout-builder] rotated marker labels are not being kept upright"
  exit 1
fi

log_success "[layout-builder] selected-object bindings and upright label safeguards are present"
