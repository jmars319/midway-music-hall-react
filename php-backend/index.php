<?php

require __DIR__ . '/bootstrap.php';

use Midway\Backend\Database;
use Midway\Backend\Emailer;
use Midway\Backend\Env;
use Midway\Backend\Request;
use Midway\Backend\Response;
use Midway\Backend\Router;
use function Midway\Backend\process_image_variants;
use function Midway\Backend\load_image_manifest;
use function Midway\Backend\delete_image_with_variants;
use function Midway\Backend\relative_upload_path;
use function Midway\Backend\build_variant_payload_from_manifest;

$router = new Router();

function json_input(Request $request): array
{
    return $request->json ?? $request->body ?? [];
}

function normalize_rows(array $rows, callable $normalizer): array
{
    return array_map($normalizer, $rows);
}

function parse_selected_seats($value): array
{
    if (is_array($value)) {
        return $value;
    }
    if (is_string($value)) {
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }
    return [];
}

class SeatRequestException extends RuntimeException
{
    public int $httpStatus;
    public array $payload;

    public function __construct(string $message, int $httpStatus = 400, array $payload = [])
    {
        parent::__construct($message);
        $this->httpStatus = $httpStatus;
        $this->payload = $payload;
    }
}

function output_upload_error(string $message): void
{
    Response::error($message, 400);
}

function save_uploaded_file(array $file): ?array
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        return null;
    }

    $allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    $allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $file['tmp_name']);
    finfo_close($finfo);
    $originalName = $file['name'] ?? 'upload';
    $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $fileSize = (int) ($file['size'] ?? 0);
    if ($fileSize <= 0 && is_file($file['tmp_name'])) {
        $fileSize = (int) filesize($file['tmp_name']);
    }

    if (IMAGE_UPLOAD_MAX_BYTES > 0 && $fileSize > IMAGE_UPLOAD_MAX_BYTES) {
        $maxMb = round(IMAGE_UPLOAD_MAX_BYTES / (1024 * 1024));
        return ['error' => "File exceeds the {$maxMb}MB limit"];
    }

    if (!in_array($mime, $allowedMimes, true) || !in_array($extension, $allowedExtensions, true)) {
        return ['error' => 'Only image files are allowed'];
    }

    $hashPrefix = substr(sha1(($originalName ?: '') . $fileSize . microtime(true) . random_bytes(8)), 0, 12);
    $unique = 'event-' . $hashPrefix . '-' . mt_rand(100000, 999999999);
    $filename = $unique . '.' . $extension;
    $targetPath = rtrim(UPLOADS_DIR, '/') . '/' . $filename;

    if (!move_uploaded_file($file['tmp_name'], $targetPath)) {
        return ['error' => 'Failed to save file'];
    }

    $responsive = process_image_variants($targetPath, $filename, $mime);

    return [
        'filename' => $filename,
        'path' => $targetPath,
        'mime' => $mime,
        'size' => @filesize($targetPath) ?: $fileSize,
        'original_name' => $originalName,
        'width' => $responsive['intrinsic_width'] ?? null,
        'height' => $responsive['intrinsic_height'] ?? null,
        'optimized_path' => $responsive['optimized_path'] ?? null,
        'webp_path' => $responsive['webp_path'] ?? null,
        'optimized_srcset' => $responsive['optimized_srcset'] ?? null,
        'webp_srcset' => $responsive['webp_srcset'] ?? null,
        'fallback_original' => $responsive['fallback_original'] ?? ('/uploads/' . $filename),
        'responsive_variants' => [
            'optimized' => $responsive['optimized_variants'] ?? [],
            'webp' => $responsive['webp_variants'] ?? [],
        ],
        'manifest_path' => $responsive['manifest_path'] ?? null,
        'derived_files' => $responsive['derived_files'] ?? [],
        'optimization_status' => $responsive['optimization_status'] ?? 'pending',
        'processing_notes' => $responsive['processing_notes'] ?? null,
        'checksum' => is_file($targetPath) ? hash_file('sha256', $targetPath) : null,
    ];
}

function mysql_now(): string
{
    return (new DateTime('now', new DateTimeZone('UTC')))->format('Y-m-d H:i:s');
}

function fetch_layout_for_event(?int $eventId): array
{
    $pdo = Database::connection();
    $layoutData = [];
    $stagePosition = null;
    $stageSize = null;
    $canvasSettings = null;

    if ($eventId) {
        $stmt = $pdo->prepare('SELECT layout_id, layout_version_id FROM events WHERE id = ?');
        $stmt->execute([$eventId]);
        $layoutRow = $stmt->fetch();
        if ($layoutRow && $layoutRow['layout_version_id']) {
            $stmt = $pdo->prepare('SELECT layout_data, stage_position, stage_size, canvas_settings FROM seating_layout_versions WHERE id = ?');
            $stmt->execute([$layoutRow['layout_version_id']]);
            $layout = $stmt->fetch();
            if ($layout) {
                $layoutData = $layout['layout_data'] ? json_decode($layout['layout_data'], true) : [];
                $stagePosition = $layout['stage_position'] ? json_decode($layout['stage_position'], true) : null;
                $stageSize = $layout['stage_size'] ? json_decode($layout['stage_size'], true) : null;
                $canvasSettings = $layout['canvas_settings'] ? json_decode($layout['canvas_settings'], true) : null;
                return [$layoutData ?? [], $stagePosition, $stageSize, $canvasSettings];
            }
        }
        if ($layoutRow && $layoutRow['layout_id']) {
            $stmt = $pdo->prepare('SELECT layout_data, stage_position, stage_size, canvas_settings FROM seating_layouts WHERE id = ?');
            $stmt->execute([$layoutRow['layout_id']]);
            $layout = $stmt->fetch();
            if ($layout) {
                $layoutData = $layout['layout_data'] ? json_decode($layout['layout_data'], true) : [];
                $stagePosition = $layout['stage_position'] ? json_decode($layout['stage_position'], true) : null;
                $stageSize = $layout['stage_size'] ? json_decode($layout['stage_size'], true) : null;
                $canvasSettings = $layout['canvas_settings'] ? json_decode($layout['canvas_settings'], true) : null;
                return [$layoutData ?? [], $stagePosition, $stageSize, $canvasSettings];
            }
        }
    }

    $stmt = $pdo->query('SELECT layout_data, stage_position, stage_size, canvas_settings FROM seating_layouts WHERE is_default = 1 LIMIT 1');
    $layout = $stmt->fetch();
    if ($layout) {
        $layoutData = $layout['layout_data'] ? json_decode($layout['layout_data'], true) : [];
        $stagePosition = $layout['stage_position'] ? json_decode($layout['stage_position'], true) : null;
        $stageSize = $layout['stage_size'] ? json_decode($layout['stage_size'], true) : null;
        $canvasSettings = $layout['canvas_settings'] ? json_decode($layout['canvas_settings'], true) : null;
    }

    return [$layoutData ?? [], $stagePosition, $stageSize, $canvasSettings];
}

function slugify_string(?string $value, string $fallback = 'event'): string
{
    $value = strtolower(trim((string) $value));
    $value = preg_replace('/[^a-z0-9]+/', '-', $value);
    $value = trim($value, '-');
    return $value !== '' ? $value : $fallback;
}

function parse_layout_snapshot($snapshot): array
{
    if (!$snapshot) {
        return [];
    }
    if (is_array($snapshot)) {
        return $snapshot;
    }
    if (!is_string($snapshot)) {
        return [];
    }
    $decoded = json_decode($snapshot, true);
    if (is_array($decoded)) {
        if (isset($decoded[0])) {
            return $decoded;
        }
        if (isset($decoded['layout_data']) && is_array($decoded['layout_data'])) {
            return $decoded['layout_data'];
        }
    }
    return [];
}

function normalize_seat_labels_for_row($value): array
{
    if ($value === null) {
        return [];
    }
    if (is_string($value)) {
        $decoded = json_decode($value, true);
        if (is_array($decoded)) {
            return normalize_seat_labels_for_row($decoded);
        }
        return [];
    }
    if (!is_array($value)) {
        return [];
    }
    $normalized = [];
    foreach ($value as $key => $label) {
        $trimmed = trim((string)($label ?? ''));
        if ($trimmed !== '') {
            $normalized[(string)$key] = $trimmed;
        }
    }
    return $normalized;
}

function seat_row_is_interactive(array $row): bool
{
    $type = strtolower((string)($row['element_type'] ?? $row['elementType'] ?? 'table'));
    return $type === 'table' || $type === 'chair';
}

function build_seat_id_for_row(array $row, int $seatNumber): string
{
    $section = trim((string)($row['section_name'] ?? $row['section'] ?? 'Section'));
    $rowLabel = trim((string)($row['row_label'] ?? $row['row'] ?? 'Row'));
    $sectionPart = $section !== '' ? $section : 'Section';
    $rowPart = $rowLabel !== '' ? $rowLabel : 'Row';
    return $sectionPart . '-' . $rowPart . '-' . $seatNumber;
}

function build_default_seat_label(array $row, int $seatNumber): string
{
    $base = $row['row_label'] ?? $row['row'] ?? 'Row';
    $totalSeats = isset($row['total_seats']) ? (int) $row['total_seats'] : 0;
    if ($totalSeats <= 1) {
        return $base !== '' ? $base : 'Row';
    }
    $index = max(0, $seatNumber - 1);
    $alphabetSize = 26;
    if ($index < $alphabetSize) {
        return ($base ?: 'Row') . chr(65 + $index);
    }
    $repeat = intdiv($index, $alphabetSize) + 1;
    $remainder = $index % $alphabetSize;
    return ($base ?: 'Row') . str_repeat(chr(65 + $remainder), $repeat);
}

function build_seat_label_for_row(array $row, int $seatNumber): string
{
    $labels = normalize_seat_labels_for_row($row['seat_labels'] ?? $row['seatLabels'] ?? null);
    if (isset($labels[(string)$seatNumber])) {
        return $labels[(string)$seatNumber];
    }
    return build_default_seat_label($row, $seatNumber);
}

function build_seat_label_map_from_rows(array $rows): array
{
    $map = [];
    foreach ($rows as $row) {
        if (!is_array($row) || !seat_row_is_interactive($row)) {
            continue;
        }
        $total = (int)($row['total_seats'] ?? 0);
        if ($total <= 0) {
            continue;
        }
        for ($i = 1; $i <= $total; $i++) {
            $seatId = build_seat_id_for_row($row, $i);
            $map[$seatId] = build_seat_label_for_row($row, $i);
        }
    }
    return $map;
}

function describe_seat_display(string $seatId, ?string $label = null): string
{
    if (!$label || trim($label) === '' || $label === $seatId) {
        return $seatId;
    }
    return $label . ' (' . $seatId . ')';
}

function build_display_seat_list(array $seatRequest): array
{
    $seats = parse_selected_seats($seatRequest['selected_seats'] ?? []);
    if (!$seats) {
        return [];
    }
    if (!empty($seatRequest['seat_display_labels']) && is_array($seatRequest['seat_display_labels'])) {
        return $seatRequest['seat_display_labels'];
    }
    $rows = parse_layout_snapshot($seatRequest['seat_map_snapshot'] ?? null);
    if (!$rows) {
        return $seats;
    }
    $labels = build_seat_label_map_from_rows($rows);
    return array_map(function ($seatId) use ($labels) {
        $label = $labels[$seatId] ?? null;
        return describe_seat_display($seatId, $label);
    }, $seats);
}

function normalize_phone_number($value): ?string
{
    if ($value === null) {
        return null;
    }
    $digits = preg_replace('/\\D+/', '', (string) $value);
    return $digits !== '' ? $digits : null;
}

function normalize_layout_identifier($value): ?int
{
    if ($value === null || $value === '' || $value === false) {
        return null;
    }
    if (is_numeric($value)) {
        $int = (int) $value;
        return $int > 0 ? $int : null;
    }
    return null;
}

function normalize_door_time_input($value): ?string
{
    if ($value === null || $value === '' || $value === false) {
        return null;
    }
    try {
        $dt = new DateTimeImmutable((string) $value);
        return $dt->format('Y-m-d H:i:s');
    } catch (Throwable $e) {
        return null;
    }
}

function event_time_candidate(string $alias = 'e'): string
{
    return "NULLIF(TRIM(SUBSTRING_INDEX({$alias}.event_time, '-', 1)), '')";
}

function event_start_expression(string $alias = 'e'): string
{
    $timeCandidate = event_time_candidate($alias);
    $twentyFour = "STR_TO_DATE(CONCAT({$alias}.event_date, ' ', $timeCandidate), '%Y-%m-%d %H:%i:%s')";
    $twentyFourShort = "STR_TO_DATE(CONCAT({$alias}.event_date, ' ', $timeCandidate), '%Y-%m-%d %H:%i')";
    $twelveHour = "STR_TO_DATE(CONCAT({$alias}.event_date, ' ', $timeCandidate), '%Y-%m-%d %h:%i %p')";
    $defaultEvening = "STR_TO_DATE(CONCAT({$alias}.event_date, ' 18:00:00'), '%Y-%m-%d %H:%i:%s')";
    return "COALESCE(
        {$alias}.start_datetime,
        CASE
            WHEN {$alias}.event_date IS NOT NULL THEN
                COALESCE(
                    CASE WHEN $timeCandidate IS NOT NULL THEN COALESCE($twentyFour, $twentyFourShort) END,
                    CASE WHEN $timeCandidate IS NOT NULL THEN $twelveHour END,
                    $defaultEvening
                )
            ELSE NULL
        END
    )";
}

function event_end_expression(string $alias = 'e', int $fallbackHours = 4): string
{
    $startExpr = event_start_expression($alias);
    $hours = max(1, $fallbackHours);
    return "COALESCE({$alias}.end_datetime, DATE_ADD($startExpr, INTERVAL {$hours} HOUR))";
}

function event_has_schedule_expression(string $alias = 'e'): string
{
    $validStart = "{$alias}.start_datetime IS NOT NULL";
    $validDate = "{$alias}.event_date IS NOT NULL";
    return "($validStart OR $validDate)";
}

function event_missing_schedule_expression(string $alias = 'e'): string
{
    $hasExpr = event_has_schedule_expression($alias);
    return "(NOT $hasExpr)";
}

function event_schedule_sort_expression(string $alias = 'e'): string
{
    $hasExpr = event_has_schedule_expression($alias);
    return "CASE WHEN $hasExpr THEN 0 ELSE 1 END";
}

function event_has_schedule_metadata(array $event): bool
{
    $start = trim((string) ($event['start_datetime'] ?? ''));
    if ($start !== '' && $start !== '0000-00-00 00:00:00') {
        return true;
    }
    $date = trim((string) ($event['event_date'] ?? ''));
    if ($date !== '' && $date !== '0000-00-00') {
        return true;
    }
    return false;
}

function event_missing_schedule_metadata(array $event): bool
{
    return !event_has_schedule_metadata($event);
}

function events_table_has_column(PDO $pdo, string $column): bool
{
    static $cache = [];
    $key = strtolower($column);
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }
    try {
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $column)) {
            $cache[$key] = false;
            return false;
        }
        $quoted = str_replace("'", "''", $column);
        $stmt = $pdo->query("SHOW COLUMNS FROM events LIKE '{$quoted}'");
        $cache[$key] = (bool) ($stmt->fetch() ?: null);
    } catch (Throwable $error) {
        $cache[$key] = false;
        if (APP_DEBUG) {
            error_log('events_table_has_column failure: ' . $error->getMessage());
        }
    }
    return $cache[$key];
}

function events_table_has_index(PDO $pdo, string $indexName): bool
{
    static $cache = [];
    $key = strtolower($indexName);
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }
    try {
        $stmt = $pdo->prepare('SHOW INDEX FROM events WHERE Key_name = ?');
        $stmt->execute([$indexName]);
        $cache[$key] = (bool) $stmt->fetch();
    } catch (Throwable $error) {
        $cache[$key] = false;
        if (APP_DEBUG) {
            error_log('events_table_has_index failure: ' . $error->getMessage());
        }
    }
    return $cache[$key];
}

function event_categories_table_exists(PDO $pdo): bool
{
    static $exists = null;
    if ($exists !== null) {
        return $exists;
    }
    try {
        $pdo->query('SELECT 1 FROM event_categories LIMIT 1');
        $exists = true;
    } catch (Throwable $error) {
        $exists = false;
        if (APP_DEBUG) {
            error_log('event_categories_table_exists failure: ' . $error->getMessage());
        }
    }
    return $exists;
}

function audit_log_table_exists(PDO $pdo): bool
{
    static $exists = null;
    if ($exists !== null) {
        return $exists;
    }
    try {
        $pdo->query('SELECT 1 FROM audit_log LIMIT 1');
        $exists = true;
    } catch (Throwable $error) {
        $exists = false;
        if (APP_DEBUG) {
            error_log('audit_log_table_exists failure: ' . $error->getMessage());
        }
    }
    return $exists;
}

function normalize_category_id($value): ?int
{
    if ($value === null || $value === '' || $value === false) {
        return null;
    }
    if (!is_numeric($value)) {
        return null;
    }
    $id = (int) $value;
    return $id > 0 ? $id : null;
}

function fetch_event_category_by_id(PDO $pdo, int $id): ?array
{
    static $cache = [];
    if (array_key_exists($id, $cache)) {
        return $cache[$id];
    }
    try {
        $stmt = $pdo->prepare('SELECT * FROM event_categories WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $row = $stmt->fetch() ?: null;
        $cache[$id] = $row;
        return $row;
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('fetch_event_category_by_id failure: ' . $error->getMessage());
        }
        $cache[$id] = null;
        return null;
    }
}

function fetch_event_category_by_slug(PDO $pdo, string $slug): ?array
{
    static $cache = [];
    $key = strtolower($slug);
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }
    try {
        $stmt = $pdo->prepare('SELECT * FROM event_categories WHERE slug = ? LIMIT 1');
        $stmt->execute([$key]);
        $row = $stmt->fetch() ?: null;
        $cache[$key] = $row;
        return $row;
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('fetch_event_category_by_slug failure: ' . $error->getMessage());
        }
        $cache[$key] = null;
        return null;
    }
}

function default_event_category_id(PDO $pdo): ?int
{
    static $default = null;
    if ($default !== null) {
        return $default;
    }
    $category = fetch_event_category_by_slug($pdo, 'normal');
    $default = $category['id'] ?? null;
    return $default;
}

function fetch_event_category_with_count(PDO $pdo, int $id): ?array
{
    try {
        $stmt = $pdo->prepare('SELECT c.*, COUNT(e.id) AS usage_count FROM event_categories c LEFT JOIN events e ON e.category_id = c.id WHERE c.id = ? GROUP BY c.id');
        $stmt->execute([$id]);
        return $stmt->fetch() ?: null;
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('fetch_event_category_with_count failure: ' . $error->getMessage());
        }
        return null;
    }
}

function fetch_business_settings(): array
{
    $settings = [];
    try {
        $stmt = Database::run('SELECT setting_key, setting_value FROM business_settings');
        while ($row = $stmt->fetch()) {
            $key = $row['setting_key'] ?? null;
            if ($key === null) {
                continue;
            }
            $settings[$key] = $row['setting_value'];
        }
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('fetch_business_settings failure: ' . $error->getMessage());
        }
    }
    return $settings;
}

