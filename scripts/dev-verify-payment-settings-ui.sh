#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

printf '%s\n' "[payment-settings-ui] verifying multi-provider admin payment messaging"

if ! grep -q "Square readiness" "$ROOT_DIR/frontend/src/admin/PaymentSettingsModule.js"; then
  fail "PaymentSettingsModule is missing the Square readiness panel"
fi

if ! grep -q "PayPal readiness" "$ROOT_DIR/frontend/src/admin/PaymentSettingsModule.js"; then
  fail "PaymentSettingsModule is missing the PayPal readiness panel"
fi

if ! grep -q "Enable provider" "$ROOT_DIR/frontend/src/admin/PaymentSettingsModule.js"; then
  fail "PaymentSettingsModule is missing per-provider enable controls"
fi

if ! grep -q "PayPal Orders checkout" "$ROOT_DIR/frontend/src/admin/PaymentSettingsModule.js"; then
  fail "PaymentSettingsModule is missing the PayPal Orders provider card"
fi

if grep -q "Legacy PayPal" "$ROOT_DIR/frontend/src/admin/PaymentSettingsModule.js"; then
  fail "PaymentSettingsModule still exposes legacy PayPal hosted-button UI"
fi

if ! grep -q "Allow Cash App Pay inside Square checkout" "$ROOT_DIR/frontend/src/admin/PaymentSettingsModule.js"; then
  fail "PaymentSettingsModule is missing the Square Cash App Pay toggle"
fi

if ! grep -q "provider_scope_key" "$ROOT_DIR/backend/index.php"; then
  fail "backend payment settings endpoint is missing provider_scope_key support"
fi

if ! grep -q "paypal_status" "$ROOT_DIR/backend/index.php"; then
  fail "backend payment settings endpoint is missing PayPal readiness metadata"
fi

if ! grep -q "square_status" "$ROOT_DIR/backend/index.php"; then
  fail "backend payment settings endpoint is missing Square readiness metadata"
fi

printf '%s\n' "[payment-settings-ui] verification succeeded"
