#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1090
. "$ROOT_DIR/scripts/script-utils.sh"

log_step "[recurring-audit] auditing existing recurrence rules for recurring-series compatibility"

AUDIT_JSON="$(
  ROOT_DIR="$ROOT_DIR" php <<'PHP'
<?php
if (!isset($_SERVER['REQUEST_METHOD'])) {
    $_SERVER['REQUEST_METHOD'] = 'CLI';
}

$rootDir = getenv('ROOT_DIR');
if (!$rootDir) {
    fwrite(STDERR, "ROOT_DIR is required\n");
    exit(2);
}

require $rootDir . '/backend/bootstrap.php';

$pdo = \Midway\Backend\Database::connection();

try {
    $pdo->query('SELECT 1 FROM event_recurrence_rules LIMIT 1');
} catch (Throwable $error) {
    echo json_encode([
        'error' => 'event_recurrence_rules table not available. Apply database/20251212_schema_upgrade.sql before auditing recurrence compatibility.',
    ]);
    exit(0);
}

function recurrence_weekday_map_for_audit(): array
{
    return [
        'SU' => 0,
        'SUN' => 0,
        'SUNDAY' => 0,
        'MO' => 1,
        'MON' => 1,
        'MONDAY' => 1,
        'TU' => 2,
        'TUE' => 2,
        'TUESDAY' => 2,
        'WE' => 3,
        'WED' => 3,
        'WEDNESDAY' => 3,
        'TH' => 4,
        'THU' => 4,
        'THURSDAY' => 4,
        'FR' => 5,
        'FRI' => 5,
        'FRIDAY' => 5,
        'SA' => 6,
        'SAT' => 6,
        'SATURDAY' => 6,
        '0' => 0,
        '1' => 1,
        '2' => 2,
        '3' => 3,
        '4' => 4,
        '5' => 5,
        '6' => 6,
    ];
}

function recurrence_weekday_tokens_for_audit(): array
{
    return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
}

function normalize_recurrence_weekday_tokens_for_audit($value): array
{
    if ($value === null || $value === '' || $value === false) {
        return [];
    }

    $queue = is_array($value) ? array_values($value) : [$value];
    $normalized = [];

    while ($queue) {
        $candidate = array_shift($queue);
        if ($candidate === null || $candidate === '' || $candidate === false) {
            continue;
        }
        if (is_array($candidate)) {
            foreach ($candidate as $nested) {
                $queue[] = $nested;
            }
            continue;
        }

        $raw = trim((string) $candidate);
        if ($raw === '') {
            continue;
        }

        if ($raw[0] === '[') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                foreach ($decoded as $nested) {
                    $queue[] = $nested;
                }
                continue;
            }
        }

        if (preg_match('/[\s,]/', $raw)) {
            foreach (preg_split('/[\s,]+/', $raw) ?: [] as $part) {
                if ($part !== '') {
                    $queue[] = $part;
                }
            }
            continue;
        }

        $candidateUpper = strtoupper($raw);
        $map = recurrence_weekday_map_for_audit();
        if (!array_key_exists($candidateUpper, $map)) {
            continue;
        }
        $tokens = recurrence_weekday_tokens_for_audit();
        $token = $tokens[$map[$candidateUpper]] ?? null;
        if ($token !== null) {
            $normalized[$token] = $map[$candidateUpper];
        }
    }

    $tokens = array_keys($normalized);
    usort($tokens, static function (string $left, string $right): int {
        $map = array_flip(recurrence_weekday_tokens_for_audit());
        return ($map[$left] ?? 0) <=> ($map[$right] ?? 0);
    });
    return array_values($tokens);
}

function weekday_payload_tokens_for_audit(array $row): array
{
    $payload = [];
    if (!empty($row['rule_payload'])) {
        $decoded = json_decode((string) $row['rule_payload'], true);
        if (is_array($decoded)) {
            $payload = $decoded;
        }
    }

    foreach (['byweekday_set', 'byweekday'] as $key) {
        if (array_key_exists($key, $payload)) {
            $tokens = normalize_recurrence_weekday_tokens_for_audit($payload[$key]);
            if ($tokens) {
                return $tokens;
            }
        }
    }

    return [];
}