function decode_settings_json(array $settings, string $key, $default = [])
{
    if (!array_key_exists($key, $settings)) {
        return $default;
    }
    $raw = (string) $settings[$key];
    if (trim($raw) === '') {
        return $default;
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : $default;
}

function derive_variant_paths_from_disk(string $fileUrl): array
{
    $manifest = load_image_manifest($fileUrl);
    if ($manifest) {
        $payload = build_variant_payload_from_manifest($fileUrl, $manifest);
        return array_merge([
            'original' => $fileUrl,
        ], $payload);
    }

    $relative = relative_upload_path($fileUrl);
    if (!$relative) {
        return [
            'original' => $fileUrl,
            'optimized' => null,
            'webp' => null,
            'optimized_srcset' => null,
            'webp_srcset' => null,
            'fallback_original' => $fileUrl,
        ];
    }

    $baseDir = rtrim(UPLOADS_DIR, '/');
    $baseName = pathinfo($relative, PATHINFO_FILENAME);
    $extension = pathinfo($relative, PATHINFO_EXTENSION);
    $optimizedUrl = null;
    $webpUrl = null;

    if ($baseName && $extension) {
        $optimizedRelative = 'optimized/' . $baseName . '-optimized.' . $extension;
        $optimizedPath = $baseDir . '/' . $optimizedRelative;
        if (is_file($optimizedPath)) {
            $optimizedUrl = '/uploads/' . $optimizedRelative;
        }

        $webpRelative = 'webp/' . $baseName . '.webp';
        $webpPath = $baseDir . '/' . $webpRelative;
        if (is_file($webpPath)) {
            $webpUrl = '/uploads/' . $webpRelative;
        }
    }

    return [
        'original' => $fileUrl,
        'optimized' => $optimizedUrl,
        'webp' => $webpUrl,
        'optimized_srcset' => null,
        'webp_srcset' => null,
        'fallback_original' => $fileUrl,
    ];
}

function normalize_variant_candidate_url($candidate): ?string
{
    if (!is_string($candidate)) {
        return null;
    }
    $candidate = trim($candidate);
    if ($candidate === '') {
        return null;
    }

    $relative = null;
    if (str_starts_with($candidate, '/uploads/')) {
        $relative = ltrim(substr($candidate, strlen('/uploads/')), '/');
    } elseif (str_starts_with($candidate, 'uploads/')) {
        $relative = ltrim(substr($candidate, strlen('uploads/')), '/');
        $candidate = '/uploads/' . $relative;
    }

    if ($relative !== null) {
        if ($relative === '') {
            return null;
        }
        $fullPath = rtrim(UPLOADS_DIR, '/') . '/' . $relative;
        return is_file($fullPath) ? $candidate : null;
    }

    return $candidate;
}

function build_image_variants(array $fileUrls): array
{
    $variants = [];
    if (empty($fileUrls)) {
        return $variants;
    }

    $normalized = [];
    foreach ($fileUrls as $url) {
        if (!is_string($url) || trim($url) === '') {
            continue;
        }
        $normalized[] = $url;
    }

    if (empty($normalized)) {
        return $variants;
    }

    $unique = array_values(array_unique($normalized));
    $placeholders = implode(',', array_fill(0, count($unique), '?'));
    $map = [];
    try {
        $stmt = Database::run("SELECT file_url, optimized_path, webp_path FROM media WHERE file_url IN ({$placeholders})", $unique);
        while ($row = $stmt->fetch()) {
            $url = $row['file_url'] ?? null;
            if ($url) {
                $map[$url] = [
                    'optimized' => $row['optimized_path'] ?: null,
                    'webp' => $row['webp_path'] ?: null,
                ];
            }
        }
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('build_image_variants lookup failed: ' . $e->getMessage());
        }
    }

    foreach ($normalized as $url) {
        $manifest = load_image_manifest($url);
        if ($manifest) {
            $variants[] = build_variant_payload_from_manifest($url, $manifest);
            continue;
        }
        $fromDb = $map[$url] ?? [];
        $optimized = normalize_variant_candidate_url($fromDb['optimized'] ?? null);
        $webp = normalize_variant_candidate_url($fromDb['webp'] ?? null);
        if (!$optimized || !$webp) {
            $derived = derive_variant_paths_from_disk($url);
            $optimized = $optimized ?: ($derived['optimized'] ?? null);
            $webp = $webp ?: ($derived['webp'] ?? null);
        }
        $variants[] = [
            'file_url' => $url,
            'original' => $url,
            'optimized' => $optimized,
            'webp' => $webp,
            'optimized_srcset' => null,
            'webp_srcset' => null,
            'fallback_original' => $url,
        ];
    }

    return $variants;
}

function build_single_image_variant(?string $fileUrl): ?array
{
    if (!$fileUrl || trim($fileUrl) === '') {
        return null;
    }
    $variants = build_image_variants([$fileUrl]);
    if (!empty($variants)) {
        return $variants[0];
    }
    $derived = derive_variant_paths_from_disk($fileUrl);
    return [
        'file_url' => $fileUrl,
        'original' => $derived['original'] ?? $fileUrl,
        'optimized' => $derived['optimized'] ?? null,
        'webp' => $derived['webp'] ?? null,
        'optimized_srcset' => $derived['optimized_srcset'] ?? null,
        'webp_srcset' => $derived['webp_srcset'] ?? null,
        'fallback_original' => $derived['fallback_original'] ?? $fileUrl,
    ];
}

function log_admin_session_state(string $message): void
{
    if (!APP_DEBUG) {
        return;
    }
    $state = [
        'session_status' => session_status(),
        'session_name' => session_name(),
        'has_admin_user' => isset($_SESSION['admin_user']),
        'session_id_prefix' => session_id() ? substr(session_id(), 0, 8) : null,
        'cookies' => array_keys($_COOKIE ?? []),
        'admin_expires_at' => $_SESSION['admin_expires_at'] ?? null,
        'admin_last_active' => $_SESSION['admin_last_active'] ?? null,
    ];
    error_log($message . ' ' . json_encode($state));
}

function sanitize_admin_user(array $row): array
{
    $username = $row['username'] ?? null;
    $email = $row['email'] ?? null;
    $rawDisplay = $row['display_name'] ?? $row['name'] ?? $row['full_name'] ?? $username ?? '';
    if (!$rawDisplay && $email) {
        $rawDisplay = explode('@', $email)[0] ?? '';
    }
    $display = trim($rawDisplay !== '' ? $rawDisplay : 'Admin');
    if ($email && str_starts_with(strtolower($email), 'admin@')) {
        $display = 'Admin';
    }
    return [
        'id' => isset($row['id']) ? (int) $row['id'] : null,
        'username' => $username ?? null,
        'email' => $email ?? null,
        'display_name' => $display,
        'created_at' => $row['created_at'] ?? $row['created'] ?? $row['updated_at'] ?? null,
        'updated_at' => $row['updated_at'] ?? null,
    ];
}

function admin_column_cache_key(string $column): string
{
    return '_admins_column_' . strtolower($column);
}

function set_admin_column_flag(string $column, bool $value): void
{
    $GLOBALS[admin_column_cache_key($column)] = $value;
}

function admin_table_has_column(string $column): bool
{
    $key = admin_column_cache_key($column);
    if (array_key_exists($key, $GLOBALS)) {
        return (bool) $GLOBALS[$key];
    }
    try {
        $stmt = Database::run("SHOW COLUMNS FROM admins LIKE ?", [$column]);
        $exists = (bool) $stmt->fetch();
    } catch (Throwable $e) {
        $exists = false;
    }
    $GLOBALS[$key] = $exists;
    return $exists;
}

function ensure_admins_column_exists(string $column, string $alterSql): void
{
    if (admin_table_has_column($column)) {
        return;
    }
    try {
        Database::run($alterSql);
        set_admin_column_flag($column, true);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log("Failed to ensure admins.{$column} column: " . $e->getMessage());
        }
        set_admin_column_flag($column, false);
    }
}

function start_admin_session(array $user): array
{
    $expiresAt = time() + ADMIN_SESSION_LIFETIME;
    $_SESSION['admin_user'] = $user;
    $_SESSION['admin_expires_at'] = $expiresAt;
    $_SESSION['admin_last_active'] = time();
    return [
        'user' => $user,
        'expires_at' => gmdate(DateTimeInterface::ATOM, $expiresAt),
        'idle_timeout_seconds' => ADMIN_SESSION_IDLE_TIMEOUT,
    ];
}

function current_admin_session(): ?array
{
    if (session_status() !== PHP_SESSION_ACTIVE || empty($_SESSION['admin_user'])) {
        return null;
    }
    $now = time();
    $expiresAt = (int) ($_SESSION['admin_expires_at'] ?? 0);
    $lastActive = (int) ($_SESSION['admin_last_active'] ?? 0);
    if (($expiresAt && $expiresAt < $now) || ($lastActive && ($now - $lastActive) > ADMIN_SESSION_IDLE_TIMEOUT)) {
        destroy_admin_session();
        return null;
    }
    return [
        'user' => $_SESSION['admin_user'],
        'expires_at' => $expiresAt ? gmdate(DateTimeInterface::ATOM, $expiresAt) : null,
        'idle_timeout_seconds' => ADMIN_SESSION_IDLE_TIMEOUT,
    ];
}

function refresh_admin_session(): ?array
{
    if (session_status() !== PHP_SESSION_ACTIVE || empty($_SESSION['admin_user'])) {
        return null;
    }
    $_SESSION['admin_last_active'] = time();
    return current_admin_session();
}

function destroy_admin_session(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        return;
    }
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?? '', $params['secure'] ?? false, $params['httponly'] ?? true);
    }
    session_destroy();
}

function now_eastern(): DateTimeImmutable
{
    return new DateTimeImmutable('now', new DateTimeZone('America/New_York'));
}

function resolve_event_start_datetime(array $event): ?DateTimeImmutable
{
    $tz = new DateTimeZone($event['timezone'] ?? 'America/New_York');
    $start = $event['start_datetime'] ?? null;
    if ($start) {
        try {
            return new DateTimeImmutable($start, $tz);
        } catch (Throwable $e) {
            // fall through
        }
    }
    if (!empty($event['event_date'])) {
        $timePart = $event['event_time'] ?? '00:00:00';
        $candidate = $event['event_date'] . ' ' . $timePart;
        try {
            return new DateTimeImmutable($candidate, $tz);
        } catch (Throwable $e) {
            // ignore
        }
    }
    return null;
}

function resolve_event_end_datetime(array $event, int $fallbackHours = 4): ?DateTimeImmutable
{
    $tz = new DateTimeZone($event['timezone'] ?? 'America/New_York');
    $end = $event['end_datetime'] ?? null;
    if ($end) {
        try {
            return new DateTimeImmutable($end, $tz);
        } catch (Throwable $e) {
            // fall through
        }
    }
    $start = resolve_event_start_datetime($event);
    if ($start) {
        return $start->modify('+' . max(1, $fallbackHours) . ' hours');
    }
    return null;
}

function compute_hold_expiration(DateTimeImmutable $now): DateTimeImmutable
{
    return $now->modify('+24 hours');
}

function format_datetime_eastern(?DateTimeInterface $dateTime): string
{
    if (!$dateTime) {
        return 'TBD';
    }
    return $dateTime->setTimezone(new DateTimeZone('America/New_York'))->format('l, F j, Y g:i A T');
}

function format_event_datetime_for_email(array $event): string
{
    $start = resolve_event_start_datetime($event);
    if ($start instanceof DateTimeInterface) {
        return format_datetime_eastern($start);
    }
    if (!empty($event['event_date'])) {
        $time = trim((string) ($event['event_time'] ?? ''));
        return trim($event['event_date'] . ' ' . $time);
    }
    return 'TBD';
}

function decode_seat_list($seats): array
{
    if (is_array($seats)) {
        return $seats;
    }
    if (is_string($seats)) {
        $decoded = json_decode($seats, true);
        return is_array($decoded) ? $decoded : [];
    }
    return [];
}

function notify_seat_request_emails(array $seatRequest, array $event): void
{
    try {
        $emailer = Emailer::instance();
    } catch (Throwable $error) {
        error_log('[email] Failed to initialize emailer for seat request: ' . $error->getMessage());
        return;
    }

    $eventTitle = trim((string) ($event['title'] ?? ''));
    if ($eventTitle === '') {
        $eventTitle = trim((string) ($event['artist_name'] ?? 'Midway Music Hall Event'));
    }
    if ($eventTitle === '') {
        $eventTitle = 'Midway Music Hall Event';
    }
    $timestamp = format_datetime_eastern(now_eastern());
    $eventDate = format_event_datetime_for_email($event);
    $seatList = build_display_seat_list($seatRequest);
    $seatCount = count($seatList);
    $seatSummary = $seatCount ? implode(', ', $seatList) : 'None provided';
    $notes = trim((string) ($seatRequest['special_requests'] ?? ''));
    $notes = $notes !== '' ? $notes : 'None provided';
    $holdExpiresLine = '';
    if (!empty($seatRequest['hold_expires_at'])) {
        try {
            $holdDate = new DateTimeImmutable($seatRequest['hold_expires_at'], new DateTimeZone('America/New_York'));
            $holdExpiresLine = "\nHold Expires (ET): " . format_datetime_eastern($holdDate);
        } catch (Throwable $e) {
            $holdExpiresLine = '';
        }
    }
    $requestId = $seatRequest['id'] ?? 'n/a';
    $customerEmail = isset($seatRequest['customer_email']) ? trim((string) $seatRequest['customer_email']) : '';
    if ($customerEmail && !filter_var($customerEmail, FILTER_VALIDATE_EMAIL)) {
        $customerEmail = '';
    }
    $customerPhone = trim((string) ($seatRequest['customer_phone'] ?? ''));
    $customerName = trim((string) ($seatRequest['customer_name'] ?? ''));
    $customerNameLine = $customerName !== '' ? $customerName : 'Unknown';
    $customerEmailLine = $customerEmail !== '' ? $customerEmail : 'Not provided';
    $customerPhoneLine = $customerPhone !== '' ? $customerPhone : 'Not provided';
    $staffBody = <<<TEXT
New seat request received.

Timestamp (ET): {$timestamp}
Seat Request ID: {$requestId}
Event: {$eventTitle}
Event Date/Time (ET): {$eventDate}{$holdExpiresLine}

Customer Name: {$customerNameLine}
Customer Email: {$customerEmailLine}
Customer Phone: {$customerPhoneLine}

Selected Seats ({$seatCount}):
{$seatSummary}

Notes / Special Requests:
{$notes}
TEXT;

    [$staffInbox] = determine_seat_request_recipient($event);
    $staffSubject = 'New Seat Request - ' . $eventTitle;
    $replyTo = $customerEmail !== '' ? $customerEmail : $staffInbox;

    try {
        $emailer->send([
            'to' => $staffInbox,
            'from' => $emailer->notificationsSender(),
            'subject' => $staffSubject,
            'body' => $staffBody,
            'reply_to' => $replyTo,
        ]);
    } catch (Throwable $sendError) {
        error_log('[email] Seat request staff notification failed: ' . $sendError->getMessage());
    }

    if ($customerEmail === '') {
        return;
    }

    $customerGreeting = $customerName !== '' ? $customerName : 'there';
    $customerBody = <<<TEXT
Hi {$customerGreeting},

Thanks for reaching out to Midway Music Hall. We received your seat request for "{$eventTitle}" on {$timestamp}.

Request summary:
- Event: {$eventTitle}
- Event Date/Time (ET): {$eventDate}
- Seats Requested ({$seatCount}): {$seatSummary}
- Notes: {$notes}
- Phone: {$customerPhoneLine}

Our team will review your request and will follow up with availability and next steps. If you need to update your request, just reply to this email or contact us at {$staffInbox}.

Thank you,
Midway Music Hall
TEXT;

    try {
        $emailer->send([
            'to' => $customerEmail,
            'from' => $emailer->notificationsSender(),
            'subject' => 'Seat Request Received - ' . $eventTitle,
            'body' => $customerBody,
            'reply_to' => $staffInbox,
        ]);
    } catch (Throwable $sendError) {
        error_log('[email] Seat request customer confirmation failed: ' . $sendError->getMessage());
    }
}

function stringify_contact_field($value): string
{
    if (is_array($value)) {
        $flattened = array_filter(array_map(function ($item) {
            return is_scalar($item) ? trim((string) $item) : '';
        }, $value), function ($item) {
            return $item !== '';
        });
        return $flattened ? implode(', ', $flattened) : '';
    }
    if (is_string($value) || is_numeric($value)) {
        return trim((string) $value);
    }
    return '';
}

function notify_artist_suggestion_emails(int $suggestionId, string $artistName, array $contact, string $notes, string $submissionType): void
{
    try {
        $emailer = Emailer::instance();
    } catch (Throwable $error) {
        error_log('[email] Failed to initialize emailer for artist suggestion: ' . $error->getMessage());
        return;
    }

    $timestamp = format_datetime_eastern(now_eastern());
    $contactName = trim((string) ($contact['name'] ?? ''));
    $contactEmail = stringify_contact_field($contact['email'] ?? $contact['contact_email'] ?? '');
    if ($contactEmail && !filter_var($contactEmail, FILTER_VALIDATE_EMAIL)) {
        $contactEmail = '';
    }
    $contactPhone = stringify_contact_field($contact['phone'] ?? $contact['contact_phone'] ?? '');
    $genre = stringify_contact_field($contact['genre'] ?? '');
    $musicLinks = stringify_contact_field($contact['music_links'] ?? ($contact['links'] ?? ''));
    $social = stringify_contact_field($contact['social_media'] ?? '');
    $raw = stringify_contact_field($contact['raw'] ?? '');
    $notesText = trim($notes) !== '' ? trim($notes) : 'None provided';
    $submissionLabel = ucfirst(str_replace('_', ' ', trim($submissionType))) ?: 'General';

    $staffBodySections = [
        "New artist suggestion submitted.",
        "",
        "Timestamp (ET): {$timestamp}",
        "Suggestion ID: {$suggestionId}",
        "Artist: {$artistName}",
        "Submission Type: {$submissionLabel}",
        "Submitter Name: " . ($contactName !== '' ? $contactName : 'Unknown'),
        "Submitter Email: " . ($contactEmail !== '' ? $contactEmail : 'Not provided'),
        "Submitter Phone: " . ($contactPhone !== '' ? $contactPhone : 'Not provided'),
        "Genre: " . ($genre !== '' ? $genre : 'Not provided'),
    ];
    if ($musicLinks !== '') {
        $staffBodySections[] = 'Music Links: ' . $musicLinks;
    }
    if ($social !== '') {
        $staffBodySections[] = 'Social Media: ' . $social;
    }
    if ($raw !== '') {
        $staffBodySections[] = 'Original Contact Entry: ' . $raw;
    }
    $staffBodySections[] = '';
    $staffBodySections[] = "Notes / Message:";
    $staffBodySections[] = $notesText;
    $staffBody = implode("\n", $staffBodySections);

    $replyTo = $contactEmail !== '' ? $contactEmail : $emailer->staffRecipient();
    try {
        $emailer->send([
            'to' => $emailer->staffRecipient(),
            'from' => $emailer->notificationsSender(),
            'subject' => 'New Artist Suggestion - ' . $artistName,
            'body' => $staffBody,
            'reply_to' => $replyTo,
        ]);
    } catch (Throwable $sendError) {
        error_log('[email] Artist suggestion staff notification failed: ' . $sendError->getMessage());
    }

    if ($contactEmail === '') {
        return;
    }

    $greeting = $contactName !== '' ? $contactName : 'there';
    $customerBodyLines = [
        "Hi {$greeting},",
        "",
        "Thanks for sharing \"{$artistName}\" with Midway Music Hall. We received your suggestion on {$timestamp}.",
        "",
        "Submission summary:",
        "- Artist: {$artistName}",
        "- Submission Type: {$submissionLabel}",
        "- Notes: {$notesText}",
    ];
    if ($musicLinks !== '') {
        $customerBodyLines[] = "- Music Links: {$musicLinks}";
    }
    if ($social !== '') {
        $customerBodyLines[] = "- Social Media: {$social}";
    }
    $customerBodyLines[] = "";
    $customerBodyLines[] = "Our programming team reviews every submission. We'll reach out if we have availability or questions. Reply to this email any time to add more info.";
    $customerBodyLines[] = "";
    $customerBodyLines[] = "Thank you,";
    $customerBodyLines[] = "Midway Music Hall";
    $customerBody = implode("\n", $customerBodyLines);

    try {
        $emailer->send([
            'to' => $contactEmail,
            'from' => $emailer->notificationsSender(),
            'subject' => 'Artist Suggestion Received - ' . $artistName,
            'body' => $customerBody,
            'reply_to' => $emailer->staffRecipient(),
        ]);
    } catch (Throwable $sendError) {
        error_log('[email] Artist suggestion customer confirmation failed: ' . $sendError->getMessage());
    }
}

function redact_sensitive_values($value)
{
    if (is_array($value)) {
        $redacted = [];
        foreach ($value as $key => $item) {
            if (is_string($key) && is_sensitive_key($key)) {
                $redacted[$key] = '[redacted]';
                continue;
            }
            $redacted[$key] = redact_sensitive_values($item);
        }
        return $redacted;
    }
    return $value;
}

function is_sensitive_key(string $key): bool
{
    $lower = strtolower($key);
    $keywords = ['password', 'pass', 'token', 'secret', 'authorization', 'api_key', 'apikey', 'auth', 'key', 'session'];
    foreach ($keywords as $needle) {
        if (str_contains($lower, $needle)) {
            return true;
        }
    }
    return false;
}

