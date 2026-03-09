#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/dev-common.sh"

log_step "[event-datetime-input] verifying helper parsing and admin form wiring"

node --no-warnings --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const helperPath = path.join(rootDir, 'frontend', 'src', 'utils', 'adminEventDateTimeInput.js');
const eventsModulePath = path.join(rootDir, 'frontend', 'src', 'admin', 'EventsModule.js');

const helper = await import(pathToFileURL(helperPath).href);

const assertEqual = (label, actual, expected) => {
  if (actual !== expected) {
    throw new Error(`${label} expected "${expected}" but got "${actual}"`);
  }
};

const assertNull = (label, actual) => {
  if (actual !== null) {
    throw new Error(`${label} expected null but got "${actual}"`);
  }
};

assertEqual('parseFriendlyEventDate 03/19/2026', helper.parseFriendlyEventDate('03/19/2026'), '2026-03-19');
assertEqual('parseFriendlyEventDate 3/19/2026', helper.parseFriendlyEventDate('3/19/2026'), '2026-03-19');
assertNull('parseFriendlyEventDate 13/40/2026', helper.parseFriendlyEventDate('13/40/2026'));

assertEqual('parseFriendlyEventTime 7:00 PM', helper.parseFriendlyEventTime('7:00 PM'), '19:00:00');
assertEqual('parseFriendlyEventTime 7:00pm', helper.parseFriendlyEventTime('7:00pm'), '19:00:00');
assertNull('parseFriendlyEventTime 7:61 PM', helper.parseFriendlyEventTime('7:61 PM'));
assertNull('parseFriendlyEventTime 13:00 PM', helper.parseFriendlyEventTime('13:00 PM'));

const source = fs.readFileSync(eventsModulePath, 'utf8');

if (source.includes('type="date"') || source.includes('type="time"')) {
  throw new Error('EventsModule still contains native type="date"/"time" inputs');
}
if (!source.includes('<form noValidate onSubmit={handleSubmit}')) {
  throw new Error('Add Event form must disable browser-native validation via noValidate');
}
if (!source.includes("SCHEDULE_VALIDATION_SUMMARY = 'Please fix the highlighted fields.'")) {
  throw new Error('Missing top-level validation summary copy');
}
if (!source.includes("DATE_INPUT_ERROR = 'Use MM/DD/YYYY'")) {
  throw new Error('Missing date field-specific validation copy');
}
if (!source.includes("TIME_INPUT_ERROR = 'Use h:mm AM/PM (example: 7:00 PM)'")) {
  throw new Error('Missing time field-specific validation copy');
}

const requiredSnippets = [
  'name="event_date"',
  'placeholder="MM/DD/YYYY"',
  "aria-invalid={fieldErrors.event_date ? 'true' : 'false'}",
  "aria-describedby={fieldErrors.event_date ? 'event-date-error' : undefined}",
  'name="event_time"',
  'placeholder="h:mm AM/PM"',
  "aria-invalid={fieldErrors.event_time ? 'true' : 'false'}",
  "aria-describedby={fieldErrors.event_time ? 'event-time-error' : undefined}",
  'name="door_time"',
  "aria-invalid={fieldErrors.door_time ? 'true' : 'false'}",
  "aria-describedby={fieldErrors.door_time ? 'door-time-help door-time-error' : 'door-time-help'}",
  'payload.event_date = parsedEventDate;',
  'payload.event_time = parsedEventTime;',
  'payload.door_time = `${parsedEventDate} ${parsedDoorTime}`;',
  'setFieldErrors(nextFieldErrors);',
  'setError(SCHEDULE_VALIDATION_SUMMARY);',
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`EventsModule missing required snippet: ${snippet}`);
  }
}

console.log('[event-datetime-input] checks passed');
NODE

log_success "[event-datetime-input] verification complete"
