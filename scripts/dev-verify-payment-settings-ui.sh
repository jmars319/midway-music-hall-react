#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

printf '%s\n' "[payment-settings-ui] verifying Square-first admin payment messaging"

if ! grep -q "Square readiness" "$ROOT_DIR/frontend/src/admin/PaymentSettingsModule.js"; then
  fail "PaymentSettingsModule is missing the Square readiness panel"
fi

if ! grep -q "Square secrets stay in backend environment settings" "$ROOT_DIR/frontend/src/admin/PaymentSettingsModule.js"; then
  fail "PaymentSettingsModule is missing the backend-env Square guidance"
fi

if ! grep -q "Square hosted checkout" "$ROOT_DIR/frontend/src/admin/PaymentSettingsModule.js"; then
  fail "PaymentSettingsModule is missing the Square hosted checkout option"
fi

if ! grep -q "External payment link" "$ROOT_DIR/frontend/src/admin/PaymentSettingsModule.js"; then
  fail "PaymentSettingsModule is missing the external payment link fallback option"
fi

if ! grep -q "square_status" "$ROOT_DIR/backend/index.php"; then
  fail "backend payment settings endpoint is missing Square status metadata"
fi

if ! grep -q "ready_to_enable" "$ROOT_DIR/backend/index.php"; then
  fail "backend Square readiness metadata is incomplete"
fi

printf '%s\n' "[payment-settings-ui] verification succeeded"