function notify_unhandled_error(Throwable $error, Request $request): void
{
    try {
        $emailer = Emailer::instance();
    } catch (Throwable $initError) {
        error_log('[email] Failed to initialize emailer for alert: ' . $initError->getMessage());
        $emailer = null;
    }

    $timestamp = format_datetime_eastern(now_eastern());
    $method = $request->method ?? ($_SERVER['REQUEST_METHOD'] ?? 'CLI');
    $path = $request->path ?? (parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
    $queryString = $request->query ? json_encode($request->query, JSON_PRETTY_PRINT) : '{}';
    $payload = $request->json ?? $request->body ?? [];
    $redactedPayload = $payload ? json_encode(redact_sensitive_values($payload), JSON_PRETTY_PRINT) : '{}';
    $rawBody = $request->raw();
    if (strlen($rawBody) > 800) {
        $rawBody = substr($rawBody, 0, 800) . '...';
    }
    $userAgent = $_SERVER['HTTP_USER_AGENT'] ?? 'unknown';
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $host = $_SERVER['HTTP_HOST'] ?? 'unknown';

    $bodyParts = [
        "A backend error occurred.",
        "",
        "Timestamp (ET): {$timestamp}",
        "Host: {$host}",
        "Request: {$method} {$path}",
        "IP: {$ip}",
        "User Agent: {$userAgent}",
        "",
        "Query Params:",
        $queryString,
        "",
        "Payload (redacted):",
        $redactedPayload,
    ];
    if ($rawBody !== '') {
        $bodyParts[] = '';
        $bodyParts[] = 'Raw Body Preview:';
        $bodyParts[] = $rawBody;
    }
    $bodyParts[] = '';
    $bodyParts[] = 'Error Message: ' . $error->getMessage();
    $bodyParts[] = 'Error Code: ' . $error->getCode();
    $bodyParts[] = '';
    $bodyParts[] = 'Stack Trace:';
    $bodyParts[] = $error->getTraceAsString();

    if ($emailer) {
        $subject = '[MMH] Backend Error - ' . $method . ' ' . $path;
        try {
            $emailer->send([
                'to' => $emailer->alertsRecipient(),
                'from' => $emailer->alertsSender(),
                'subject' => $subject,
                'body' => implode("\n", $bodyParts),
                'reply_to' => $emailer->alertsRecipient(),
            ]);
        } catch (Throwable $sendError) {
            error_log('[email] Failed to send backend error alert: ' . $sendError->getMessage());
        }
    }
}
function seat_request_status_aliases(): array
{
    return [
        'new' => 'new',
        'hold' => 'new',
        'contacted' => 'contacted',
        'waiting' => 'waiting',
        'pending' => 'waiting',
        'confirmed' => 'confirmed',
        'finalized' => 'confirmed',
        'approved' => 'confirmed',
        'declined' => 'declined',
        'denied' => 'declined',
        'closed' => 'closed',
        'cancelled' => 'closed',
        'spam' => 'spam',
        'expired' => 'expired',
    ];
}

function canonical_seat_request_statuses(): array
{
    return ['new', 'contacted', 'waiting', 'confirmed', 'declined', 'closed', 'spam', 'expired'];
}

function open_seat_request_statuses(): array
{
    return ['new', 'contacted', 'waiting'];
}

function normalize_seat_request_status(?string $status): string
{
    if ($status === null) {
        return 'new';
    }
    $map = seat_request_status_aliases();
    $normalized = strtolower(trim($status));
    return $map[$normalized] ?? $normalized ?: 'new';
}

function seat_request_admin_actor(): string
{
    $session = current_admin_session();
    if ($session && !empty($session['user'])) {
        $user = $session['user'];
        return $user['display_name'] ?? $user['username'] ?? $user['email'] ?? 'admin';
    }
    return 'admin';
}

function audit_log_actor(): string
{
    $session = current_admin_session();
    if ($session && isset($session['user'])) {
        $user = $session['user'];
        foreach (['display_name', 'username', 'email'] as $field) {
            if (!empty($user[$field])) {
                return (string) $user[$field];
            }
        }
    }
    return seat_request_admin_actor() ?: 'system';
}

function record_audit(string $action, string $entityType, $entityId = null, array $meta = []): void
{
    try {
        $pdo = Database::connection();
        if (!audit_log_table_exists($pdo)) {
            return;
        }
        $actor = audit_log_actor();
        $entityValue = $entityId !== null ? (string) $entityId : null;
        $metaJson = $meta ? json_encode($meta) : null;
        $stmt = $pdo->prepare('INSERT INTO audit_log (actor, action, entity_type, entity_id, meta_json) VALUES (?, ?, ?, ?, ?)');
        $stmt->execute([$actor, $action, $entityType, $entityValue, $metaJson]);
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('record_audit failure: ' . $error->getMessage());
        }
    }
}

/**
 * Determine which inbox should receive seat request notifications for an event.
 *
 * @return array{0:string,1:string} [recipientEmail, source]
 */
function determine_seat_request_recipient(array $eventRow): array
{
    $emailer = Emailer::instance();
    $defaultRecipient = $emailer->staffRecipient();
    $categorySlug = strtolower(trim((string)($eventRow['category_slug'] ?? '')));
    $eventOverride = trim((string)($eventRow['seat_request_email_override'] ?? ''));
    if ($eventOverride !== '') {
        return [$eventOverride, 'event'];
    }
    $categoryOverride = trim((string)($eventRow['category_seat_request_email_to'] ?? ''));
    if ($categoryOverride !== '') {
        return [$categoryOverride, 'category'];
    }
    if ($categorySlug === 'beach-bands') {
        $beachRecipient = (string) Env::get('BEACH_BANDS_EMAIL_TO', 'mmhbeachbands@gmail.com');
        return [$beachRecipient, 'category_slug'];
    }
    return [$defaultRecipient, 'default'];
}

function expire_stale_holds(PDO $pdo): void
{
    $statuses = array_merge(open_seat_request_statuses(), ['hold', 'pending']);
    $placeholders = implode(',', array_fill(0, count($statuses), '?'));
    $selectSql = "SELECT id FROM seat_requests WHERE status IN ($placeholders) AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW()";
    $select = $pdo->prepare($selectSql);
    $select->execute($statuses);
    $expiredIds = $select->fetchAll(PDO::FETCH_COLUMN);
    if (!$expiredIds) {
        return;
    }
    $updateSql = "UPDATE seat_requests SET status = 'expired', change_note = 'auto-expired hold', hold_expires_at = NULL, updated_at = NOW() WHERE status IN ($placeholders) AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW()";
    $update = $pdo->prepare($updateSql);
    $update->execute($statuses);
    foreach ($expiredIds as $expiredId) {
        record_audit('seat_request.expire', 'seat_request', (int) $expiredId);
    }
}

function snapshot_layout_version(PDO $pdo, ?int $layoutId, string $changeNote = 'auto-snapshot'): ?int
{
    if (!$layoutId) {
        return null;
    }
    $stmt = $pdo->prepare('SELECT layout_data, stage_position, stage_size, canvas_settings FROM seating_layouts WHERE id = ? LIMIT 1');
    $stmt->execute([$layoutId]);
    $layout = $stmt->fetch();
    if (!$layout) {
        return null;
    }
    $versionStmt = $pdo->prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM seating_layout_versions WHERE layout_id = ?');
    $versionStmt->execute([$layoutId]);
    $nextVersion = (int) ($versionStmt->fetchColumn() ?: 1);
    $insert = $pdo->prepare('INSERT INTO seating_layout_versions (layout_id, version_number, layout_data, stage_position, stage_size, canvas_settings, created_by, change_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    $insert->execute([
        $layoutId,
        $nextVersion,
        $layout['layout_data'],
        $layout['stage_position'],
        $layout['stage_size'],
        $layout['canvas_settings'] ?? null,
        'system',
        $changeNote
    ]);
    return (int) $pdo->lastInsertId();
}

function ensure_event_layout_version(PDO $pdo, ?int $layoutId, ?int $requestedVersion = null): ?int
{
    if (!$layoutId) {
        return null;
    }
    if ($requestedVersion) {
        $check = $pdo->prepare('SELECT id FROM seating_layout_versions WHERE id = ? AND layout_id = ?');
        $check->execute([$requestedVersion, $layoutId]);
        if ($check->fetch()) {
            return $requestedVersion;
        }
    }
    return snapshot_layout_version($pdo, $layoutId);
}

function detect_seat_conflicts(PDO $pdo, int $eventId, array $seatIds): array
{
    if (empty($seatIds)) {
        return [];
    }
    $conflicts = [];
    $now = now_eastern();
    $stmt = $pdo->prepare("SELECT selected_seats, status, hold_expires_at FROM seat_requests WHERE event_id = ?");
    $stmt->execute([$eventId]);
    $holdStatuses = open_seat_request_statuses();
    while ($row = $stmt->fetch()) {
        $status = normalize_seat_request_status($row['status'] ?? null);
        $shouldConsider = false;
        if ($status === 'confirmed') {
            $shouldConsider = true;
        } elseif (in_array($status, $holdStatuses, true)) {
            $shouldConsider = true;
            if (!empty($row['hold_expires_at'])) {
                try {
                    $expiry = new DateTimeImmutable($row['hold_expires_at'], new DateTimeZone('America/New_York'));
                    if ($expiry < $now) {
                        $shouldConsider = false;
                    }
                } catch (Throwable $e) {
                    // if parsing fails, default to considering the hold to be safe
                }
            }
        }
        if (!$shouldConsider) {
            continue;
        }
        $existing = parse_selected_seats($row['selected_seats']);
        foreach ($existing as $seat) {
            if (in_array($seat, $seatIds, true)) {
                $conflicts[] = $seat;
            }
        }
    }
    $seatStmt = $pdo->prepare('SELECT selected_seats FROM seating WHERE event_id = ? AND selected_seats IS NOT NULL');
    $seatStmt->execute([$eventId]);
    while ($row = $seatStmt->fetch()) {
        $existing = parse_selected_seats($row['selected_seats']);
        foreach ($existing as $seat) {
            if (in_array($seat, $seatIds, true)) {
                $conflicts[] = $seat;
            }
        }
    }
    return array_values(array_unique($conflicts));
}

function parse_seat_identifier(string $seatId): array
{
    $parts = explode('-', $seatId);
    if (count($parts) < 3) {
        return [null, null, null];
    }
    $seatNum = array_pop($parts);
    $rowLabel = array_pop($parts);
    $section = implode('-', $parts);
    return [$section, $rowLabel, $seatNum];
}

function apply_seat_reservations(PDO $pdo, array $seatIds): void
{
    foreach ($seatIds as $seatId) {
        [$section, $rowLabel] = parse_seat_identifier($seatId);
        if (!$section || !$rowLabel) {
            continue;
        }
        $stmt = $pdo->prepare('SELECT id, selected_seats FROM seating WHERE section = ? AND row_label = ? LIMIT 1');
        $stmt->execute([$section, $rowLabel]);
        $row = $stmt->fetch();
        if (!$row) {
            continue;
        }
        $existing = parse_selected_seats($row['selected_seats']);
        if (!in_array($seatId, $existing, true)) {
            $existing[] = $seatId;
            $update = $pdo->prepare('UPDATE seating SET selected_seats = ? WHERE id = ?');
            $update->execute([json_encode($existing), $row['id']]);
        }
    }
}

function create_seat_request_record(PDO $pdo, array $payload, array $options = []): array
{
    expire_stale_holds($pdo);
    $createdBy = $options['created_by'] ?? 'public';
    $updatedBy = $options['updated_by'] ?? $createdBy;
    $defaultStatus = normalize_seat_request_status($options['default_status'] ?? 'new');
    $allowOverride = !empty($options['allow_status_override']);
    $forcedStatus = $options['forced_status'] ?? null;
    $statusInput = $forcedStatus ?? ($allowOverride ? ($payload['status'] ?? null) : null);
    $status = $statusInput ? normalize_seat_request_status($statusInput) : $defaultStatus;
    if (!in_array($status, canonical_seat_request_statuses(), true)) {
        $status = $defaultStatus;
    }
    $rawSeats = $payload['selected_seats'] ?? $payload['selectedSeats'] ?? [];
    if (!is_array($rawSeats)) {
        $rawSeats = [];
    }
    $selectedSeats = array_values(array_filter(array_map(function ($seat) {
        return is_string($seat) ? trim($seat) : '';
    }, $rawSeats), function ($seat) {
        return $seat !== '';
    }));
    if (empty($selectedSeats)) {
        throw new SeatRequestException('selected_seats is required');
    }
    $eventIdRaw = $payload['event_id'] ?? $payload['eventId'] ?? null;
    $eventId = (int) $eventIdRaw;
    if ($eventId <= 0) {
        throw new SeatRequestException('event_id is required');
    }
    $customerName = trim((string)($payload['customer_name'] ?? $payload['customerName'] ?? ''));
    if ($customerName === '') {
        throw new SeatRequestException('customer_name is required');
    }
    $contactPayload = $payload['contact'] ?? $payload['contactInfo'] ?? [];
    $contactPhone = isset($contactPayload['phone']) ? trim((string)$contactPayload['phone']) : '';
    if ($contactPhone === '') {
        throw new SeatRequestException('phone is required');
    }
    $customerEmail = isset($contactPayload['email']) ? trim((string)$contactPayload['email']) : '';
    if ($customerEmail && !filter_var($customerEmail, FILTER_VALIDATE_EMAIL)) {
        throw new SeatRequestException('Invalid email address');
    }
    $customerPhoneNormalized = normalize_phone_number($contactPhone) ?: null;

    $hasCategoryTable = event_categories_table_exists($pdo);
    if ($hasCategoryTable) {
        $eventStmt = $pdo->prepare('SELECT e.id, e.title, e.artist_name, e.layout_id, e.layout_version_id, e.seating_enabled, e.start_datetime, e.event_date, e.event_time, e.timezone, e.seat_request_email_override, ec.slug AS category_slug, ec.seat_request_email_to AS category_seat_request_email_to FROM events e LEFT JOIN event_categories ec ON ec.id = e.category_id WHERE e.id = ? LIMIT 1');
        $eventStmt->execute([$eventId]);
    } else {
        $eventStmt = $pdo->prepare('SELECT id, title, artist_name, layout_id, layout_version_id, seating_enabled, start_datetime, event_date, event_time, timezone, seat_request_email_override FROM events WHERE id = ? LIMIT 1');
        $eventStmt->execute([$eventId]);
    }
    $event = $eventStmt->fetch();
    if (!$event) {
        throw new SeatRequestException('Event not found', 404);
    }
    $hasLayout = !empty($event['layout_id']) || !empty($event['layout_version_id']);
    if ((int)($event['seating_enabled'] ?? 0) !== 1 || !$hasLayout) {
        throw new SeatRequestException('Seating requests are not available for this event');
    }

    $conflicts = detect_seat_conflicts($pdo, $eventId, $selectedSeats);
    if (!empty($conflicts)) {
        throw new SeatRequestException('Seats unavailable', 409, ['conflicts' => $conflicts]);
    }

    $now = now_eastern();
    $holdDate = null;
    if (in_array($status, open_seat_request_statuses(), true)) {
        $holdDate = compute_hold_expiration($now);
    }
    $holdExpiry = $holdDate ? $holdDate->format('Y-m-d H:i:s') : null;
    $finalizedAt = $status === 'confirmed' ? $now->format('Y-m-d H:i:s') : null;

    $layoutVersionId = $event['layout_version_id'];
    if (!$layoutVersionId && $event['layout_id']) {
        $layoutVersionId = snapshot_layout_version($pdo, $event['layout_id'], 'auto-reservation');
        if ($layoutVersionId) {
            Database::run('UPDATE events SET layout_version_id = ? WHERE id = ?', [$layoutVersionId, $eventId]);
        }
    }
    $snapshotData = null;
    if ($layoutVersionId) {
        $snapStmt = $pdo->prepare('SELECT layout_data FROM seating_layout_versions WHERE id = ? LIMIT 1');
        $snapStmt->execute([$layoutVersionId]);
        $snapshotRow = $snapStmt->fetch();
        $snapshotData = $snapshotRow ? $snapshotRow['layout_data'] : null;
    }

    Database::run(
        'INSERT INTO seat_requests (event_id, layout_version_id, seat_map_snapshot, customer_name, customer_email, customer_phone, customer_phone_normalized, selected_seats, total_seats, special_requests, status, hold_expires_at, finalized_at, created_by, updated_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [
            $eventId,
            $layoutVersionId,
            $snapshotData,
            $customerName,
            $customerEmail ?: '',
            $contactPhone,
            $customerPhoneNormalized,
            json_encode($selectedSeats),
            count($selectedSeats),
            $payload['special_requests'] ?? $payload['specialRequests'] ?? null,
            $status,
            $holdExpiry,
            $finalizedAt,
            $createdBy,
            $updatedBy
        ]
    );
    $id = (int) $pdo->lastInsertId();
    if ($status === 'confirmed') {
        apply_seat_reservations($pdo, $selectedSeats);
    }
    $createdStmt = $pdo->prepare('SELECT * FROM seat_requests WHERE id = ? LIMIT 1');
    $createdStmt->execute([$id]);
    $created = $createdStmt->fetch() ?: ['id' => $id];
    if ($created) {
        $created['seat_display_labels'] = build_display_seat_list($created);
    }
    try {
        notify_seat_request_emails($created, $event);
    } catch (Throwable $notifyError) {
        error_log('[email] Unable to process seat request notifications: ' . $notifyError->getMessage());
    }
    return [
        'seat_request' => $created,
        'hold_expires_at' => $holdDate ? $holdDate->format(DateTimeInterface::ATOM) : null,
    ];
}
function list_events(Request $request, ?string $scopeOverride = null): array
{
    $pdo = Database::connection();
    $hasCategoryTable = event_categories_table_exists($pdo);
    $params = [];
    $conditions = [];
    $includeDeleted = !empty($request->query['include_deleted']);
    $scope = $scopeOverride ? strtolower($scopeOverride) : strtolower((string)($request->query['scope'] ?? 'admin'));
    $includeSeriesMasters = $scope !== 'public' && !empty($request->query['include_series_masters']);
    $venue = strtoupper(trim((string)($request->query['venue'] ?? '')));
    $status = strtolower(trim((string)($request->query['status'] ?? '')));
    $limit = (int)($request->query['limit'] ?? 200);
    $limit = max(1, min($limit, 500));
    $page = max(1, (int)($request->query['page'] ?? 1));
    $offset = ($page - 1) * $limit;
    $timeframe = strtolower(trim((string)($request->query['timeframe'] ?? '')));
    $archivedFilterRaw = isset($request->query['archived']) ? strtolower(trim((string)$request->query['archived'])) : null;
    $hasArchivedColumn = events_table_has_column($pdo, 'archived_at');

    if (!$includeDeleted) {
        $conditions[] = 'e.deleted_at IS NULL';
    }
    if ($venue && in_array($venue, ['MMH','TGP'], true)) {
        $conditions[] = 'e.venue_code = ?';
        $params[] = $venue;
    }
    if ($status) {
        if ($includeSeriesMasters) {
            $conditions[] = '(e.status = ? OR e.is_series_master = 1)';
        } else {
            $conditions[] = 'e.status = ?';
        }
        $params[] = $status;
    }
    if ($hasArchivedColumn) {
        if ($archivedFilterRaw === '1') {
            $conditions[] = 'e.archived_at IS NOT NULL';
        } elseif ($archivedFilterRaw === 'all') {
            // no-op
        } else {
            $conditions[] = 'e.archived_at IS NULL';
        }
    } else {
        if ($archivedFilterRaw === '1') {
            $conditions[] = 'e.status = ?';
            $params[] = 'archived';
        } elseif ($archivedFilterRaw === 'all') {
            // leave rows as-is
        } else {
            $conditions[] = 'e.status != ?';
            $params[] = 'archived';
        }
    }
    if ($scope === 'public') {
        $conditions[] = "e.status = 'published'";
        $conditions[] = "e.visibility = 'public'";
    }
    $nowExpr = "NOW()";
    $endExpr = event_end_expression('e');
    $hasScheduleExpr = event_has_schedule_expression('e');
    $missingScheduleExpr = event_missing_schedule_expression('e');
    $scheduleSortExpr = event_schedule_sort_expression('e');
    $orderBy = "ORDER BY $scheduleSortExpr ASC, e.start_datetime ASC, e.event_date ASC, e.id DESC";
    if ($timeframe === 'upcoming') {
        $timeframeCondition = "$endExpr >= $nowExpr";
        if ($scope === 'public') {
            $conditions[] = $timeframeCondition;
        } else {
            $conditions[] = "($timeframeCondition OR $missingScheduleExpr)";
        }
        $orderBy = "ORDER BY $scheduleSortExpr ASC, e.start_datetime ASC, e.event_date ASC, e.id DESC";
    } elseif ($timeframe === 'past') {
        $timeframeCondition = "$endExpr < $nowExpr";
        if ($scope === 'public') {
            $conditions[] = $timeframeCondition;
        } else {
            $conditions[] = "($timeframeCondition OR $missingScheduleExpr)";
        }
        $orderBy = "ORDER BY $scheduleSortExpr ASC, e.start_datetime DESC, e.event_date DESC, e.id DESC";
    }
    $where = $conditions ? ('WHERE ' . implode(' AND ', $conditions)) : '';
    $limitClause = "LIMIT $limit OFFSET $offset";
    $categorySelect = '';
    $categoryJoin = '';
    if ($hasCategoryTable) {
        $categorySelect = ', ec.slug AS category_slug, ec.name AS category_name, ec.is_active AS category_is_active, ec.is_system AS category_is_system, ec.seat_request_email_to AS category_seat_request_email_to';
        $categoryJoin = ' LEFT JOIN event_categories ec ON ec.id = e.category_id';
    }
    $recurrenceSelect = ', rr_self.id AS recurrence_rule_id, rr_parent.id AS parent_recurrence_rule_id, rx_skip.id AS skipped_instance_exception_id, rx_skip.exception_date AS skipped_instance_exception_date';
    $occurrenceDateExpr = "COALESCE(e.event_date, DATE(e.start_datetime))";
    $recurrenceJoin = ' LEFT JOIN event_recurrence_rules rr_self ON rr_self.event_id = e.id LEFT JOIN event_recurrence_rules rr_parent ON rr_parent.event_id = e.series_master_id LEFT JOIN event_recurrence_exceptions rx_skip ON rx_skip.recurrence_id = rr_parent.id AND rx_skip.exception_type = \'skip\' AND rx_skip.exception_date = ' . $occurrenceDateExpr;
    $sql = "SELECT e.*{$categorySelect}{$recurrenceSelect} FROM events e{$categoryJoin}{$recurrenceJoin} $where $orderBy $limitClause";
    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll() ?: [];
        if ($scope === 'public' && $rows) {
            $rows = array_values(array_filter($rows, function ($row) {
                return empty($row['skipped_instance_exception_id']);
            }));
        }
        if ($scope !== 'public') {
            foreach ($rows as &$row) {
                [$targetEmail, $targetSource] = determine_seat_request_recipient($row);
                $row['seat_request_target_email'] = $targetEmail;
                $row['seat_request_target_source'] = $targetSource;
                $row['missing_schedule'] = event_missing_schedule_metadata($row);
            }
            unset($row);
            $missingIds = [];
            foreach ($rows as $row) {
                if (!empty($row['missing_schedule'])) {
                    $missingIds[] = (int) ($row['id'] ?? 0);
                }
            }
            if ($missingIds) {
                $preview = implode(',', array_slice($missingIds, 0, 10));
                error_log('[events] Admin scope returning events without schedule metadata; ids=' . $preview . (count($missingIds) > 10 ? '...' : ''));
            }
        }
        $imageLookup = [];
        $imageUrls = [];
        foreach ($rows as $row) {
            $imageUrl = trim((string) ($row['image_url'] ?? ''));
            if ($imageUrl !== '') {
                $imageUrls[] = $imageUrl;
            }
        }
        if ($imageUrls) {
            $variants = build_image_variants($imageUrls);
            foreach ($variants as $variant) {
                $key = $variant['file_url'] ?? $variant['original'] ?? null;
                if ($key) {
                    $imageLookup[$key] = $variant;
                }
            }
        }
        $defaultEventVariant = null;
        if ($scope === 'public') {
            $settings = fetch_business_settings();
            $defaultEventVariant = build_single_image_variant($settings['default_event_image'] ?? null);
        }
        foreach ($rows as &$row) {
            $imageUrl = trim((string) ($row['image_url'] ?? ''));
            $variant = null;
            $variantSource = null;
            if ($imageUrl !== '' && isset($imageLookup[$imageUrl])) {
                $variant = $imageLookup[$imageUrl];
                $variantSource = 'event_image';
            }
            if (!$variant && $defaultEventVariant) {
                $variant = $defaultEventVariant;
                $variantSource = 'branding_default';
            }
            if ($variant) {
                $row['image_variants'] = $variant;
                $row['image_variant_source'] = $variantSource;
                $row['resolved_image_url'] = $variant['webp'] ?? $variant['optimized'] ?? $variant['original'];
                $row['image_webp_srcset'] = $variant['webp_srcset'] ?? null;
                $row['image_optimized_srcset'] = $variant['optimized_srcset'] ?? null;
                $row['image_intrinsic_width'] = $variant['intrinsic_width'] ?? null;
                $row['image_intrinsic_height'] = $variant['intrinsic_height'] ?? null;
            }
        }
        unset($row);
        return $rows;
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            $safeParams = array_map(function ($value) {
                if (is_scalar($value) || $value === null) {
                    return $value;
                }
                return json_encode($value);
            }, $params);
            $context = [
                'scope' => $scope,
                'venue' => $venue,
                'status' => $status,
                'limit' => $limit,
                'page' => $page,
                'timeframe' => $timeframe,
                'archived' => $archivedFilterRaw,
                'has_archived_column' => $hasArchivedColumn,
                'where' => $where,
                'sql' => $sql,
                'params' => $safeParams,
            ];
            error_log('list_events failure: ' . $error->getMessage() . ' context=' . json_encode($context));
        }
        throw $error;
    }
}