function monthday_values_for_audit($value): array
{
    if ($value === null || $value === '' || $value === false) {
        return [];
    }
    $queue = is_array($value) ? array_values($value) : [$value];
    $normalized = [];
    while ($queue) {
        $candidate = array_shift($queue);
        if ($candidate === null || $candidate === '' || $candidate === false) {
            continue;
        }
        if (is_array($candidate)) {
            foreach ($candidate as $nested) {
                $queue[] = $nested;
            }
            continue;
        }
        $raw = trim((string) $candidate);
        if ($raw === '') {
            continue;
        }
        if ($raw[0] === '[') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                foreach ($decoded as $nested) {
                    $queue[] = $nested;
                }
                continue;
            }
        }
        if (preg_match('/[\s,]+/', $raw)) {
            foreach (preg_split('/[\s,]+/', $raw) ?: [] as $part) {
                if ($part !== '') {
                    $queue[] = $part;
                }
            }
            continue;
        }
        if (!preg_match('/^\d+$/', $raw)) {
            continue;
        }
        $monthday = (int) $raw;
        if ($monthday < 1 || $monthday > 31) {
            continue;
        }
        $normalized[$monthday] = true;
    }
    $tokens = array_map('intval', array_keys($normalized));
    sort($tokens, SORT_NUMERIC);
    return array_values($tokens);
}

function payload_values_for_audit(array $row, array $keys, callable $normalizer): array
{
    $payload = [];
    if (!empty($row['rule_payload'])) {
        $decoded = json_decode((string) $row['rule_payload'], true);
        if (is_array($decoded)) {
            $payload = $decoded;
        }
    }
    foreach ($keys as $key) {
        if (array_key_exists($key, $payload)) {
            $values = $normalizer($payload[$key]);
            if ($values) {
                return $values;
            }
        }
    }
    return [];
}

function setpos_values_for_audit($value): array
{
    if ($value === null || $value === '' || $value === false) {
        return [];
    }
    $queue = is_array($value) ? array_values($value) : [$value];
    $normalized = [];
    $aliases = [
        'FIRST' => 1,
        '1ST' => 1,
        'SECOND' => 2,
        '2ND' => 2,
        'THIRD' => 3,
        '3RD' => 3,
        'FOURTH' => 4,
        '4TH' => 4,
        'FIFTH' => 5,
        '5TH' => 5,
        'LAST' => -1,
    ];
    $order = [1, 2, 3, 4, 5, -1];
    while ($queue) {
        $candidate = array_shift($queue);
        if ($candidate === null || $candidate === '' || $candidate === false) {
            continue;
        }
        if (is_array($candidate)) {
            foreach ($candidate as $nested) {
                $queue[] = $nested;
            }
            continue;
        }
        $raw = trim((string) $candidate);
        if ($raw === '') {
            continue;
        }
        if ($raw[0] === '[') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                foreach ($decoded as $nested) {
                    $queue[] = $nested;
                }
                continue;
            }
        }
        if (preg_match('/[\s,]+/', $raw)) {
            foreach (preg_split('/[\s,]+/', $raw) ?: [] as $part) {
                if ($part !== '') {
                    $queue[] = $part;
                }
            }
            continue;
        }
        $candidateUpper = strtoupper($raw);
        if (array_key_exists($candidateUpper, $aliases)) {
            $normalized[$aliases[$candidateUpper]] = true;
            continue;
        }
        if (!preg_match('/^-?\d+$/', $raw)) {
            continue;
        }
        $setpos = (int) $raw;
        if (!in_array($setpos, $order, true)) {
            continue;
        }
        $normalized[$setpos] = true;
    }
    $tokens = array_map('intval', array_keys($normalized));
    $orderLookup = array_flip($order);
    usort($tokens, static function (int $left, int $right) use ($orderLookup): int {
        return ($orderLookup[$left] ?? PHP_INT_MAX) <=> ($orderLookup[$right] ?? PHP_INT_MAX);
    });
    return array_values($tokens);
}

