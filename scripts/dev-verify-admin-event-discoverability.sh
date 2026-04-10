#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

log() {
  printf '%s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

log "[admin-event-discoverability] verifying admin shortcuts and lessons editing guidance"

if ! grep -q "Jump by event type" "$ROOT_DIR/frontend/src/admin/EventsModule.js"; then
  fail "EventsModule is missing the quick access heading"
fi

if ! grep -q "Edit public lessons section" "$ROOT_DIR/frontend/src/admin/EventsModule.js"; then
  fail "EventsModule is missing the lessons manager shortcut"
fi

if ! grep -q "Normal <span" "$ROOT_DIR/frontend/src/admin/EventsModule.js" && ! grep -q "name: priorityLabels\\[slug\\]" "$ROOT_DIR/frontend/src/admin/EventsModule.js"; then
  fail "EventsModule is missing the explicit Normal quick-access filter support"
fi

if ! grep -q "Site Content & Lessons" "$ROOT_DIR/frontend/src/admin/AdminPanel.js"; then
  fail "Admin navigation is missing the Site Content & Lessons label"
fi

if ! grep -q "Public lessons are edited here" "$ROOT_DIR/frontend/src/admin/SiteContentModule.js"; then
  fail "SiteContentModule is missing the lessons editing guidance"
fi

if ! grep -q "site-content-lessons" "$ROOT_DIR/frontend/src/admin/SiteContentModule.js"; then
  fail "SiteContentModule is missing the lessons anchor for admin jump navigation"
fi

log "[admin-event-discoverability] verifying recurring and lessons data are not hardcoded to specific shows"

if grep -q "MANUAL_RECURRING_OVERRIDES" "$ROOT_DIR/frontend/src/utils/recurringSeriesDisplay.js"; then
  fail "recurringSeriesDisplay.js still contains manual recurring overrides"
fi

if grep -q "getLegacyRecurringSeriesOverride" "$ROOT_DIR/frontend/src/utils/recurringSeriesDisplay.js"; then
  fail "recurringSeriesDisplay.js still contains the legacy recurring override helper"
fi

if grep -q "buildManualRecurringSeries" "$ROOT_DIR/frontend/src/pages/HomePage.js"; then
  fail "HomePage.js still contains the manual recurring series builder"
fi

if ! grep -q "buildRecurringCategoryFallbackSeries" "$ROOT_DIR/frontend/src/pages/HomePage.js"; then
  fail "HomePage.js is missing the generic recurring fallback grouping"
fi

if ! grep -q "lessons: \\[\\]" "$ROOT_DIR/frontend/src/hooks/useSiteContent.js"; then
  fail "useSiteContent still seeds lessons with hardcoded defaults"
fi

if ! grep -q "decode_settings_json(\$settings, 'lessons_json', \\[\\])" "$ROOT_DIR/backend/index.php"; then
  fail "backend site-content endpoint is not using an empty lessons fallback"
fi

log "[admin-event-discoverability] verifying delete safety guardrails"

if ! grep -q "Recurring series and generated series dates should be managed with series controls" "$ROOT_DIR/frontend/src/admin/EventsModule.js"; then
  fail "EventsModule is missing the recurring delete safety guard"
fi

if ! grep -q "Unpublish this event before deleting it" "$ROOT_DIR/frontend/src/admin/EventsModule.js"; then
  fail "EventsModule is missing the published-event delete safety guard"
fi

log "[admin-event-discoverability] verification succeeded"
