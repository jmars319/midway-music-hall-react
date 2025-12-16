#!/usr/bin/env php
<?php
// Run-once migration: import authoritative event data from the placeholder single-page JSON
// - Reads frontend/src/data/events.json
// - Replaces events + recurrence tables with canonical data
// - Generates future occurrences for recurring items (12 months horizon)
// Usage: php backend/scripts/migrate_events.php [--force]

use Midway\Backend\Env;
use Midway\Backend\Database;

require __DIR__ . '/../lib/Env.php';
require __DIR__ . '/../lib/Database.php';

if (php_sapi_name() !== 'cli') {
    fwrite(STDERR, "This script must be run from the command line.\n");
    exit(1);
}

Env::load(__DIR__ . '/../.env');
$pdo = Database::connection();
$tz = new DateTimeZone('America/New_York');
$today = new DateTimeImmutable('now', $tz);
$force = in_array('--force', $argv, true);
$horizonMonths = 12; // generate 12 months of occurrences
$migrationKey = 'events_seed_version_20251212';

// Guard: only run once unless --force supplied
$settingStmt = $pdo->prepare('SELECT setting_value FROM business_settings WHERE setting_key = ?');
$settingStmt->execute([$migrationKey]);
$setting = $settingStmt->fetchColumn();
if ($setting && !$force) {
    fwrite(STDERR, "Events have already been imported on {$setting}. Re-run with --force to override.\n");
    exit(1);
}

// Resolve data files
$root = realpath(__DIR__ . '/..');
$dataFile = realpath($root . '/../frontend/src/data/events.json');
if (!$dataFile || !is_file($dataFile)) {
    fwrite(STDERR, "Unable to locate events.json at frontend/src/data/events.json\n");
    exit(1);
}

$json = json_decode(file_get_contents($dataFile), true);
if (!is_array($json)) {
    fwrite(STDERR, "Invalid JSON in events.json\n");
    exit(1);
}

$pdo->exec('CREATE TABLE IF NOT EXISTS events_backup_20251212 LIKE events');
$eventsBackupCount = $pdo->query('SELECT COUNT(*) FROM events_backup_20251212')->fetchColumn();
if ((int)$eventsBackupCount === 0) {
    $pdo->exec('INSERT INTO events_backup_20251212 SELECT * FROM events');
}

$pdo->exec('CREATE TABLE IF NOT EXISTS seat_requests_backup_20251212 LIKE seat_requests');
$seatRequestBackupCount = $pdo->query('SELECT COUNT(*) FROM seat_requests_backup_20251212')->fetchColumn();
if ((int)$seatRequestBackupCount === 0) {
    $pdo->exec('INSERT INTO seat_requests_backup_20251212 SELECT * FROM seat_requests');
}

$pdo->beginTransaction();
try {
    $pdo->exec('DELETE FROM seat_requests');
    $pdo->exec('DELETE FROM event_recurrence_exceptions');
    $pdo->exec('DELETE FROM events');

    $slugRegistry = [];
    $stats = [
        'single' => 0,
        'recurring_master' => 0,
        'recurring_occurrence' => 0,
    ];

    foreach ($json as $record) {
        if (!is_array($record)) {
            continue;
        }
        if (isRecurringRecord($record)) {
            $result = importRecurringSeries($pdo, $record, $slugRegistry, $today, $tz, $horizonMonths);
            $stats['recurring_master'] += $result['masters'];
            $stats['recurring_occurrence'] += $result['occurrences'];
        } else {
            $eventData = buildEventPayload($record, $slugRegistry, $tz);
            if (!$eventData) {
                continue;
            }
            insertEvent($pdo, $eventData);
            $stats['single']++;
        }
    }

    $pdo->prepare('INSERT INTO business_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)')
        ->execute([$migrationKey, (new DateTimeImmutable('now', $tz))->format('Y-m-d H:i:s')]);

    $pdo->commit();
    echo "Imported {$stats['single']} single events, {$stats['recurring_master']} recurring masters, {$stats['recurring_occurrence']} generated occurrences.\n";
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, 'Migration failed: ' . $e->getMessage() . "\n");
    exit(1);
}