function ensure_unique_slug(PDO $pdo, string $base, ?int $ignoreId = null): string
{
    $slug = $base;
    $i = 2;
    while (true) {
        if ($ignoreId) {
            $stmt = $pdo->prepare('SELECT id FROM events WHERE slug = ? AND id != ? LIMIT 1');
            $stmt->execute([$slug, $ignoreId]);
        } else {
            $stmt = $pdo->prepare('SELECT id FROM events WHERE slug = ? LIMIT 1');
            $stmt->execute([$slug]);
        }
        if (!$stmt->fetch()) {
            break;
        }
        $slug = $base . '-' . $i;
        $i++;
    }
    return $slug;
}

function ensure_unique_category_slug(PDO $pdo, string $base): string
{
    $slug = $base;
    $i = 2;
    while (true) {
        $stmt = $pdo->prepare('SELECT id FROM event_categories WHERE slug = ? LIMIT 1');
        $stmt->execute([$slug]);
        if (!$stmt->fetch()) {
            break;
        }
        $slug = $base . '-' . $i;
        $i++;
    }
    return $slug;
}

function read_json_body(Request $request): array
{
    $payload = $request->json();
    if (!is_array($payload)) {
        $payload = [];
    }
    $raw = trim($request->raw());
    if ($raw !== '' && $request->jsonError() !== JSON_ERROR_NONE) {
        Response::error('Invalid JSON payload', 400);
    }
    return $payload;
}

function format_contact(array $row): array
{
    $contact = ['email' => $row['customer_email'] ?? null, 'phone' => $row['customer_phone'] ?? null];
    $contactObj = $row['contact'] ?? null;
    if ($contactObj) {
        if (is_string($contactObj)) {
            $decoded = json_decode($contactObj, true);
            if (is_array($decoded)) {
                $contactObj = $decoded;
            }
        }
        if (is_array($contactObj)) {
            $contact = array_merge($contact, $contactObj);
        }
    }
    return $contact;
}

function parse_contact_field($contact)
{
    if (is_array($contact)) {
        return json_encode($contact);
    }
    if (is_string($contact)) {
        json_decode($contact);
        return json_last_error() === JSON_ERROR_NONE ? $contact : json_encode(['raw' => $contact]);
    }
    return null;
}

function ensure_admins_table_exists(): void
{
    static $checked = false;
    if ($checked) {
        return;
    }
    $checked = true;
    try {
        Database::run('SELECT 1 FROM admins LIMIT 1');
    } catch (Throwable $e) {
        Database::run(
            'CREATE TABLE IF NOT EXISTS admins (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                display_name VARCHAR(191) DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
    }

    ensure_admins_column_exists('display_name', "ALTER TABLE admins ADD COLUMN display_name VARCHAR(191) DEFAULT NULL AFTER email");
    ensure_admins_column_exists('created_at', "ALTER TABLE admins ADD COLUMN created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP AFTER display_name");
    ensure_admins_column_exists('updated_at', "ALTER TABLE admins ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at");
}

// Routes
$router->add('GET', '/api/health', function () {
    Response::success(['status' => 'ok']);
});

$router->add('POST', '/api/upload-image', function (Request $request) {
    if (!isset($_FILES['image'])) {
        return Response::error('No file uploaded', 400);
    }
    $result = save_uploaded_file($_FILES['image']);
    if (!$result || isset($result['error'])) {
        return Response::error($result['error'] ?? 'Upload failed', 400);
    }
    $fileUrl = '/uploads/' . $result['filename'];
    Response::success([
        'url' => $fileUrl,
        'filename' => $result['filename'],
        'width' => $result['width'],
        'height' => $result['height'],
        'optimized_url' => $result['optimized_path'] ?? null,
        'webp_url' => $result['webp_path'] ?? null,
        'fallback_original' => $result['fallback_original'] ?? $fileUrl,
        'optimized_srcset' => $result['optimized_srcset'] ?? null,
        'webp_srcset' => $result['webp_srcset'] ?? null,
        'responsive_variants' => $result['responsive_variants'] ?? null,
    ]);
});

$router->add('POST', '/api/login', function (Request $request) {
    $payload = read_json_body($request);
    $email = trim((string) ($payload['email'] ?? ''));
    $password = (string) ($payload['password'] ?? '');

    ensure_admins_table_exists();
    $stmt = Database::run('SELECT * FROM admins WHERE username = ? OR email = ? LIMIT 1', [$email, $email]);
    $row = $stmt->fetch();
    if ($row && password_verify($password, $row['password_hash'] ?? '')) {
        $user = sanitize_admin_user($row);
        $session = start_admin_session($user);
        return Response::success([
            'user' => $session['user'],
            'session' => [
                'expires_at' => $session['expires_at'],
                'idle_timeout_seconds' => $session['idle_timeout_seconds'],
            ],
        ]);
    }

    if (!$row && $email === 'admin' && $password === 'admin123') {
        $user = sanitize_admin_user([
            'username' => 'admin',
            'email' => 'admin@midwaymusichall.net',
            'display_name' => 'Admin',
        ]);
        $session = start_admin_session($user);
        return Response::success([
            'user' => $session['user'],
            'session' => [
                'expires_at' => $session['expires_at'],
                'idle_timeout_seconds' => $session['idle_timeout_seconds'],
            ],
        ]);
    }

    destroy_admin_session();
    Response::error('Invalid credentials', 401);
});

$router->add('POST', '/api/admin/change-password', function (Request $request) {
    try {
        $session = current_admin_session();
        if (!$session || empty($session['user'])) {
            return Response::error('Unauthorized', 401);
        }
        $payload = read_json_body($request);
        $currentPassword = (string) ($payload['current_password'] ?? $payload['currentPassword'] ?? '');
        $newPassword = (string) ($payload['new_password'] ?? $payload['newPassword'] ?? '');
        $confirmPassword = (string) ($payload['confirm_password'] ?? $payload['confirmPassword'] ?? '');
        if ($currentPassword === '' || $newPassword === '' || $confirmPassword === '') {
            return Response::error('All password fields are required.', 400);
        }
        if ($newPassword !== $confirmPassword) {
            return Response::error('New passwords do not match.', 400);
        }
        if (strlen($newPassword) < 10) {
            return Response::error('New password must be at least 10 characters long.', 400);
        }

        $userInfo = $session['user'];
        $username = trim((string) ($userInfo['username'] ?? ''));
        $email = trim((string) ($userInfo['email'] ?? ''));

        ensure_admins_table_exists();
        $row = null;
        if ($username !== '') {
            $stmt = Database::run('SELECT * FROM admins WHERE username = ? LIMIT 1', [$username]);
            $row = $stmt->fetch();
        }
        if (!$row && $email !== '') {
            $stmt = Database::run('SELECT * FROM admins WHERE email = ? LIMIT 1', [$email]);
            $row = $stmt->fetch();
        }

        $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
        $sanitizedEmail = $email !== '' ? $email : 'admin@midwaymusichall.net';
        $sanitizedUsername = $username !== '' ? $username : 'admin';

        if ($row) {
            if (!password_verify($currentPassword, $row['password_hash'] ?? '')) {
                return Response::error('Invalid credentials', 401);
            }
            $updateSql = 'UPDATE admins SET password_hash = ?';
            if (admin_table_has_column('updated_at')) {
                $updateSql .= ', updated_at = CURRENT_TIMESTAMP';
            }
            $updateSql .= ' WHERE id = ?';
            Database::run($updateSql, [$newHash, $row['id']]);
            $updatedStmt = Database::run('SELECT * FROM admins WHERE id = ? LIMIT 1', [$row['id']]);
            $updatedRow = $updatedStmt->fetch() ?: $row;
            $sessionData = sanitize_admin_user($updatedRow);
            start_admin_session($sessionData);
            return Response::success(['message' => 'Password updated successfully.']);
        }

        if (strcasecmp($sanitizedUsername, 'admin') === 0) {
            if ($currentPassword !== 'admin123') {
                return Response::error('Invalid credentials', 401);
            }
            $upsertSql = 'INSERT INTO admins (username, email, password_hash) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), email = COALESCE(NULLIF(email, \'\'), VALUES(email))';
            if (admin_table_has_column('updated_at')) {
                $upsertSql .= ', updated_at = CURRENT_TIMESTAMP';
            }
            Database::run($upsertSql, [$sanitizedUsername, $sanitizedEmail, $newHash]);
            $stmt = Database::run('SELECT * FROM admins WHERE username = ? LIMIT 1', [$sanitizedUsername]);
            $createdRow = $stmt->fetch();
            $sessionData = sanitize_admin_user($createdRow ?: ['username' => $sanitizedUsername, 'email' => $sanitizedEmail]);
            start_admin_session($sessionData);
            return Response::success(['message' => 'Password updated successfully.']);
        }

        return Response::error('Invalid credentials', 401);
    } catch (Throwable $error) {
        $message = 'Unable to change password at this time.';
        if (APP_DEBUG) {
            error_log('Change password failure: ' . $error->getMessage());
            $message .= ' ' . $error->getMessage();
        }
        return Response::error($message, 500);
    }
});

$router->add('GET', '/api/admin/users', function () {
    try {
        $session = current_admin_session();
        if (!$session || empty($session['user'])) {
            return Response::error('Unauthorized', 401);
        }
        ensure_admins_table_exists();
        $select = [
            'id',
            'username',
            'email',
        ];
        $select[] = admin_table_has_column('display_name') ? 'display_name' : 'NULL AS display_name';
        if (admin_table_has_column('created_at')) {
            $select[] = 'created_at';
        } elseif (admin_table_has_column('updated_at')) {
            $select[] = 'updated_at AS created_at';
        } else {
            $select[] = 'NULL AS created_at';
        }
        $select[] = admin_table_has_column('updated_at') ? 'updated_at' : 'NULL AS updated_at';
        $orderBy = admin_table_has_column('created_at')
            ? 'created_at'
            : (admin_table_has_column('updated_at') ? 'updated_at' : 'id');
        $sql = 'SELECT ' . implode(', ', $select) . " FROM admins ORDER BY {$orderBy} DESC";
        $stmt = Database::run($sql);
        $users = [];
        while ($row = $stmt->fetch()) {
            $users[] = sanitize_admin_user($row);
        }
        Response::success(['users' => $users]);
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('GET /api/admin/users error: ' . $error->getMessage());
        }
        Response::error('Unable to load admin users.', 500);
    }
});

$router->add('POST', '/api/admin/users', function (Request $request) {
    try {
        $session = current_admin_session();
        if (!$session || empty($session['user'])) {
            return Response::error('Unauthorized', 401);
        }
        $payload = read_json_body($request);
        $username = trim((string) ($payload['username'] ?? ''));
        $email = trim((string) ($payload['email'] ?? ''));
        $displayName = trim((string) ($payload['display_name'] ?? $payload['name'] ?? ''));
        $password = (string) ($payload['password'] ?? '');

        if ($username === '' || $password === '') {
            return Response::error('Username and password are required.', 400);
        }
        if (strlen($password) < 10) {
            return Response::error('Password must be at least 10 characters long.', 400);
        }
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return Response::error('Invalid email address.', 400);
        }

        ensure_admins_table_exists();
        $existing = Database::run('SELECT id FROM admins WHERE username = ? LIMIT 1', [$username])->fetch();
        if ($existing) {
            return Response::error('An admin with that username already exists.', 409);
        }
        if ($email !== '') {
            $existingEmail = Database::run('SELECT id FROM admins WHERE email = ? LIMIT 1', [$email])->fetch();
            if ($existingEmail) {
                return Response::error('An admin with that email already exists.', 409);
            }
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $finalDisplayName = $displayName !== '' ? $displayName : $username;
        $hasDisplayName = admin_table_has_column('display_name');
        if ($hasDisplayName) {
            Database::run(
                'INSERT INTO admins (username, password_hash, email, display_name) VALUES (?, ?, ?, ?)',
                [$username, $hash, $email !== '' ? $email : null, $finalDisplayName]
            );
        } else {
            Database::run(
                'INSERT INTO admins (username, password_hash, email) VALUES (?, ?, ?)',
                [$username, $hash, $email !== '' ? $email : null]
            );
        }
        $id = (int) Database::connection()->lastInsertId();
        $selectColumns = ['id', 'username', 'email'];
        $selectColumns[] = $hasDisplayName ? 'display_name' : 'NULL AS display_name';
        if (admin_table_has_column('created_at')) {
            $selectColumns[] = 'created_at';
        } elseif (admin_table_has_column('updated_at')) {
            $selectColumns[] = 'updated_at AS created_at';
        } else {
            $selectColumns[] = 'NULL AS created_at';
        }
        $selectColumns[] = admin_table_has_column('updated_at') ? 'updated_at' : 'NULL AS updated_at';
        $row = Database::run(
            'SELECT ' . implode(', ', $selectColumns) . ' FROM admins WHERE id = ? LIMIT 1',
            [$id]
        )->fetch();
        if ($row && !array_key_exists('display_name', $row)) {
            $row['display_name'] = $finalDisplayName;
        }

        Response::success([
            'user' => sanitize_admin_user($row ?: [
                'id' => $id,
                'username' => $username,
                'email' => $email,
                'display_name' => $finalDisplayName,
            ]),
        ]);
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('POST /api/admin/users error: ' . $error->getMessage());
        }
        Response::error('Unable to create admin user.', 500);
    }
});

$router->add('POST', '/api/events/:id/archive', function ($request, $params) {
    $targetId = (int) $params['id'];
    $pdo = Database::connection();
    if (events_table_has_column($pdo, 'archived_at')) {
        Database::run('UPDATE events SET archived_at = NOW(), status = ?, visibility = ? WHERE id = ?', ['archived', 'private', $targetId]);
    } else {
        if (APP_DEBUG) {
            error_log('Archive requested but archived_at column missing; falling back to status/visibility only.');
        }
        Database::run('UPDATE events SET status = ?, visibility = ? WHERE id = ?', ['archived', 'private', $targetId]);
    }
    record_audit('event.archive', 'event', $targetId);
    Response::success(['archived' => true]);
});

$router->add('POST', '/api/events/:id/restore', function (Request $request, $params) {
    $targetId = (int) $params['id'];
    $payload = read_json_body($request);
    $status = in_array($payload['status'] ?? 'draft', ['draft','published','archived'], true) ? ($payload['status'] ?? 'draft') : 'draft';
    $visibility = in_array($payload['visibility'] ?? 'public', ['public','private'], true) ? ($payload['visibility'] ?? 'public') : 'public';
    $pdo = Database::connection();
    if (events_table_has_column($pdo, 'archived_at')) {
        Database::run('UPDATE events SET archived_at = NULL, status = ?, visibility = ? WHERE id = ?', [$status, $visibility, $targetId]);
    } else {
        if (APP_DEBUG) {
            error_log('Restore requested but archived_at column missing; updating status/visibility only.');
        }
        Database::run('UPDATE events SET status = ?, visibility = ? WHERE id = ?', [$status, $visibility, $targetId]);
    }
    record_audit('event.unarchive', 'event', $targetId, [
        'status' => $status,
        'visibility' => $visibility,
    ]);
    Response::success(['archived' => false]);
});