$rulesStmt = $pdo->query("
    SELECT rr.id,
           rr.event_id,
           rr.frequency,
           rr.`interval`,
           rr.byweekday,
           rr.bymonthday,
           rr.bysetpos,
           rr.starts_on,
           rr.ends_on,
           rr.rule_payload,
           e.artist_name,
           e.title,
           e.status,
           e.deleted_at
    FROM event_recurrence_rules rr
    LEFT JOIN events e ON e.id = rr.event_id
    ORDER BY rr.id ASC
");
$rules = $rulesStmt ? ($rulesStmt->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];

$result = [
    'total_rules' => count($rules),
    'compatible_weekly_rules' => [],
    'normalizable_weekly_rules' => [],
    'compatible_monthly_rules' => [],
    'normalizable_monthly_rules' => [],
    'invalid_weekly_rules' => [],
    'invalid_monthly_rules' => [],
    'duplicate_generated_children' => [],
    'orphan_generated_children' => [],
];

foreach ($rules as $row) {
    $frequency = strtolower(trim((string) ($row['frequency'] ?? '')));
    $label = trim((string) ($row['title'] ?: $row['artist_name'] ?: 'Untitled event'));
    $storedByweekday = trim((string) ($row['byweekday'] ?? ''));
    $normalizedTokens = normalize_recurrence_weekday_tokens_for_audit($storedByweekday);
    $payloadTokens = weekday_payload_tokens_for_audit($row);
    $storedBymonthday = trim((string) ($row['bymonthday'] ?? ''));
    $normalizedBymonthday = monthday_values_for_audit($storedBymonthday);
    $payloadBymonthday = payload_values_for_audit($row, ['bymonthday_set', 'bymonthday'], 'monthday_values_for_audit');
    $storedBysetpos = trim((string) ($row['bysetpos'] ?? ''));
    $normalizedBysetpos = setpos_values_for_audit($storedBysetpos);
    $payloadBysetpos = payload_values_for_audit($row, ['bysetpos_set', 'bysetpos', 'setpos'], 'setpos_values_for_audit');
    $canonicalByweekday = $normalizedTokens ? implode(',', $normalizedTokens) : '';
    $payloadCanonical = $payloadTokens ? implode(',', $payloadTokens) : '';
    $canonicalBymonthday = $normalizedBymonthday ? implode(',', $normalizedBymonthday) : '';
    $payloadMonthdayCanonical = $payloadBymonthday ? implode(',', $payloadBymonthday) : '';
    $canonicalBysetpos = $normalizedBysetpos ? implode(',', $normalizedBysetpos) : '';
    $payloadSetposCanonical = $payloadBysetpos ? implode(',', $payloadBysetpos) : '';
    $entry = [
        'rule_id' => (int) $row['id'],
        'event_id' => (int) $row['event_id'],
        'label' => $label,
        'frequency' => $frequency ?: '(blank)',
        'byweekday' => $storedByweekday,
        'canonical_byweekday' => $canonicalByweekday,
        'bymonthday' => $storedBymonthday,
        'canonical_bymonthday' => $canonicalBymonthday,
        'bysetpos' => $storedBysetpos,
        'canonical_bysetpos' => $canonicalBysetpos,
        'starts_on' => $row['starts_on'] ?? null,
        'ends_on' => $row['ends_on'] ?? null,
    ];

    if ($payloadCanonical !== '' && $payloadCanonical !== $canonicalByweekday) {
        $entry['payload_byweekday'] = $payloadCanonical;
    }
    if ($payloadMonthdayCanonical !== '' && $payloadMonthdayCanonical !== $canonicalBymonthday) {
        $entry['payload_bymonthday'] = $payloadMonthdayCanonical;
    }
    if ($payloadSetposCanonical !== '' && $payloadSetposCanonical !== $canonicalBysetpos) {
        $entry['payload_bysetpos'] = $payloadSetposCanonical;
    }

    if ($frequency === 'monthly') {
        $hasMonthlyDayRule = $canonicalBymonthday !== '';
        $hasMonthlyNthRule = $canonicalByweekday !== '' && (($canonicalBysetpos !== '') || ($payloadSetposCanonical !== ''));
        if (!$row['starts_on'] || (!$hasMonthlyDayRule && !$hasMonthlyNthRule)) {
            $result['invalid_monthly_rules'][] = $entry;
            continue;
        }
        if (
            ($storedBymonthday !== '' && $storedBymonthday !== $canonicalBymonthday)
            || ($payloadMonthdayCanonical !== '' && $payloadMonthdayCanonical !== $canonicalBymonthday)
            || ($storedBysetpos !== '' && $storedBysetpos !== $canonicalBysetpos)
            || ($payloadSetposCanonical !== '' && $payloadSetposCanonical !== $canonicalBysetpos)
            || ($storedByweekday !== '' && $storedByweekday !== $canonicalByweekday)
            || ($payloadCanonical !== '' && $payloadCanonical !== $canonicalByweekday)
        ) {
            $result['normalizable_monthly_rules'][] = $entry;
            continue;
        }
        $result['compatible_monthly_rules'][] = $entry;
        continue;
    }

    if ($frequency !== 'weekly') {
        $result['invalid_monthly_rules'][] = $entry;
        continue;
    }

    if ($canonicalByweekday === '' || empty($row['starts_on'])) {
        $result['invalid_weekly_rules'][] = $entry;
        continue;
    }

    if ($storedByweekday !== $canonicalByweekday || ($payloadCanonical !== '' && $payloadCanonical !== $canonicalByweekday)) {
        $result['normalizable_weekly_rules'][] = $entry;
        continue;
    }

    $result['compatible_weekly_rules'][] = $entry;
}

$duplicateGeneratedStmt = $pdo->query("
    SELECT e.series_master_id,
           COALESCE(e.event_date, DATE(e.start_datetime)) AS occurrence_date,
           COUNT(*) AS child_count,
           GROUP_CONCAT(e.id ORDER BY e.id ASC SEPARATOR ',') AS child_ids
    FROM events e
    WHERE e.series_master_id IS NOT NULL
      AND e.deleted_at IS NULL
      AND e.change_note LIKE 'generated by recurrence|%'
    GROUP BY e.series_master_id, COALESCE(e.event_date, DATE(e.start_datetime))
    HAVING COUNT(*) > 1
    ORDER BY e.series_master_id ASC, occurrence_date ASC
");
foreach (($duplicateGeneratedStmt ? $duplicateGeneratedStmt->fetchAll(PDO::FETCH_ASSOC) : []) ?: [] as $row) {
    $result['duplicate_generated_children'][] = [
        'series_master_id' => (int) $row['series_master_id'],
        'occurrence_date' => $row['occurrence_date'],
        'child_count' => (int) $row['child_count'],
        'child_ids' => array_map('intval', array_filter(explode(',', (string) $row['child_ids']))),
    ];
}

$orphanGeneratedStmt = $pdo->query("
    SELECT e.id,
           e.series_master_id,
           COALESCE(e.event_date, DATE(e.start_datetime)) AS occurrence_date
    FROM events e
    LEFT JOIN event_recurrence_rules rr ON rr.event_id = e.series_master_id
    WHERE e.series_master_id IS NOT NULL
      AND e.deleted_at IS NULL
      AND e.change_note LIKE 'generated by recurrence|%'
      AND rr.id IS NULL
    ORDER BY e.series_master_id ASC, occurrence_date ASC, e.id ASC
");
foreach (($orphanGeneratedStmt ? $orphanGeneratedStmt->fetchAll(PDO::FETCH_ASSOC) : []) ?: [] as $row) {
    $result['orphan_generated_children'][] = [
        'event_id' => (int) $row['id'],
        'series_master_id' => (int) $row['series_master_id'],
        'occurrence_date' => $row['occurrence_date'],
    ];
}

echo json_encode($result, JSON_UNESCAPED_SLASHES);
PHP
)"

AUDIT_JSON="$AUDIT_JSON" python3 - <<'PY'
import json
import os
import sys

payload = json.loads(os.environ["AUDIT_JSON"])

if "error" in payload:
    print(f"ERROR {payload['error']}", file=sys.stderr)
    raise SystemExit(1)

total_rules = payload.get("total_rules", 0)
compatible = payload.get("compatible_weekly_rules", [])
normalizable = payload.get("normalizable_weekly_rules", [])
compatible_monthly = payload.get("compatible_monthly_rules", [])
normalizable_monthly = payload.get("normalizable_monthly_rules", [])
invalid_weekly = payload.get("invalid_weekly_rules", [])
invalid_monthly = payload.get("invalid_monthly_rules", [])
duplicate_generated = payload.get("duplicate_generated_children", [])
orphan_generated = payload.get("orphan_generated_children", [])

print(f"INFO [recurring-audit] total recurrence rules: {total_rules}")
print(f"INFO [recurring-audit] compatible weekly rules: {len(compatible)}")
print(f"INFO [recurring-audit] normalizable weekly rules: {len(normalizable)}")
print(f"INFO [recurring-audit] compatible monthly rules: {len(compatible_monthly)}")
print(f"INFO [recurring-audit] normalizable monthly rules: {len(normalizable_monthly)}")
print(f"INFO [recurring-audit] invalid weekly rules: {len(invalid_weekly)}")
print(f"INFO [recurring-audit] invalid monthly rules: {len(invalid_monthly)}")
print(f"INFO [recurring-audit] duplicate generated child dates: {len(duplicate_generated)}")
print(f"INFO [recurring-audit] orphan generated children without a rule: {len(orphan_generated)}")

def print_entries(label, entries, limit=10):
    if not entries:
        return
    print(f"WARN [recurring-audit] {label}:")
    for entry in entries[:limit]:
        print(f"  - {json.dumps(entry, sort_keys=True)}")
    if len(entries) > limit:
        print(f"  - ... {len(entries) - limit} more")

print_entries("weekly rules that will normalize on next save", normalizable)
print_entries("monthly rules that will normalize on next save", normalizable_monthly)
print_entries("invalid weekly rules", invalid_weekly)
print_entries("invalid monthly rules", invalid_monthly)
print_entries("duplicate generated child date groups", duplicate_generated)
print_entries("orphan generated children", orphan_generated)

if invalid_weekly or invalid_monthly or duplicate_generated:
    print("ERROR [recurring-audit] blocking recurrence compatibility issues found", file=sys.stderr)
    raise SystemExit(1)

if normalizable or normalizable_monthly or orphan_generated:
    print("OK [recurring-audit] no blocking issues found; review warnings above before deployment")
else:
    print("OK [recurring-audit] existing recurrence data is compatible with the current recurring-series model")
PY