function isRecurringRecord(array $record): bool
{
    $type = strtolower($record['event_type'] ?? '');
    $date = strtolower($record['date'] ?? '');
    return str_contains($type, 'recurring') || $date === 'ongoing';
}

function buildEventPayload(array $record, array &$slugRegistry, DateTimeZone $tz, ?DateTimeImmutable $forcedDate = null, ?array $overrideTimes = null, ?int $masterId = null): ?array
{
    $name = trim($record['name'] ?? 'Untitled Event');
    $artist = $name !== '' ? $name : 'Untitled Event';
    $dateString = $forcedDate ? $forcedDate->format('Y-m-d') : trim((string)($record['date'] ?? ''));
    $times = $overrideTimes ?: parseTimeRange($record['time'] ?? '');
    $startTime = $times['start'];
    $endTime = $times['end'];
    $start = parseDateTime($dateString, $startTime, $tz);
    $end = $start && $endTime ? parseDateTime($dateString, $endTime, $tz) : ($start ? $start->modify('+3 hours') : null);

    if (!$start) {
        return null;
    }

    $door = parseDateTime($dateString, parseStartOnly($record['doors_open'] ?? ''), $tz);
    $coverCharge = parseMoney($record['cover_charge'] ?? '');

    $slugBase = slugify($artist . '-' . $start->format('Ymd'));
    $slug = uniqueSlug($slugBase, $slugRegistry);

    $venueCode = determineVenueCode($record);
    $venueSection = trim((string)($record['location'] ?? '')) ?: null;
    $contactPhoneRaw = strippedValue($record['contact_phone'] ?? null);

    $payload = [
        'artist_name' => $artist,
        'title' => $artist,
        'slug' => $slug,
        'description' => trim((string)($record['description'] ?? $record['notes'] ?? '')) ?: null,
        'notes' => trim((string)($record['notes'] ?? '')) ?: null,
        'genre' => trim((string)($record['event_type'] ?? '')) ?: null,
        'category_tags' => json_encode(array_values(array_filter([
            $record['event_type'] ?? null,
            $venueSection,
            $record['venue'] ?? null,
        ]))),
        'image_url' => null,
        'hero_image_id' => null,
        'poster_image_id' => null,
        'ticket_price' => $coverCharge,
        'door_price' => $coverCharge,
        'min_ticket_price' => $coverCharge,
        'max_ticket_price' => $coverCharge,
        'ticket_type' => 'general_admission',
        'seating_enabled' => 0,
        'venue_code' => $venueCode,
        'venue_section' => $venueSection,
        'timezone' => 'America/New_York',
        'start_datetime' => $start->format('Y-m-d H:i:s'),
        'end_datetime' => $end ? $end->format('Y-m-d H:i:s') : null,
        'door_time' => $door ? $door->format('Y-m-d H:i:s') : null,
        'event_date' => $start->format('Y-m-d'),
        'event_time' => $start->format('H:i:s'),
        'age_restriction' => trim((string)($record['age_restriction'] ?? 'All Ages')) ?: 'All Ages',
        'status' => 'published',
        'visibility' => 'public',
        'publish_at' => $start->format('Y-m-d H:i:s'),
        'layout_id' => null,
        'layout_version_id' => null,
        'series_master_id' => $masterId,
        'is_series_master' => 0,
        'ticket_url' => null,
        'contact_name' => strippedValue($record['contact_person'] ?? null),
        'contact_phone_raw' => $contactPhoneRaw,
        'contact_phone_normalized' => normalizePhone($contactPhoneRaw),
        'contact_email' => null,
        'change_note' => 'imported from events.json',
        'created_by' => 'events-migration',
        'updated_by' => 'events-migration',
    ];

    return $payload;
}

function insertEvent(PDO $pdo, array $data): int
{
    $columns = array_keys($data);
    $placeholders = implode(', ', array_fill(0, count($columns), '?'));
    $sql = 'INSERT INTO events (' . implode(', ', $columns) . ') VALUES (' . $placeholders . ')';
    $stmt = $pdo->prepare($sql);
    $stmt->execute(array_values($data));
    return (int)$pdo->lastInsertId();
}