$router->add('GET', '/api/events/:id.ics', function ($request, $params) {
    $stmt = Database::run('SELECT * FROM events WHERE id = ? LIMIT 1', [$params['id']]);
    $event = $stmt->fetch();
    if (!$event) {
        http_response_code(404);
        header('Content-Type: text/plain');
        echo 'Event not found';
        return;
    }
    $start = resolve_event_start_datetime($event);
    if (!$start) {
        http_response_code(400);
        header('Content-Type: text/plain');
        echo 'Event start time unavailable';
        return;
    }
    $end = resolve_event_end_datetime($event);
    $dtStart = $start->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z');
    $dtEnd = $end ? $end->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z') : $start->modify('+4 hours')->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z');
    $host = $_SERVER['HTTP_HOST'] ?? 'midwaymusichall.com';
    $uid = sprintf('mmh-%d@%s', $event['id'], $host);
    $title = $event['artist_name'] ?: ($event['title'] ?? 'Midway Music Hall Event');
    $location = trim(($event['venue_section'] ?? '') . ' ' . ($event['venue_code'] ?? ''));
    if ($location === '') {
        $location = 'Midway Music Hall, 11141 Old US Hwy 52, Winston-Salem, NC 27107';
    }
    $description = trim(($event['description'] ?? '') . "\nContact: " . ($event['contact_name'] ?? 'Venue'));
    header('Content-Type: text/calendar; charset=utf-8');
    header('Content-Disposition: attachment; filename="event-' . $event['id'] . '.ics"');
    echo "BEGIN:VCALENDAR\r\n";
    echo "VERSION:2.0\r\n";
    echo "PRODID:-//Midway Music Hall//Events//EN\r\n";
    echo "BEGIN:VEVENT\r\n";
    echo "UID:$uid\r\n";
    echo "DTSTAMP:" . gmdate('Ymd\THis\Z') . "\r\n";
    echo "DTSTART:$dtStart\r\n";
    echo "DTEND:$dtEnd\r\n";
    echo "SUMMARY:" . addcslashes($title, ",;\\") . "\r\n";
    echo "LOCATION:" . addcslashes($location, ",;\\") . "\r\n";
    if ($description !== '') {
        echo "DESCRIPTION:" . addcslashes($description, ",;\\n") . "\r\n";
    }
    echo "END:VEVENT\r\n";
    echo "END:VCALENDAR\r\n";
});

$router->add('GET', '/api/session', function () {
    $session = current_admin_session();
    if (!$session) {
        log_admin_session_state('GET /api/session unauthenticated');
        return Response::success(['authenticated' => false]);
    }
    $refreshed = refresh_admin_session() ?? $session;
    Response::success([
        'authenticated' => true,
        'user' => $refreshed['user'],
        'session' => [
            'expires_at' => $refreshed['expires_at'],
            'idle_timeout_seconds' => $refreshed['idle_timeout_seconds'],
        ],
    ]);
});

$router->add('POST', '/api/session/refresh', function () {
    $session = refresh_admin_session();
    if (!$session) {
        log_admin_session_state('POST /api/session/refresh failed');
        return Response::error('Session expired', 401);
    }
    Response::success([
        'user' => $session['user'],
        'session' => [
            'expires_at' => $session['expires_at'],
            'idle_timeout_seconds' => $session['idle_timeout_seconds'],
        ],
    ]);
});

$router->add('POST', '/api/logout', function () {
    destroy_admin_session();
    Response::success(['status' => 'logged_out']);
});

$router->add('GET', '/api/events', function (Request $request) {
    try {
        $events = list_events($request);
        Response::success(['events' => $events]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('GET /api/events error: ' . $e->getMessage());
        }
        Response::error('Failed to fetch events', 500);
    }
});

$router->add('GET', '/api/public/events', function (Request $request) {
    try {
        $events = list_events($request, 'public');
        Response::success(['events' => $events]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('GET /api/public/events error: ' . $e->getMessage());
        }
        Response::error('Failed to fetch events', 500);
    }
});

$router->add('GET', '/api/events/:id', function ($request, $params) {
    $pdo = Database::connection();
    $hasCategoryTable = event_categories_table_exists($pdo);
    if ($hasCategoryTable) {
        $stmt = $pdo->prepare('SELECT e.*, ec.slug AS category_slug, ec.name AS category_name, ec.is_active AS category_is_active, ec.is_system AS category_is_system, ec.seat_request_email_to AS category_seat_request_email_to FROM events e LEFT JOIN event_categories ec ON ec.id = e.category_id WHERE e.id = ? LIMIT 1');
        $stmt->execute([$params['id']]);
    } else {
        $stmt = $pdo->prepare('SELECT * FROM events WHERE id = ? LIMIT 1');
        $stmt->execute([$params['id']]);
    }
    $event = $stmt->fetch();
    if (!$event) {
        return Response::error('Event not found', 404);
    }
    if ($event) {
        [$targetEmail, $targetSource] = determine_seat_request_recipient($event);
        $event['seat_request_target_email'] = $targetEmail;
        $event['seat_request_target_source'] = $targetSource;
    }
    Response::success(['event' => $event]);
});

$router->add('GET', '/api/event-categories', function () {
    try {
        $pdo = Database::connection();
        if (!event_categories_table_exists($pdo)) {
            return Response::success(['categories' => []]);
        }
        $stmt = $pdo->query('SELECT c.*, COUNT(e.id) AS usage_count FROM event_categories c LEFT JOIN events e ON e.category_id = c.id GROUP BY c.id ORDER BY c.is_system DESC, c.name ASC');
        $rows = $stmt->fetchAll() ?: [];
        Response::success(['categories' => $rows]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('GET /api/event-categories error: ' . $e->getMessage());
        }
        Response::error('Failed to fetch categories', 500);
    }
});

$router->add('GET', '/api/audit-log', function (Request $request) {
    $session = current_admin_session();
    if (!$session) {
        return Response::error('Unauthorized', 401);
    }
    try {
        $pdo = Database::connection();
        if (!audit_log_table_exists($pdo)) {
            return Response::success(['logs' => []]);
        }
        $conditions = [];
        $params = [];
        $limit = (int) ($request->query['limit'] ?? 200);
        $limit = max(1, min($limit, 1000));
        $action = trim((string) ($request->query['action'] ?? ''));
        if ($action !== '') {
            $conditions[] = 'action = ?';
            $params[] = $action;
        }
        $entityType = trim((string) ($request->query['entity_type'] ?? ''));
        if ($entityType !== '') {
            $conditions[] = 'entity_type = ?';
            $params[] = $entityType;
        }
        $actor = trim((string) ($request->query['actor'] ?? ''));
        if ($actor !== '') {
            $conditions[] = 'actor = ?';
            $params[] = $actor;
        }
        $entityId = trim((string) ($request->query['entity_id'] ?? ''));
        if ($entityId !== '') {
            $conditions[] = 'entity_id = ?';
            $params[] = $entityId;
        }
        $dateFrom = trim((string) ($request->query['date_from'] ?? ''));
        if ($dateFrom !== '') {
            $conditions[] = 'created_at >= ?';
            $params[] = $dateFrom;
        }
        $dateTo = trim((string) ($request->query['date_to'] ?? ''));
        if ($dateTo !== '') {
            $conditions[] = 'created_at <= ?';
            $params[] = $dateTo;
        }
        $where = $conditions ? ('WHERE ' . implode(' AND ', $conditions)) : '';
        $sql = "SELECT id, actor, action, entity_type, entity_id, meta_json, created_at FROM audit_log $where ORDER BY created_at DESC, id DESC LIMIT $limit";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $logs = [];
        while ($row = $stmt->fetch()) {
            $meta = null;
            if (!empty($row['meta_json'])) {
                $decoded = json_decode($row['meta_json'], true);
                $meta = is_array($decoded) ? $decoded : null;
            }
            $logs[] = [
                'id' => (int) $row['id'],
                'actor' => $row['actor'],
                'action' => $row['action'],
                'entity_type' => $row['entity_type'],
                'entity_id' => $row['entity_id'],
                'meta' => $meta,
                'created_at' => $row['created_at'],
            ];
        }
        Response::success(['logs' => $logs]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('GET /api/audit-log error: ' . $e->getMessage());
        }
        Response::error('Failed to fetch audit log', 500);
    }
});

$router->add('POST', '/api/event-categories', function (Request $request) {
    try {
        $pdo = Database::connection();
        if (!event_categories_table_exists($pdo)) {
            return Response::error('Categories feature unavailable', 500);
        }
        $payload = read_json_body($request);
        $name = trim((string) ($payload['name'] ?? ''));
        if ($name === '') {
            return Response::error('Name is required', 422);
        }
        $slugInput = $payload['slug'] ?? $name;
        $slugBase = slugify_string($slugInput, 'category');
        $slug = ensure_unique_category_slug($pdo, $slugBase);
        $isActive = array_key_exists('is_active', $payload) ? (!empty($payload['is_active']) ? 1 : 0) : 1;
        $seatEmail = null;
        if (array_key_exists('seat_request_email_to', $payload)) {
            $rawSeat = trim((string) $payload['seat_request_email_to']);
            if ($rawSeat !== '' && !filter_var($rawSeat, FILTER_VALIDATE_EMAIL)) {
                return Response::error('Please enter a valid email address for seat requests.', 422);
            }
            $seatEmail = $rawSeat !== '' ? $rawSeat : null;
        }
        $stmt = $pdo->prepare('INSERT INTO event_categories (name, slug, is_active, is_system, seat_request_email_to) VALUES (?, ?, ?, 0, ?)');
        $stmt->execute([$name, $slug, $isActive ? 1 : 0, $seatEmail]);
        $categoryId = (int) $pdo->lastInsertId();
        $category = fetch_event_category_with_count($pdo, $categoryId);
        record_audit('category.create', 'event_category', $categoryId, [
            'slug' => $slug,
            'is_active' => (bool) $isActive,
            'seat_request_email_to' => $seatEmail,
        ]);
        Response::success(['category' => $category]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('POST /api/event-categories error: ' . $e->getMessage());
        }
        Response::error('Failed to create category', 500);
    }
});

$router->add('PUT', '/api/event-categories/:id', function (Request $request, $params) {
    try {
        $pdo = Database::connection();
        if (!event_categories_table_exists($pdo)) {
            return Response::error('Categories feature unavailable', 500);
        }
        $categoryId = (int) $params['id'];
        $category = fetch_event_category_by_id($pdo, $categoryId);
        if (!$category) {
            return Response::error('Category not found', 404);
        }
        $payload = read_json_body($request);
        $name = array_key_exists('name', $payload) ? trim((string) $payload['name']) : ($category['name'] ?? '');
        if ($name === '') {
            $name = $category['name'];
        }
        $targetIsActive = array_key_exists('is_active', $payload) ? (!empty($payload['is_active']) ? 1 : 0) : (int) ($category['is_active'] ?? 1);
        if (!empty($category['is_system']) && $targetIsActive === 0) {
            return Response::error('System categories cannot be deactivated', 422);
        }
        $replacementId = array_key_exists('replacement_category_id', $payload) ? normalize_category_id($payload['replacement_category_id']) : null;
        if ($replacementId !== null) {
            if ($replacementId === $categoryId) {
                return Response::error('Replacement category must be different', 422);
            }
            $replacement = fetch_event_category_by_id($pdo, $replacementId);
            if (!$replacement) {
                return Response::error('Replacement category not found', 404);
            }
        }
        $seatEmail = $category['seat_request_email_to'] ?? null;
        if (array_key_exists('seat_request_email_to', $payload)) {
            $rawSeat = trim((string) $payload['seat_request_email_to']);
            if ($rawSeat !== '' && !filter_var($rawSeat, FILTER_VALIDATE_EMAIL)) {
                return Response::error('Please enter a valid email address for seat requests.', 422);
            }
            $seatEmail = $rawSeat !== '' ? $rawSeat : null;
        }
        $stmt = $pdo->prepare('UPDATE event_categories SET name = ?, is_active = ?, seat_request_email_to = ? WHERE id = ?');
        $stmt->execute([$name, $targetIsActive ? 1 : 0, $seatEmail, $categoryId]);
        if ($replacementId !== null) {
            $pdo->prepare('UPDATE events SET category_id = ? WHERE category_id = ?')->execute([$replacementId, $categoryId]);
        }
        $updated = fetch_event_category_with_count($pdo, $categoryId);
        record_audit('category.update', 'event_category', $categoryId, [
            'is_active' => (bool) $targetIsActive,
            'replacement_id' => $replacementId,
            'name' => $name,
            'seat_request_email_to' => $seatEmail,
        ]);
        Response::success(['category' => $updated]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('PUT /api/event-categories/:id error: ' . $e->getMessage());
        }
        Response::error('Failed to update category', 500);
    }
});

$router->add('POST', '/api/events', function (Request $request) {
    try {
        $pdo = Database::connection();
        $hasCategoryTable = event_categories_table_exists($pdo);
        $payload = read_json_body($request);
        $artist = trim((string)($payload['artist_name'] ?? $payload['title'] ?? ''));
        if ($artist === '') {
            return Response::error('artist_name is required', 400);
        }
        $title = trim((string)($payload['title'] ?? $artist));
        $timezone = $payload['timezone'] ?? 'America/New_York';
        $startInput = $payload['start_datetime'] ?? null;
        if (!$startInput && !empty($payload['event_date']) && !empty($payload['event_time'])) {
            $startInput = $payload['event_date'] . ' ' . $payload['event_time'];
        }
        if (!$startInput) {
            return Response::error('event_date and event_time are required', 422);
        }
        try {
            $startDt = new DateTimeImmutable($startInput, new DateTimeZone($timezone));
        } catch (Throwable $e) {
            return Response::error('Invalid event_date or event_time value', 422);
        }
        $endInput = $payload['end_datetime'] ?? null;
        $endDt = null;
        if ($endInput) {
            try {
                $endDt = new DateTimeImmutable($endInput, new DateTimeZone($timezone));
            } catch (Throwable $e) {
                return Response::error('Invalid end_datetime value', 422);
            }
        }
        $slugBase = slugify_string($payload['slug'] ?? ($title . ($startDt ? '-' . $startDt->format('Ymd') : '')));
        $slug = ensure_unique_slug($pdo, $slugBase);
        $venueCode = strtoupper(trim((string)($payload['venue_code'] ?? 'MMH')));
        if (!in_array($venueCode, ['MMH','TGP'], true)) {
            $venueCode = 'MMH';
        }
        $ticketPrice = $payload['ticket_price'] ?? null;
        $doorPrice = $payload['door_price'] ?? null;
        $ticketType = in_array($payload['ticket_type'] ?? 'general_admission', ['general_admission','reserved_seating','hybrid'], true) ? $payload['ticket_type'] : 'general_admission';
        $status = in_array($payload['status'] ?? 'draft', ['draft','published','archived'], true) ? $payload['status'] : 'draft';
        $visibility = in_array($payload['visibility'] ?? 'public', ['public','private'], true) ? $payload['visibility'] : 'public';
        $rawLayoutId = array_key_exists('layout_id', $payload) ? $payload['layout_id'] : null;
        $layoutId = normalize_layout_identifier($rawLayoutId);
        $rawRequestedVersion = array_key_exists('layout_version_id', $payload) ? $payload['layout_version_id'] : null;
        $requestedVersion = normalize_layout_identifier($rawRequestedVersion);
        $explicitSeating = array_key_exists('seating_enabled', $payload) ? (!empty($payload['seating_enabled']) ? 1 : 0) : null;
        $seatingEnabled = $explicitSeating ?? ($layoutId ? 1 : 0);
        if (!$layoutId) {
            $seatingEnabled = 0;
        }
        $layoutVersionId = ($seatingEnabled && $layoutId) ? ensure_event_layout_version($pdo, $layoutId, $requestedVersion) : null;

        $categoryTags = $payload['category_tags'] ?? null;
        if (is_array($categoryTags)) {
            $categoryTags = json_encode($categoryTags);
        } elseif (is_string($categoryTags)) {
            $decoded = json_decode($categoryTags, true);
            $categoryTags = $decoded ? json_encode($decoded) : null;
        }
        $categoryId = null;
        if ($hasCategoryTable) {
            $normalizedCategoryId = normalize_category_id($payload['category_id'] ?? null);
            if ($normalizedCategoryId !== null) {
                $categoryRow = fetch_event_category_by_id($pdo, $normalizedCategoryId);
                if (!$categoryRow) {
                    return Response::error('Invalid category selection', 422);
                }
                $categoryId = (int) $categoryRow['id'];
            } else {
                $categoryId = default_event_category_id($pdo);
            }
        }

        $seatRequestOverride = null;
        if (array_key_exists('seat_request_email_override', $payload)) {
            $rawOverride = trim((string) $payload['seat_request_email_override']);
            if ($rawOverride !== '' && !filter_var($rawOverride, FILTER_VALIDATE_EMAIL)) {
                return Response::error('seat_request_email_override must be a valid email address.', 422);
            }
            $seatRequestOverride = $rawOverride !== '' ? $rawOverride : null;
        }

        $contactPhoneRaw = $payload['contact_phone_raw'] ?? $payload['contact_phone'] ?? null;
        $contactPhoneNormalized = normalize_phone_number($contactPhoneRaw);
        $startString = $startDt ? $startDt->format('Y-m-d H:i:s') : null;
        $endString = $endDt ? $endDt->format('Y-m-d H:i:s') : null;
        $doorTime = normalize_door_time_input($payload['door_time'] ?? null);
        if ($doorTime === null) {
            return Response::error('door_time is required and must include a valid date and time.', 422);
        }
        $publishAt = $payload['publish_at'] ?? ($status === 'published' && $startString ? $startString : null);
        $stmt = $pdo->prepare('INSERT INTO events (artist_name, title, slug, description, notes, genre, category_tags, category_id, image_url, hero_image_id, poster_image_id, ticket_price, door_price, min_ticket_price, max_ticket_price, ticket_type, seating_enabled, venue_code, venue_section, timezone, start_datetime, end_datetime, door_time, event_date, event_time, age_restriction, status, visibility, publish_at, layout_id, layout_version_id, ticket_url, contact_name, contact_phone_raw, contact_phone_normalized, contact_email, seat_request_email_override, change_note, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $artist,
            $title,
            $slug,
            $payload['description'] ?? null,
            $payload['notes'] ?? null,
            $payload['genre'] ?? null,
            $categoryTags,
            $categoryId,
            $payload['image_url'] ?? null,
            $payload['hero_image_id'] ?? null,
            $payload['poster_image_id'] ?? null,
            $ticketPrice,
            $doorPrice,
            $payload['min_ticket_price'] ?? $ticketPrice,
            $payload['max_ticket_price'] ?? $doorPrice ?? $ticketPrice,
            $ticketType,
            $seatingEnabled,
            $venueCode,
            $payload['venue_section'] ?? null,
            $timezone,
            $startString,
            $endString,
            $doorTime,
            $startDt ? $startDt->format('Y-m-d') : ($payload['event_date'] ?? null),
            $startDt ? $startDt->format('H:i:s') : ($payload['event_time'] ?? null),
            $payload['age_restriction'] ?? 'All Ages',
            $status,
            $visibility,
            $publishAt,
            $layoutId,
            $layoutVersionId,
            $payload['ticket_url'] ?? null,
            $payload['contact_name'] ?? null,
            $contactPhoneRaw,
            $contactPhoneNormalized,
            $payload['contact_email'] ?? null,
            $seatRequestOverride,
            'created via API',
            'api',
            'api'
        ]);
        $id = (int)$pdo->lastInsertId();
        record_audit('event.create', 'event', $id, [
            'slug' => $slug,
            'status' => $status,
            'visibility' => $visibility,
            'venue' => $venueCode,
            'category_id' => $categoryId,
            'seating_enabled' => (bool) $seatingEnabled,
        ]);
        Response::success(['id' => $id, 'slug' => $slug]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('POST /api/events error: ' . $e->getMessage());
        }
        Response::error('Failed to create event', 500);
    }
});

