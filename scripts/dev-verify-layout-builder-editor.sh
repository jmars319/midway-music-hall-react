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
if ! rg -n "startPointerDrag" "$ROOT_DIR/frontend/src/admin/LayoutsModule.js" >/dev/null; then
  log_error "[layout-builder] pointer drag helper is missing from LayoutsModule"
  exit 1
fi
if ! rg -n "handleRowPointerDown" "$ROOT_DIR/frontend/src/admin/LayoutsModule.js" >/dev/null; then
  log_error "[layout-builder] seating objects are not wired to pointer drag"
  exit 1
fi
if ! rg -n "handleStagePointerDown" "$ROOT_DIR/frontend/src/admin/LayoutsModule.js" >/dev/null; then
  log_error "[layout-builder] stage is not wired to pointer drag"
  exit 1
fi
if rg -n "onDragStart|draggable|onDrop|onDragOver" "$ROOT_DIR/frontend/src/admin/LayoutsModule.js" >/dev/null; then
  log_error "[layout-builder] native HTML drag/drop handlers should not be used for editor movement"
  exit 1
fi
if rg -n "SeatingModule" "$ROOT_DIR/frontend/src/admin/index.js" "$ROOT_DIR/frontend/src/admin/AdminPanel.js" >/dev/null; then
  log_error "[layout-builder] legacy SeatingModule should not be exported from the admin barrel or mounted in AdminPanel"
  exit 1
fi

log_step "[layout-builder] verifying rotated labels are rendered upright"
if ! rg -n "textRotation = 0" "$ROOT_DIR/frontend/src/components/TableComponent.js" >/dev/null; then
  log_error "[layout-builder] TableComponent does not accept textRotation"
  exit 1
fi
if ! rg -n -F 'textRotationStyle = textRotation ? { transform: `rotate(${textRotation}deg)` } : null' "$ROOT_DIR/frontend/src/components/TableComponent.js" >/dev/null; then
  log_error "[layout-builder] TableComponent is missing the shared counter-rotation style"
  exit 1
fi
if ! rg -n "textRotationStyle \\|\\| undefined" "$ROOT_DIR/frontend/src/components/TableComponent.js" >/dev/null; then
  log_error "[layout-builder] TableComponent is not applying counter-rotation to seat status badges"
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

cat <<'CHECKLIST'
[layout-builder] MANUAL CHECKLIST
1. Open Admin > Layouts and select a rotated table or row object.
2. Edit Section, Row Label, and at least one Seat Label in the sidebar.
   Pass: the selected object stays selected while typing and each field remains editable.
3. Save the layout and reload the editor.
   Pass: the updated Section, Row Label, and Seat Labels persist after reload.
4. Rotate the same object to 90, 180, and 270 degrees.
   Pass: seat labels and row/table labels stay upright and readable.
5. Drag the object after editing and rotate it again.
   Pass: drag/rotate/placement behavior is unchanged after the label edits.
CHECKLIST