function parseDateTime(?string $date, ?string $time, DateTimeZone $tz): ?DateTimeImmutable
{
    if (!$date) {
        return null;
    }
    $date = trim($date);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        return null;
    }
    $timePart = $time ?: '00:00:00';
    if (!preg_match('/^\d{2}:\d{2}:\d{2}$/', $timePart)) {
        return null;
    }
    $dt = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $date . ' ' . $timePart, $tz);
    return $dt ?: null;
}

function parseTimeRange(?string $value): array
{
    $value = trim((string)$value);
    $matches = [];
    preg_match_all('/(\d{1,2}:\d{2})\s*(AM|PM)?/i', $value, $matches, PREG_SET_ORDER);
    $start = $matches[0] ?? null;
    $end = $matches[1] ?? null;
    return [
        'start' => $start ? formatTo24Hour($start[1], $start[2] ?? null) : '19:00:00',
        'end' => $end ? formatTo24Hour($end[1], $end[2] ?? null) : null,
    ];
}

function parseStartOnly(?string $value): ?string
{
    $value = trim((string)$value);
    if ($value === '') {
        return null;
    }
    if (preg_match('/(\d{1,2}:\d{2})\s*(AM|PM)?/i', $value, $m)) {
        return formatTo24Hour($m[1], $m[2] ?? null);
    }
    return null;
}

function formatTo24Hour(string $time, ?string $meridiem): string
{
    [$hour, $minute] = array_map('intval', explode(':', $time));
    $meridiem = strtoupper(trim((string)$meridiem));
    if ($meridiem === 'PM' && $hour < 12) {
        $hour += 12;
    }
    if ($meridiem === 'AM' && $hour === 12) {
        $hour = 0;
    }
    return sprintf('%02d:%02d:00', $hour, $minute);
}

function parseMoney(?string $value): ?float
{
    if (!$value) {
        return null;
    }
    if (preg_match('/(\d+(?:\.\d+)?)/', $value, $m)) {
        return (float)$m[1];
    }
    return null;
}

function slugify(string $value): string
{
    $value = strtolower(trim($value));
    $value = preg_replace('/[^a-z0-9]+/', '-', $value);
    return trim($value, '-') ?: 'event';
}

function uniqueSlug(string $base, array &$registry): string
{
    $slug = $base;
    $i = 2;
    while (isset($registry[$slug])) {
        $slug = $base . '-' . $i;
        $i++;
    }
    $registry[$slug] = true;
    return $slug;
}

function determineVenueCode(array $record): string
{
    $venue = strtoupper(trim((string)($record['venue'] ?? '')));
    $location = strtolower(trim((string)($record['location'] ?? '')));
    if ($venue === 'TGP' || str_contains($location, 'gathering')) {
        return 'TGP';
    }
    return 'MMH';
}

function normalizePhone(?string $value): ?string
{
    if (!$value) {
        return null;
    }
    $digits = preg_replace('/\D+/', '', $value);
    return $digits ?: null;
}

function strippedValue($value): ?string
{
    $value = trim((string)$value);
    if ($value === '' || strtolower($value) === 'n/a') {
        return null;
    }
    return $value;
}

function importRecurringSeries(PDO $pdo, array $record, array &$slugRegistry, DateTimeImmutable $today, DateTimeZone $tz, int $monthsAhead): array
{
    $pattern = parseRecurrencePattern($record);
    if (!$pattern) {
        return ['masters' => 0, 'occurrences' => 0];
    }

    $occurrenceDates = generateOccurrences($pattern, $today, $monthsAhead, $tz);
    if (!$occurrenceDates) {
        return ['masters' => 0, 'occurrences' => 0];
    }

    $firstDate = $occurrenceDates[0]['date'];
    $masterPayload = buildEventPayload($record, $slugRegistry, $tz, $firstDate);
    if (!$masterPayload) {
        return ['masters' => 0, 'occurrences' => 0];
    }
    $masterPayload['status'] = 'draft';
    $masterPayload['visibility'] = 'private';
    $masterPayload['is_series_master'] = 1;
    $masterPayload['publish_at'] = null;
    $masterPayload['start_datetime'] = null;
    $masterPayload['end_datetime'] = null;
    $masterPayload['event_date'] = null;
    $masterPayload['event_time'] = null;
    $masterId = insertEvent($pdo, $masterPayload);

    $rule = createRecurrenceRule($pdo, $masterId, $pattern, $firstDate);
    $count = 0;

    foreach ($occurrenceDates as $dateInfo) {
        $forcedDate = $dateInfo['date'];
        $overrideTimes = $dateInfo['times'] ?? null;
        $payload = buildEventPayload($record, $slugRegistry, $tz, $forcedDate, $overrideTimes, $masterId);
        if (!$payload) {
            continue;
        }
        insertEvent($pdo, $payload);
        $count++;
        if (!empty($dateInfo['exception'])) {
            insertException($pdo, $rule, $dateInfo['exception']);
        }
    }

    return ['masters' => 1, 'occurrences' => $count];
}