$router->add('PUT', '/api/events/:id', function (Request $request, $params) {
    try {
        $pdo = Database::connection();
        $hasCategoryTable = event_categories_table_exists($pdo);
        $eventId = (int)$params['id'];
        $existingStmt = $pdo->prepare('SELECT * FROM events WHERE id = ? LIMIT 1');
        $existingStmt->execute([$eventId]);
        $existing = $existingStmt->fetch();
        if (!$existing) {
            return Response::error('Event not found', 404);
        }
        $payload = read_json_body($request);
        $artist = trim((string)($payload['artist_name'] ?? $existing['artist_name']));
        if ($artist === '') {
            return Response::error('artist_name is required', 400);
        }
        $title = trim((string)($payload['title'] ?? $existing['title'] ?? $artist));
        $timezone = $payload['timezone'] ?? $existing['timezone'] ?? 'America/New_York';
        $startInput = $payload['start_datetime'] ?? null;
        if (!$startInput && !empty($payload['event_date']) && !empty($payload['event_time'])) {
            $startInput = $payload['event_date'] . ' ' . $payload['event_time'];
        }
        try {
            $startDt = $startInput
                ? new DateTimeImmutable($startInput, new DateTimeZone($timezone))
                : ($existing['start_datetime'] ? new DateTimeImmutable($existing['start_datetime'], new DateTimeZone($timezone)) : null);
        } catch (Throwable $e) {
            return Response::error('Invalid event_date or event_time value', 422);
        }
        if (!$startDt) {
            return Response::error('event_date and event_time are required', 422);
        }
        $endInput = $payload['end_datetime'] ?? null;
        try {
            $endDt = $endInput
                ? new DateTimeImmutable($endInput, new DateTimeZone($timezone))
                : ($existing['end_datetime'] ? new DateTimeImmutable($existing['end_datetime'], new DateTimeZone($timezone)) : null);
        } catch (Throwable $e) {
            return Response::error('Invalid end_datetime value', 422);
        }
        $slugInput = $payload['slug'] ?? $existing['slug'] ?? null;
        $slugBase = slugify_string($slugInput ?? ($title . ($startDt ? '-' . $startDt->format('Ymd') : '')));
        $slug = ensure_unique_slug($pdo, $slugBase, $eventId);
        $venueCode = strtoupper(trim((string)($payload['venue_code'] ?? $existing['venue_code'] ?? 'MMH')));
        if (!in_array($venueCode, ['MMH','TGP'], true)) {
            $venueCode = $existing['venue_code'] ?? 'MMH';
        }
        $ticketType = in_array($payload['ticket_type'] ?? $existing['ticket_type'] ?? 'general_admission', ['general_admission','reserved_seating','hybrid'], true) ? ($payload['ticket_type'] ?? $existing['ticket_type']) : ($existing['ticket_type'] ?? 'general_admission');
        $status = in_array($payload['status'] ?? $existing['status'] ?? 'draft', ['draft','published','archived'], true) ? ($payload['status'] ?? $existing['status']) : ($existing['status'] ?? 'draft');
        $visibility = in_array($payload['visibility'] ?? $existing['visibility'] ?? 'public', ['public','private'], true) ? ($payload['visibility'] ?? $existing['visibility']) : ($existing['visibility'] ?? 'public');
        $seatingEnabled = array_key_exists('seating_enabled', $payload) ? (!empty($payload['seating_enabled']) ? 1 : 0) : (int)$existing['seating_enabled'];
        $rawLayoutValue = array_key_exists('layout_id', $payload) ? $payload['layout_id'] : $existing['layout_id'];
        $layoutId = normalize_layout_identifier($rawLayoutValue);
        $rawVersionValue = array_key_exists('layout_version_id', $payload) ? $payload['layout_version_id'] : $existing['layout_version_id'];
        $requestedVersion = normalize_layout_identifier($rawVersionValue);
        if (!$layoutId) {
            $seatingEnabled = 0;
        }
        $layoutVersionId = ($seatingEnabled && $layoutId) ? ensure_event_layout_version($pdo, $layoutId, $requestedVersion) : null;

        $categoryTags = $payload['category_tags'] ?? $existing['category_tags'];
        if (is_array($categoryTags)) {
            $categoryTags = json_encode($categoryTags);
        } elseif (is_string($categoryTags)) {
            $decoded = json_decode($categoryTags, true);
            $categoryTags = $decoded ? json_encode($decoded) : $existing['category_tags'];
        }
        $categoryId = $hasCategoryTable ? normalize_category_id($existing['category_id'] ?? null) : null;
        if ($hasCategoryTable) {
            if (array_key_exists('category_id', $payload)) {
                $normalizedCategoryId = normalize_category_id($payload['category_id']);
                if ($normalizedCategoryId !== null) {
                    $categoryRow = fetch_event_category_by_id($pdo, $normalizedCategoryId);
                    if (!$categoryRow) {
                        return Response::error('Invalid category selection', 422);
                    }
                    $categoryId = (int) $categoryRow['id'];
                } else {
                    $categoryId = default_event_category_id($pdo);
                }
            } elseif ($categoryId === null) {
                $categoryId = default_event_category_id($pdo);
            }
        }

        $seatRequestOverride = $existing['seat_request_email_override'] ?? null;
        if (array_key_exists('seat_request_email_override', $payload)) {
            $rawOverride = trim((string) $payload['seat_request_email_override']);
            if ($rawOverride !== '' && !filter_var($rawOverride, FILTER_VALIDATE_EMAIL)) {
                return Response::error('seat_request_email_override must be a valid email address.', 422);
            }
            $seatRequestOverride = $rawOverride !== '' ? $rawOverride : null;
        }

        $contactPhoneRaw = $payload['contact_phone_raw'] ?? $payload['contact_phone'] ?? $existing['contact_phone_raw'];
        $contactPhoneNormalized = normalize_phone_number($contactPhoneRaw);
        $startString = $startDt ? $startDt->format('Y-m-d H:i:s') : null;
        $endString = $endDt ? $endDt->format('Y-m-d H:i:s') : null;
        $publishAt = $payload['publish_at'] ?? $existing['publish_at'];

        $doorTimeInput = array_key_exists('door_time', $payload) ? $payload['door_time'] : $existing['door_time'];
        $doorTime = normalize_door_time_input($doorTimeInput);
        if ($doorTime === null) {
            return Response::error('door_time is required and must include a valid date and time.', 422);
        }

        $stmt = $pdo->prepare('UPDATE events SET artist_name = ?, title = ?, slug = ?, description = ?, notes = ?, genre = ?, category_tags = ?, category_id = ?, image_url = ?, hero_image_id = ?, poster_image_id = ?, ticket_price = ?, door_price = ?, min_ticket_price = ?, max_ticket_price = ?, ticket_type = ?, seating_enabled = ?, venue_code = ?, venue_section = ?, timezone = ?, start_datetime = ?, end_datetime = ?, door_time = ?, event_date = ?, event_time = ?, age_restriction = ?, status = ?, visibility = ?, publish_at = ?, layout_id = ?, layout_version_id = ?, ticket_url = ?, contact_name = ?, contact_phone_raw = ?, contact_phone_normalized = ?, contact_email = ?, seat_request_email_override = ?, change_note = ?, updated_by = ? WHERE id = ?');
        $stmt->execute([
            $artist,
            $title,
            $slug,
            $payload['description'] ?? $existing['description'],
            $payload['notes'] ?? $existing['notes'],
            $payload['genre'] ?? $existing['genre'],
            $categoryTags,
            $categoryId,
            $payload['image_url'] ?? $existing['image_url'],
            $payload['hero_image_id'] ?? $existing['hero_image_id'],
            $payload['poster_image_id'] ?? $existing['poster_image_id'],
            $payload['ticket_price'] ?? $existing['ticket_price'],
            $payload['door_price'] ?? $existing['door_price'],
            $payload['min_ticket_price'] ?? $existing['min_ticket_price'],
            $payload['max_ticket_price'] ?? $existing['max_ticket_price'],
            $ticketType,
            $seatingEnabled,
            $venueCode,
            $payload['venue_section'] ?? $existing['venue_section'],
            $timezone,
            $startString,
            $endString,
            $doorTime,
            $startDt ? $startDt->format('Y-m-d') : ($payload['event_date'] ?? $existing['event_date']),
            $startDt ? $startDt->format('H:i:s') : ($payload['event_time'] ?? $existing['event_time']),
            $payload['age_restriction'] ?? $existing['age_restriction'],
            $status,
            $visibility,
            $publishAt,
            $layoutId,
            $layoutVersionId,
            $payload['ticket_url'] ?? $existing['ticket_url'],
            $payload['contact_name'] ?? $existing['contact_name'],
            $contactPhoneRaw,
            $contactPhoneNormalized,
            $payload['contact_email'] ?? $existing['contact_email'],
            $seatRequestOverride,
            $payload['change_note'] ?? 'updated via API',
            'api',
            $eventId
        ]);
        record_audit('event.update', 'event', $eventId, [
            'slug' => $slug,
            'status' => $status,
            'visibility' => $visibility,
            'venue' => $venueCode,
            'category_id' => $categoryId,
            'seating_enabled' => (bool) $seatingEnabled,
        ]);
        Response::success(['id' => $eventId, 'slug' => $slug]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('PUT /api/events/:id error: ' . $e->getMessage());
        }
        Response::error('Failed to update event', 500);
    }
});

$router->add('DELETE', '/api/events/:id', function (Request $request, $params) {
    try {
        $force = !empty($request->query['force']);
        if ($force) {
            $stmt = Database::run('DELETE FROM events WHERE id = ?', [$params['id']]);
            if ($stmt->rowCount() === 0) {
                return Response::error('Event not found', 404);
            }
        } else {
            $stmt = Database::run('UPDATE events SET deleted_at = NOW(), status = ?, visibility = ? WHERE id = ?', ['archived', 'private', $params['id']]);
            if ($stmt->rowCount() === 0) {
                return Response::error('Event not found', 404);
            }
        }
        record_audit('event.delete', 'event', (int) $params['id'], [
            'mode' => $force ? 'hard' : 'soft',
        ]);
        Response::success();
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('DELETE /api/events/:id error: ' . $e->getMessage());
        }
        Response::error('Failed to delete event', 500);
    }
});

$router->add('GET', '/api/events/:id/recurrence', function ($request, $params) {
    try {
        $stmt = Database::run('SELECT * FROM event_recurrence_rules WHERE event_id = ? LIMIT 1', [$params['id']]);
        $rule = $stmt->fetch();
        if (!$rule) {
            return Response::success(['recurrence' => null]);
        }
        $exStmt = Database::run('SELECT * FROM event_recurrence_exceptions WHERE recurrence_id = ? ORDER BY exception_date ASC', [$rule['id']]);
        $exceptions = $exStmt->fetchAll() ?: [];
        Response::success(['recurrence' => $rule, 'exceptions' => $exceptions]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('GET /api/events/:id/recurrence error: ' . $e->getMessage());
        }
        Response::error('Failed to fetch recurrence', 500);
    }
});

$router->add('POST', '/api/events/:id/recurrence', function (Request $request, $params) {
    try {
        $payload = read_json_body($request);
        $frequency = strtolower($payload['frequency'] ?? 'weekly');
        if (!in_array($frequency, ['daily','weekly','monthly','yearly','custom'], true)) {
            $frequency = 'weekly';
        }
        $interval = max(1, (int)($payload['interval'] ?? 1));
        $byweekday = strtoupper(trim((string)($payload['byweekday'] ?? '')));
        $startsOn = $payload['starts_on'] ?? date('Y-m-d');
        $rulePayload = [
            'setpos' => $payload['setpos'] ?? null,
            'notes' => $payload['notes'] ?? null,
        ];
        $stmt = Database::run('SELECT id FROM event_recurrence_rules WHERE event_id = ? LIMIT 1', [$params['id']]);
        $existing = $stmt->fetchColumn();
        if ($existing) {
            Database::run('UPDATE event_recurrence_rules SET frequency = ?, interval = ?, byweekday = ?, starts_on = ?, ends_on = ?, rule_payload = ?, updated_by = ? WHERE id = ?', [
                $frequency,
                $interval,
                $byweekday,
                $startsOn,
                $payload['ends_on'] ?? null,
                json_encode($rulePayload),
                'api',
                $existing
            ]);
            $recurrenceId = (int)$existing;
        } else {
            Database::run('INSERT INTO event_recurrence_rules (event_id, frequency, interval, byweekday, starts_on, ends_on, rule_payload, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
                $params['id'],
                $frequency,
                $interval,
                $byweekday,
                $startsOn,
                $payload['ends_on'] ?? null,
                json_encode($rulePayload),
                'api',
                'api'
            ]);
            $recurrenceId = (int)Database::connection()->lastInsertId();
        }
        record_audit('recurrence.save', 'event', (int) $params['id'], [
            'recurrence_id' => $recurrenceId,
            'frequency' => $frequency,
            'interval' => $interval,
            'byweekday' => $byweekday,
            'starts_on' => $startsOn,
            'ends_on' => $payload['ends_on'] ?? null,
        ]);
        Response::success(['recurrence_id' => $recurrenceId]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('POST /api/events/:id/recurrence error: ' . $e->getMessage());
        }
        Response::error('Failed to save recurrence', 500);
    }
});

$router->add('DELETE', '/api/events/:id/recurrence', function ($request, $params) {
    try {
        $stmt = Database::run('DELETE FROM event_recurrence_rules WHERE event_id = ?', [$params['id']]);
        if ($stmt->rowCount() > 0) {
            record_audit('recurrence.delete', 'event', (int) $params['id']);
        }
        Response::success(['deleted' => $stmt->rowCount()]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('DELETE /api/events/:id/recurrence error: ' . $e->getMessage());
        }
        Response::error('Failed to delete recurrence', 500);
    }
});

$router->add('POST', '/api/events/:id/recurrence/exceptions', function (Request $request, $params) {
    try {
        $ruleStmt = Database::run('SELECT id FROM event_recurrence_rules WHERE event_id = ? LIMIT 1', [$params['id']]);
        $ruleId = $ruleStmt->fetchColumn();
        if (!$ruleId) {
            return Response::error('Recurrence rule not found', 404);
        }
        $payload = read_json_body($request);
        $exceptionDate = $payload['exception_date'] ?? null;
        if (!$exceptionDate) {
            return Response::error('exception_date is required', 400);
        }
        $type = in_array($payload['exception_type'] ?? 'skip', ['skip','override'], true) ? $payload['exception_type'] : 'skip';
        $override = $payload['override_payload'] ?? null;
        Database::run('INSERT INTO event_recurrence_exceptions (recurrence_id, exception_date, exception_type, override_payload, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)', [
            $ruleId,
            $exceptionDate,
            $type,
            $override ? json_encode($override) : null,
            $payload['notes'] ?? null,
            'api'
        ]);
        $exceptionId = (int)Database::connection()->lastInsertId();
        record_audit('recurrence.exception.add', 'event', (int) $params['id'], [
            'exception_id' => $exceptionId,
            'exception_date' => $exceptionDate,
            'exception_type' => $type,
        ]);
        Response::success(['exception_id' => $exceptionId]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('POST /api/events/:id/recurrence/exceptions error: ' . $e->getMessage());
        }
        Response::error('Failed to save exception', 500);
    }
});

$router->add('DELETE', '/api/recurrence-exceptions/:id', function ($request, $params) {
    try {
        $fetch = Database::run('SELECT rx.id, rx.recurrence_id, rx.exception_date, rr.event_id FROM event_recurrence_exceptions rx LEFT JOIN event_recurrence_rules rr ON rr.id = rx.recurrence_id WHERE rx.id = ? LIMIT 1', [$params['id']]);
        $row = $fetch->fetch();
        if (!$row) {
            return Response::error('Exception not found', 404);
        }
        Database::run('DELETE FROM event_recurrence_exceptions WHERE id = ?', [$params['id']]);
        record_audit('recurrence.exception.delete', 'recurrence_exception', (int) $row['id'], [
            'event_id' => $row['event_id'] ?? null,
            'recurrence_id' => $row['recurrence_id'] ?? null,
            'exception_date' => $row['exception_date'] ?? null,
        ]);
        Response::success();
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('DELETE /api/recurrence-exceptions/:id error: ' . $e->getMessage());
        }
        Response::error('Failed to delete exception', 500);
    }
});

$router->add('GET', '/api/seating/event/:eventId', function ($request, $params) {
    $pdo = Database::connection();
    expire_stale_holds($pdo);
    $eventId = (int) $params['eventId'];
    [$layoutData, $stagePosition, $stageSize, $canvasSettings] = fetch_layout_for_event($eventId);
    $stmt = $pdo->prepare('SELECT selected_seats, status, hold_expires_at FROM seat_requests WHERE event_id = ?');
    $stmt->execute([$eventId]);
    $reserved = [];
    $pending = [];
    $holds = [];
    $finalized = [];
    $now = now_eastern();
    $openStatuses = open_seat_request_statuses();
    while ($row = $stmt->fetch()) {
        $seats = parse_selected_seats($row['selected_seats']);
        $status = normalize_seat_request_status($row['status'] ?? null);
        if (in_array($status, $openStatuses, true) && $row['hold_expires_at']) {
            try {
                $expires = new DateTimeImmutable($row['hold_expires_at'], new DateTimeZone('America/New_York'));
                if ($expires < $now) {
                    continue;
                }
            } catch (Throwable $e) {
                // default to considering, safer to show as pending
            }
        }
        foreach ($seats as $seat) {
            if ($status === 'confirmed') {
                $reserved[$seat] = true;
                $finalized[$seat] = true;
            } elseif (in_array($status, $openStatuses, true)) {
                $pending[$seat] = true;
                if ($status === 'new') {
                    $holds[$seat] = true;
                }
            }
        }
    }
    Response::success([
        'seating' => $layoutData,
        'stagePosition' => $stagePosition,
        'stageSize' => $stageSize,
        'canvasSettings' => $canvasSettings,
        'reservedSeats' => array_keys($reserved),
        'pendingSeats' => array_keys($pending),
        'holdSeats' => array_keys($holds),
        'finalizedSeats' => array_keys($finalized),
    ]);
});

$router->add('GET', '/api/seating', function () {
    $stmt = Database::run('SELECT id, event_id, section as section_name, row_label, seat_number, total_seats, seat_type, is_active, selected_seats, pos_x, pos_y, rotation, status FROM seating ORDER BY section, row_label, seat_number');
    $rows = $stmt->fetchAll();
    Response::success(['seating' => $rows]);
});

$router->add('POST', '/api/seating', function (Request $request) {
    $payload = read_json_body($request);
    $id = $payload['id'] ?? null;
    $fields = ['event_id','section','row_label','seat_number','total_seats','seat_type','is_active','selected_seats','pos_x','pos_y','rotation','status'];
    $values = [];
    foreach ($fields as $field) {
        $values[$field] = $payload[$field] ?? null;
    }
    if ($id) {
        Database::run(
            'UPDATE seating SET event_id = ?, section = ?, row_label = ?, seat_number = ?, total_seats = ?, seat_type = ?, is_active = ?, pos_x = ?, pos_y = ?, rotation = ?, status = ? WHERE id = ?',
            [$values['event_id'], $values['section'], $values['row_label'], $values['seat_number'], $values['total_seats'] ?? 1, $values['seat_type'] ?? 'general', $values['is_active'] ? 1 : 0, $values['pos_x'], $values['pos_y'], $values['rotation'] ?? 0, $values['status'] ?? 'available', $id]
        );
        return Response::success(['id' => $id]);
    }
    Database::run(
        'INSERT INTO seating (event_id, section, row_label, seat_number, total_seats, seat_type, is_active, selected_seats, pos_x, pos_y, rotation, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$values['event_id'], $values['section'], $values['row_label'], $values['seat_number'], $values['total_seats'] ?? 1, $values['seat_type'] ?? 'general', $values['is_active'] ? 1 : 0, $values['selected_seats'] ? json_encode($values['selected_seats']) : null, $values['pos_x'], $values['pos_y'], $values['rotation'] ?? 0, $values['status'] ?? 'available']
    );
    $insertId = (int) Database::connection()->lastInsertId();
    Response::success(['id' => $insertId]);
});

$router->add('PATCH', '/api/seating/:id', function (Request $request, $params) {
    $payload = read_json_body($request);
    $allowed = ['event_id','section','row_label','seat_number','total_seats','seat_type','is_active','selected_seats','pos_x','pos_y','rotation','status'];
    $updates = [];
    $values = [];
    foreach ($allowed as $field) {
        if (array_key_exists($field, $payload)) {
            $updates[] = "`$field` = ?";
            $values[] = $field === 'selected_seats' ? ($payload[$field] ? json_encode($payload[$field]) : null) : $payload[$field];
        }
    }
    if (!$updates) {
        return Response::error('No valid fields provided', 400);
    }
    $values[] = $params['id'];
    $sql = 'UPDATE seating SET ' . implode(', ', $updates) . ' WHERE id = ?';
    Database::run($sql, $values);
    Response::success(['id' => $params['id']]);
});

$router->add('GET', '/api/stage-settings', function () {
    $stmt = Database::run('SELECT key_name, value FROM stage_settings');
    $settings = [];
    while ($row = $stmt->fetch()) {
        $settings[$row['key_name']] = $row['value'];
    }
    Response::success(['settings' => $settings]);
});

$router->add('PUT', '/api/stage-settings', function (Request $request) {
    $payload = read_json_body($request);
    foreach ($payload as $key => $value) {
        Database::run('INSERT INTO stage_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?', [$key, $value, $value]);
    }
    Response::success();
});

$router->add('POST', '/api/layout-history', function (Request $request) {
    $payload = read_json_body($request);
    $snapshot = $payload['snapshot'] ?? null;
    if (!$snapshot) {
        return Response::error('No snapshot provided', 400);
    }
    Database::run('INSERT INTO layout_history (snapshot) VALUES (?)', [json_encode($snapshot)]);
    $id = (int) Database::connection()->lastInsertId();
    try {
        Database::run('DELETE FROM layout_history WHERE id IN (SELECT id FROM (SELECT id FROM layout_history ORDER BY id DESC LIMIT 18446744073709551615 OFFSET ?) tmp)', [LAYOUT_HISTORY_MAX]);
        Database::run('DELETE FROM layout_history WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [LAYOUT_HISTORY_RETENTION_DAYS]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('Prune after insert error: ' . $e->getMessage());
        }
    }
    Response::success(['id' => $id]);
});

$router->add('POST', '/api/layout-history/prune', function (Request $request) {
    $payload = read_json_body($request);
    $maxEntries = (int) ($payload['maxEntries'] ?? LAYOUT_HISTORY_MAX);
    $olderThan = (int) ($payload['olderThanDays'] ?? LAYOUT_HISTORY_RETENTION_DAYS);
    Database::run('DELETE FROM layout_history WHERE id IN (SELECT id FROM (SELECT id FROM layout_history ORDER BY id DESC LIMIT 18446744073709551615 OFFSET ?) tmp)', [$maxEntries]);
    Database::run('DELETE FROM layout_history WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [$olderThan]);
    Response::success();
});

$router->add('GET', '/api/layout-history', function (Request $request) {
    $limit = (int) ($request->query['limit'] ?? 50);
    $stmt = Database::run('SELECT id, snapshot, created_at FROM layout_history ORDER BY id DESC LIMIT ?', [$limit]);
    $history = [];
    while ($row = $stmt->fetch()) {
        $history[] = ['id' => $row['id'], 'snapshot' => json_decode($row['snapshot'], true), 'created_at' => $row['created_at']];
    }
    Response::success(['history' => $history]);
});

$router->add('GET', '/api/layout-history/:id', function ($request, $params) {
    $stmt = Database::run('SELECT id, snapshot, created_at FROM layout_history WHERE id = ? LIMIT 1', [$params['id']]);
    $row = $stmt->fetch();
    if (!$row) {
        return Response::error('Snapshot not found', 404);
    }
    Response::success(['snapshot' => ['id' => $row['id'], 'snapshot' => json_decode($row['snapshot'], true), 'created_at' => $row['created_at']]]);
});

$router->add('GET', '/api/seating-layouts', function () {
    $stmt = Database::run('SELECT id, name, description, is_default, layout_data, stage_position, stage_size, canvas_settings, created_at, updated_at FROM seating_layouts ORDER BY is_default DESC, name ASC');
    $layouts = [];
    while ($row = $stmt->fetch()) {
        $row['layout_data'] = $row['layout_data'] ? json_decode($row['layout_data'], true) : null;
        $row['stage_position'] = $row['stage_position'] ? json_decode($row['stage_position'], true) : null;
        $row['stage_size'] = $row['stage_size'] ? json_decode($row['stage_size'], true) : null;
        $row['canvas_settings'] = $row['canvas_settings'] ? json_decode($row['canvas_settings'], true) : null;
        $layouts[] = $row;
    }
    Response::success(['layouts' => $layouts]);
});

$router->add('GET', '/api/seating-layouts/default', function () {
    $stmt = Database::run('SELECT id, name, description, is_default, layout_data, stage_position, stage_size, canvas_settings, created_at, updated_at FROM seating_layouts WHERE is_default = 1 LIMIT 1');
    $row = $stmt->fetch();
    if (!$row) {
        return Response::error('No default layout found', 404);
    }
    $row['layout_data'] = $row['layout_data'] ? json_decode($row['layout_data'], true) : null;
    $row['stage_position'] = $row['stage_position'] ? json_decode($row['stage_position'], true) : null;
    $row['stage_size'] = $row['stage_size'] ? json_decode($row['stage_size'], true) : null;
    $row['canvas_settings'] = $row['canvas_settings'] ? json_decode($row['canvas_settings'], true) : null;
    Response::success(['layout' => $row]);
});

$router->add('GET', '/api/seating-layouts/:id', function ($request, $params) {
    $stmt = Database::run('SELECT id, name, description, is_default, layout_data, stage_position, stage_size, canvas_settings, created_at, updated_at FROM seating_layouts WHERE id = ?', [$params['id']]);
    $row = $stmt->fetch();
    if (!$row) {
        return Response::error('Layout not found', 404);
    }
    $row['layout_data'] = $row['layout_data'] ? json_decode($row['layout_data'], true) : null;
    $row['stage_position'] = $row['stage_position'] ? json_decode($row['stage_position'], true) : null;
    $row['stage_size'] = $row['stage_size'] ? json_decode($row['stage_size'], true) : null;
    $row['canvas_settings'] = $row['canvas_settings'] ? json_decode($row['canvas_settings'], true) : null;
    Response::success(['layout' => $row]);
});

$router->add('POST', '/api/seating-layouts', function (Request $request) {
    $payload = read_json_body($request);
    $name = $payload['name'] ?? null;
    $layoutData = $payload['layout_data'] ?? null;
    if (!$name || !$layoutData) {
        return Response::error('Name and layout_data are required', 400);
    }
    $isDefault = !empty($payload['is_default']);
    if ($isDefault) {
        Database::run('UPDATE seating_layouts SET is_default = 0');
    }
    Database::run('INSERT INTO seating_layouts (name, description, is_default, layout_data, canvas_settings) VALUES (?, ?, ?, ?, ?)', [
        $name,
        $payload['description'] ?? '',
        $isDefault ? 1 : 0,
        json_encode($layoutData),
        isset($payload['canvas_settings']) ? json_encode($payload['canvas_settings']) : null
    ]);
    $id = (int) Database::connection()->lastInsertId();
    Response::success(['id' => $id]);
});

$router->add('PUT', '/api/seating-layouts/:id', function (Request $request, $params) {
    $payload = read_json_body($request);
    $isDefault = !empty($payload['is_default']);
    if ($isDefault) {
        Database::run('UPDATE seating_layouts SET is_default = 0 WHERE id != ?', [$params['id']]);
    }
    $stagePosition = isset($payload['stage_position']) ? json_encode($payload['stage_position']) : null;
    $stageSize = isset($payload['stage_size']) ? json_encode($payload['stage_size']) : null;
    $canvasSettings = isset($payload['canvas_settings']) ? json_encode($payload['canvas_settings']) : null;
    $result = Database::run('UPDATE seating_layouts SET name = ?, description = ?, is_default = ?, layout_data = ?, stage_position = ?, stage_size = ?, canvas_settings = ? WHERE id = ?', [$payload['name'] ?? null, $payload['description'] ?? '', $isDefault ? 1 : 0, json_encode($payload['layout_data'] ?? []), $stagePosition, $stageSize, $canvasSettings, $params['id']]);
    if ($result->rowCount() === 0) {
        return Response::error('Layout not found', 404);
    }
    Response::success();
});

$router->add('DELETE', '/api/seating-layouts/:id', function ($request, $params) {
    $stmt = Database::run('SELECT is_default FROM seating_layouts WHERE id = ?', [$params['id']]);
    $layout = $stmt->fetch();
    if ($layout && (int) $layout['is_default'] === 1) {
        return Response::error('Cannot delete the default layout', 400);
    }
    Database::run('UPDATE events SET layout_id = NULL WHERE layout_id = ?', [$params['id']]);
    $result = Database::run('DELETE FROM seating_layouts WHERE id = ?', [$params['id']]);
    if ($result->rowCount() === 0) {
        return Response::error('Layout not found', 404);
    }
    Response::success();
});

$router->add('DELETE', '/api/seating/:id', function ($request, $params) {
    Database::run('DELETE FROM seating WHERE id = ?', [$params['id']]);
    Response::success();
});

$router->add('GET', '/api/seat-requests', function (Request $request) {
    try {
        $pdo = Database::connection();
        expire_stale_holds($pdo);
        $filters = [];
        $values = [];
        if (!empty($request->query['event_id'])) {
            $filters[] = 'sr.event_id = ?';
            $values[] = $request->query['event_id'];
        }
        $statusFilter = strtolower(trim((string) ($request->query['status'] ?? '')));
        if ($statusFilter !== '' && $statusFilter !== 'all') {
            if ($statusFilter === 'open') {
                $statuses = open_seat_request_statuses();
            } elseif (str_contains($statusFilter, ',')) {
                $statuses = array_filter(array_map('trim', explode(',', $statusFilter)));
            } else {
                $statuses = [$statusFilter];
            }
            $statuses = array_values(array_unique(array_map('normalize_seat_request_status', $statuses)));
            if ($statuses) {
                $placeholders = implode(',', array_fill(0, count($statuses), '?'));
                $filters[] = "sr.status IN ($placeholders)";
                $values = array_merge($values, $statuses);
            }
        }
        $where = $filters ? ('WHERE ' . implode(' AND ', $filters)) : '';
        $sql = <<<SQL
SELECT
    sr.*,
    e.title AS event_title,
    e.start_datetime,
    e.seat_request_email_override,
    ec.slug AS category_slug,
    ec.name AS category_name,
    ec.seat_request_email_to AS category_seat_request_email_to
FROM seat_requests sr
LEFT JOIN events e ON sr.event_id = e.id
LEFT JOIN event_categories ec ON ec.id = e.category_id
$where
ORDER BY sr.created_at DESC
SQL;
        $stmt = $pdo->prepare($sql);
        $stmt->execute($values);
        $requests = [];
        while ($row = $stmt->fetch()) {
            if (!empty($row['selected_seats']) && is_string($row['selected_seats'])) {
                $row['selected_seats'] = json_decode($row['selected_seats'], true) ?: [];
            }
            if (empty($row['contact'])) {
                $row['contact'] = ['email' => $row['customer_email'] ?? null, 'phone' => $row['customer_phone'] ?? null];
            } elseif (is_string($row['contact'])) {
                $decoded = json_decode($row['contact'], true);
                $row['contact'] = is_array($decoded) ? $decoded : ['email' => $row['customer_email'] ?? null, 'phone' => $row['customer_phone'] ?? null];
            }
            $row['status_raw'] = $row['status'];
            $row['status'] = normalize_seat_request_status($row['status']);
            $row['status_normalized'] = $row['status'];
            [$targetEmail, $targetSource] = determine_seat_request_recipient($row);
            $row['seat_request_target_email'] = $targetEmail;
            $row['seat_request_target_source'] = $targetSource;
            $row['seat_display_labels'] = build_display_seat_list($row);
            $requests[] = $row;
        }
        Response::success(['requests' => $requests]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('GET /api/seat-requests error: ' . $e->getMessage());
        }
        Response::error('Failed to fetch seat requests', 500);
    }
});

$router->add('POST', '/api/admin/seat-requests', function (Request $request) {
    $session = current_admin_session();
    if (!$session) {
        return Response::error('Unauthorized', 401);
    }
    try {
        $payload = read_json_body($request);
        $pdo = Database::connection();
        $adminActor = seat_request_admin_actor();
        $statusOverride = $payload['status'] ?? null;
        $result = create_seat_request_record($pdo, $payload, [
            'created_by' => $adminActor,
            'updated_by' => $adminActor,
            'default_status' => 'confirmed',
            'allow_status_override' => true,
            'forced_status' => $statusOverride,
        ]);
        $seatId = (int) ($result['seat_request']['id'] ?? 0);
        if ($seatId > 0) {
            record_audit('seat_request.manual_create', 'seat_request', $seatId, [
                'event_id' => $result['seat_request']['event_id'] ?? null,
                'status' => $result['seat_request']['status'] ?? null,
            ]);
        }
        Response::success($result);
    } catch (SeatRequestException $validationError) {
        Response::error($validationError->getMessage(), $validationError->httpStatus, $validationError->payload);
    } catch (RuntimeException $validationError) {
        Response::error($validationError->getMessage(), 400);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('POST /api/admin/seat-requests error: ' . $e->getMessage());
        }
        Response::error('Failed to create reservation', 500);
    }
});

$router->add('POST', '/api/seat-requests/:id/approve', function ($request, $params) {
    $pdo = Database::connection();
    expire_stale_holds($pdo);
    $rid = (int) $params['id'];
    try {
        $pdo->beginTransaction();
        $stmt = $pdo->prepare('SELECT * FROM seat_requests WHERE id = ? LIMIT 1');
        $stmt->execute([$rid]);
        $requestRow = $stmt->fetch();
        if (!$requestRow) {
            $pdo->rollBack();
            return Response::error('Request not found', 404);
        }
        $currentStatus = normalize_seat_request_status($requestRow['status'] ?? null);
        if ($currentStatus === 'confirmed') {
            $pdo->rollBack();
            return Response::success(['message' => 'Already confirmed']);
        }
        $seats = json_decode($requestRow['selected_seats'] ?? '[]', true) ?: [];
        $conflicts = [];
        foreach ($seats as $seatId) {
            $parts = explode('-', $seatId);
            $seatNum = array_pop($parts);
            $rowLabel = array_pop($parts);
            $section = implode('-', $parts);
            $stmt = $pdo->prepare('SELECT id, selected_seats FROM seating WHERE section = ? AND row_label = ? LIMIT 1');
            $stmt->execute([$section, $rowLabel]);
            $row = $stmt->fetch();
            if (!$row) {
                continue;
            }
            $existing = json_decode($row['selected_seats'] ?? '[]', true) ?: [];
            if (in_array($seatId, $existing, true)) {
                $conflicts[] = $seatId;
            }
        }
        if ($conflicts) {
            $pdo->rollBack();
            return Response::error('Conflict - seats already reserved', 409, ['conflicts' => $conflicts]);
        }
        apply_seat_reservations($pdo, $seats);
        $actor = seat_request_admin_actor();
        $pdo->prepare('UPDATE seat_requests SET status = ?, finalized_at = NOW(), hold_expires_at = NULL, updated_at = NOW(), updated_by = ?, change_note = ? WHERE id = ?')
            ->execute(['confirmed', $actor, 'approved via admin', $rid]);
        $pdo->commit();
        record_audit('seat_request.approve', 'seat_request', $rid, [
            'seats' => $seats,
        ]);
        Response::success();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (APP_DEBUG) {
            error_log('POST /api/seat-requests/:id/approve error: ' . $e->getMessage());
        }
        Response::error('Failed to approve request', 500);
    }
});

$router->add('POST', '/api/seat-requests/:id/deny', function ($request, $params) {
    $pdo = Database::connection();
    expire_stale_holds($pdo);
    $actor = seat_request_admin_actor();
    $stmt = $pdo->prepare('UPDATE seat_requests SET status = ?, hold_expires_at = NULL, updated_at = NOW(), updated_by = ?, change_note = ? WHERE id = ?');
    $stmt->execute(['declined', $actor, 'declined via admin', $params['id']]);
    if ($stmt->rowCount() === 0) {
        return Response::error('Seat request not found', 404);
    }
    record_audit('seat_request.deny', 'seat_request', (int) $params['id']);
    Response::success();
});

$router->add('POST', '/api/seat-requests', function (Request $request) {
    try {
        $rawBody = trim($request->raw());
        $payload = json_decode($rawBody, true);
        if ($rawBody !== '' && json_last_error() !== JSON_ERROR_NONE) {
            return Response::error('Invalid JSON payload', 400, ['detail' => json_last_error_msg()]);
        }
        $payload = is_array($payload) ? $payload : [];
        $pdo = Database::connection();
        $result = create_seat_request_record($pdo, $payload, [
            'created_by' => 'public',
            'updated_by' => 'public',
            'default_status' => 'new',
            'allow_status_override' => false,
        ]);
        Response::success($result);
    } catch (SeatRequestException $validationError) {
        Response::error($validationError->getMessage(), $validationError->httpStatus, $validationError->payload);
    } catch (RuntimeException $validationError) {
        Response::error($validationError->getMessage(), 400);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('[seat-requests] error: ' . $e->getMessage());
        }
        $extra = APP_DEBUG ? [
            'detail' => $e->getMessage(),
            'where' => $e->getFile() . ':' . $e->getLine(),
        ] : [];
        Response::error('Failed to submit seat request', 500, $extra);
    }
});

$router->add('PUT', '/api/seat-requests/:id', function (Request $request, $params) {
    try {
        $pdo = Database::connection();
        expire_stale_holds($pdo);
        $payload = read_json_body($request);
        if (array_key_exists('selectedSeats', $payload) && !array_key_exists('selected_seats', $payload)) {
            $payload['selected_seats'] = $payload['selectedSeats'];
        }
        $requestId = (int) $params['id'];
        $existingStmt = $pdo->prepare('SELECT id, status FROM seat_requests WHERE id = ? LIMIT 1');
        $existingStmt->execute([$requestId]);
        $existing = $existingStmt->fetch();
        if (!$existing) {
            return Response::error('Seat request not found', 404);
        }
        $originalStatus = normalize_seat_request_status($existing['status'] ?? 'new');
        $targetStatus = normalize_seat_request_status($existing['status'] ?? 'new');
        $fields = [];
        $values = [];
        $metaChanges = [];
        if (array_key_exists('status', $payload)) {
            $newStatus = normalize_seat_request_status($payload['status']);
            if (!in_array($newStatus, canonical_seat_request_statuses(), true)) {
                return Response::error('Invalid status', 400);
            }
            if ($newStatus === 'confirmed') {
                return Response::error('Use the finalize action to confirm seats', 400);
            }
            $targetStatus = $newStatus;
            if ($newStatus !== $originalStatus) {
                $metaChanges['status'] = ['from' => $originalStatus, 'to' => $newStatus];
            }
            $fields[] = 'status = ?';
            $values[] = $newStatus;
            if ($newStatus === 'confirmed') {
                $fields[] = 'finalized_at = NOW()';
                $fields[] = 'hold_expires_at = NULL';
            } elseif (in_array($newStatus, ['declined', 'closed', 'spam', 'expired'], true)) {
                $fields[] = 'hold_expires_at = NULL';
            } elseif (in_array($newStatus, open_seat_request_statuses(), true) && !array_key_exists('hold_expires_at', $payload)) {
                $fields[] = 'hold_expires_at = ?';
                $values[] = compute_hold_expiration(now_eastern())->format('Y-m-d H:i:s');
            }
        }
        $selectedSeatsPayload = $payload['selected_seats'] ?? null;
        if ($selectedSeatsPayload !== null) {
            if (!is_array($selectedSeatsPayload)) {
                return Response::error('selected_seats must be an array of seat labels', 400);
            }
            $seatList = array_values(array_filter(array_map(function ($seat) {
                return is_string($seat) ? trim($seat) : '';
            }, $selectedSeatsPayload), function ($seat) {
                return $seat !== '';
            }));
            if (in_array($targetStatus, ['confirmed', 'declined', 'closed', 'spam'], true)) {
                return Response::error('Seats are locked once a request is finalized. Reopen it first.', 409);
            }
            $fields[] = 'selected_seats = ?';
            $values[] = json_encode($seatList);
            $fields[] = 'total_seats = ?';
            $values[] = count($seatList);
            $metaChanges['seats'] = count($seatList);
        }
        foreach (['customer_name','customer_email','customer_phone','special_requests','staff_notes'] as $col) {
            if (array_key_exists($col, $payload)) {
                $fields[] = $col . ' = ?';
                $values[] = $payload[$col];
                if ($col === 'customer_phone') {
                    $fields[] = 'customer_phone_normalized = ?';
                    $values[] = normalize_phone_number($payload[$col]);
                }
            }
        }
        if (array_key_exists('hold_expires_at', $payload)) {
            $rawExpiry = $payload['hold_expires_at'];
            $metaChanges['hold_override'] = true;
            if ($rawExpiry === null || $rawExpiry === '') {
                $fields[] = 'hold_expires_at = NULL';
            } else {
                try {
                    $expiry = new DateTime($rawExpiry);
                    $fields[] = 'hold_expires_at = ?';
                    $values[] = $expiry->format('Y-m-d H:i:s');
                } catch (Throwable $e) {
                    return Response::error('Invalid hold_expires_at value', 400);
                }
            }
        }
        if (!$fields) {
            return Response::error('No valid fields provided', 400);
        }
        $fields[] = 'updated_by = ?';
        $values[] = seat_request_admin_actor();
        $values[] = $requestId;
        $sql = 'UPDATE seat_requests SET ' . implode(', ', $fields) . ' WHERE id = ?';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($values);
        if (!empty($metaChanges)) {
            record_audit('seat_request.update', 'seat_request', $requestId, $metaChanges);
        }
        Response::success();
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('PUT /api/seat-requests/:id error: ' . $e->getMessage());
        }
        Response::error('Failed to update seat request', 500);
    }
});

$router->add('DELETE', '/api/seat-requests/:id', function ($request, $params) {
    $stmt = Database::run('DELETE FROM seat_requests WHERE id = ?', [$params['id']]);
    if ($stmt->rowCount() === 0) {
        return Response::error('Seat request not found', 404);
    }
    record_audit('seat_request.delete', 'seat_request', (int) $params['id']);
    Response::success();
});