function parseRecurrencePattern(array $record): ?array
{
    $text = strtolower(trim((string)($record['day_of_week'] ?? '')));
    $notes = strtolower(trim((string)($record['notes'] ?? '')));
    $pattern = [
        'type' => 'weekly',
        'interval' => 1,
        'weekday' => null,
        'setpos' => [],
        'overrides' => [],
        'raw' => $record['day_of_week'] ?? '',
        'notes' => $record['notes'] ?? '',
    ];

    $weekdayMap = [
        'monday' => 'MO',
        'tuesday' => 'TU',
        'wednesday' => 'WE',
        'thursday' => 'TH',
        'friday' => 'FR',
        'saturday' => 'SA',
        'sunday' => 'SU'
    ];

    if (preg_match('/(\d+)(?:st|nd|rd|th)\s*&\s*(\d+)(?:st|nd|rd|th)\s+([a-z]+)/', $text, $m)) {
        $pattern['type'] = 'monthly';
        $pattern['setpos'] = [(int)$m[1], (int)$m[2]];
        $pattern['weekday'] = $weekdayMap[strtolower($m[3])] ?? null;
    } elseif (preg_match('/(\d+)(?:st|nd|rd|th)\s+([a-z]+)/', $text, $m)) {
        $pattern['type'] = 'monthly';
        $pattern['setpos'] = [(int)$m[1]];
        $pattern['weekday'] = $weekdayMap[strtolower($m[2])] ?? null;
    } else {
        foreach ($weekdayMap as $word => $code) {
            if (str_contains($text, $word)) {
                $pattern['type'] = 'weekly';
                $pattern['weekday'] = $code;
                break;
            }
        }
    }

    if (!$pattern['weekday']) {
        return null;
    }

    if (str_contains($text, '3rd sunday in may') || str_contains($notes, '3rd sunday in may')) {
        $pattern['overrides'][] = ['month' => 5, 'setpos' => 3, 'from_setpos' => 2, 'weekday' => 'SU'];
    }

    return $pattern;
}

function createRecurrenceRule(PDO $pdo, int $eventId, array $pattern, DateTimeImmutable $firstDate): int
{
    $frequency = $pattern['type'] === 'monthly' ? 'monthly' : 'weekly';
    $startsOn = $firstDate->format('Y-m-d');
    $payload = json_encode([
        'raw_day_of_week' => $pattern['raw'],
        'notes' => $pattern['notes'],
        'setpos' => $pattern['setpos'],
        'overrides' => $pattern['overrides'],
    ]);

    $stmt = $pdo->prepare('INSERT INTO event_recurrence_rules (event_id, frequency, `interval`, byweekday, starts_on, rule_payload, created_by, updated_by, change_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([
        $eventId,
        $frequency,
        1,
        $pattern['weekday'],
        $startsOn,
        $payload,
        'events-migration',
        'events-migration',
        'imported from events.json'
    ]);

    return (int)$pdo->lastInsertId();
}

function generateOccurrences(array $pattern, DateTimeImmutable $today, int $monthsAhead, DateTimeZone $tz): array
{
    $dates = [];
    $cursor = new DateTimeImmutable($today->format('Y-m-01'), $tz);
    $endMonth = $cursor->modify("+{$monthsAhead} months");

    if ($pattern['type'] === 'weekly') {
        $weekday = $pattern['weekday'];
        $dates = generateWeeklyOccurrences($weekday, $today, $monthsAhead, $tz);
    } else {
        $dates = generateMonthlyOccurrences($pattern, $today, $cursor, $endMonth, $tz);
    }

    return $dates;
}

function generateWeeklyOccurrences(string $weekdayCode, DateTimeImmutable $start, int $monthsAhead, DateTimeZone $tz): array
{
    $occurrences = [];
    $weeks = $monthsAhead * 4;
    $weekdayNum = weekdayToNumber($weekdayCode);
    $cursor = $start;

    // move cursor to next desired weekday
    while ((int)$cursor->format('w') !== $weekdayNum) {
        $cursor = $cursor->modify('+1 day');
    }

    for ($i = 0; $i < $weeks; $i++) {
        $occurrences[] = ['date' => $cursor];
        $cursor = $cursor->modify('+1 week');
    }

    return $occurrences;
}

function generateMonthlyOccurrences(array $pattern, DateTimeImmutable $today, DateTimeImmutable $cursor, DateTimeImmutable $end, DateTimeZone $tz): array
{
    $occurrences = [];
    $setPositions = $pattern['setpos'];
    $weekday = $pattern['weekday'];
    $weekdayNum = weekdayToNumber($weekday);

    while ($cursor < $end) {
        $year = (int)$cursor->format('Y');
        $month = (int)$cursor->format('n');
        foreach ($setPositions as $pos) {
            $date = nthWeekdayOfMonth($year, $month, $weekdayNum, $pos, $tz);
            if (!$date) {
                continue;
            }
            if ($date < $today) {
                continue;
            }

            $override = findOverride($pattern['overrides'], $month, $weekday, $pos);
            if ($override) {
                $overrideDate = nthWeekdayOfMonth($year, $month, $weekdayNum, $override['setpos'], $tz);
                if ($overrideDate && $overrideDate >= $today) {
                    $occurrences[] = [
                        'date' => $overrideDate,
                        'exception' => [
                            'exception_date' => $date,
                            'override_to' => $overrideDate
                        ]
                    ];
                }
                continue;
            }

            $occurrences[] = ['date' => $date];
        }

        $cursor = $cursor->modify('+1 month');
    }

    return $occurrences;
}

function findOverride(array $overrides, int $month, string $weekday, int $fromSetpos)
{
    foreach ($overrides as $override) {
        if ((int)($override['month'] ?? 0) === $month && ($override['weekday'] ?? '') === $weekday && (int)($override['from_setpos'] ?? 0) === $fromSetpos) {
            return $override;
        }
    }
    return null;
}

function insertException(PDO $pdo, int $ruleId, array $exception): void
{
    if (empty($exception['exception_date']) || empty($exception['override_to'])) {
        return;
    }
    $stmt = $pdo->prepare('INSERT INTO event_recurrence_exceptions (recurrence_id, exception_date, exception_type, override_payload, created_by) VALUES (?, ?, ?, ?, ?)');
    $stmt->execute([
        $ruleId,
        $exception['exception_date']->format('Y-m-d'),
        'override',
        json_encode(['override_date' => $exception['override_to']->format('Y-m-d')]),
        'events-migration'
    ]);
}

function nthWeekdayOfMonth(int $year, int $month, int $weekdayNum, int $nth, DateTimeZone $tz): ?DateTimeImmutable
{
    $firstOfMonth = new DateTimeImmutable(sprintf('%04d-%02d-01', $year, $month), $tz);
    $firstWeekdayNum = (int)$firstOfMonth->format('w');
    $offsetDays = ($weekdayNum - $firstWeekdayNum + 7) % 7;
    $day = 1 + $offsetDays + 7 * ($nth - 1);
    if ($day > (int)$firstOfMonth->format('t')) {
        return null;
    }
    return new DateTimeImmutable(sprintf('%04d-%02d-%02d', $year, $month, $day), $tz);
}

function weekdayToNumber(string $code): int
{
    $map = ['SU' => 0, 'MO' => 1, 'TU' => 2, 'WE' => 3, 'TH' => 4, 'FR' => 5, 'SA' => 6];
    return $map[$code] ?? 0;
}