$router->add('GET', '/api/suggestions', function () {
    $stmt = Database::run('SELECT * FROM suggestions ORDER BY created_at DESC');
    $suggestions = [];
    while ($row = $stmt->fetch()) {
        $row['artist_name'] = $row['name'];
        $contact = $row['contact'];
        if ($contact) {
            if (is_string($contact)) {
                $decoded = json_decode($contact, true);
                $contact = is_array($decoded) ? $decoded : null;
            }
        }
        if ($contact) {
            $row['contact_name'] = $contact['name'] ?? $contact['contact_name'] ?? null;
            $row['contact_email'] = $contact['email'] ?? $contact['contact_email'] ?? null;
            $row['contact_phone'] = $contact['phone'] ?? $contact['contact_phone'] ?? null;
            $row['music_links'] = $contact['music_links'] ?? null;
            $row['social_media'] = $contact['social_media'] ?? null;
            $row['genre'] = $contact['genre'] ?? null;
        } else {
            $row['contact_name'] = null;
            $row['contact_email'] = null;
            $row['contact_phone'] = null;
            $row['music_links'] = null;
            $row['social_media'] = null;
            $row['genre'] = null;
        }
        $row['message'] = $row['notes'] ?? null;
        $suggestions[] = $row;
    }
    Response::success(['suggestions' => $suggestions]);
});

$router->add('POST', '/api/suggestions', function (Request $request) {
    $payload = read_json_body($request);
    $artistName = $payload['artist_name'] ?? $payload['name'] ?? 'Unknown Artist';
    $submissionType = $payload['submission_type'] ?? $payload['type'] ?? 'general';
    $contact = $payload['contact'] ?? [];
    if (is_string($contact)) {
        $decoded = json_decode($contact, true);
        $contact = is_array($decoded) ? $decoded : ['raw' => $contact];
    }
    $contact = is_array($contact) ? $contact : [];
    foreach (['contact_name' => 'name','contact_email' => 'email','contact_phone' => 'phone','music_links' => 'music_links','social_media' => 'social_media','genre' => 'genre'] as $input => $target) {
        if (!isset($contact[$target]) && isset($payload[$input])) {
            $contact[$target] = $payload[$input];
        }
    }
    $contactJson = $contact ? json_encode($contact) : null;
    $notes = $payload['notes'] ?? $payload['message'] ?? '';
    Database::run('INSERT INTO suggestions (name, contact, notes, submission_type, created_at) VALUES (?, ?, ?, ?, NOW())', [$artistName, $contactJson, $notes, $submissionType]);
    $id = (int) Database::connection()->lastInsertId();
    try {
        notify_artist_suggestion_emails($id, $artistName, $contact, $notes, $submissionType);
    } catch (Throwable $notifyError) {
        error_log('[email] Unable to process artist suggestion notifications: ' . $notifyError->getMessage());
    }
    Response::success(['id' => $id]);
});

$router->add('PUT', '/api/suggestions/:id', function (Request $request, $params) {
    // Enhanced: allow updating artist fields and contact metadata safely
    // Accepts flat fields (artist_name, contact_*) or a `contact` object/string
    $payload = read_json_body($request);
    $existingStmt = Database::run('SELECT contact FROM suggestions WHERE id = ?', [$params['id']]);
    $existing = $existingStmt->fetch();
    if (!$existing) {
        return Response::error('Suggestion not found', 404);
    }

    $contactData = [];
    if (!empty($existing['contact'])) {
        $decoded = json_decode($existing['contact'], true);
        if (is_array($decoded)) {
            $contactData = $decoded;
        }
    }

    $fields = [];
    $values = [];

    if (array_key_exists('status', $payload)) {
        $fields[] = 'status = ?';
        $values[] = $payload['status'] ?: null;
    }

    if (array_key_exists('notes', $payload) || array_key_exists('message', $payload)) {
        $fields[] = 'notes = ?';
        $values[] = $payload['notes'] ?? $payload['message'] ?? null;
    }

    if (array_key_exists('artist_name', $payload) || array_key_exists('name', $payload)) {
        $fields[] = 'name = ?';
        $values[] = $payload['artist_name'] ?? $payload['name'];
    }

    if (array_key_exists('submission_type', $payload)) {
        $fields[] = 'submission_type = ?';
        $values[] = $payload['submission_type'] ?: null;
    }

    $contactPayload = $payload['contact'] ?? null;
    if (is_string($contactPayload)) {
        $decoded = json_decode($contactPayload, true);
        $contactPayload = is_array($decoded) ? $decoded : ['raw' => $contactPayload];
    }
    if (is_array($contactPayload)) {
        $contactData = array_merge($contactData, $contactPayload);
    }

    $contactFieldMap = [
        'contact_name' => 'name',
        'contact_email' => 'email',
        'contact_phone' => 'phone',
        'music_links' => 'music_links',
        'social_media' => 'social_media',
        'genre' => 'genre',
    ];

    $contactChanged = false;
    foreach ($contactFieldMap as $input => $target) {
        if (array_key_exists($input, $payload)) {
            $contactData[$target] = $payload[$input];
            $contactChanged = true;
        }
    }

    if ($contactPayload !== null) {
        $contactChanged = true;
    }

    if ($contactChanged) {
        $cleanContact = array_filter(
            $contactData,
            function ($value) {
                return $value !== null && $value !== '';
            }
        );
        $fields[] = 'contact = ?';
        $values[] = $cleanContact ? json_encode($cleanContact) : null;
    }

    if (!$fields) {
        return Response::error('No valid fields provided', 400);
    }

    $values[] = $params['id'];
    $sql = 'UPDATE suggestions SET ' . implode(', ', $fields) . ' WHERE id = ?';
    $stmt = Database::run($sql, $values);
    if ($stmt->rowCount() === 0) {
        return Response::error('Suggestion not updated', 500);
    }

    Response::success();
});

$router->add('DELETE', '/api/suggestions/:id', function ($request, $params) {
    $stmt = Database::run('DELETE FROM suggestions WHERE id = ?', [$params['id']]);
    if ($stmt->rowCount() === 0) {
        return Response::error('Suggestion not found', 404);
    }
    Response::success();
});

$router->add('GET', '/api/dashboard-stats', function () {
    try {
        $pdo = Database::connection();
        $targetTimezone = 'America/New_York';
        $tz = new DateTimeZone($targetTimezone);
        try {
            $pdo->exec("SET time_zone = '{$targetTimezone}'");
        } catch (Throwable $tzError) {
            $now = new DateTime('now', $tz);
            $offsetSeconds = $tz->getOffset($now);
            $sign = $offsetSeconds >= 0 ? '+' : '-';
            $hh = str_pad((string) floor(abs($offsetSeconds) / 3600), 2, '0', STR_PAD_LEFT);
            $mm = str_pad((string) floor((abs($offsetSeconds) % 3600) / 60), 2, '0', STR_PAD_LEFT);
            $tzOffset = sprintf('%s%s:%s', $sign, $hh, $mm);
            $pdo->prepare('SET time_zone = ?')->execute([$tzOffset]);
        }

        $visibilityFilter = "status = 'published' AND visibility = 'public' AND deleted_at IS NULL";

        $upcoming = (int) $pdo->query(
            "SELECT COUNT(*) FROM events WHERE {$visibilityFilter} AND start_datetime >= NOW() AND start_datetime < DATE_ADD(NOW(), INTERVAL 2 MONTH)"
        )->fetchColumn();

        $pendingStatuses = ['pending','hold','new','contacted','waiting'];
        $placeholders = implode(',', array_fill(0, count($pendingStatuses), '?'));
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) FROM seat_requests WHERE status IS NULL OR LOWER(status) IN ({$placeholders})"
        );
        $stmt->execute($pendingStatuses);
        $pendingRequests = (int) $stmt->fetchColumn();

        try {
            $pendingSuggestions = (int) $pdo->query(
                "SELECT COUNT(*) FROM suggestions WHERE status = 'pending'"
            )->fetchColumn();
        } catch (Throwable $e) {
            $pendingSuggestions = (int) $pdo->query('SELECT COUNT(*) FROM suggestions')->fetchColumn();
        }

        $eventsThisMonth = (int) $pdo->query(
            "SELECT COUNT(*) FROM events WHERE {$visibilityFilter} AND YEAR(start_datetime) = YEAR(CURDATE()) AND MONTH(start_datetime) = MONTH(CURDATE())"
        )->fetchColumn();

        Response::success([
            'stats' => [
                'upcoming_events' => $upcoming,
                'pending_requests' => $pendingRequests,
                'pending_suggestions' => $pendingSuggestions,
                'events_this_month' => $eventsThisMonth,
            ],
        ]);
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('GET /api/dashboard-stats error: ' . $error->getMessage());
        }
        Response::error('Failed to fetch dashboard stats', 500);
    }
});

$router->add('GET', '/api/media', function (Request $request) {
    try {
        $category = $request->query['category'] ?? null;
        if ($category && $category !== 'all') {
            $stmt = Database::run('SELECT * FROM media WHERE category = ? ORDER BY created_at DESC', [$category]);
        } else {
            $stmt = Database::run('SELECT * FROM media ORDER BY created_at DESC');
        }
        $media = $stmt->fetchAll();
        if ($media) {
            foreach ($media as &$item) {
                $variant = build_single_image_variant($item['file_url'] ?? null);
                if ($variant) {
                    $item['image_variants'] = $variant;
                    $item['optimized_srcset'] = $variant['optimized_srcset'] ?? null;
                    $item['webp_srcset'] = $variant['webp_srcset'] ?? null;
                    $item['fallback_original'] = $variant['fallback_original'] ?? ($item['file_url'] ?? null);
                }
            }
            unset($item);
        }
        Response::success(['media' => $media]);
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('GET /api/media error: ' . $error->getMessage());
        }
        Response::error('Failed to fetch media', 500);
    }
});

$router->add('POST', '/api/media', function (Request $request) {
    if (!isset($_FILES['file'])) {
        return Response::error('No file uploaded', 400);
    }
    $result = save_uploaded_file($_FILES['file']);
    if (!$result || isset($result['error'])) {
        return Response::error($result['error'] ?? 'Upload failed', 400);
    }
    try {
        $category = $request->body['category'] ?? 'other';
        $alt = $request->body['alt_text'] ?? '';
        $caption = $request->body['caption'] ?? '';
        $fileUrl = '/uploads/' . $result['filename'];
        $checksum = is_file($result['path']) ? hash_file('sha256', $result['path']) : null;
        Database::run(
            'INSERT INTO media (filename, original_name, file_path, file_url, file_size, width, height, mime_type, checksum, category, alt_text, caption, optimized_path, webp_path, optimization_status, processing_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $result['filename'],
                $result['original_name'],
                $result['path'],
                $fileUrl,
                $result['size'],
                $result['width'],
                $result['height'],
                $result['mime'],
                $checksum,
                $category,
                $alt,
                $caption,
                $result['optimized_path'],
                $result['webp_path'],
                $result['optimization_status'],
                $result['processing_notes'],
            ]
        );
        $id = (int) Database::connection()->lastInsertId();
        Response::success([
            'media' => [
                'id' => $id,
                'filename' => $result['filename'],
                'file_url' => $fileUrl,
                'category' => $category,
                'alt_text' => $alt,
                'caption' => $caption,
                'width' => $result['width'],
                'height' => $result['height'],
                'optimized_path' => $result['optimized_path'],
                'webp_path' => $result['webp_path'],
                'optimized_srcset' => $result['optimized_srcset'] ?? null,
                'webp_srcset' => $result['webp_srcset'] ?? null,
                'fallback_original' => $result['fallback_original'] ?? $fileUrl,
                'responsive_variants' => $result['responsive_variants'] ?? null,
            ],
        ]);
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('POST /api/media error: ' . $error->getMessage());
        }
        Response::error('Upload failed', 500);
    }
});

$router->add('PUT', '/api/media/:id', function (Request $request, $params) {
    try {
        $payload = read_json_body($request);
        Database::run(
            'UPDATE media SET category = ?, alt_text = ?, caption = ? WHERE id = ?',
            [$payload['category'] ?? null, $payload['alt_text'] ?? '', $payload['caption'] ?? '', $params['id']]
        );
        Response::success();
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('PUT /api/media/:id error: ' . $error->getMessage());
        }
        Response::error('Failed to update media', 500);
    }
});

$router->add('DELETE', '/api/media/:id', function ($request, $params) {
    try {
        $stmt = Database::run('SELECT * FROM media WHERE id = ?', [$params['id']]);
        $row = $stmt->fetch();
        if (!$row) {
            return Response::error('Media not found', 404);
        }
        $fileUrl = $row['file_url'] ?? null;
        if (!$fileUrl && !empty($row['filename'])) {
            $fileUrl = '/uploads/' . ltrim($row['filename'], '/');
        }
        if ($fileUrl) {
            delete_image_with_variants($fileUrl);
        }
        Database::run('DELETE FROM media WHERE id = ?', [$params['id']]);
        Response::success();
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('DELETE /api/media/:id error: ' . $error->getMessage());
        }
        Response::error('Failed to delete media', 500);
    }
});

$router->add('GET', '/api/settings', function () {
    try {
        $settings = fetch_business_settings();
        $heroImages = decode_settings_json($settings, 'hero_images', []);
        $tgpHeroImages = decode_settings_json($settings, 'tgp_hero_images', []);
        $settings['hero_images_variants'] = build_image_variants($heroImages);
        $settings['tgp_hero_images_variants'] = build_image_variants($tgpHeroImages);
        Response::success(['settings' => $settings]);
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('GET /api/settings error: ' . $error->getMessage());
        }
        Response::error('Failed to fetch settings', 500);
    }
});

$router->add('GET', '/api/site-content', function () {
    try {
        $settings = fetch_business_settings();
        $defaultContacts = [
            [
                'name' => 'Donna Cheek',
                'title' => 'Venue Manager',
                'phone' => '336-793-4218',
                'email' => 'midwayeventcenter@gmail.com',
                'notes' => 'Main contact for all events and seat requests.',
            ],
            [
                'name' => 'Sandra Marshall',
                'title' => 'Beach Music Coordinator',
                'phone' => '336-223-5570',
                'email' => 'mmhbeachbands@gmail.com',
                'notes' => 'Carolina Beach Music Series bookings.',
            ],
        ];
        $defaultLessons = [
            [
                'id' => 'line-all-levels',
                'title' => 'Line Dance Lessons - All Skill Levels',
                'schedule' => 'Mondays · 5:30 – 7:30 PM',
                'price' => '$7 / person',
                'instructor' => 'Jackie Phillips',
                'phone' => '727-776-1555',
                'description' => 'High-energy session covering foundations plus new choreography each week.',
            ],
            [
                'id' => 'line-seniors',
                'title' => 'Line Dance Lessons - 55+ Beginner',
                'schedule' => 'Wednesdays · 11:00 AM – Noon',
                'price' => '$7 / person',
                'instructor' => 'Brenda Holcomb',
                'phone' => '336-816-5544',
                'description' => 'Gentle pacing for beginners and seniors who want to get comfortable on the floor.',
            ],
            [
                'id' => 'shag-all-levels',
                'title' => 'Shag Dance Lessons - All Levels',
                'schedule' => 'Tuesdays · 6:30 PM',
                'price' => '$12 / person',
                'instructor' => 'Vickie Chambers',
                'phone' => '336-989-0156',
                'description' => 'Classic beach music shag instruction with individualized coaching.',
            ],
        ];
        $contacts = decode_settings_json($settings, 'site_contacts_json', $defaultContacts);
        $lessons = decode_settings_json($settings, 'lessons_json', $defaultLessons);
        $business = [
            'name' => $settings['business_name'] ?? 'Midway Music Hall',
            'address' => $settings['business_address'] ?? '11141 Old US Hwy 52, Winston-Salem, NC 27107',
            'phone' => $settings['business_phone'] ?? '336-793-4218',
            'email' => $settings['business_email'] ?? 'midwayeventcenter@gmail.com',
        ];
        $map = [
            'address_label' => $settings['map_address_label'] ?? '11141 Old U.S. Hwy 52, Winston-Salem, NC 27107',
            'subtext' => $settings['map_subtext'] ?? 'Midway Town Center · Exit 100 off Hwy 52',
            'embed_url' => $settings['map_embed_url'] ?? 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3274.058364949036!2d-80.22422352346647!3d35.99506067241762!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x8853e93a2da3c6f3%3A0x7fe2bff7e76bc3ab!2s11141%20Old%20U.S.%2052%2C%20Winston-Salem%2C%20NC%2027107!5e0!3m2!1sen!2sus!4v1734046800!5m2!1sen!2sus',
        ];
        $policies = [
            'family' => $settings['policy_family_text'] ?? 'Family venue – please keep language respectful.',
            'refunds' => $settings['policy_refund_text'] ?? 'All ticket sales are final. NO REFUNDS.',
            'notes' => $settings['policy_additional_text'] ?? '',
        ];
        $boxOfficeNote = $settings['box_office_note'] ?? 'Seat reservations are request-only with a 24-hour hold window. Staff will call or text to confirm every request.';
        $social = [
            'facebook' => $settings['facebook_url'] ?? 'https://www.facebook.com/midwaymusichall',
            'instagram' => $settings['instagram_url'] ?? 'https://www.instagram.com/midwaymusichall',
            'twitter' => $settings['twitter_url'] ?? 'https://twitter.com/midwaymusichall',
        ];
        $review = [
            'google_review_url' => $settings['google_review_url'] ?? '',
        ];
        $branding = [
            'logo' => build_single_image_variant($settings['site_logo'] ?? null),
            'mark' => build_single_image_variant(
                $settings['site_brand_mark'] ?? $settings['site_logo'] ?? $settings['default_event_image'] ?? null
            ),
            'default_event' => build_single_image_variant($settings['default_event_image'] ?? null),
        ];

        Response::success([
            'content' => [
                'business' => $business,
                'map' => $map,
                'contacts' => $contacts,
                'policies' => $policies,
                'box_office_note' => $boxOfficeNote,
                'lessons' => $lessons,
                'social' => $social,
                'review' => $review,
                'branding' => $branding,
            ],
        ]);
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('GET /api/site-content error: ' . $error->getMessage());
        }
        Response::error('Failed to fetch site content', 500);
    }
});

$router->add('PUT', '/api/settings', function (Request $request) {
    try {
        $payload = read_json_body($request);
        $changedKeys = [];
        foreach ($payload as $key => $value) {
            Database::run(
                'INSERT INTO business_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
                [$key, $value, $value]
            );
            $changedKeys[] = $key;
        }
        if ($changedKeys) {
            record_audit('settings.update', 'settings', null, ['keys' => $changedKeys]);
        }
        Response::success();
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('PUT /api/settings error: ' . $error->getMessage());
        }
        Response::error('Failed to update settings', 500);
    }
});

if (APP_DEBUG) {
    $router->add('GET', '/api/debug/schema-check', function () {
        try {
            $pdo = Database::connection();
            $hasArchived = events_table_has_column($pdo, 'archived_at');
            $hasArchivedIndex = events_table_has_index($pdo, 'idx_events_archived_at');
            $totalEvents = (int) $pdo->query('SELECT COUNT(*) FROM events')->fetchColumn();
            $nowExpr = "NOW()";
            $endExpr = event_end_expression('e');
            $upcomingSql = "SELECT COUNT(*) FROM events e WHERE $endExpr >= $nowExpr";
            $upcomingEvents = (int) $pdo->query($upcomingSql)->fetchColumn();
            $pastSql = "SELECT COUNT(*) FROM events e WHERE $endExpr < $nowExpr";
            $pastEvents = (int) $pdo->query($pastSql)->fetchColumn();
            $sampleStmt = $pdo->query("SELECT id, artist_name, status, visibility, start_datetime, event_date, event_time FROM events ORDER BY start_datetime DESC LIMIT 5");
            $recent = $sampleStmt->fetchAll() ?: [];
            Response::success([
                'has_archived_at' => $hasArchived,
                'has_archived_index' => $hasArchivedIndex,
                'total_events' => $totalEvents,
                'upcoming_events' => $upcomingEvents,
                'past_events' => $pastEvents,
                'recent_events' => $recent,
            ]);
        } catch (Throwable $error) {
            if (APP_DEBUG) {
                error_log('GET /api/debug/schema-check error: ' . $error->getMessage());
            }
            Response::error('Debug schema check failed', 500);
        }
    });
}

try {
    $handled = $router->dispatch($request);
} catch (Throwable $error) {
    error_log('[router] Unhandled exception: ' . $error->getMessage());
    try {
        notify_unhandled_error($error, $request);
    } catch (Throwable $alertError) {
        error_log('[email] Failed to dispatch error alert: ' . $alertError->getMessage());
    }
    Response::error('Server error', 500);
    exit;
}

if (!$handled) {
    Response::error('Not found', 404);
}
