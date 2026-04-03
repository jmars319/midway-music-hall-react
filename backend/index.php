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
use function Midway\Backend\upload_asset_exists;
use function Midway\Backend\normalize_existing_upload_url;

$router = new Router();

function json_input(Request $request): array
{
    return $request->json ?? $request->body ?? [];
}

function normalize_rows(array $rows, callable $normalizer): array
{
    return array_map($normalizer, $rows);
}

function normalize_nullable_text($value): ?string
{
    if ($value === null) {
        return null;
    }
    if (is_string($value)) {
        $trimmed = trim($value);
        return $trimmed === '' ? null : $trimmed;
    }
    if (is_scalar($value)) {
        $trimmed = trim((string) $value);
        return $trimmed === '' ? null : $trimmed;
    }
    return null;
}

function normalize_nullable_decimal($value): ?string
{
    if ($value === null) {
        return null;
    }
    if (is_string($value)) {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return null;
        }
        $value = $trimmed;
    }
    if ($value === '') {
        return null;
    }
    if (!is_numeric($value)) {
        return null;
    }
    return number_format((float) $value, 2, '.', '');
}

function event_pricing_palette(): array
{
    return [
        '#f59e0b',
        '#06b6d4',
        '#10b981',
        '#8b5cf6',
        '#ef4444',
        '#3b82f6',
        '#f97316',
        '#22c55e',
    ];
}

function normalize_event_pricing_tier_identifier($value, string $fallback): string
{
    $candidate = strtolower(trim((string) $value));
    $candidate = preg_replace('/[^a-z0-9]+/', '-', $candidate);
    $candidate = trim((string) $candidate, '-');
    if ($candidate === '') {
        $candidate = strtolower(trim($fallback));
        $candidate = preg_replace('/[^a-z0-9]+/', '-', $candidate);
        $candidate = trim((string) $candidate, '-');
    }
    return $candidate !== '' ? $candidate : 'tier';
}

function normalize_event_pricing_tier_color($value, int $index): string
{
    $candidate = strtoupper(trim((string) ($value ?? '')));
    if (preg_match('/^#[0-9A-F]{6}$/', $candidate)) {
        return $candidate;
    }
    $palette = event_pricing_palette();
    return $palette[$index % count($palette)];
}

function decode_event_pricing_config($value): ?array
{
    if ($value === null || $value === '' || $value === false) {
        return null;
    }
    if (is_string($value)) {
        $decoded = json_decode($value, true);
        if (!is_array($decoded)) {
            return null;
        }
        $value = $decoded;
    }
    if (!is_array($value)) {
        return null;
    }
    $mode = strtolower(trim((string) ($value['mode'] ?? 'tiered')));
    if ($mode === '' || $mode === 'flat' || $mode === 'disabled') {
        return null;
    }

    $tiers = [];
    $seenTierIds = [];
    $rawTiers = is_array($value['tiers'] ?? null) ? $value['tiers'] : [];
    foreach ($rawTiers as $index => $tier) {
        if (!is_array($tier)) {
            continue;
        }
        $label = normalize_nullable_text($tier['label'] ?? null);
        $price = normalize_nullable_decimal($tier['price'] ?? null);
        if ($label === null || $price === null || (float) $price < 0) {
            continue;
        }
        $tierId = normalize_event_pricing_tier_identifier($tier['id'] ?? $label, 'tier-' . ($index + 1));
        if (isset($seenTierIds[$tierId])) {
            continue;
        }
        $tiers[] = [
            'id' => $tierId,
            'label' => $label,
            'price' => $price,
            'note' => normalize_nullable_text($tier['note'] ?? $tier['description'] ?? null),
            'color' => normalize_event_pricing_tier_color($tier['color'] ?? null, count($tiers)),
        ];
        $seenTierIds[$tierId] = true;
    }
    if (!$tiers) {
        return null;
    }

    $assignments = [];
    $rawAssignments = $value['assignments'] ?? [];
    if (is_array($rawAssignments)) {
        foreach ($rawAssignments as $rowKey => $tierId) {
            $normalizedRowKey = trim((string) $rowKey);
            $normalizedTierId = trim((string) $tierId);
            if ($normalizedRowKey === '' || $normalizedTierId === '') {
                continue;
            }
            $assignments[$normalizedRowKey] = $normalizedTierId;
        }
    }

    return [
        'mode' => 'tiered',
        'tiers' => $tiers,
        'assignments' => $assignments,
    ];
}

function get_event_pricing_config_range(array $config): array
{
    $prices = [];
    foreach (($config['tiers'] ?? []) as $tier) {
        $price = normalize_nullable_decimal($tier['price'] ?? null);
        if ($price === null) {
            continue;
        }
        $prices[] = (float) $price;
    }
    if (!$prices) {
        return [null, null];
    }
    return [
        number_format(min($prices), 2, '.', ''),
        number_format(max($prices), 2, '.', ''),
    ];
}

function build_pricing_row_key(array $row): ?string
{
    $rowId = trim((string) ($row['id'] ?? ''));
    if ($rowId !== '') {
        return 'id:' . $rowId;
    }
    $section = trim((string) ($row['section_name'] ?? $row['section'] ?? ''));
    $rowLabel = trim((string) ($row['row_label'] ?? $row['row'] ?? ''));
    if ($section === '' && $rowLabel === '') {
        return null;
    }
    return 'seatrow:' . $section . '::' . $rowLabel;
}

function build_pricing_row_key_map(array $layoutRows): array
{
    $map = [];
    foreach ($layoutRows as $row) {
        if (!is_array($row) || !seat_row_is_interactive($row)) {
            continue;
        }
        $totalSeats = (int) ($row['total_seats'] ?? 0);
        if ($totalSeats <= 0) {
            continue;
        }
        $rowKey = build_pricing_row_key($row);
        if ($rowKey === null) {
            continue;
        }
        $map[$rowKey] = $row;
    }
    return $map;
}

function build_seat_pricing_row_map(array $layoutRows): array
{
    $map = [];
    foreach (build_pricing_row_key_map($layoutRows) as $rowKey => $row) {
        $totalSeats = (int) ($row['total_seats'] ?? 0);
        for ($seatNumber = 1; $seatNumber <= $totalSeats; $seatNumber++) {
            $seatId = build_seat_id_for_row($row, $seatNumber);
            $map[$seatId] = $rowKey;
        }
    }
    return $map;
}

function normalize_event_pricing_config_input($value, array $layoutRows = [], ?string &$error = null): ?array
{
    $error = null;
    if ($value === null || $value === '' || $value === false) {
        return null;
    }
    if (is_string($value)) {
        $decoded = json_decode($value, true);
        if (!is_array($decoded)) {
            $error = 'pricing_config must be valid JSON.';
            return null;
        }
        $value = $decoded;
    }
    if (!is_array($value)) {
        $error = 'pricing_config must be an object.';
        return null;
    }
    $mode = strtolower(trim((string) ($value['mode'] ?? 'tiered')));
    if ($mode === '' || $mode === 'flat' || $mode === 'disabled') {
        return null;
    }
    if ($mode !== 'tiered') {
        $error = 'pricing_config.mode must be either "flat" or "tiered".';
        return null;
    }

    $config = decode_event_pricing_config($value);
    if ($config === null) {
        $error = 'Tiered pricing requires valid tier labels and prices.';
        return null;
    }
    if (count($config['tiers']) < 3) {
        $error = 'Tiered pricing requires at least 3 price tiers.';
        return null;
    }

    $tierIdMap = array_fill_keys(array_map(function ($tier) {
        return $tier['id'];
    }, $config['tiers']), true);
    $layoutRowMap = build_pricing_row_key_map($layoutRows);
    $normalizedAssignments = [];
    foreach ($config['assignments'] as $rowKey => $tierId) {
        if (!isset($tierIdMap[$tierId])) {
            $error = 'Tier assignments must reference an existing price tier.';
            return null;
        }
        if ($layoutRowMap && !isset($layoutRowMap[$rowKey])) {
            continue;
        }
        $normalizedAssignments[$rowKey] = $tierId;
    }
    if ($layoutRowMap) {
        foreach (array_keys($layoutRowMap) as $rowKey) {
            if (!isset($normalizedAssignments[$rowKey])) {
                $error = 'Assign every seat/table group to a pricing tier before saving tiered pricing.';
                return null;
            }
        }
    }
    $config['assignments'] = $normalizedAssignments;
    return $config;
}

function event_uses_tiered_pricing(array $event): bool
{
    return decode_event_pricing_config($event['pricing_config'] ?? null) !== null;
}

function resolve_tiered_seat_request_total_amount(array $event, array $selectedSeats, array $layoutRows = [], ?string &$failureReason = null): ?string
{
    $failureReason = null;
    if (!$selectedSeats) {
        return null;
    }
    $pricingConfig = decode_event_pricing_config($event['pricing_config'] ?? null);
    if ($pricingConfig === null) {
        return null;
    }
    $tierAmounts = [];
    foreach ($pricingConfig['tiers'] as $tier) {
        $tierAmounts[$tier['id']] = (float) $tier['price'];
    }
    $assignments = $pricingConfig['assignments'] ?? [];
    if (!$assignments || !$layoutRows) {
        $failureReason = 'missing_pricing_assignment';
        return null;
    }
    $seatRowMap = build_seat_pricing_row_map($layoutRows);
    $total = 0.0;
    foreach ($selectedSeats as $seatId) {
        $rowKey = $seatRowMap[$seatId] ?? null;
        $tierId = $rowKey !== null ? ($assignments[$rowKey] ?? null) : null;
        if ($rowKey === null || $tierId === null || !isset($tierAmounts[$tierId])) {
            $failureReason = 'missing_pricing_assignment';
            return null;
        }
        $total += $tierAmounts[$tierId];
    }
    return number_format($total, 2, '.', '');
}

function resolve_seat_request_total_amount(array $event, array $selectedSeats = [], array $layoutRows = [], ?string &$failureReason = null): ?string
{
    $seatCount = count($selectedSeats);
    if ($seatCount <= 0) {
        return null;
    }
    if (event_uses_tiered_pricing($event)) {
        return resolve_tiered_seat_request_total_amount($event, $selectedSeats, $layoutRows, $failureReason);
    }
    $priceCandidates = [
        $event['ticket_price'] ?? null,
        $event['min_ticket_price'] ?? null,
        $event['door_price'] ?? null,
        $event['max_ticket_price'] ?? null,
    ];
    $pricePerSeat = null;
    foreach ($priceCandidates as $candidate) {
        $normalized = normalize_nullable_decimal($candidate);
        if ($normalized === null || (float) $normalized < 0) {
            continue;
        }
        $pricePerSeat = (float) $normalized;
        break;
    }
    if ($pricePerSeat === null) {
        return null;
    }
    return number_format($pricePerSeat * $seatCount, 2, '.', '');
}

function normalize_nullable_int($value): ?int
{
    if ($value === null || $value === '' || $value === false) {
        return null;
    }
    if (!is_numeric($value)) {
        return null;
    }
    $int = (int) $value;
    return $int > 0 ? $int : null;
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

function reservation_client_fingerprint(): string
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        $sessionId = session_id();
        if (is_string($sessionId) && $sessionId !== '') {
            return substr(hash('sha256', $sessionId), 0, 16);
        }
    }
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $agent = $_SERVER['HTTP_USER_AGENT'] ?? '';
    $seed = $ip . '|' . $agent;
    if ($seed === '|') {
        $seed = microtime(true) . random_bytes(4);
    }
    return substr(hash('sha256', (string) $seed), 0, 16);
}

function normalize_seat_id_list($value): array
{
    $clean = [];
    $seats = decode_seat_list($value);
    foreach ($seats as $seatId) {
        if (!is_string($seatId)) {
            continue;
        }
        $trimmed = trim($seatId);
        if ($trimmed === '') {
            continue;
        }
        $clean[$trimmed] = true;
    }
    return array_slice(array_keys($clean), 0, 200);
}

function resolve_reservation_log_context(array $payload = [], array $context = []): array
{
    $seatIds = $context['seat_ids'] ?? normalize_seat_id_list($payload['selected_seats'] ?? $payload['selectedSeats'] ?? []);
    $eventId = $context['event_id'] ?? ($payload['event_id'] ?? $payload['eventId'] ?? null);
    return [
        'event_id' => $eventId ? (int) $eventId : null,
        'layout_id' => $context['layout_id'] ?? null,
        'layout_version_id' => $context['layout_version_id'] ?? null,
        'seat_ids' => $seatIds,
    ];
}

function log_reservation_rejection(array $details): void
{
    $defaults = [
        'event_id' => null,
        'layout_id' => null,
        'layout_version_id' => null,
        'seat_ids' => [],
        'request_type' => 'public',
        'client_fingerprint' => reservation_client_fingerprint(),
        'reason_code' => 'unknown',
        'http_status' => 400,
        'message' => null,
    ];
    $payload = array_merge($defaults, $details);
    $payload['seat_ids'] = normalize_seat_id_list($payload['seat_ids']);
    if (!$payload['client_fingerprint']) {
        $payload['client_fingerprint'] = reservation_client_fingerprint();
    }
    error_log('[reservation-reject] ' . json_encode($payload, JSON_UNESCAPED_SLASHES));
}

class SeatRequestException extends RuntimeException
{
    public int $httpStatus;
    public array $payload;
    public string $reasonCode;
    public array $context;

    public function __construct(string $message, int $httpStatus = 400, array $payload = [], string $reasonCode = 'unknown', array $context = [])
    {
        parent::__construct($message);
        $this->httpStatus = $httpStatus;
        $this->payload = $payload;
        $reason = $payload['reason'] ?? $payload['reason_code'] ?? $reasonCode;
        $this->reasonCode = (is_string($reason) && $reason !== '') ? $reason : 'unknown';
        $this->context = $context;
    }
}

function output_upload_error(string $message): void
{
    Response::error($message, 400);
}

function public_image_variants(array $variants): array
{
    $sanitized = [];
    foreach ($variants as $variant) {
        if (!is_array($variant)) {
            continue;
        }
        unset($variant['path']);
        $sanitized[] = $variant;
    }
    return $sanitized;
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
    if (PHP_VERSION_ID < 80500 && function_exists('finfo_close')) {
        finfo_close($finfo);
    }
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
            'optimized' => public_image_variants($responsive['optimized_variants'] ?? []),
            'webp' => public_image_variants($responsive['webp_variants'] ?? []),
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

function layout_table_has_column(PDO $pdo, string $table, string $column): bool
{
    static $cache = [];
    $key = strtolower($table . '.' . $column);
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }
    if (!preg_match('/^[a-zA-Z0-9_]+$/', $table) || !preg_match('/^[a-zA-Z0-9_]+$/', $column)) {
        $cache[$key] = false;
        return false;
    }
    try {
        $stmt = $pdo->prepare('SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1');
        $stmt->execute([$table, $column]);
        $cache[$key] = (bool) $stmt->fetchColumn();
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log(sprintf('layout_table_has_column failure for %s.%s: %s', $table, $column, $e->getMessage()));
        }
        $cache[$key] = false;
    }
    return $cache[$key];
}

function layout_optional_select_clause(PDO $pdo, string $table): string
{
    static $cache = [];
    $key = strtolower($table);
    if (isset($cache[$key])) {
        return $cache[$key];
    }
    $parts = [];
    foreach (['stage_position','stage_size','canvas_settings'] as $column) {
        $parts[] = layout_table_has_column($pdo, $table, $column) ? $column : ('NULL AS ' . $column);
    }
    $cache[$key] = implode(', ', $parts);
    return $cache[$key];
}

function decode_layout_json_value($value): ?array
{
    if (is_array($value)) {
        return $value;
    }
    if (is_string($value) && $value !== '') {
        $decoded = json_decode($value, true);
        if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
            return $decoded;
        }
    }
    return null;
}

function fetch_layout_for_event(?int $eventId): array
{
    $pdo = Database::connection();
    $layoutData = [];
    $stagePosition = null;
    $stageSize = null;
    $canvasSettings = null;
    $versionSelect = layout_optional_select_clause($pdo, 'seating_layout_versions');
    $layoutSelect = layout_optional_select_clause($pdo, 'seating_layouts');

    if ($eventId) {
        $stmt = $pdo->prepare('SELECT layout_id, layout_version_id FROM events WHERE id = ?');
        $stmt->execute([$eventId]);
        $layoutRow = $stmt->fetch();
        if ($layoutRow && $layoutRow['layout_version_id']) {
            $stmt = $pdo->prepare("SELECT layout_data, {$versionSelect} FROM seating_layout_versions WHERE id = ?");
            $stmt->execute([$layoutRow['layout_version_id']]);
            $layout = $stmt->fetch();
            if ($layout) {
                $layoutData = decode_layout_json_value($layout['layout_data'] ?? null) ?? [];
                $stagePosition = decode_layout_json_value($layout['stage_position'] ?? null);
                $stageSize = decode_layout_json_value($layout['stage_size'] ?? null);
                $canvasSettings = decode_layout_json_value($layout['canvas_settings'] ?? null);
                return [$layoutData ?? [], $stagePosition, $stageSize, $canvasSettings];
            }
        }
        if ($layoutRow && $layoutRow['layout_id']) {
            $stmt = $pdo->prepare("SELECT layout_data, {$layoutSelect} FROM seating_layouts WHERE id = ?");
            $stmt->execute([$layoutRow['layout_id']]);
            $layout = $stmt->fetch();
            if ($layout) {
                $layoutData = decode_layout_json_value($layout['layout_data'] ?? null) ?? [];
                $stagePosition = decode_layout_json_value($layout['stage_position'] ?? null);
                $stageSize = decode_layout_json_value($layout['stage_size'] ?? null);
                $canvasSettings = decode_layout_json_value($layout['canvas_settings'] ?? null);
                return [$layoutData ?? [], $stagePosition, $stageSize, $canvasSettings];
            }
        }
    }

    $stmt = $pdo->query("SELECT layout_data, {$layoutSelect} FROM seating_layouts WHERE is_default = 1 LIMIT 1");
    $layout = $stmt->fetch();
    if ($layout) {
        $layoutData = decode_layout_json_value($layout['layout_data'] ?? null) ?? [];
        $stagePosition = decode_layout_json_value($layout['stage_position'] ?? null);
        $stageSize = decode_layout_json_value($layout['stage_size'] ?? null);
        $canvasSettings = decode_layout_json_value($layout['canvas_settings'] ?? null);
    }

    return [$layoutData ?? [], $stagePosition, $stageSize, $canvasSettings];
}

function fetch_layout_rows_for_assignment(PDO $pdo, ?int $layoutId, ?int $layoutVersionId): array
{
    $layoutId = $layoutId ? (int) $layoutId : null;
    $layoutVersionId = $layoutVersionId ? (int) $layoutVersionId : null;
    if ($layoutVersionId) {
        $stmt = $pdo->prepare('SELECT layout_data FROM seating_layout_versions WHERE id = ? LIMIT 1');
        $stmt->execute([$layoutVersionId]);
        $row = $stmt->fetch();
        if ($row) {
            return decode_layout_json_value($row['layout_data'] ?? null) ?? [];
        }
    }
    if ($layoutId) {
        $stmt = $pdo->prepare('SELECT layout_data FROM seating_layouts WHERE id = ? LIMIT 1');
        $stmt->execute([$layoutId]);
        $row = $stmt->fetch();
        if ($row) {
            return decode_layout_json_value($row['layout_data'] ?? null) ?? [];
        }
    }
    return [];
}

function prepare_event_pricing_config_for_response(array &$row): void
{
    if (!array_key_exists('pricing_config', $row)) {
        return;
    }
    $row['pricing_config'] = decode_event_pricing_config($row['pricing_config'] ?? null);
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

function build_event_start_datetime(?string $eventDate, ?string $eventTime, string $timezone): ?DateTimeImmutable
{
    if (!$eventDate || !$eventTime) {
        return null;
    }
    $candidate = trim($eventDate . ' ' . $eventTime);
    if ($candidate === '') {
        return null;
    }
    try {
        return new DateTimeImmutable($candidate, new DateTimeZone($timezone));
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
    // start_datetime is the canonical event start; keep it in sync with event_date/event_time/timezone.
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
    $endExpr = "{$alias}.end_datetime";
    return "CASE
        WHEN $endExpr IS NOT NULL AND $startExpr IS NOT NULL AND $endExpr < $startExpr THEN DATE_ADD($startExpr, INTERVAL {$hours} HOUR)
        ELSE COALESCE($endExpr, DATE_ADD($startExpr, INTERVAL {$hours} HOUR))
    END";
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

function event_series_meta_table_exists(PDO $pdo): bool
{
    static $hasTable = null;
    if ($hasTable !== null) {
        return $hasTable;
    }
    try {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?');
        $stmt->execute(['event_series_meta']);
        $hasTable = (int) $stmt->fetchColumn() > 0;
    } catch (Throwable $error) {
        $hasTable = false;
        if (APP_DEBUG) {
            error_log('event_series_meta_table_exists failure: ' . $error->getMessage());
        }
    }
    return $hasTable;
}

function event_occurrences_table_exists(PDO $pdo): bool
{
    static $hasTable = null;
    if ($hasTable !== null) {
        return $hasTable;
    }
    try {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?');
        $stmt->execute(['event_occurrences']);
        $hasTable = (int) $stmt->fetchColumn() > 0;
    } catch (Throwable $error) {
        $hasTable = false;
        if (APP_DEBUG) {
            error_log('event_occurrences_table_exists failure: ' . $error->getMessage());
        }
    }
    return $hasTable;
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

function normalize_occurrence_date_input($value): ?string
{
    if ($value === null || $value === '' || $value === false) {
        return null;
    }
    try {
        return (new DateTimeImmutable((string) $value))->format('Y-m-d');
    } catch (Throwable $error) {
        return null;
    }
}

function normalize_occurrence_time_input($value): ?string
{
    if ($value === null || $value === '' || $value === false) {
        return null;
    }
    $raw = trim((string) $value);
    if ($raw === '') {
        return null;
    }
    try {
        return (new DateTimeImmutable('2000-01-01 ' . $raw))->format('H:i:s');
    } catch (Throwable $error) {
        return null;
    }
}

function extract_time_of_day_from_value($value, string $timezone = 'America/New_York'): ?string
{
    if ($value === null || $value === '' || $value === false) {
        return null;
    }
    $raw = trim((string) $value);
    if ($raw === '') {
        return null;
    }
    $normalizedTime = normalize_occurrence_time_input($raw);
    if ($normalizedTime !== null) {
        return $normalizedTime;
    }
    try {
        return (new DateTimeImmutable($raw, new DateTimeZone($timezone)))->format('H:i:s');
    } catch (Throwable $error) {
        return null;
    }
}

function resolve_event_duration_seconds(array $event, int $fallbackHours = 4): int
{
    $start = resolve_event_start_datetime($event);
    $end = resolve_event_end_datetime($event, $fallbackHours);
    if ($start instanceof DateTimeInterface && $end instanceof DateTimeInterface) {
        $seconds = $end->getTimestamp() - $start->getTimestamp();
        if ($seconds > 0) {
            return $seconds;
        }
    }
    return max(1, $fallbackHours) * 3600;
}

function build_occurrence_door_datetime(string $occurrenceDate, ?string $doorTimeOfDay, string $timezone): ?string
{
    if (!$doorTimeOfDay) {
        return null;
    }
    try {
        return (new DateTimeImmutable($occurrenceDate . ' ' . $doorTimeOfDay, new DateTimeZone($timezone)))->format('Y-m-d H:i:s');
    } catch (Throwable $error) {
        return null;
    }
}

function resolve_occurrence_door_time_of_day(array $occurrence, ?string $sharedDoorTimeOfDay, string $timezone): ?string
{
    $occurrenceDoorValue = $occurrence['door_time']
        ?? $occurrence['door_datetime']
        ?? $occurrence['doors_open_time']
        ?? null;
    $occurrenceDoorTimeOfDay = extract_time_of_day_from_value($occurrenceDoorValue, $timezone);
    return $occurrenceDoorTimeOfDay ?? $sharedDoorTimeOfDay;
}

function normalize_event_occurrence_rows(array $occurrences, string $timezone, ?string $doorTimeValue, int $durationSeconds, ?string &$error = null): array
{
    $sharedDoorTimeOfDay = extract_time_of_day_from_value($doorTimeValue, $timezone);
    $normalized = [];
    foreach (array_values($occurrences) as $index => $occurrence) {
        if (!is_array($occurrence)) {
            $error = 'Each occurrence must be an object with a date and start time.';
            return [];
        }
        $occurrenceDate = normalize_occurrence_date_input($occurrence['occurrence_date'] ?? $occurrence['event_date'] ?? $occurrence['date'] ?? null);
        $startTime = normalize_occurrence_time_input($occurrence['start_time'] ?? $occurrence['event_time'] ?? $occurrence['time'] ?? null);
        if ($occurrenceDate === null || $startTime === null) {
            $error = 'Each occurrence requires a valid date and start time.';
            return [];
        }
        $startDt = build_event_start_datetime($occurrenceDate, $startTime, $timezone);
        if (!$startDt) {
            $error = 'One or more occurrences could not be parsed.';
            return [];
        }
        $doorTimeOfDay = resolve_occurrence_door_time_of_day($occurrence, $sharedDoorTimeOfDay, $timezone);
        if ($doorTimeOfDay === null) {
            $error = 'Each occurrence requires a valid doors-open time or a shared default doors-open time.';
            return [];
        }
        $endDt = $startDt->modify('+' . max(1, $durationSeconds) . ' seconds');
        $normalized[] = [
            'occurrence_date' => $occurrenceDate,
            'start_time' => $startTime,
            'start_datetime' => $startDt->format('Y-m-d H:i:s'),
            'end_datetime' => $endDt->format('Y-m-d H:i:s'),
            'door_datetime' => build_occurrence_door_datetime($occurrenceDate, $doorTimeOfDay, $timezone),
            'sort_order' => $index,
        ];
    }
    usort($normalized, static function (array $left, array $right): int {
        $leftStart = $left['start_datetime'] ?? '';
        $rightStart = $right['start_datetime'] ?? '';
        if ($leftStart === $rightStart) {
            return ($left['sort_order'] ?? 0) <=> ($right['sort_order'] ?? 0);
        }
        return strcmp($leftStart, $rightStart);
    });
    foreach ($normalized as $index => &$occurrence) {
        $occurrence['sort_order'] = $index;
    }
    unset($occurrence);
    return $normalized;
}

function decorate_event_occurrence(array $occurrence, int $eventId, int $index, int $count): array
{
    $occurrenceId = isset($occurrence['id']) ? (int) $occurrence['id'] : 0;
    $occurrenceKey = $eventId > 0
        ? ($eventId . '-' . ($occurrenceId > 0 ? $occurrenceId : ($index + 1)))
        : ('occurrence-' . ($occurrenceId > 0 ? $occurrenceId : ($index + 1)));
    $doorTime = $occurrence['door_time'] ?? $occurrence['door_datetime'] ?? null;
    return [
        'id' => $occurrenceId > 0 ? $occurrenceId : null,
        'event_id' => $eventId > 0 ? $eventId : (int) ($occurrence['event_id'] ?? 0),
        'occurrence_date' => $occurrence['occurrence_date'] ?? null,
        'start_time' => $occurrence['start_time'] ?? null,
        'start_datetime' => $occurrence['start_datetime'] ?? null,
        'end_datetime' => $occurrence['end_datetime'] ?? null,
        'door_datetime' => $doorTime,
        'door_time' => $doorTime,
        'event_date' => $occurrence['occurrence_date'] ?? null,
        'event_time' => $occurrence['start_time'] ?? null,
        'sort_order' => (int) ($occurrence['sort_order'] ?? $index),
        'occurrence_index' => $index,
        'occurrence_count' => $count,
        'occurrence_key' => $occurrenceKey,
        'ics_url' => $eventId > 0
            ? ('/api/events/' . $eventId . '.ics' . ($occurrenceId > 0 ? ('?occurrence_id=' . $occurrenceId) : ''))
            : null,
    ];
}

function fetch_event_occurrences(PDO $pdo, int $eventId): array
{
    if ($eventId <= 0 || !event_occurrences_table_exists($pdo)) {
        return [];
    }
    $stmt = $pdo->prepare('SELECT id, event_id, occurrence_date, start_time, start_datetime, end_datetime, door_datetime, sort_order FROM event_occurrences WHERE event_id = ? ORDER BY start_datetime ASC, sort_order ASC, id ASC');
    $stmt->execute([$eventId]);
    $rows = $stmt->fetchAll() ?: [];
    $count = count($rows);
    return array_map(static function (array $row, int $index) use ($eventId, $count): array {
        return decorate_event_occurrence($row, $eventId, $index, $count);
    }, $rows, array_keys($rows));
}

function load_event_occurrences_map(PDO $pdo, array $eventIds): array
{
    $eventIds = array_values(array_unique(array_filter(array_map('intval', $eventIds), static function (int $value): bool {
        return $value > 0;
    })));
    if (!$eventIds || !event_occurrences_table_exists($pdo)) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($eventIds), '?'));
    $stmt = $pdo->prepare("SELECT id, event_id, occurrence_date, start_time, start_datetime, end_datetime, door_datetime, sort_order FROM event_occurrences WHERE event_id IN ({$placeholders}) ORDER BY event_id ASC, start_datetime ASC, sort_order ASC, id ASC");
    $stmt->execute($eventIds);
    $rows = $stmt->fetchAll() ?: [];
    $grouped = [];
    foreach ($rows as $row) {
        $eventId = (int) ($row['event_id'] ?? 0);
        if ($eventId <= 0) {
            continue;
        }
        if (!isset($grouped[$eventId])) {
            $grouped[$eventId] = [];
        }
        $grouped[$eventId][] = $row;
    }
    foreach ($grouped as $eventId => $occurrenceRows) {
        $count = count($occurrenceRows);
        $grouped[$eventId] = array_map(static function (array $row, int $index) use ($eventId, $count): array {
            return decorate_event_occurrence($row, (int) $eventId, $index, $count);
        }, $occurrenceRows, array_keys($occurrenceRows));
    }
    return $grouped;
}

function build_fallback_occurrence_from_event(array $event): ?array
{
    if (!event_has_schedule_metadata($event)) {
        return null;
    }
    $start = resolve_event_start_datetime($event);
    if (!$start) {
        return null;
    }
    $end = resolve_event_end_datetime($event);
    $doorTime = normalize_door_time_input($event['door_time'] ?? null);
    return decorate_event_occurrence([
        'id' => null,
        'event_id' => $event['id'] ?? null,
        'occurrence_date' => $start->format('Y-m-d'),
        'start_time' => $start->format('H:i:s'),
        'start_datetime' => $start->format('Y-m-d H:i:s'),
        'end_datetime' => $end ? $end->format('Y-m-d H:i:s') : null,
        'door_datetime' => $doorTime,
        'sort_order' => 0,
    ], (int) ($event['id'] ?? 0), 0, 1);
}

function resolve_event_occurrences_for_event(PDO $pdo, array $event): array
{
    $eventId = (int) ($event['id'] ?? 0);
    $occurrences = $eventId > 0 ? fetch_event_occurrences($pdo, $eventId) : [];
    if ($occurrences) {
        return $occurrences;
    }
    $fallback = build_fallback_occurrence_from_event($event);
    return $fallback ? [$fallback] : [];
}

function delete_event_occurrences(PDO $pdo, int $eventId): void
{
    if ($eventId <= 0 || !event_occurrences_table_exists($pdo)) {
        return;
    }
    $stmt = $pdo->prepare('DELETE FROM event_occurrences WHERE event_id = ?');
    $stmt->execute([$eventId]);
}

function sync_event_occurrences(PDO $pdo, int $eventId, array $occurrences, string $timezone, ?string $doorTimeValue, int $durationSeconds, ?string &$error = null): array
{
    if (!event_occurrences_table_exists($pdo)) {
        $error = 'Run database/20251212_schema_upgrade.sql to enable multi-day events.';
        return [];
    }
    $normalized = normalize_event_occurrence_rows($occurrences, $timezone, $doorTimeValue, $durationSeconds, $error);
    if (!$normalized) {
        if ($error === null) {
            $error = 'At least one valid occurrence is required.';
        }
        return [];
    }
    delete_event_occurrences($pdo, $eventId);
    $insert = $pdo->prepare('INSERT INTO event_occurrences (event_id, occurrence_date, start_time, start_datetime, end_datetime, door_datetime, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
    foreach ($normalized as $occurrence) {
        $insert->execute([
            $eventId,
            $occurrence['occurrence_date'],
            $occurrence['start_time'],
            $occurrence['start_datetime'],
            $occurrence['end_datetime'],
            $occurrence['door_datetime'],
            $occurrence['sort_order'],
        ]);
    }
    $stored = fetch_event_occurrences($pdo, $eventId);
    $first = $stored[0] ?? null;
    $last = $stored ? $stored[count($stored) - 1] : null;
    return [
        'occurrences' => $stored,
        'occurrence_count' => count($stored),
        'event_date' => $first['occurrence_date'] ?? null,
        'event_time' => $first['start_time'] ?? null,
        'start_datetime' => $first['start_datetime'] ?? null,
        'door_time' => $first['door_datetime'] ?? null,
        'end_datetime' => $last['end_datetime'] ?? null,
    ];
}

function attach_occurrence_metadata_to_event(array $event, array $occurrences): array
{
    $normalizedOccurrences = array_values($occurrences);
    $event['occurrences'] = $normalizedOccurrences;
    $event['occurrence_count'] = count($normalizedOccurrences);
    $event['is_multi_day'] = count($normalizedOccurrences) > 1 ? 1 : 0;
    if (!empty($event['id'])) {
        $event['ics_url'] = '/api/events/' . $event['id'] . '.ics';
    }
    if ($normalizedOccurrences) {
        $event['run_start_datetime'] = $normalizedOccurrences[0]['start_datetime'] ?? ($event['start_datetime'] ?? null);
        $event['run_end_datetime'] = $normalizedOccurrences[count($normalizedOccurrences) - 1]['end_datetime'] ?? ($event['end_datetime'] ?? null);
    } else {
        $event['run_start_datetime'] = $event['start_datetime'] ?? null;
        $event['run_end_datetime'] = $event['end_datetime'] ?? null;
    }
    return $event;
}

function occurrence_falls_in_timeframe(array $occurrence, string $timeframe, DateTimeImmutable $now, string $timezone = 'America/New_York'): bool
{
    if ($timeframe !== 'upcoming' && $timeframe !== 'past') {
        return true;
    }
    try {
        $endRaw = $occurrence['end_datetime'] ?? null;
        $startRaw = $occurrence['start_datetime'] ?? null;
        $tz = new DateTimeZone($timezone);
        $end = $endRaw ? new DateTimeImmutable($endRaw, $tz) : null;
        $start = $startRaw ? new DateTimeImmutable($startRaw, $tz) : null;
    } catch (Throwable $error) {
        return true;
    }
    if (!$start) {
        return true;
    }
    if (!$end) {
        $end = $start->modify('+4 hours');
    }
    if ($timeframe === 'past') {
        return $end < $now;
    }
    return $end >= $now;
}

function expand_public_event_rows(array $rows, string $timeframe): array
{
    $now = new DateTimeImmutable('now');
    $expanded = [];
    foreach ($rows as $row) {
        $occurrences = is_array($row['occurrences'] ?? null) ? $row['occurrences'] : [];
        if (empty($row['series_master_id']) && empty($row['is_series_master']) && count($occurrences) > 1) {
            foreach ($occurrences as $occurrence) {
                if (!occurrence_falls_in_timeframe($occurrence, $timeframe, $now, (string) ($row['timezone'] ?? 'America/New_York'))) {
                    continue;
                }
                $expandedRow = $row;
                $expandedRow['occurrence_id'] = $occurrence['id'] ?? null;
                $expandedRow['occurrence_index'] = $occurrence['occurrence_index'] ?? 0;
                $expandedRow['occurrence_count'] = $occurrence['occurrence_count'] ?? count($occurrences);
                $expandedRow['occurrence_key'] = $occurrence['occurrence_key'] ?? null;
                $expandedRow['ics_url'] = $occurrence['ics_url'] ?? null;
                $expandedRow['event_date'] = $occurrence['event_date'] ?? $expandedRow['event_date'];
                $expandedRow['event_time'] = $occurrence['event_time'] ?? $expandedRow['event_time'];
                $expandedRow['start_datetime'] = $occurrence['start_datetime'] ?? $expandedRow['start_datetime'];
                $expandedRow['end_datetime'] = $occurrence['end_datetime'] ?? $expandedRow['end_datetime'];
                $expandedRow['door_time'] = $occurrence['door_time'] ?? $expandedRow['door_time'];
                $expanded[] = $expandedRow;
            }
            continue;
        }
        $expanded[] = $row;
    }
    usort($expanded, static function (array $left, array $right) use ($timeframe): int {
        $leftStart = trim((string) ($left['start_datetime'] ?? ''));
        $rightStart = trim((string) ($right['start_datetime'] ?? ''));
        if ($leftStart === $rightStart) {
            return ((int) ($left['id'] ?? 0)) <=> ((int) ($right['id'] ?? 0));
        }
        if ($timeframe === 'past') {
            return strcmp($rightStart, $leftStart);
        }
        return strcmp($leftStart, $rightStart);
    });
    return $expanded;
}

function normalize_series_meta_field($value): ?string
{
    if ($value === null) {
        return null;
    }
    if (is_string($value)) {
        $trimmed = trim($value);
        return $trimmed === '' ? null : $trimmed;
    }
    if (is_scalar($value)) {
        $trimmed = trim((string) $value);
        return $trimmed === '' ? null : $trimmed;
    }
    return null;
}

function save_event_series_meta(PDO $pdo, int $eventId, ?string $scheduleLabel, ?string $summary, ?string $footerNote): void
{
    if (!event_series_meta_table_exists($pdo)) {
        if (APP_DEBUG && ($scheduleLabel !== null || $summary !== null || $footerNote !== null)) {
            error_log('[series-meta] table missing; unable to persist metadata for event ' . $eventId);
        }
        return;
    }
    if ($scheduleLabel === null && $summary === null && $footerNote === null) {
        $deleteStmt = $pdo->prepare('DELETE FROM event_series_meta WHERE event_id = ?');
        $deleteStmt->execute([$eventId]);
        return;
    }
    $stmt = $pdo->prepare('INSERT INTO event_series_meta (event_id, schedule_label, summary, footer_note, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE schedule_label = VALUES(schedule_label), summary = VALUES(summary), footer_note = VALUES(footer_note), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP');
    $stmt->execute([
        $eventId,
        $scheduleLabel,
        $summary,
        $footerNote,
        'api',
        'api',
    ]);
}

function fetch_event_series_meta(PDO $pdo, int $eventId): array
{
    if (!event_series_meta_table_exists($pdo)) {
        return ['schedule_label' => null, 'summary' => null, 'footer_note' => null];
    }
    $stmt = $pdo->prepare('SELECT schedule_label, summary, footer_note FROM event_series_meta WHERE event_id = ? LIMIT 1');
    $stmt->execute([$eventId]);
    $row = $stmt->fetch() ?: [];
    return [
        'schedule_label' => $row['schedule_label'] ?? null,
        'summary' => $row['summary'] ?? null,
        'footer_note' => $row['footer_note'] ?? null,
    ];
}

function recurrence_weekday_map(): array
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

function recurrence_weekday_tokens(): array
{
    return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
}

function normalize_recurrence_weekday_token($value): ?string
{
    if ($value === null || $value === '' || $value === false) {
        return null;
    }
    $candidate = strtoupper(trim((string) $value));
    if ($candidate === '') {
        return null;
    }
    $map = recurrence_weekday_map();
    if (!array_key_exists($candidate, $map)) {
        return null;
    }
    $tokens = recurrence_weekday_tokens();
    return $tokens[$map[$candidate]] ?? null;
}

function normalize_recurrence_weekday_tokens($value): array
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

        $token = normalize_recurrence_weekday_token($raw);
        if ($token !== null) {
            $normalized[$token] = recurrence_weekday_index($token);
        }
    }

    $tokens = array_keys($normalized);
    usort($tokens, static function (string $left, string $right): int {
        return recurrence_weekday_index($left) <=> recurrence_weekday_index($right);
    });
    return array_values($tokens);
}

function recurrence_weekday_csv($value): ?string
{
    $tokens = normalize_recurrence_weekday_tokens($value);
    if (!$tokens) {
        return null;
    }
    return implode(',', $tokens);
}

function recurrence_weekday_index(string $weekday): int
{
    $token = normalize_recurrence_weekday_token($weekday) ?? 'SU';
    $tokens = recurrence_weekday_tokens();
    $index = array_search($token, $tokens, true);
    return $index === false ? 0 : (int) $index;
}

function recurrence_setpos_order(): array
{
    return [1, 2, 3, 4, 5, -1];
}

function normalize_recurrence_monthday_values($value): array
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

        if (!preg_match('/^-?\d+$/', $raw)) {
            continue;
        }

        $monthDay = (int) $raw;
        if ($monthDay < 1 || $monthDay > 31) {
            continue;
        }
        $normalized[$monthDay] = true;
    }

    $tokens = array_map('intval', array_keys($normalized));
    sort($tokens, SORT_NUMERIC);
    return array_values($tokens);
}

function recurrence_monthday_csv($value): ?string
{
    $tokens = normalize_recurrence_monthday_values($value);
    if (!$tokens) {
        return null;
    }
    return implode(',', $tokens);
}

function normalize_recurrence_setpos_values($value): array
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
        if (!in_array($setpos, recurrence_setpos_order(), true)) {
            continue;
        }
        $normalized[$setpos] = true;
    }

    $tokens = array_map('intval', array_keys($normalized));
    $orderLookup = array_flip(recurrence_setpos_order());
    usort($tokens, static function (int $left, int $right) use ($orderLookup): int {
        return ($orderLookup[$left] ?? PHP_INT_MAX) <=> ($orderLookup[$right] ?? PHP_INT_MAX);
    });
    return array_values($tokens);
}

function recurrence_setpos_csv($value): ?string
{
    $tokens = normalize_recurrence_setpos_values($value);
    if (!$tokens) {
        return null;
    }
    return implode(',', $tokens);
}

function normalize_recurrence_exception_rows($value, ?string &$error = null): array
{
    $error = null;
    if ($value === null || $value === '' || $value === false) {
        return [];
    }
    if (is_string($value)) {
        $decoded = json_decode($value, true);
        if (!is_array($decoded)) {
            $error = 'recurrence.exceptions must be a JSON array.';
            return [];
        }
        $value = $decoded;
    }
    if (!is_array($value)) {
        $error = 'recurrence.exceptions must be an array.';
        return [];
    }

    $normalized = [];
    $seenDates = [];

    foreach (array_values($value) as $index => $row) {
        if (!is_array($row)) {
            $error = 'Each recurrence exception must be an object.';
            return [];
        }
        $exceptionDate = normalize_occurrence_date_input($row['exception_date'] ?? null);
        if ($exceptionDate === null) {
            $error = 'Each recurrence exception needs a valid exception_date.';
            return [];
        }
        if (isset($seenDates[$exceptionDate])) {
            $error = 'Each recurrence exception date may only appear once.';
            return [];
        }
        $overrideDate = normalize_occurrence_date_input(
            $row['override_date']
                ?? ($row['override_payload']['override_date'] ?? null)
        );
        $notes = array_key_exists('notes', $row) ? trim((string) ($row['notes'] ?? '')) : null;
        $type = $overrideDate !== null ? 'override' : 'skip';
        if (isset($row['exception_type']) && $row['exception_type'] === 'override' && $overrideDate === null) {
            $error = 'Override exceptions require an override date.';
            return [];
        }
        $normalized[] = [
            'id' => isset($row['id']) ? (int) $row['id'] : ($index + 1),
            'exception_date' => $exceptionDate,
            'exception_type' => $type,
            'override_date' => $overrideDate,
            'override_payload' => $overrideDate !== null ? ['override_date' => $overrideDate] : null,
            'notes' => $notes !== '' ? $notes : null,
        ];
        $seenDates[$exceptionDate] = true;
    }

    usort($normalized, static function (array $left, array $right): int {
        return strcmp((string) ($left['exception_date'] ?? ''), (string) ($right['exception_date'] ?? ''));
    });

    return $normalized;
}

function normalize_recurrence_request_payload($value, ?string &$error = null): ?array
{
    $error = null;
    if ($value === null || $value === '' || $value === false) {
        return null;
    }
    if (is_string($value)) {
        $decoded = json_decode($value, true);
        if (!is_array($decoded)) {
            $error = 'recurrence must be a JSON object.';
            return null;
        }
        $value = $decoded;
    }
    if (!is_array($value)) {
        $error = 'recurrence must be an object.';
        return null;
    }

    $enabled = array_key_exists('enabled', $value) ? !empty($value['enabled']) : true;
    $startsOn = normalize_occurrence_date_input($value['starts_on'] ?? $value['start_date'] ?? null);
    $endsOn = normalize_occurrence_date_input($value['ends_on'] ?? $value['end_date'] ?? null);
    $frequency = strtolower(trim((string) ($value['frequency'] ?? 'weekly')));
    if ($frequency === '') {
        $frequency = 'weekly';
    }
    if (!in_array($frequency, ['weekly', 'monthly'], true)) {
        $error = 'recurrence.frequency must be either weekly or monthly.';
        return null;
    }
    $weekdayInput = null;
    foreach (['byweekday', 'byweekdays', 'weekday', 'weekdays'] as $key) {
        if (array_key_exists($key, $value)) {
            $weekdayInput = $value[$key];
            break;
        }
    }
    $byweekdaySet = normalize_recurrence_weekday_tokens($weekdayInput);
    $byweekday = $byweekdaySet ? implode(',', $byweekdaySet) : null;
    $bymonthdayInput = null;
    foreach (['bymonthday', 'monthday', 'monthdays', 'day_of_month'] as $key) {
        if (array_key_exists($key, $value)) {
            $bymonthdayInput = $value[$key];
            break;
        }
    }
    $bymonthdaySet = normalize_recurrence_monthday_values($bymonthdayInput);
    $bymonthday = $bymonthdaySet ? implode(',', $bymonthdaySet) : null;
    $bysetposInput = null;
    foreach (['bysetpos', 'setpos', 'set_position', 'set_positions', 'positions'] as $key) {
        if (array_key_exists($key, $value)) {
            $bysetposInput = $value[$key];
            break;
        }
    }
    $bysetposSet = normalize_recurrence_setpos_values($bysetposInput);
    $bysetpos = $bysetposSet ? implode(',', $bysetposSet) : null;
    $monthlyMode = strtolower(trim((string) ($value['monthly_mode'] ?? '')));
    if ($monthlyMode === '') {
        $monthlyMode = $bymonthday !== null ? 'day_of_month' : 'nth_weekday';
    }
    if (!in_array($monthlyMode, ['day_of_month', 'nth_weekday'], true)) {
        $error = 'recurrence.monthly_mode must be either day_of_month or nth_weekday.';
        return null;
    }
    $interval = max(1, (int) ($value['interval'] ?? 1));
    $exceptionsProvided = array_key_exists('exceptions', $value);
    $exceptionsError = null;
    $exceptions = normalize_recurrence_exception_rows($value['exceptions'] ?? null, $exceptionsError);
    if ($exceptionsError !== null) {
        $error = $exceptionsError;
        return null;
    }

    if ($enabled) {
        if ($startsOn === null) {
            $error = 'recurrence.starts_on is required.';
            return null;
        }
        if ($frequency === 'weekly') {
            if ($byweekday === null) {
                $error = 'recurrence.byweekday is required.';
                return null;
            }
        } else {
            if ($monthlyMode === 'day_of_month') {
                if ($bymonthday === null) {
                    $error = 'recurrence.bymonthday is required for monthly day-of-month rules.';
                    return null;
                }
            } else {
                if (count($byweekdaySet) !== 1) {
                    $error = 'Monthly nth-weekday rules require exactly one weekday.';
                    return null;
                }
                if ($bysetpos === null) {
                    $error = 'recurrence.bysetpos is required for monthly nth-weekday rules.';
                    return null;
                }
            }
        }
        if ($endsOn !== null && strcmp($endsOn, $startsOn) < 0) {
            $error = 'recurrence.ends_on must be on or after recurrence.starts_on.';
            return null;
        }
    }

    if ($frequency === 'weekly') {
        $bymonthday = null;
        $bymonthdaySet = [];
        $bysetpos = null;
        $bysetposSet = [];
        $monthlyMode = null;
    } elseif ($monthlyMode === 'day_of_month') {
        $byweekday = null;
        $byweekdaySet = [];
        $bysetpos = null;
        $bysetposSet = [];
    } else {
        $bymonthday = null;
        $bymonthdaySet = [];
    }

    return [
        'enabled' => $enabled,
        'frequency' => $frequency,
        'interval' => $interval,
        'byweekday' => $byweekday,
        'byweekday_set' => $byweekdaySet,
        'bymonthday' => $bymonthday,
        'bymonthday_set' => $bymonthdaySet,
        'bysetpos' => $bysetpos,
        'bysetpos_set' => $bysetposSet,
        'monthly_mode' => $frequency === 'monthly' ? $monthlyMode : null,
        'starts_on' => $startsOn,
        'ends_on' => $endsOn,
        'exceptions_provided' => $exceptionsProvided,
        'exceptions' => $exceptions,
    ];
}

function resolve_recurrence_default_horizon_days(array $recurrence): int
{
    $frequency = strtolower(trim((string) ($recurrence['frequency'] ?? 'weekly')));
    return $frequency === 'monthly' ? 365 : 180;
}

function resolve_recurrence_limit_date(DateTimeImmutable $start, ?string $endsOn, int $defaultHorizonDays): DateTimeImmutable
{
    if ($endsOn !== null) {
        try {
            return new DateTimeImmutable($endsOn . ' 23:59:59');
        } catch (Throwable $error) {
            // Fall back to the default horizon below.
        }
    }
    return $start->modify('+' . max(1, $defaultHorizonDays) . ' days');
}

function build_weekly_recurrence_dates(string $startsOn, ?string $endsOn, $byweekday, int $interval = 1, int $defaultHorizonDays = 180, ?int $maxCount = null): array
{
    try {
        $start = new DateTimeImmutable($startsOn . ' 00:00:00');
    } catch (Throwable $error) {
        return [];
    }
    $tokens = normalize_recurrence_weekday_tokens($byweekday);
    if (!$tokens) {
        return [];
    }
    $limitDate = resolve_recurrence_limit_date($start, $endsOn, $defaultHorizonDays);

    $intervalWeeks = max(1, $interval);
    $startWeekdayIndex = (int) $start->format('w');
    $weekCursor = $startWeekdayIndex > 0
        ? $start->modify('-' . $startWeekdayIndex . ' days')
        : $start;
    $dates = [];
    $seen = [];
    $maxDates = $maxCount !== null
        ? max(1, $maxCount)
        : max(1, ((int) ceil(max(1, $defaultHorizonDays) / 7) * count($tokens)) + count($tokens) + 8);
    while ($weekCursor <= $limitDate && count($dates) < $maxDates) {
        foreach ($tokens as $token) {
            $candidate = $weekCursor->modify('+' . recurrence_weekday_index($token) . ' days');
            if ($candidate < $start || $candidate > $limitDate) {
                continue;
            }
            $dateKey = $candidate->format('Y-m-d');
            if (isset($seen[$dateKey])) {
                continue;
            }
            $seen[$dateKey] = true;
            $dates[] = $dateKey;
            if (count($dates) >= $maxDates) {
                break;
            }
        }
        $weekCursor = $weekCursor->modify('+' . $intervalWeeks . ' weeks');
    }
    return $dates;
}

function recurrence_nth_weekday_of_month(int $year, int $month, int $weekdayNum, int $nth): ?DateTimeImmutable
{
    if ($nth === -1) {
        try {
            $lastOfMonth = new DateTimeImmutable(sprintf('%04d-%02d-%02d 00:00:00', $year, $month, cal_days_in_month(CAL_GREGORIAN, $month, $year)));
        } catch (Throwable $error) {
            return null;
        }
        $lastWeekdayNum = (int) $lastOfMonth->format('w');
        $offset = ($lastWeekdayNum - $weekdayNum + 7) % 7;
        return $lastOfMonth->modify('-' . $offset . ' days');
    }

    if ($nth < 1) {
        return null;
    }

    try {
        $firstOfMonth = new DateTimeImmutable(sprintf('%04d-%02d-01 00:00:00', $year, $month));
    } catch (Throwable $error) {
        return null;
    }
    $firstWeekdayNum = (int) $firstOfMonth->format('w');
    $offsetDays = ($weekdayNum - $firstWeekdayNum + 7) % 7;
    $day = 1 + $offsetDays + (7 * ($nth - 1));
    $daysInMonth = (int) $firstOfMonth->format('t');
    if ($day > $daysInMonth) {
        return null;
    }
    return new DateTimeImmutable(sprintf('%04d-%02d-%02d 00:00:00', $year, $month, $day));
}

function build_monthly_day_of_month_recurrence_dates(string $startsOn, ?string $endsOn, $bymonthday, int $interval = 1, int $defaultHorizonDays = 365, ?int $maxCount = null): array
{
    try {
        $start = new DateTimeImmutable($startsOn . ' 00:00:00');
    } catch (Throwable $error) {
        return [];
    }
    $monthdays = normalize_recurrence_monthday_values($bymonthday);
    if (!$monthdays) {
        return [];
    }
    $limitDate = resolve_recurrence_limit_date($start, $endsOn, $defaultHorizonDays);
    $monthCursor = new DateTimeImmutable($start->format('Y-m-01 00:00:00'));
    $intervalMonths = max(1, $interval);
    $dates = [];
    $seen = [];
    $maxDates = $maxCount !== null
        ? max(1, $maxCount)
        : max(1, ((int) ceil(max(1, $defaultHorizonDays) / 28) * count($monthdays)) + count($monthdays) + 6);
    while ($monthCursor <= $limitDate && count($dates) < $maxDates) {
        $year = (int) $monthCursor->format('Y');
        $month = (int) $monthCursor->format('n');
        $daysInMonth = (int) $monthCursor->format('t');
        foreach ($monthdays as $monthday) {
            if ($monthday > $daysInMonth) {
                continue;
            }
            $candidate = new DateTimeImmutable(sprintf('%04d-%02d-%02d 00:00:00', $year, $month, $monthday));
            if ($candidate < $start || $candidate > $limitDate) {
                continue;
            }
            $dateKey = $candidate->format('Y-m-d');
            if (isset($seen[$dateKey])) {
                continue;
            }
            $seen[$dateKey] = true;
            $dates[] = $dateKey;
            if (count($dates) >= $maxDates) {
                break;
            }
        }
        $monthCursor = $monthCursor->modify('+' . $intervalMonths . ' months');
    }
    return $dates;
}

function build_monthly_nth_weekday_recurrence_dates(string $startsOn, ?string $endsOn, $byweekday, $bysetpos, int $interval = 1, int $defaultHorizonDays = 365, ?int $maxCount = null): array
{
    try {
        $start = new DateTimeImmutable($startsOn . ' 00:00:00');
    } catch (Throwable $error) {
        return [];
    }
    $tokens = normalize_recurrence_weekday_tokens($byweekday);
    $weekday = $tokens[0] ?? null;
    $setposValues = normalize_recurrence_setpos_values($bysetpos);
    if ($weekday === null || !$setposValues) {
        return [];
    }
    $limitDate = resolve_recurrence_limit_date($start, $endsOn, $defaultHorizonDays);
    $monthCursor = new DateTimeImmutable($start->format('Y-m-01 00:00:00'));
    $intervalMonths = max(1, $interval);
    $dates = [];
    $seen = [];
    $maxDates = $maxCount !== null
        ? max(1, $maxCount)
        : max(1, ((int) ceil(max(1, $defaultHorizonDays) / 28) * count($setposValues)) + count($setposValues) + 6);
    $weekdayIndex = recurrence_weekday_index($weekday);
    while ($monthCursor <= $limitDate && count($dates) < $maxDates) {
        $year = (int) $monthCursor->format('Y');
        $month = (int) $monthCursor->format('n');
        foreach ($setposValues as $setpos) {
            $candidate = recurrence_nth_weekday_of_month($year, $month, $weekdayIndex, $setpos);
            if ($candidate === null || $candidate < $start || $candidate > $limitDate) {
                continue;
            }
            $dateKey = $candidate->format('Y-m-d');
            if (isset($seen[$dateKey])) {
                continue;
            }
            $seen[$dateKey] = true;
            $dates[] = $dateKey;
            if (count($dates) >= $maxDates) {
                break;
            }
        }
        $monthCursor = $monthCursor->modify('+' . $intervalMonths . ' months');
    }
    sort($dates, SORT_STRING);
    return array_values($dates);
}

function normalize_recurrence_exception_row_to_payload(array $row): array
{
    $overridePayload = null;
    if (array_key_exists('override_payload', $row) && $row['override_payload'] !== null && $row['override_payload'] !== '') {
        if (is_array($row['override_payload'])) {
            $overridePayload = $row['override_payload'];
        } else {
            $decoded = json_decode((string) $row['override_payload'], true);
            if (is_array($decoded)) {
                $overridePayload = $decoded;
            }
        }
    }
    $overrideDate = normalize_occurrence_date_input($row['override_date'] ?? ($overridePayload['override_date'] ?? null));
    $exceptionDate = normalize_occurrence_date_input($row['exception_date'] ?? null);
    return array_merge($row, [
        'id' => isset($row['id']) ? (int) $row['id'] : null,
        'exception_date' => $exceptionDate,
        'exception_type' => in_array($row['exception_type'] ?? 'skip', ['skip', 'override'], true)
            ? $row['exception_type']
            : 'skip',
        'override_date' => $overrideDate,
        'override_payload' => $overrideDate !== null ? ['override_date' => $overrideDate] : null,
        'notes' => array_key_exists('notes', $row) ? ($row['notes'] !== null ? trim((string) $row['notes']) : null) : null,
    ]);
}

function load_recurrence_exceptions(PDO $pdo, int $recurrenceId): array
{
    $stmt = $pdo->prepare('SELECT * FROM event_recurrence_exceptions WHERE recurrence_id = ? ORDER BY exception_date ASC, id ASC');
    $stmt->execute([$recurrenceId]);
    $rows = $stmt->fetchAll() ?: [];
    return array_map('normalize_recurrence_exception_row_to_payload', $rows);
}

function apply_recurrence_exceptions_to_dates(array $dates, array $exceptions): array
{
    if (!$dates || !$exceptions) {
        return $dates;
    }

    $dateSet = array_fill_keys($dates, true);
    foreach ($exceptions as $exception) {
        $row = normalize_recurrence_exception_row_to_payload(is_array($exception) ? $exception : []);
        $exceptionDate = $row['exception_date'] ?? null;
        if ($exceptionDate === null || !isset($dateSet[$exceptionDate])) {
            continue;
        }
        unset($dateSet[$exceptionDate]);
        if (($row['exception_type'] ?? 'skip') !== 'override') {
            continue;
        }
        $overrideDate = $row['override_date'] ?? null;
        if ($overrideDate !== null) {
            $dateSet[$overrideDate] = true;
        }
    }

    $resolvedDates = array_keys($dateSet);
    sort($resolvedDates, SORT_STRING);
    return array_values($resolvedDates);
}

function build_recurrence_dates(array $recurrence, array $exceptions = [], array $options = []): array
{
    $frequency = strtolower(trim((string) ($recurrence['frequency'] ?? 'weekly')));
    $defaultHorizonDays = max(1, (int) ($options['default_horizon_days'] ?? resolve_recurrence_default_horizon_days($recurrence)));
    $maxCount = array_key_exists('max_count', $options) ? max(1, (int) $options['max_count']) : null;

    if ($frequency === 'monthly') {
        $monthlyMode = strtolower(trim((string) ($recurrence['monthly_mode'] ?? '')));
        $monthdays = normalize_recurrence_monthday_values($recurrence['bymonthday_set'] ?? $recurrence['bymonthday'] ?? null);
        if ($monthlyMode === 'day_of_month' || ($monthlyMode === '' && $monthdays)) {
            $dates = build_monthly_day_of_month_recurrence_dates(
                $recurrence['starts_on'],
                $recurrence['ends_on'] ?? null,
                $monthdays,
                max(1, (int) ($recurrence['interval'] ?? 1)),
                $defaultHorizonDays,
                $maxCount
            );
        } else {
            $dates = build_monthly_nth_weekday_recurrence_dates(
                $recurrence['starts_on'],
                $recurrence['ends_on'] ?? null,
                $recurrence['byweekday_set'] ?? $recurrence['byweekday'] ?? null,
                $recurrence['bysetpos_set'] ?? $recurrence['bysetpos'] ?? null,
                max(1, (int) ($recurrence['interval'] ?? 1)),
                $defaultHorizonDays,
                $maxCount
            );
        }
        return apply_recurrence_exceptions_to_dates($dates, $exceptions);
    }

    $dates = build_weekly_recurrence_dates(
        $recurrence['starts_on'],
        $recurrence['ends_on'] ?? null,
        $recurrence['byweekday_set'] ?? $recurrence['byweekday'] ?? null,
        max(1, (int) ($recurrence['interval'] ?? 1)),
        $defaultHorizonDays,
        $maxCount
    );
    return apply_recurrence_exceptions_to_dates($dates, $exceptions);
}

function recurrence_preview_cycle_size(array $recurrence): int
{
    $frequency = strtolower(trim((string) ($recurrence['frequency'] ?? 'weekly')));
    if ($frequency === 'weekly') {
        return max(1, count(normalize_recurrence_weekday_tokens($recurrence['byweekday_set'] ?? $recurrence['byweekday'] ?? null)));
    }

    $monthlyMode = strtolower(trim((string) ($recurrence['monthly_mode'] ?? '')));
    if ($monthlyMode === 'day_of_month') {
        return max(1, count(normalize_recurrence_monthday_values($recurrence['bymonthday_set'] ?? $recurrence['bymonthday'] ?? null)));
    }

    return max(1, count(normalize_recurrence_setpos_values($recurrence['bysetpos_set'] ?? $recurrence['bysetpos'] ?? null)));
}

function recurrence_preview_cycle_distance(string $startsOn, string $today, string $frequency, int $interval): int
{
    try {
        $start = new DateTimeImmutable($startsOn . ' 00:00:00');
        $todayDate = new DateTimeImmutable($today . ' 00:00:00');
    } catch (Throwable $error) {
        return 0;
    }

    if ($todayDate <= $start) {
        return 0;
    }

    if ($frequency === 'weekly') {
        $days = (int) $start->diff($todayDate)->format('%a');
        return max(0, (int) floor(($days / 7) / max(1, $interval)));
    }

    $yearDelta = ((int) $todayDate->format('Y')) - ((int) $start->format('Y'));
    $monthDelta = ((int) $todayDate->format('n')) - ((int) $start->format('n'));
    $totalMonths = ($yearDelta * 12) + $monthDelta;
    return max(0, (int) floor($totalMonths / max(1, $interval)));
}

function build_recurrence_exception_candidate_dates(array $recurrence, array $options = []): array
{
    $startsOn = normalize_occurrence_date_input($recurrence['starts_on'] ?? null);
    if ($startsOn === null) {
        return [];
    }

    $today = normalize_occurrence_date_input($options['today'] ?? null);
    if ($today === null) {
        $today = (new DateTimeImmutable('now', new DateTimeZone('America/New_York')))->format('Y-m-d');
    }

    $desiredCount = array_key_exists('max_count', $options)
        ? max(1, (int) $options['max_count'])
        : 24;
    $frequency = strtolower(trim((string) ($recurrence['frequency'] ?? 'weekly')));
    $interval = max(1, (int) ($recurrence['interval'] ?? 1));
    $cycleSize = recurrence_preview_cycle_size($recurrence);
    $cycleDistance = recurrence_preview_cycle_distance($startsOn, $today, $frequency, $interval);
    $estimatedMaxCount = max(
        $desiredCount + 4,
        (($cycleDistance + $desiredCount + 8) * max(1, $cycleSize)) + 4
    );

    try {
        $startDate = new DateTimeImmutable($startsOn . ' 00:00:00');
        $todayDate = new DateTimeImmutable($today . ' 00:00:00');
        $daysSinceStart = max(0, (int) $startDate->diff($todayDate)->format('%a'));
    } catch (Throwable $error) {
        $daysSinceStart = 0;
    }

    $forwardWindowDays = $frequency === 'monthly' ? 540 : 210;
    $defaultHorizonDays = max(
        resolve_recurrence_default_horizon_days($recurrence),
        $daysSinceStart + $forwardWindowDays
    );

    $exceptions = is_array($options['exceptions'] ?? null) ? $options['exceptions'] : [];

    $dates = build_recurrence_dates($recurrence, $exceptions, [
        'default_horizon_days' => $defaultHorizonDays,
        'max_count' => $estimatedMaxCount,
    ]);

    $upcomingDates = array_values(array_filter($dates, static function ($date) use ($today): bool {
        return is_string($date) && strcmp($date, $today) >= 0;
    }));

    return array_slice($upcomingDates, 0, $desiredCount);
}

function resolve_recurrence_first_occurrence_date(array $recurrence, array $exceptions = []): ?string
{
    $dates = build_recurrence_dates($recurrence, $exceptions, ['max_count' => 1]);
    return $dates[0] ?? null;
}

function recurrence_generated_change_note_prefix(): string
{
    return 'generated by recurrence|';
}

function recurrence_rule_payload_from_event_row(array $row): ?array
{
    return recurrence_rule_row_to_payload([
        'frequency' => $row['recurrence_frequency'] ?? null,
        'interval' => $row['recurrence_interval'] ?? ($row['interval'] ?? 1),
        'byweekday' => $row['recurrence_byweekday'] ?? null,
        'bymonthday' => $row['recurrence_bymonthday'] ?? null,
        'bysetpos' => $row['recurrence_bysetpos'] ?? null,
        'starts_on' => $row['recurrence_starts_on'] ?? null,
        'ends_on' => $row['recurrence_ends_on'] ?? null,
        'rule_payload' => $row['recurrence_rule_payload'] ?? null,
    ]);
}

function load_recurrence_exceptions_map(PDO $pdo, array $recurrenceIds): array
{
    $normalizedIds = array_values(array_unique(array_filter(array_map('intval', $recurrenceIds))));
    if (!$normalizedIds) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($normalizedIds), '?'));
    $stmt = $pdo->prepare("SELECT * FROM event_recurrence_exceptions WHERE recurrence_id IN ({$placeholders}) ORDER BY recurrence_id ASC, exception_date ASC, id ASC");
    $stmt->execute($normalizedIds);
    $rows = $stmt->fetchAll() ?: [];
    $map = [];
    foreach ($rows as $row) {
        $recurrenceId = (int) ($row['recurrence_id'] ?? 0);
        if ($recurrenceId <= 0) {
            continue;
        }
        if (!isset($map[$recurrenceId])) {
            $map[$recurrenceId] = [];
        }
        $map[$recurrenceId][] = normalize_recurrence_exception_row_to_payload($row);
    }
    return $map;
}

function build_public_recurrence_preview_occurrences(array $master, array $exceptions = [], int $maxCount = 6): array
{
    if (empty($master['is_series_master'])) {
        return [];
    }
    $recurrence = recurrence_rule_payload_from_event_row($master);
    if (!$recurrence || empty($recurrence['enabled'])) {
        return [];
    }

    $dates = build_recurrence_exception_candidate_dates($recurrence, [
        'exceptions' => $exceptions,
        'max_count' => max(1, $maxCount),
    ]);
    if (!$dates) {
        return [];
    }

    $occurrences = [];
    foreach ($dates as $occurrenceDate) {
        $schedule = build_recurrence_child_schedule($master, $occurrenceDate);
        if (!$schedule) {
            continue;
        }
        $occurrences[] = [
            'occurrence_date' => $schedule['event_date'],
            'event_date' => $schedule['event_date'],
            'event_time' => $schedule['event_time'],
            'start_datetime' => $schedule['start_datetime'],
            'end_datetime' => $schedule['end_datetime'],
            'door_time' => $schedule['door_time'],
            'venue_code' => $master['venue_code'] ?? 'MMH',
            'series_master_id' => isset($master['id']) ? (int) $master['id'] : null,
        ];
    }

    return $occurrences;
}

function attach_public_recurrence_previews(PDO $pdo, array $rows): array
{
    $ruleIds = [];
    foreach ($rows as $row) {
        if (empty($row['is_series_master'])) {
            continue;
        }
        $ruleId = (int) ($row['recurrence_rule_id'] ?? 0);
        if ($ruleId > 0) {
            $ruleIds[] = $ruleId;
        }
    }
    $exceptionMap = load_recurrence_exceptions_map($pdo, $ruleIds);
    foreach ($rows as &$row) {
        if (empty($row['is_series_master'])) {
            continue;
        }
        $ruleId = (int) ($row['recurrence_rule_id'] ?? 0);
        $row['public_recurrence_occurrences'] = build_public_recurrence_preview_occurrences(
            $row,
            $exceptionMap[$ruleId] ?? []
        );
    }
    unset($row);
    return $rows;
}

function recurrence_generated_change_note_for_date(string $date): string
{
    return recurrence_generated_change_note_prefix() . $date;
}

function event_is_generated_recurrence_child(array $event): bool
{
    $changeNote = trim((string) ($event['change_note'] ?? ''));
    return $changeNote !== '' && strpos($changeNote, recurrence_generated_change_note_prefix()) === 0;
}

function event_is_sync_managed_recurrence_child(array $event): bool
{
    if (event_is_generated_recurrence_child($event)) {
        return true;
    }
    return !empty($event['series_master_id']) && trim((string) ($event['change_note'] ?? '')) === 'imported from events.json';
}

function recurrence_child_date_key(array $child): ?string
{
    $dateKey = $child['event_date'] ?? null;
    if (!$dateKey && !empty($child['start_datetime'])) {
        $dateKey = substr((string) $child['start_datetime'], 0, 10);
    }
    $normalized = normalize_occurrence_date_input($dateKey);
    return $normalized !== null ? $normalized : null;
}

function fetch_recurrence_children(PDO $pdo, int $masterId): array
{
    $childrenStmt = $pdo->prepare("
        SELECT e.*,
               EXISTS(SELECT 1 FROM seat_requests sr WHERE sr.event_id = e.id LIMIT 1) AS has_seat_requests
        FROM events e
        WHERE e.series_master_id = ? AND e.deleted_at IS NULL
        ORDER BY COALESCE(e.event_date, DATE(e.start_datetime)) ASC, e.start_datetime ASC, e.id ASC
    ");
    $childrenStmt->execute([$masterId]);
    return $childrenStmt->fetchAll() ?: [];
}

function archive_generated_recurrence_children(PDO $pdo, array $children, array $targetDateSet, string $today): int
{
    $archived = 0;
    foreach ($children as $child) {
        if (!event_is_sync_managed_recurrence_child($child)) {
            continue;
        }
        $dateKey = recurrence_child_date_key($child);
        if (!$dateKey || isset($targetDateSet[$dateKey]) || $dateKey < $today) {
            continue;
        }
        if (!empty($child['has_seat_requests'])) {
            continue;
        }
        soft_archive_recurrence_child($pdo, (int) $child['id']);
        $archived++;
    }
    return $archived;
}

function cleanup_disabled_recurrence_children(PDO $pdo, int $masterId): array
{
    $masterStmt = $pdo->prepare('SELECT * FROM events WHERE id = ? LIMIT 1 FOR UPDATE');
    $masterStmt->execute([$masterId]);
    $master = $masterStmt->fetch();
    if (!$master) {
        throw new RuntimeException('Recurring series master not found.');
    }

    $today = (new DateTimeImmutable('now', new DateTimeZone((string) ($master['timezone'] ?? 'America/New_York'))))->format('Y-m-d');
    $children = fetch_recurrence_children($pdo, $masterId);
    $archived = archive_generated_recurrence_children($pdo, $children, [], $today);

    return [
        'created' => 0,
        'updated' => 0,
        'archived' => $archived,
        'skipped_existing' => 0,
    ];
}

function recurrence_rule_payload_json(array $recurrence): string
{
    $frequency = strtolower(trim((string) ($recurrence['frequency'] ?? 'weekly')));
    $payload = [
        'generator' => 'series_instances',
        'horizon_days' => resolve_recurrence_default_horizon_days($recurrence),
        'sync_generated_children' => true,
        'frequency' => $frequency,
        'interval' => max(1, (int) ($recurrence['interval'] ?? 1)),
        'byweekday' => recurrence_weekday_csv($recurrence['byweekday_set'] ?? $recurrence['byweekday'] ?? null),
        'byweekday_set' => normalize_recurrence_weekday_tokens($recurrence['byweekday_set'] ?? $recurrence['byweekday'] ?? null),
        'bymonthday' => recurrence_monthday_csv($recurrence['bymonthday_set'] ?? $recurrence['bymonthday'] ?? null),
        'bymonthday_set' => normalize_recurrence_monthday_values($recurrence['bymonthday_set'] ?? $recurrence['bymonthday'] ?? null),
        'bysetpos' => recurrence_setpos_csv($recurrence['bysetpos_set'] ?? $recurrence['bysetpos'] ?? null),
        'bysetpos_set' => normalize_recurrence_setpos_values($recurrence['bysetpos_set'] ?? $recurrence['bysetpos'] ?? null),
        'setpos' => normalize_recurrence_setpos_values($recurrence['bysetpos_set'] ?? $recurrence['bysetpos'] ?? null),
        'monthly_mode' => $frequency === 'monthly'
            ? strtolower(trim((string) ($recurrence['monthly_mode'] ?? (normalize_recurrence_monthday_values($recurrence['bymonthday_set'] ?? $recurrence['bymonthday'] ?? null) ? 'day_of_month' : 'nth_weekday'))))
            : null,
    ];
    return json_encode($payload);
}

function recurrence_rule_row_to_payload(array $row): ?array
{
    $startsOn = normalize_occurrence_date_input($row['starts_on'] ?? null);
    $payload = [];
    if (!empty($row['rule_payload'])) {
        $decoded = json_decode((string) $row['rule_payload'], true);
        if (is_array($decoded)) {
            $payload = $decoded;
        }
    }
    $frequency = strtolower(trim((string) ($row['frequency'] ?? ($payload['frequency'] ?? 'weekly')))) ?: 'weekly';
    $byweekdaySet = normalize_recurrence_weekday_tokens($row['byweekday'] ?? ($payload['byweekday_set'] ?? ($payload['byweekday'] ?? null)));
    $bymonthdaySet = normalize_recurrence_monthday_values($row['bymonthday'] ?? ($payload['bymonthday_set'] ?? ($payload['bymonthday'] ?? null)));
    $bysetposSet = normalize_recurrence_setpos_values($row['bysetpos'] ?? ($payload['bysetpos_set'] ?? ($payload['bysetpos'] ?? ($payload['setpos'] ?? null))));
    $byweekday = $byweekdaySet ? implode(',', $byweekdaySet) : null;
    $bymonthday = $bymonthdaySet ? implode(',', $bymonthdaySet) : null;
    $bysetpos = $bysetposSet ? implode(',', $bysetposSet) : null;
    if ($startsOn === null) {
        return null;
    }
    $monthlyMode = strtolower(trim((string) ($payload['monthly_mode'] ?? '')));
    if ($frequency === 'monthly') {
        if ($monthlyMode === '') {
            $monthlyMode = $bymonthday !== null ? 'day_of_month' : 'nth_weekday';
        }
        if ($monthlyMode === 'day_of_month') {
            if ($bymonthday === null) {
                return null;
            }
        } else {
            $monthlyMode = 'nth_weekday';
            if ($byweekday === null || $bysetpos === null) {
                return null;
            }
        }
    } elseif ($byweekday === null) {
        return null;
    }
    return [
        'enabled' => true,
        'frequency' => $frequency,
        'interval' => max(1, (int) ($row['interval'] ?? 1)),
        'byweekday' => $byweekday,
        'byweekday_set' => $byweekdaySet,
        'bymonthday' => $bymonthday,
        'bymonthday_set' => $bymonthdaySet,
        'bysetpos' => $bysetpos,
        'bysetpos_set' => $bysetposSet,
        'monthly_mode' => $frequency === 'monthly' ? $monthlyMode : null,
        'starts_on' => $startsOn,
        'ends_on' => normalize_occurrence_date_input($row['ends_on'] ?? null),
        'exceptions_provided' => false,
        'exceptions' => [],
    ];
}

function upsert_event_recurrence_rule(PDO $pdo, int $eventId, array $recurrence, string $actor = 'api'): ?int
{
    if (empty($recurrence['enabled'])) {
        $stmt = $pdo->prepare('DELETE FROM event_recurrence_rules WHERE event_id = ?');
        $stmt->execute([$eventId]);
        return null;
    }
    $existingStmt = $pdo->prepare('SELECT id FROM event_recurrence_rules WHERE event_id = ? LIMIT 1');
    $existingStmt->execute([$eventId]);
    $existingId = $existingStmt->fetchColumn();
    $payloadJson = recurrence_rule_payload_json($recurrence);
    $byweekday = recurrence_weekday_csv($recurrence['byweekday_set'] ?? $recurrence['byweekday'] ?? null);
    $bymonthday = recurrence_monthday_csv($recurrence['bymonthday_set'] ?? $recurrence['bymonthday'] ?? null);
    $bysetpos = recurrence_setpos_csv($recurrence['bysetpos_set'] ?? $recurrence['bysetpos'] ?? null);
    $frequency = strtolower(trim((string) ($recurrence['frequency'] ?? 'weekly'))) ?: 'weekly';
    if ($existingId) {
        $stmt = $pdo->prepare('UPDATE event_recurrence_rules SET frequency = ?, `interval` = ?, byweekday = ?, bymonthday = ?, bysetpos = ?, starts_on = ?, ends_on = ?, rule_payload = ?, updated_by = ?, change_note = ? WHERE id = ?');
        $stmt->execute([
            $frequency,
            max(1, (int) ($recurrence['interval'] ?? 1)),
            $byweekday,
            $bymonthday,
            $bysetpos,
            $recurrence['starts_on'],
            $recurrence['ends_on'] ?? null,
            $payloadJson,
            $actor,
            'updated via recurrence workflow',
            $existingId,
        ]);
        return (int) $existingId;
    }
    $stmt = $pdo->prepare('INSERT INTO event_recurrence_rules (event_id, frequency, `interval`, byweekday, bymonthday, bysetpos, starts_on, ends_on, rule_payload, created_by, updated_by, change_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([
        $eventId,
        $frequency,
        max(1, (int) ($recurrence['interval'] ?? 1)),
        $byweekday,
        $bymonthday,
        $bysetpos,
        $recurrence['starts_on'],
        $recurrence['ends_on'] ?? null,
        $payloadJson,
        $actor,
        $actor,
        'created via recurrence workflow',
    ]);
    return (int) $pdo->lastInsertId();
}

function replace_recurrence_exceptions(PDO $pdo, int $recurrenceId, array $exceptions, string $actor = 'api'): array
{
    $deleteStmt = $pdo->prepare('DELETE FROM event_recurrence_exceptions WHERE recurrence_id = ?');
    $deleteStmt->execute([$recurrenceId]);
    if (!$exceptions) {
        return [];
    }

    $insertStmt = $pdo->prepare('INSERT INTO event_recurrence_exceptions (recurrence_id, exception_date, exception_type, override_payload, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)');
    foreach ($exceptions as $exception) {
        $row = normalize_recurrence_exception_row_to_payload(is_array($exception) ? $exception : []);
        $insertStmt->execute([
            $recurrenceId,
            $row['exception_date'],
            $row['exception_type'],
            $row['override_payload'] ? json_encode($row['override_payload']) : null,
            $row['notes'] ?? null,
            $actor,
        ]);
    }

    return load_recurrence_exceptions($pdo, $recurrenceId);
}

function build_recurrence_child_schedule(array $master, string $occurrenceDate): ?array
{
    $timezone = (string) ($master['timezone'] ?? 'America/New_York');
    $eventTime = normalize_occurrence_time_input($master['event_time'] ?? null);
    if ($eventTime === null) {
        $start = resolve_event_start_datetime($master);
        $eventTime = $start ? $start->format('H:i:s') : null;
    }
    if ($eventTime === null) {
        return null;
    }
    $startDt = build_event_start_datetime($occurrenceDate, $eventTime, $timezone);
    if (!$startDt) {
        return null;
    }
    $durationSeconds = resolve_event_duration_seconds($master);
    $doorTimeOfDay = extract_time_of_day_from_value($master['door_time'] ?? null, $timezone);
    return [
        'event_date' => $occurrenceDate,
        'event_time' => $eventTime,
        'start_datetime' => $startDt->format('Y-m-d H:i:s'),
        'end_datetime' => $startDt->modify('+' . max(3600, $durationSeconds) . ' seconds')->format('Y-m-d H:i:s'),
        'door_time' => $doorTimeOfDay ? build_occurrence_door_datetime($occurrenceDate, $doorTimeOfDay, $timezone) : null,
    ];
}

function recurrence_child_slug_base(array $master, string $occurrenceDate): string
{
    $base = $master['slug'] ?? null;
    if (!is_string($base) || trim($base) === '') {
        $base = $master['title'] ?? $master['artist_name'] ?? 'recurring-event';
    }
    return slugify_string($base . '-' . str_replace('-', '', $occurrenceDate));
}

function recurrence_child_columns_from_master(array $master, int $masterId, string $occurrenceDate, array $schedule, PDO $pdo, ?int $childId = null): array
{
    $slug = ensure_unique_slug($pdo, recurrence_child_slug_base($master, $occurrenceDate), $childId);
    $masterStatus = trim((string) ($master['status'] ?? 'draft'));
    if (!in_array($masterStatus, ['draft', 'published', 'archived'], true)) {
        $masterStatus = 'draft';
    }
    $status = $masterStatus === 'archived' ? 'archived' : 'published';
    $visibility = 'public';
    if ($status === 'archived') {
        $visibility = 'private';
    }
    $publishAt = $master['publish_at'] ?? null;
    if (($publishAt === null || $publishAt === '') && $status === 'published') {
        $publishAt = $schedule['start_datetime'];
    }
    $columns = [
        'artist_name' => $master['artist_name'] ?? null,
        'title' => $master['title'] ?? null,
        'slug' => $slug,
        'description' => $master['description'] ?? null,
        'notes' => $master['notes'] ?? null,
        'genre' => $master['genre'] ?? null,
        'category_tags' => $master['category_tags'] ?? null,
        'category_id' => $master['category_id'] ?? null,
        'image_url' => $master['image_url'] ?? null,
        'hero_image_id' => $master['hero_image_id'] ?? null,
        'poster_image_id' => $master['poster_image_id'] ?? null,
        'ticket_price' => $master['ticket_price'] ?? null,
        'door_price' => $master['door_price'] ?? null,
        'min_ticket_price' => $master['min_ticket_price'] ?? null,
        'max_ticket_price' => $master['max_ticket_price'] ?? null,
        'pricing_config' => $master['pricing_config'] ?? null,
        'ticket_type' => $master['ticket_type'] ?? 'general_admission',
        'seating_enabled' => !empty($master['seating_enabled']) ? 1 : 0,
        'venue_code' => $master['venue_code'] ?? 'MMH',
        'venue_section' => $master['venue_section'] ?? null,
        'timezone' => $master['timezone'] ?? 'America/New_York',
        'start_datetime' => $schedule['start_datetime'],
        'end_datetime' => $schedule['end_datetime'],
        'door_time' => $schedule['door_time'],
        'event_date' => $schedule['event_date'],
        'event_time' => $schedule['event_time'],
        'age_restriction' => $master['age_restriction'] ?? 'All Ages',
        'status' => $status,
        'visibility' => $visibility,
        'publish_at' => $publishAt,
        'layout_id' => $master['layout_id'] ?? null,
        'layout_version_id' => $master['layout_version_id'] ?? null,
        'series_master_id' => $masterId,
        'is_series_master' => 0,
        'ticket_url' => $master['ticket_url'] ?? null,
        'contact_name' => $master['contact_name'] ?? null,
        'contact_phone_raw' => $master['contact_phone_raw'] ?? null,
        'contact_phone_normalized' => $master['contact_phone_normalized'] ?? null,
        'contact_email' => $master['contact_email'] ?? null,
        'contact_notes' => $master['contact_notes'] ?? null,
        'seat_request_email_override' => $master['seat_request_email_override'] ?? null,
        'payment_enabled' => !empty($master['payment_enabled']) ? 1 : 0,
        'change_note' => recurrence_generated_change_note_for_date($occurrenceDate),
        'updated_by' => 'api',
    ];
    if ($childId === null) {
        $columns['created_by'] = 'api';
    }
    return $columns;
}

function soft_archive_recurrence_child(PDO $pdo, int $childId): void
{
    $stmt = $pdo->prepare('UPDATE events SET deleted_at = NOW(), status = ?, visibility = ?, updated_by = ?, change_note = ? WHERE id = ?');
    $stmt->execute([
        'archived',
        'private',
        'api',
        'archived by recurrence sync',
        $childId,
    ]);
}

function sync_generated_recurrence_children(PDO $pdo, int $masterId, array $recurrence, ?int $recurrenceId = null, ?array $exceptions = null): array
{
    if (empty($recurrence['enabled'])) {
        return ['created' => 0, 'updated' => 0, 'archived' => 0, 'skipped_existing' => 0];
    }
    // Lock the master row so recurrence sync remains serialized per series.
    $masterStmt = $pdo->prepare('SELECT * FROM events WHERE id = ? LIMIT 1 FOR UPDATE');
    $masterStmt->execute([$masterId]);
    $master = $masterStmt->fetch();
    if (!$master) {
        throw new RuntimeException('Recurring series master not found.');
    }

    if ($recurrenceId === null) {
        $ruleStmt = $pdo->prepare('SELECT id FROM event_recurrence_rules WHERE event_id = ? LIMIT 1');
        $ruleStmt->execute([$masterId]);
        $recurrenceId = (int) ($ruleStmt->fetchColumn() ?: 0);
    }
    if ($exceptions === null && $recurrenceId > 0) {
        $exceptions = load_recurrence_exceptions($pdo, $recurrenceId);
    }

    $targetDates = build_recurrence_dates($recurrence, $exceptions ?: []);
    if (!$targetDates) {
        return ['created' => 0, 'updated' => 0, 'archived' => 0, 'skipped_existing' => 0];
    }

    $children = fetch_recurrence_children($pdo, $masterId);

    $today = (new DateTimeImmutable('now', new DateTimeZone((string) ($master['timezone'] ?? 'America/New_York'))))->format('Y-m-d');
    $allChildrenByDate = [];
    $generatedChildrenByDate = [];
    foreach ($children as $child) {
        $dateKey = recurrence_child_date_key($child);
        if (!$dateKey) {
            continue;
        }
        if (!isset($allChildrenByDate[$dateKey])) {
            $allChildrenByDate[$dateKey] = [];
        }
        $allChildrenByDate[$dateKey][] = $child;
        if (event_is_sync_managed_recurrence_child($child) && !isset($generatedChildrenByDate[$dateKey])) {
            $generatedChildrenByDate[$dateKey] = $child;
        }
    }

    $created = 0;
    $updated = 0;
    $skippedExisting = 0;
    $targetDateSet = array_fill_keys($targetDates, true);

    foreach ($targetDates as $occurrenceDate) {
        $schedule = build_recurrence_child_schedule($master, $occurrenceDate);
        if (!$schedule) {
            continue;
        }
        if ($occurrenceDate < $today && empty($allChildrenByDate[$occurrenceDate])) {
            continue;
        }
        if (isset($generatedChildrenByDate[$occurrenceDate])) {
            $child = $generatedChildrenByDate[$occurrenceDate];
            $columns = recurrence_child_columns_from_master($master, $masterId, $occurrenceDate, $schedule, $pdo, (int) $child['id']);
            $assignments = implode(', ', array_map(static function ($column): string {
                return $column . ' = ?';
            }, array_keys($columns)));
            $stmt = $pdo->prepare('UPDATE events SET ' . $assignments . ' WHERE id = ?');
            $values = array_values($columns);
            $values[] = (int) $child['id'];
            $stmt->execute($values);
            $updated++;
            continue;
        }
        if (!empty($allChildrenByDate[$occurrenceDate])) {
            $skippedExisting++;
            continue;
        }
        $columns = recurrence_child_columns_from_master($master, $masterId, $occurrenceDate, $schedule, $pdo, null);
        $placeholders = implode(', ', array_fill(0, count($columns), '?'));
        $stmt = $pdo->prepare('INSERT INTO events (' . implode(', ', array_keys($columns)) . ') VALUES (' . $placeholders . ')');
        $stmt->execute(array_values($columns));
        $created++;
    }

    $archived = archive_generated_recurrence_children($pdo, $children, $targetDateSet, $today);

    return [
        'created' => $created,
        'updated' => $updated,
        'archived' => $archived,
        'skipped_existing' => $skippedExisting,
    ];
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

function payment_settings_table_exists(PDO $pdo): bool
{
    static $exists = null;
    if ($exists !== null) {
        return $exists;
    }
    try {
        $pdo->query('SELECT 1 FROM payment_settings LIMIT 1');
        $exists = true;
    } catch (Throwable $error) {
        $exists = false;
        if (APP_DEBUG) {
            error_log('payment_settings_table_exists failure: ' . $error->getMessage());
        }
    }
    return $exists;
}

function payment_settings_table_has_column(PDO $pdo, string $column): bool
{
    static $cache = [];
    $key = strtolower($column);
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }
    if (!payment_settings_table_exists($pdo)) {
        $cache[$key] = false;
        return false;
    }
    try {
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $column)) {
            $cache[$key] = false;
            return false;
        }
        $quoted = str_replace("'", "''", $column);
        $stmt = $pdo->query("SHOW COLUMNS FROM payment_settings LIKE '{$quoted}'");
        $cache[$key] = (bool) ($stmt->fetch() ?: null);
    } catch (Throwable $error) {
        $cache[$key] = false;
        if (APP_DEBUG) {
            error_log('payment_settings_table_has_column failure: ' . $error->getMessage());
        }
    }
    return $cache[$key];
}

function payment_settings_provider_type_supports(PDO $pdo, string $providerType): bool
{
    static $cache = [];
    $normalized = normalize_payment_provider_type($providerType);
    if (array_key_exists($normalized, $cache)) {
        return $cache[$normalized];
    }
    if (!payment_settings_table_has_column($pdo, 'provider_type')) {
        $cache[$normalized] = false;
        return false;
    }
    try {
        $stmt = $pdo->query("SHOW COLUMNS FROM payment_settings LIKE 'provider_type'");
        $column = $stmt->fetch() ?: [];
        $type = strtolower(trim((string) ($column['Type'] ?? $column['type'] ?? '')));
        if ($type === '') {
            $cache[$normalized] = false;
            return false;
        }
        if (!str_starts_with($type, 'enum(')) {
            $cache[$normalized] = true;
            return true;
        }
        preg_match_all("/'([^']+)'/", $type, $matches);
        $cache[$normalized] = in_array($normalized, $matches[1] ?? [], true);
    } catch (Throwable $error) {
        $cache[$normalized] = false;
        if (APP_DEBUG) {
            error_log('payment_settings_provider_type_supports failure: ' . $error->getMessage());
        }
    }
    return $cache[$normalized];
}

function payment_settings_has_disallowed_markup(?string $value): bool
{
    if ($value === null) {
        return false;
    }
    return preg_match('/<[^>]*>/', $value) === 1;
}

function normalize_payment_provider_type($value): string
{
    $providerType = strtolower(trim((string) ($value ?? 'external_link')));
    if (!in_array($providerType, ['external_link', 'paypal_hosted_button', 'paypal_orders', 'square'], true)) {
        return 'external_link';
    }
    return $providerType;
}

function normalize_currency_code($value): ?string
{
    $currency = strtoupper(trim((string) ($value ?? 'USD')));
    if (!preg_match('/^[A-Z]{3,8}$/', $currency)) {
        return null;
    }
    return $currency;
}

function normalize_paypal_currency($value): string
{
    return normalize_currency_code($value) ?? 'USD';
}

function normalize_paypal_hosted_button_id($value): ?string
{
    $hostedButtonId = trim((string) ($value ?? ''));
    if ($hostedButtonId === '') {
        return null;
    }
    if (!preg_match('/^[A-Za-z0-9]{5,64}$/', $hostedButtonId)) {
        return null;
    }
    return $hostedButtonId;
}

function resolve_paypal_sdk_client_id(): ?string
{
    $envClientId = trim((string) Env::get('PAYPAL_SDK_CLIENT_ID', ''));
    return $envClientId !== '' ? $envClientId : null;
}

function resolve_square_environment(): string
{
    $fallback = strtolower(trim((string) Env::get('APP_ENV', 'development'))) === 'production'
        ? 'production'
        : 'sandbox';
    $environment = strtolower(trim((string) Env::get('SQUARE_ENVIRONMENT', $fallback)));
    return $environment === 'production' ? 'production' : 'sandbox';
}

function resolve_square_access_token(): ?string
{
    $token = trim((string) Env::get('SQUARE_ACCESS_TOKEN', ''));
    return $token !== '' ? $token : null;
}

function resolve_square_location_id(): ?string
{
    $locationId = trim((string) Env::get('SQUARE_LOCATION_ID', ''));
    return $locationId !== '' ? $locationId : null;
}

function resolve_square_api_base_url(): string
{
    $override = trim((string) Env::get('SQUARE_API_BASE_URL', ''));
    if ($override !== '') {
        return rtrim($override, '/');
    }
    return resolve_square_environment() === 'production'
        ? 'https://connect.squareup.com'
        : 'https://connect.squareupsandbox.com';
}

function resolve_square_api_version(): string
{
    $version = trim((string) Env::get('SQUARE_API_VERSION', '2026-01-22'));
    return $version !== '' ? $version : '2026-01-22';
}

function resolve_square_checkout_redirect_url(): ?string
{
    $redirectUrl = trim((string) Env::get('SQUARE_CHECKOUT_REDIRECT_URL', ''));
    return $redirectUrl !== '' ? $redirectUrl : null;
}

function resolve_square_webhook_signature_key(): ?string
{
    $signatureKey = trim((string) Env::get('SQUARE_WEBHOOK_SIGNATURE_KEY', ''));
    return $signatureKey !== '' ? $signatureKey : null;
}

function resolve_square_webhook_notification_url(): ?string
{
    $notificationUrl = trim((string) Env::get('SQUARE_WEBHOOK_NOTIFICATION_URL', ''));
    return $notificationUrl !== '' ? $notificationUrl : null;
}

function square_provider_is_configured(): bool
{
    return resolve_square_access_token() !== null
        && resolve_square_location_id() !== null;
}

function square_extract_error_message(array $payload, string $fallback = 'Square request failed'): string
{
    $errors = $payload['errors'] ?? null;
    if (!is_array($errors) || !$errors) {
        return $fallback;
    }
    $first = $errors[0] ?? null;
    if (!is_array($first)) {
        return $fallback;
    }
    $parts = array_values(array_filter([
        trim((string) ($first['category'] ?? '')),
        trim((string) ($first['code'] ?? '')),
        trim((string) ($first['detail'] ?? '')),
    ]));
    if (!$parts) {
        return $fallback;
    }
    return implode(': ', $parts);
}

function square_api_request(string $method, string $path, ?array $payload = null): array
{
    $accessToken = resolve_square_access_token();
    if ($accessToken === null) {
        throw new RuntimeException('Square access token is not configured');
    }

    $encodedPayload = $payload !== null ? json_encode($payload) : null;
    if ($payload !== null && $encodedPayload === false) {
        throw new RuntimeException('Unable to encode Square request payload');
    }

    $ch = curl_init(resolve_square_api_base_url() . $path);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, array_values(array_filter([
        'Authorization: Bearer ' . $accessToken,
        'Square-Version: ' . resolve_square_api_version(),
        'Accept: application/json',
        $payload !== null ? 'Content-Type: application/json' : null,
    ])));
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    if ($payload !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $encodedPayload);
    }

    $responseBody = curl_exec($ch);
    $curlError = curl_error($ch);
    $statusCode = (int) (curl_getinfo($ch, CURLINFO_HTTP_CODE) ?: 0);

    if ($responseBody === false) {
        throw new RuntimeException('Square API request failed: ' . ($curlError ?: 'unknown cURL error'));
    }

    $decoded = json_decode((string) $responseBody, true);
    return [
        'status' => $statusCode,
        'body' => (string) $responseBody,
        'json' => is_array($decoded) ? $decoded : null,
    ];
}

function square_payment_link_payload_from_response(?array $payload): ?array
{
    if (!$payload) {
        return null;
    }
    $paymentLink = $payload['payment_link'] ?? null;
    if (!is_array($paymentLink)) {
        return null;
    }
    $paymentLinkId = normalize_nullable_text($paymentLink['id'] ?? null);
    $checkoutUrl = normalize_nullable_text($paymentLink['url'] ?? null);
    $orderId = normalize_nullable_text($paymentLink['order_id'] ?? null);
    if ($orderId === null) {
        $orders = $payload['related_resources']['orders'] ?? [];
        if (is_array($orders) && isset($orders[0]) && is_array($orders[0])) {
            $orderId = normalize_nullable_text($orders[0]['id'] ?? null);
        }
    }
    if ($paymentLinkId === null || $checkoutUrl === null || $orderId === null) {
        return null;
    }
    return [
        'payment_link_id' => $paymentLinkId,
        'checkout_url' => $checkoutUrl,
        'order_id' => $orderId,
    ];
}

function build_square_checkout_reference_id(int $seatRequestId): string
{
    return substr('seatreq-' . $seatRequestId, 0, 40);
}

function build_square_checkout_item_name(array $seatRequest): string
{
    $eventName = trim((string) ($seatRequest['event_artist_name'] ?? $seatRequest['event_title'] ?? ''));
    if ($eventName === '') {
        $eventName = 'Midway Music Hall seat request';
    }
    return substr($eventName, 0, 255);
}

function square_money_amount_from_decimal($amount): int
{
    $normalized = normalize_nullable_decimal($amount);
    if ($normalized === null || (float) $normalized <= 0) {
        throw new RuntimeException('Square amount must be a positive decimal');
    }
    return (int) round($normalized * 100);
}

function square_create_payment_link(array $seatRequest): array
{
    $seatRequestId = (int) ($seatRequest['id'] ?? 0);
    if ($seatRequestId <= 0) {
        throw new RuntimeException('Invalid seat request id');
    }

    $locationId = resolve_square_location_id();
    if ($locationId === null) {
        throw new RuntimeException('Square location id is not configured');
    }

    $currency = normalize_currency_code($seatRequest['currency'] ?? null);
    if ($currency === null) {
        throw new RuntimeException('Square currency is invalid');
    }

    $lineItemName = build_square_checkout_item_name($seatRequest);
    $amountCents = square_money_amount_from_decimal($seatRequest['total_amount'] ?? null);
    $body = [
        'idempotency_key' => hash('sha256', 'square-checkout:' . $seatRequestId . ':' . normalize_nullable_decimal($seatRequest['total_amount'] ?? null) . ':' . $currency),
        'order' => [
            'location_id' => $locationId,
            'reference_id' => build_square_checkout_reference_id($seatRequestId),
            'line_items' => [[
                'name' => $lineItemName,
                'quantity' => '1',
                'base_price_money' => [
                    'amount' => $amountCents,
                    'currency' => $currency,
                ],
            ]],
        ],
        'payment_note' => substr('MMH seat request #' . $seatRequestId, 0, 500),
    ];

    $redirectUrl = resolve_square_checkout_redirect_url();
    if ($redirectUrl !== null) {
        $body['checkout_options'] = [
            'redirect_url' => $redirectUrl,
        ];
    }

    $response = square_api_request('POST', '/v2/online-checkout/payment-links', $body);
    if ($response['status'] < 200 || $response['status'] >= 300) {
        throw new RuntimeException(square_extract_error_message($response['json'] ?? [], 'Square checkout creation failed'));
    }

    $paymentLink = square_payment_link_payload_from_response($response['json']);
    if ($paymentLink === null) {
        throw new RuntimeException('Square checkout response was missing payment link details');
    }

    return $paymentLink;
}

function square_retrieve_payment_link(string $paymentLinkId): ?array
{
    $trimmedId = trim($paymentLinkId);
    if ($trimmedId === '') {
        return null;
    }
    $response = square_api_request('GET', '/v2/online-checkout/payment-links/' . rawurlencode($trimmedId));
    if ($response['status'] === 404) {
        return null;
    }
    if ($response['status'] < 200 || $response['status'] >= 300) {
        throw new RuntimeException(square_extract_error_message($response['json'] ?? [], 'Unable to retrieve Square checkout link'));
    }
    return square_payment_link_payload_from_response($response['json']);
}

function square_delete_payment_link(string $paymentLinkId): bool
{
    $trimmedId = trim($paymentLinkId);
    if ($trimmedId === '') {
        return false;
    }
    $response = square_api_request('DELETE', '/v2/online-checkout/payment-links/' . rawurlencode($trimmedId));
    if (in_array($response['status'], [200, 202, 204, 404], true)) {
        return true;
    }
    throw new RuntimeException(square_extract_error_message($response['json'] ?? [], 'Unable to delete Square checkout link'));
}

function seat_request_has_square_pending_checkout(array $seatRequest): bool
{
    return strtolower(trim((string) ($seatRequest['payment_provider'] ?? ''))) === 'square'
        && seat_request_payment_is_pending_status($seatRequest['payment_status'] ?? null)
        && normalize_nullable_text($seatRequest['payment_capture_id'] ?? null) !== null;
}

function cancel_seat_request_provider_payment_session(array $seatRequest): bool
{
    if (strtolower(trim((string) ($seatRequest['payment_provider'] ?? ''))) !== 'square') {
        return false;
    }
    if (seat_request_payment_is_paid_status($seatRequest['payment_status'] ?? null)) {
        return false;
    }
    $paymentLinkId = normalize_nullable_text($seatRequest['payment_capture_id'] ?? null);
    if ($paymentLinkId === null) {
        return false;
    }
    square_delete_payment_link($paymentLinkId);
    return true;
}

function clear_pending_square_checkout_state(PDO $pdo, int $seatRequestId, array $existing, string $reason = 'request_closed', ?string $updatedBy = null): bool
{
    if (!seat_request_has_square_pending_checkout($existing)) {
        return false;
    }
    try {
        cancel_seat_request_provider_payment_session($existing);
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('clear_pending_square_checkout_state cleanup failure: ' . $error->getMessage());
        }
    }
    apply_seat_request_payment_update($pdo, $seatRequestId, [
        'payment_provider' => null,
        'payment_status' => 'invalidated',
        'payment_order_id' => null,
        'payment_capture_id' => null,
        'updated_by' => $updatedBy ?? 'system',
    ]);
    record_audit('seat_request.square_checkout_cleared', 'seat_request', $seatRequestId, [
        'reason' => $reason,
    ]);
    return true;
}

function square_webhook_signature_is_valid(Request $request): bool
{
    $signatureKey = resolve_square_webhook_signature_key();
    $notificationUrl = resolve_square_webhook_notification_url();
    $signatureHeader = request_header_value($request, 'X-Square-HmacSha256-Signature');
    if ($signatureKey === null || $notificationUrl === null || $signatureHeader === null) {
        return false;
    }
    $expected = base64_encode(hash_hmac('sha256', $notificationUrl . $request->raw(), $signatureKey, true));
    return hash_equals($expected, $signatureHeader);
}

function square_extract_payment_from_webhook(array $payload): ?array
{
    $candidates = [
        $payload['data']['object']['payment'] ?? null,
        $payload['data']['object']['object']['payment'] ?? null,
        $payload['payment'] ?? null,
    ];
    foreach ($candidates as $candidate) {
        if (is_array($candidate)) {
            return $candidate;
        }
    }
    return null;
}

function fetch_payment_settings_rows(PDO $pdo): array
{
    if (!payment_settings_table_exists($pdo)) {
        return [];
    }
    try {
        $sql = "SELECT ps.*, ec.name AS category_name, ec.slug AS category_slug
            FROM payment_settings ps
            LEFT JOIN event_categories ec ON ec.id = ps.category_id
            ORDER BY CASE WHEN ps.scope = 'global' THEN 0 ELSE 1 END, ec.name ASC, ps.id ASC";
        $stmt = $pdo->query($sql);
        $rows = $stmt->fetchAll() ?: [];
        foreach ($rows as &$row) {
            $row['enabled'] = !empty($row['enabled']);
            $row['limit_seats'] = (int) ($row['limit_seats'] ?? 6);
            if ($row['limit_seats'] <= 0) {
                $row['limit_seats'] = 6;
            }
        }
        unset($row);
        return $rows;
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('fetch_payment_settings_rows failure: ' . $error->getMessage());
        }
        return [];
    }
}

function load_payment_settings_lookup(PDO $pdo): array
{
    $lookup = ['global' => null, 'categories' => []];
    if (!payment_settings_table_exists($pdo)) {
        return $lookup;
    }
    try {
        $stmt = $pdo->query('SELECT * FROM payment_settings');
        $rows = $stmt->fetchAll() ?: [];
        foreach ($rows as $row) {
            $row['limit_seats'] = (int) ($row['limit_seats'] ?? 6);
            if ($row['limit_seats'] <= 0) {
                $row['limit_seats'] = 6;
            }
            if (($row['scope'] ?? 'category') === 'global') {
                if ($lookup['global'] === null) {
                    $lookup['global'] = $row;
                }
                continue;
            }
            $categoryId = isset($row['category_id']) ? (int) $row['category_id'] : null;
            if ($categoryId) {
                $lookup['categories'][$categoryId] = $row;
            }
        }
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('load_payment_settings_lookup failure: ' . $error->getMessage());
        }
    }
    return $lookup;
}

function resolve_event_payment_option(array $event, array $lookup): ?array
{
    $paymentEnabled = !empty($event['payment_enabled']);
    if (!$paymentEnabled) {
        return null;
    }
    $categoryId = isset($event['category_id']) ? (int) $event['category_id'] : null;
    $candidate = null;
    if ($categoryId && isset($lookup['categories'][$categoryId])) {
        $candidate = $lookup['categories'][$categoryId];
    }
    if ((!$candidate || empty($candidate['enabled'])) && !empty($lookup['global'])) {
        $candidate = $lookup['global'];
    }
    if (!$candidate || empty($candidate['enabled'])) {
        return null;
    }
    $limitSeats = (int) ($candidate['limit_seats'] ?? 6);
    if ($limitSeats <= 0) {
        $limitSeats = 6;
    }
    $buttonText = trim((string) ($candidate['button_text'] ?? ''));
    if ($buttonText === '') {
        $buttonText = 'Pay Online';
    }
    $providerType = normalize_payment_provider_type($candidate['provider_type'] ?? 'external_link');
    $base = [
        'enabled' => true,
        'scope' => $candidate['scope'] ?? 'category',
        'category_id' => $candidate['category_id'] ?? null,
        'provider_type' => $providerType,
        'supports_dynamic_amount' => in_array($providerType, ['paypal_orders', 'square'], true),
        'provider_label' => $candidate['provider_label'] ?? null,
        'button_text' => $buttonText,
        'limit_seats' => $limitSeats,
        'over_limit_message' => $candidate['over_limit_message'] ?? null,
        'fine_print' => $candidate['fine_print'] ?? null,
        'updated_at' => $candidate['updated_at'] ?? null,
    ];
    if ($providerType === 'paypal_hosted_button') {
        $hostedButtonId = normalize_paypal_hosted_button_id($candidate['paypal_hosted_button_id'] ?? null);
        if (!$hostedButtonId) {
            return null;
        }
        $paypalPayload = [
            'hosted_button_id' => $hostedButtonId,
            'currency' => normalize_paypal_currency($candidate['paypal_currency'] ?? 'USD'),
            'enable_venmo' => !empty($candidate['paypal_enable_venmo']),
        ];
        $sdkClientId = resolve_paypal_sdk_client_id();
        if ($sdkClientId) {
            $paypalPayload['sdk_client_id'] = $sdkClientId;
        }
        $base['paypal'] = $paypalPayload;
        return $base;
    }
    if ($providerType === 'paypal_orders') {
        $base['paypal_orders_enabled'] = true;
        $base['currency'] = normalize_paypal_currency($candidate['paypal_currency'] ?? 'USD');
        return $base;
    }
    if ($providerType === 'square') {
        $base['currency'] = 'USD';
        $base['square_checkout_enabled'] = true;
        return $base;
    }
    $paymentUrl = trim((string) ($candidate['payment_url'] ?? ''));
    if ($paymentUrl === '') {
        return null;
    }
    $base['payment_url'] = $paymentUrl;
    $base['payment_url'] = $paymentUrl;
    return $base;
}

function build_seat_request_payment_summary(array $seatRequest, ?array $paymentOption = null): array
{
    $paymentStatus = normalize_seat_request_payment_status($seatRequest['payment_status'] ?? null);
    $status = normalize_seat_request_status($seatRequest['status'] ?? null);
    $seatCount = isset($seatRequest['total_seats']) && is_numeric($seatRequest['total_seats'])
        ? max(0, (int) $seatRequest['total_seats'])
        : count(parse_selected_seats($seatRequest['selected_seats'] ?? []));
    $amount = normalize_nullable_decimal($seatRequest['total_amount'] ?? null);
    $currency = normalize_currency_code($seatRequest['currency'] ?? null);
    $providerType = $paymentOption ? normalize_payment_provider_type($paymentOption['provider_type'] ?? 'external_link') : null;
    $limitSeats = isset($paymentOption['limit_seats']) && is_numeric($paymentOption['limit_seats'])
        ? max(1, (int) $paymentOption['limit_seats'])
        : 0;
    $paidPendingConfirmation = seat_request_is_paid_pending_confirmation($seatRequest);
    $expiresNormally = in_array($status, open_seat_request_statuses(), true)
        && !empty($seatRequest['hold_expires_at'])
        && !$paidPendingConfirmation;

    $reasonCode = null;
    $reasonMessage = null;
    $canStartPayment = false;
    if (seat_request_is_payment_terminal_status($status)) {
        $reasonCode = 'REQUEST_NOT_OPEN_FOR_PAYMENT';
        $reasonMessage = 'Online payment is not available for this request state.';
    } elseif (seat_request_payment_is_paid_status($paymentStatus)) {
        $reasonCode = 'PAYMENT_ALREADY_COMPLETED';
        $reasonMessage = 'This request has already been paid and is pending staff confirmation.';
    } elseif (seat_request_payment_is_pending_status($paymentStatus)) {
        $reasonCode = 'PAYMENT_ALREADY_IN_PROGRESS';
        $reasonMessage = 'A payment attempt is already in progress for this request.';
    } elseif (!$paymentOption || empty($paymentOption['enabled'])) {
        $reasonCode = 'PAYMENT_NOT_CONFIGURED';
        $reasonMessage = 'Online payment is not configured for this event.';
    } elseif ($providerType === 'square' && !square_provider_is_configured()) {
        $reasonCode = 'PAYMENT_PROVIDER_UNAVAILABLE';
        $reasonMessage = 'Square online payment is not configured right now. Please contact staff for help with payment.';
    } elseif ($amount === null || (float) $amount <= 0) {
        $reasonCode = 'PAYMENT_AMOUNT_INVALID';
        $reasonMessage = 'Online payment is unavailable until this request has a valid total amount.';
    } elseif ($currency === null) {
        $reasonCode = 'PAYMENT_CURRENCY_INVALID';
        $reasonMessage = 'Online payment is unavailable until this request has a valid currency.';
    } elseif ($limitSeats > 0 && $seatCount > $limitSeats) {
        $reasonCode = 'PAYMENT_SEAT_LIMIT_EXCEEDED';
        $reasonMessage = $paymentOption['over_limit_message'] ?? 'Please contact our staff to arrange payment for larger groups.';
    } else {
        $canStartPayment = true;
    }

    return [
        'provider_type' => $providerType,
        'provider_label' => $paymentOption['provider_label'] ?? null,
        'payment_status' => $paymentStatus,
        'total_amount' => $amount,
        'currency' => $currency,
        'seat_count' => $seatCount,
        'limit_seats' => $limitSeats > 0 ? $limitSeats : null,
        'paid_pending_confirmation' => $paidPendingConfirmation,
        'expires_normally' => $expiresNormally,
        'can_offer_payment' => $canStartPayment,
        'can_start_payment' => $canStartPayment,
        'reason_code' => $reasonCode,
        'reason_message' => $reasonMessage,
    ];
}

function hydrate_seat_request_payment_details(array &$row, ?array $paymentOption = null): void
{
    $summary = build_seat_request_payment_summary($row, $paymentOption);
    $row['payment_status_normalized'] = $summary['payment_status'];
    $row['payment_paid_pending_confirmation'] = $summary['paid_pending_confirmation'];
    $row['payment_expires_normally'] = $summary['expires_normally'];
    $row['payment_summary'] = $summary;
}

function load_seat_request_payment_context(PDO $pdo, int $seatRequestId, bool $forUpdate = false): ?array
{
    $paymentEnabledSelect = events_table_has_column($pdo, 'payment_enabled')
        ? 'e.payment_enabled'
        : '0 AS payment_enabled';
    $lockClause = $forUpdate ? ' FOR UPDATE' : '';
    $stmt = $pdo->prepare(
        "SELECT
            sr.*,
            e.category_id,
            e.title AS event_title,
            e.artist_name AS event_artist_name,
            {$paymentEnabledSelect},
            COALESCE(NULLIF(TRIM(e.status), ''), 'draft') AS event_status,
            COALESCE(NULLIF(TRIM(e.visibility), ''), 'private') AS event_visibility
        FROM seat_requests sr
        INNER JOIN events e ON e.id = sr.event_id
        WHERE sr.id = ? LIMIT 1{$lockClause}"
    );
    $stmt->execute([$seatRequestId]);
    $seatRequest = $stmt->fetch();
    if (!$seatRequest) {
        return null;
    }
    $paymentOption = resolve_event_payment_option($seatRequest, load_payment_settings_lookup($pdo));
    hydrate_seat_request_payment_details($seatRequest, $paymentOption);
    return [
        'seat_request' => $seatRequest,
        'payment_option' => $paymentOption,
    ];
}

function apply_seat_request_payment_update(PDO $pdo, int $seatRequestId, array $changes): ?array
{
    $updatableColumns = [];
    if (layout_table_has_column($pdo, 'seat_requests', 'payment_provider') && array_key_exists('payment_provider', $changes)) {
        $updatableColumns['payment_provider'] = normalize_nullable_text($changes['payment_provider']);
    }
    if (layout_table_has_column($pdo, 'seat_requests', 'payment_status') && array_key_exists('payment_status', $changes)) {
        $updatableColumns['payment_status'] = normalize_seat_request_payment_status($changes['payment_status']);
    }
    if (layout_table_has_column($pdo, 'seat_requests', 'payment_order_id') && array_key_exists('payment_order_id', $changes)) {
        $updatableColumns['payment_order_id'] = normalize_nullable_text($changes['payment_order_id']);
    }
    if (layout_table_has_column($pdo, 'seat_requests', 'payment_capture_id') && array_key_exists('payment_capture_id', $changes)) {
        $updatableColumns['payment_capture_id'] = normalize_nullable_text($changes['payment_capture_id']);
    }
    if (!$updatableColumns && !layout_table_has_column($pdo, 'seat_requests', 'payment_updated_at')) {
        return null;
    }

    $fields = [];
    $values = [];
    foreach ($updatableColumns as $field => $value) {
        $fields[] = $field . ' = ?';
        $values[] = $value;
    }
    if (layout_table_has_column($pdo, 'seat_requests', 'payment_updated_at')) {
        $fields[] = 'payment_updated_at = NOW()';
    }
    if (seat_request_payment_is_paid_status($updatableColumns['payment_status'] ?? null)) {
        $fields[] = 'hold_expires_at = NULL';
    }
    $fields[] = 'updated_at = NOW()';
    if (array_key_exists('updated_by', $changes)) {
        $fields[] = 'updated_by = ?';
        $values[] = normalize_nullable_text($changes['updated_by']) ?? 'system';
    }
    $values[] = $seatRequestId;
    $pdo->prepare('UPDATE seat_requests SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($values);

    $fetch = $pdo->prepare('SELECT * FROM seat_requests WHERE id = ? LIMIT 1');
    $fetch->execute([$seatRequestId]);
    return $fetch->fetch() ?: null;
}

function invalidate_seat_request_payment_state(PDO $pdo, int $seatRequestId, array $existing, string $reason = 'amount_changed'): bool
{
    if (!seat_request_has_payment_references($existing)) {
        return false;
    }
    try {
        cancel_seat_request_provider_payment_session($existing);
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('invalidate_seat_request_payment_state cleanup failure: ' . $error->getMessage());
        }
    }
    apply_seat_request_payment_update($pdo, $seatRequestId, [
        'payment_provider' => null,
        'payment_status' => 'invalidated',
        'payment_order_id' => null,
        'payment_capture_id' => null,
        'updated_by' => seat_request_admin_actor(),
    ]);
    record_audit('seat_request.payment_invalidated', 'seat_request', $seatRequestId, [
        'reason' => $reason,
    ]);
    return true;
}

function fetch_event_for_seat_request_pricing(PDO $pdo, int $eventId): ?array
{
    $hasPricingConfigColumn = events_table_has_column($pdo, 'pricing_config');
    $pricingSelect = $hasPricingConfigColumn ? ', pricing_config' : '';
    $stmt = $pdo->prepare(
        'SELECT id, layout_id, layout_version_id, seating_enabled, ticket_price, door_price, min_ticket_price, max_ticket_price' . $pricingSelect . ' FROM events WHERE id = ? LIMIT 1'
    );
    $stmt->execute([$eventId]);
    return $stmt->fetch() ?: null;
}

function recompute_seat_request_amount_for_event(PDO $pdo, int $eventId, array $selectedSeats, ?string &$failureReason = null): array
{
    $failureReason = null;
    $event = fetch_event_for_seat_request_pricing($pdo, $eventId);
    if (!$event) {
        throw new RuntimeException('Event not found');
    }
    [$layoutRowsForPricing] = fetch_layout_for_event($eventId);
    $totalAmount = resolve_seat_request_total_amount($event, $selectedSeats, $layoutRowsForPricing, $failureReason);
    return [
        'total_amount' => $totalAmount,
        'currency' => 'USD',
    ];
}

function seat_request_payment_start_error_http_status(?string $reasonCode): int
{
    switch ($reasonCode) {
        case 'PAYMENT_AMOUNT_INVALID':
        case 'PAYMENT_CURRENCY_INVALID':
            return 422;
        case 'PAYMENT_PROVIDER_UNAVAILABLE':
            return 503;
        case 'PAYMENT_NOT_CONFIGURED':
        case 'REQUEST_NOT_OPEN_FOR_PAYMENT':
        case 'PAYMENT_ALREADY_COMPLETED':
        case 'PAYMENT_ALREADY_IN_PROGRESS':
        case 'PAYMENT_SEAT_LIMIT_EXCEEDED':
        default:
            return 409;
    }
}

function validate_seat_request_payment_context_for_start(array $seatRequest): ?array
{
    $eventStatus = strtolower(trim((string) ($seatRequest['event_status'] ?? 'draft')));
    $eventVisibility = strtolower(trim((string) ($seatRequest['event_visibility'] ?? 'private')));
    if ($eventStatus !== 'published' || $eventVisibility !== 'public') {
        return [
            'http_status' => 409,
            'code' => 'EVENT_NOT_PUBLIC_FOR_PAYMENT',
            'message' => 'Payment is only available for published public events.',
        ];
    }
    $summary = $seatRequest['payment_summary'] ?? build_seat_request_payment_summary($seatRequest);
    if (!empty($summary['can_start_payment'])) {
        return null;
    }
    return [
        'http_status' => seat_request_payment_start_error_http_status($summary['reason_code'] ?? null),
        'code' => $summary['reason_code'] ?? 'PAYMENT_NOT_AVAILABLE',
        'message' => $summary['reason_message'] ?? 'Payment is not available for this request.',
    ];
}

function event_seating_snapshots_table_exists(PDO $pdo): bool
{
    static $exists = null;
    if ($exists !== null) {
        return $exists;
    }
    try {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?');
        $stmt->execute(['event_seating_snapshots']);
        $exists = (int) $stmt->fetchColumn() > 0;
    } catch (Throwable $error) {
        $exists = false;
        if (APP_DEBUG) {
            error_log('event_seating_snapshots_table_exists failure: ' . $error->getMessage());
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
        $candidate = normalize_existing_upload_url($url);
        if ($candidate) {
            $normalized[] = $candidate;
        }
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
    $normalized = normalize_existing_upload_url($fileUrl);
    if (!$normalized) {
        return null;
    }
    $variants = build_image_variants([$normalized]);
    if (!empty($variants)) {
        return $variants[0];
    }
    $derived = derive_variant_paths_from_disk($normalized);
    return [
        'file_url' => $normalized,
        'original' => $derived['original'] ?? $normalized,
        'optimized' => $derived['optimized'] ?? null,
        'webp' => $derived['webp'] ?? null,
        'optimized_srcset' => $derived['optimized_srcset'] ?? null,
        'webp_srcset' => $derived['webp_srcset'] ?? null,
        'fallback_original' => $derived['fallback_original'] ?? $normalized,
    ];
}

function normalize_event_image_urls(array &$rows): array
{
    $imageLookup = [];
    $imageUrls = [];
    foreach ($rows as $index => $row) {
        $imageUrl = trim((string) ($row['image_url'] ?? ''));
        if ($imageUrl === '') {
            continue;
        }
        $normalizedUrl = normalize_existing_upload_url($imageUrl);
        if ($normalizedUrl) {
            $rows[$index]['image_url'] = $normalizedUrl;
            $imageUrls[] = $normalizedUrl;
        } else {
            $rows[$index]['image_url'] = null;
        }
    }
    if (!$imageUrls) {
        return $imageLookup;
    }
    $variants = build_image_variants($imageUrls);
    foreach ($variants as $variant) {
        $key = $variant['file_url'] ?? $variant['original'] ?? null;
        if ($key) {
            $imageLookup[$key] = $variant;
        }
    }
    return $imageLookup;
}

function load_media_assets_by_ids(array $ids): array
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids), function ($value) {
        return $value > 0;
    })));
    if (empty($ids)) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $map = [];
    try {
        $stmt = Database::run("SELECT * FROM media WHERE id IN ({$placeholders})", $ids);
        while ($row = $stmt->fetch()) {
            $id = (int) ($row['id'] ?? 0);
            if ($id <= 0) {
                continue;
            }
            $variant = build_single_image_variant($row['file_url'] ?? null);
            $map[$id] = [
                'id' => $id,
                'file_url' => $row['file_url'] ?? null,
                'width' => $row['width'] ?? null,
                'height' => $row['height'] ?? null,
                'alt_text' => $row['alt_text'] ?? null,
                'caption' => $row['caption'] ?? null,
                'variant' => $variant,
            ];
        }
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('load_media_assets_by_ids failure: ' . $error->getMessage());
        }
    }
    return $map;
}

function build_image_bundle(?array $variant, array $meta): ?array
{
    if (!$variant) {
        return null;
    }
    return [
        'variant' => $variant,
        'meta' => $meta,
    ];
}

function format_effective_image_payload(array $variant, array $meta): array
{
    $fileUrl = $meta['file_url'] ?? $variant['original'] ?? $variant['fallback_original'] ?? null;
    $resolved = $variant['webp'] ?? $variant['optimized'] ?? $fileUrl ?? $variant['fallback_original'] ?? null;
    return [
        'source' => $meta['source'] ?? 'unknown',
        'media_id' => $meta['media_id'] ?? null,
        'file_url' => $fileUrl,
        'optimized_url' => $variant['optimized'] ?? null,
        'webp_url' => $variant['webp'] ?? null,
        'optimized_srcset' => $variant['optimized_srcset'] ?? null,
        'webp_srcset' => $variant['webp_srcset'] ?? null,
        'fallback_url' => $variant['fallback_original'] ?? null,
        'src' => $resolved,
        'width' => $meta['width'] ?? ($variant['intrinsic_width'] ?? null),
        'height' => $meta['height'] ?? ($variant['intrinsic_height'] ?? null),
        'alt_text' => $meta['alt_text'] ?? null,
        'caption' => $meta['caption'] ?? null,
    ];
}

function build_media_bundle_for_event(array $row, array $mediaAssets, string $columnKey, string $sourceLabel): ?array
{
    $id = isset($row[$columnKey]) ? (int) $row[$columnKey] : 0;
    if ($id <= 0 || empty($mediaAssets[$id]['variant'])) {
        return null;
    }
    $asset = $mediaAssets[$id];
    return build_image_bundle($asset['variant'], [
        'source' => $sourceLabel,
        'media_id' => $asset['id'],
        'file_url' => $asset['file_url'],
        'width' => $asset['width'],
        'height' => $asset['height'],
        'alt_text' => $asset['alt_text'],
        'caption' => $asset['caption'],
    ]);
}

function build_legacy_image_bundle(array $row, array $imageLookup): ?array
{
    $imageUrl = trim((string) ($row['image_url'] ?? ''));
    if ($imageUrl === '' || !isset($imageLookup[$imageUrl])) {
        return null;
    }
    return build_image_bundle($imageLookup[$imageUrl], [
        'source' => 'event_image_url',
        'file_url' => $imageUrl,
        'width' => $row['image_intrinsic_width'] ?? null,
        'height' => $row['image_intrinsic_height'] ?? null,
    ]);
}

function build_default_image_bundle(?array $variant, ?string $fileUrl): ?array
{
    if (!$variant) {
        return null;
    }
    return build_image_bundle($variant, [
        'source' => 'default_setting',
        'file_url' => $fileUrl,
    ]);
}

function enrich_event_rows_with_images(array $rows): array
{
    if (!$rows) {
        return $rows;
    }
    $imageLookup = normalize_event_image_urls($rows);
    $mediaIds = [];
    foreach ($rows as $row) {
        $heroId = isset($row['hero_image_id']) ? (int) $row['hero_image_id'] : 0;
        $posterId = isset($row['poster_image_id']) ? (int) $row['poster_image_id'] : 0;
        if ($heroId > 0) {
            $mediaIds[$heroId] = true;
        }
        if ($posterId > 0) {
            $mediaIds[$posterId] = true;
        }
    }
    $mediaAssets = load_media_assets_by_ids(array_keys($mediaIds));
    $settings = fetch_business_settings();
    $defaultUrl = normalize_existing_upload_url($settings['default_event_image'] ?? '');
    $defaultVariant = $defaultUrl ? build_single_image_variant($defaultUrl) : null;

    foreach ($rows as &$row) {
        $heroBundle = build_media_bundle_for_event($row, $mediaAssets, 'hero_image_id', 'hero_media');
        $posterBundle = build_media_bundle_for_event($row, $mediaAssets, 'poster_image_id', 'poster_media');
        $legacyBundle = build_legacy_image_bundle($row, $imageLookup);
        $defaultBundle = build_default_image_bundle($defaultVariant, $defaultUrl);

        $row['hero_image_media'] = $heroBundle ? format_effective_image_payload($heroBundle['variant'], $heroBundle['meta']) : null;
        $row['poster_image_media'] = $posterBundle ? format_effective_image_payload($posterBundle['variant'], $posterBundle['meta']) : null;

        $chosen = $heroBundle ?? $posterBundle ?? $legacyBundle ?? $defaultBundle;
        if ($chosen) {
            $variant = $chosen['variant'];
            $meta = $chosen['meta'];
            $row['image_variants'] = $variant;
            $row['image_variant_source'] = $meta['source'] ?? null;
            $row['resolved_image_url'] = $variant['webp'] ?? $variant['optimized'] ?? $variant['original'] ?? $variant['fallback_original'] ?? null;
            $row['image_webp_srcset'] = $variant['webp_srcset'] ?? null;
            $row['image_optimized_srcset'] = $variant['optimized_srcset'] ?? null;
            $row['image_intrinsic_width'] = $meta['width'] ?? ($variant['intrinsic_width'] ?? null);
            $row['image_intrinsic_height'] = $meta['height'] ?? ($variant['intrinsic_height'] ?? null);
            $row['effective_image'] = format_effective_image_payload($variant, $meta);
        } else {
            $row['image_variants'] = null;
            $row['image_variant_source'] = null;
            $row['resolved_image_url'] = null;
            $row['image_webp_srcset'] = null;
            $row['image_optimized_srcset'] = null;
            $row['image_intrinsic_width'] = $row['image_intrinsic_width'] ?? null;
            $row['image_intrinsic_height'] = $row['image_intrinsic_height'] ?? null;
            $row['effective_image'] = null;
        }
    }
    unset($row);

    return $rows;
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
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_regenerate_id(true);
    }
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

function is_admin_session_authenticated(): bool
{
    $session = current_admin_session();
    return $session && !empty($session['user']);
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

function admin_login_client_ip(): string
{
    $remoteAddr = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    return $remoteAddr !== '' ? $remoteAddr : 'unknown';
}

function admin_login_throttle_identifier(string $identifier): string
{
    $normalized = strtolower(trim($identifier));
    return $normalized !== '' ? $normalized : '_blank';
}

function admin_login_ip_bucket_identifier(): string
{
    return '__ip_only__';
}

function admin_login_throttle_retention_seconds(): int
{
    $backoffSteps = defined('ADMIN_LOGIN_THROTTLE_BACKOFF_SECONDS') && is_array(ADMIN_LOGIN_THROTTLE_BACKOFF_SECONDS)
        ? array_map('intval', ADMIN_LOGIN_THROTTLE_BACKOFF_SECONDS)
        : [30, 120, 600];
    $maxBackoff = 0;
    foreach ($backoffSteps as $step) {
        $maxBackoff = max($maxBackoff, (int) $step);
    }
    return max(3600, ADMIN_LOGIN_THROTTLE_WINDOW_SECONDS + ($maxBackoff * 2));
}

function prune_admin_login_throttle_storage(): void
{
    static $pruned = false;
    if ($pruned || !is_dir(ADMIN_LOGIN_THROTTLE_DIR)) {
        return;
    }
    $pruned = true;
    $cutoff = time() - admin_login_throttle_retention_seconds();
    foreach (glob(rtrim(ADMIN_LOGIN_THROTTLE_DIR, '/') . '/*.json') ?: [] as $path) {
        if (!is_string($path) || !is_file($path)) {
            continue;
        }
        $modifiedAt = (int) (@filemtime($path) ?: 0);
        if ($modifiedAt > 0 && $modifiedAt < $cutoff) {
            @unlink($path);
        }
    }
}

function admin_login_throttle_file(string $identifier, ?string $clientIp = null): string
{
    $clientIp = $clientIp ?? admin_login_client_ip();
    $key = hash('sha256', admin_login_throttle_identifier($identifier) . '|' . $clientIp);
    return rtrim(ADMIN_LOGIN_THROTTLE_DIR, '/') . '/' . $key . '.json';
}

function read_admin_login_throttle_state(string $identifier, ?string $clientIp = null): array
{
    prune_admin_login_throttle_storage();
    $path = admin_login_throttle_file($identifier, $clientIp);
    if (!is_file($path)) {
        return ['failures' => [], 'blocked_until' => 0];
    }
    $decoded = json_decode((string) @file_get_contents($path), true);
    if (!is_array($decoded)) {
        return ['failures' => [], 'blocked_until' => 0];
    }
    $failures = array_values(array_filter(array_map('intval', (array) ($decoded['failures'] ?? [])), static fn (int $timestamp): bool => $timestamp > 0));
    sort($failures, SORT_NUMERIC);
    return [
        'failures' => $failures,
        'blocked_until' => max(0, (int) ($decoded['blocked_until'] ?? 0)),
    ];
}

function write_admin_login_throttle_state(string $identifier, array $state, ?string $clientIp = null): void
{
    $path = admin_login_throttle_file($identifier, $clientIp);
    $payload = [
        'failures' => array_values(array_map('intval', (array) ($state['failures'] ?? []))),
        'blocked_until' => max(0, (int) ($state['blocked_until'] ?? 0)),
    ];
    @file_put_contents($path, json_encode($payload, JSON_PRETTY_PRINT), LOCK_EX);
}

function prune_admin_login_failures(array $failures, int $now): array
{
    $windowStart = $now - ADMIN_LOGIN_THROTTLE_WINDOW_SECONDS;
    return array_values(array_filter($failures, static fn (int $timestamp): bool => $timestamp >= $windowStart));
}

function admin_login_throttle_status(string $identifier, ?string $clientIp = null): array
{
    $now = time();
    $state = read_admin_login_throttle_state($identifier, $clientIp);
    $failures = prune_admin_login_failures($state['failures'] ?? [], $now);
    $blockedUntil = max(0, (int) ($state['blocked_until'] ?? 0));
    if ($blockedUntil > 0 && $blockedUntil <= $now) {
        $blockedUntil = 0;
    }
    if ($failures !== ($state['failures'] ?? []) || $blockedUntil !== (int) ($state['blocked_until'] ?? 0)) {
        write_admin_login_throttle_state($identifier, [
            'failures' => $failures,
            'blocked_until' => $blockedUntil,
        ], $clientIp);
    }
    return [
        'failures' => $failures,
        'blocked_until' => $blockedUntil,
        'retry_after_seconds' => $blockedUntil > $now ? ($blockedUntil - $now) : 0,
    ];
}

function record_admin_login_failure(string $identifier, ?string $clientIp = null, ?int $maxFailures = null): array
{
    $now = time();
    $status = admin_login_throttle_status($identifier, $clientIp);
    $failures = $status['failures'];
    $failures[] = $now;
    $failures = prune_admin_login_failures($failures, $now);
    $limit = max(1, (int) ($maxFailures ?? ADMIN_LOGIN_THROTTLE_MAX_FAILURES));

    $blockedUntil = max(0, (int) ($status['blocked_until'] ?? 0));
    if (count($failures) > $limit) {
        $overflow = count($failures) - $limit;
        $steps = defined('ADMIN_LOGIN_THROTTLE_BACKOFF_SECONDS') && is_array(ADMIN_LOGIN_THROTTLE_BACKOFF_SECONDS)
            ? ADMIN_LOGIN_THROTTLE_BACKOFF_SECONDS
            : [30, 120, 600];
        $stepIndex = min(count($steps) - 1, max(0, $overflow - 1));
        $blockedUntil = max($blockedUntil, $now + (int) $steps[$stepIndex]);
    }

    write_admin_login_throttle_state($identifier, [
        'failures' => $failures,
        'blocked_until' => $blockedUntil,
    ], $clientIp);

    return [
        'failures' => $failures,
        'blocked_until' => $blockedUntil,
        'retry_after_seconds' => $blockedUntil > $now ? ($blockedUntil - $now) : 0,
    ];
}

function clear_admin_login_failures(string $identifier, ?string $clientIp = null): void
{
    $path = admin_login_throttle_file($identifier, $clientIp);
    if (is_file($path)) {
        @unlink($path);
    }
}

function combined_admin_login_throttle_status(string $identifier, ?string $clientIp = null): array
{
    $identifierStatus = admin_login_throttle_status($identifier, $clientIp);
    $ipStatus = admin_login_throttle_status(admin_login_ip_bucket_identifier(), $clientIp);
    $retryAfter = max((int) ($identifierStatus['retry_after_seconds'] ?? 0), (int) ($ipStatus['retry_after_seconds'] ?? 0));
    return [
        'retry_after_seconds' => $retryAfter,
        'identifier' => $identifierStatus,
        'ip' => $ipStatus,
    ];
}

function request_header_value(Request $request, string $headerName): ?string
{
    foreach ($request->headers as $name => $value) {
        if (strcasecmp((string) $name, $headerName) !== 0) {
            continue;
        }
        if (is_array($value)) {
            $value = implode(', ', array_map('strval', $value));
        }
        $trimmed = trim((string) $value);
        if ($trimmed !== '') {
            return $trimmed;
        }
    }
    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $headerName));
    $serverValue = trim((string) ($_SERVER[$serverKey] ?? ''));
    return $serverValue !== '' ? $serverValue : null;
}

function normalize_origin_url(?string $value): ?string
{
    if (!is_string($value)) {
        return null;
    }
    $trimmed = trim($value);
    if ($trimmed === '') {
        return null;
    }
    $parts = parse_url($trimmed);
    if (!is_array($parts)) {
        return null;
    }
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    $host = strtolower((string) ($parts['host'] ?? ''));
    if ($scheme === '' || $host === '' || !in_array($scheme, ['http', 'https'], true)) {
        return null;
    }
    $port = isset($parts['port']) ? (int) $parts['port'] : null;
    $hasNonDefaultPort = $port !== null
        && !(($scheme === 'http' && $port === 80) || ($scheme === 'https' && $port === 443));
    return $scheme . '://' . $host . ($hasNonDefaultPort ? ':' . $port : '');
}

function resolve_request_origin(Request $request): ?string
{
    $origin = normalize_origin_url(request_header_value($request, 'Origin'));
    if ($origin !== null) {
        return $origin;
    }
    $referer = request_header_value($request, 'Referer');
    return normalize_origin_url($referer);
}

function trusted_admin_origins(): array
{
    static $cached = null;
    if (is_array($cached)) {
        return $cached;
    }

    $origins = [];
    $configuredOrigins = Env::get(
        'CORS_ALLOW_ORIGINS',
        Env::get('CORS_ALLOW_ORIGIN', DEFAULT_TRUSTED_WEB_ORIGINS)
    );
    foreach (explode(',', (string) $configuredOrigins) as $candidate) {
        $normalized = normalize_origin_url($candidate);
        if ($normalized !== null) {
            $origins[$normalized] = true;
        }
    }

    $cached = array_keys($origins);
    return $cached;
}

function admin_csrf_origin_is_valid(Request $request): bool
{
    if (PHP_SAPI === 'cli') {
        return true;
    }

    $requestOrigin = resolve_request_origin($request);
    if ($requestOrigin === null) {
        if (APP_DEBUG) {
            error_log('CSRF check failed: missing Origin/Referer header.');
        }
        return false;
    }

    foreach (trusted_admin_origins() as $trustedOrigin) {
        if (strcasecmp($requestOrigin, $trustedOrigin) === 0) {
            return true;
        }
    }

    if (APP_DEBUG) {
        error_log('CSRF check failed: untrusted origin ' . $requestOrigin);
    }
    return false;
}

function request_method_is_read_only(Request $request): bool
{
    $method = strtoupper((string) ($request->method ?? 'GET'));
    return in_array($method, ['GET', 'HEAD', 'OPTIONS'], true);
}

function normalized_request_path(Request $request): string
{
    $path = '/' . trim((string) ($request->path ?? '/'), '/');
    return $path === '' ? '/' : $path;
}

function route_requires_admin_session(Request $request): bool
{
    $method = strtoupper((string) ($request->method ?? 'GET'));
    $path = normalized_request_path($request);

    if (!str_starts_with($path, '/api/')) {
        return false;
    }

    if (in_array($path, ['/api/health', '/api/login', '/api/logout', '/api/session', '/api/session/refresh', '/api/public/events', '/api/site-content'], true)) {
        return false;
    }

    if ($path === '/api/settings') {
        return $method !== 'GET';
    }

    if ($path === '/api/events' && $method === 'GET') {
        $scope = strtolower(trim((string) ($request->query['scope'] ?? 'public')));
        return $scope !== '' && $scope !== 'public';
    }

    if (preg_match('#^/api/events/[^/]+\.ics$#', $path)) {
        return false;
    }
    if ($path === '/api/events' || str_starts_with($path, '/api/events/')) {
        return true;
    }

    if ($path === '/api/debug/schema-check') {
        return true;
    }

    if (str_starts_with($path, '/api/admin/')) {
        return true;
    }

    if ($path === '/api/audit-log' || $path === '/api/dashboard-stats') {
        return true;
    }

    if ($path === '/api/upload-image') {
        return true;
    }

    if (preg_match('#^/api/event-categories(?:/|$)#', $path)) {
        return true;
    }

    if (preg_match('#^/api/media(?:/|$)#', $path)) {
        return true;
    }

    if (preg_match('#^/api/suggestions(?:/|$)#', $path)) {
        return $method !== 'POST';
    }

    if (preg_match('#^/api/seating/event/[^/]+$#', $path)) {
        return false;
    }
    if ($path === '/api/seating-layouts/default') {
        return false;
    }
    if (preg_match('#^/api/seating(?:/|$)#', $path)) {
        return true;
    }
    if (preg_match('#^/api/seating-layouts(?:/|$)#', $path)) {
        return true;
    }
    if (preg_match('#^/api/layout-history(?:/|$)#', $path)) {
        return true;
    }
    if (preg_match('#^/api/stage-settings(?:/|$)#', $path)) {
        return true;
    }

    if (preg_match('#^/api/recurrence-exceptions(?:/|$)#', $path)) {
        return true;
    }

    if (preg_match('#^/api/seat-requests(?:/|$)#', $path)) {
        if ($path === '/api/seat-requests' && $method === 'POST') {
            return false;
        }
        if ($method === 'POST' && preg_match('#^/api/seat-requests/[^/]+/payment/(start|create-order|capture)$#', $path)) {
            return false;
        }
        return true;
    }

    return false;
}

function enforce_admin_route_guard(Request $request): bool
{
    if (!route_requires_admin_session($request)) {
        return true;
    }

    if (!is_admin_session_authenticated()) {
        Response::error('Unauthorized', 401);
        return false;
    }

    if (!request_method_is_read_only($request) && !admin_csrf_origin_is_valid($request)) {
        Response::error('Forbidden', 403);
        return false;
    }

    return true;
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
    $start = resolve_event_start_datetime($event);
    if ($end) {
        try {
            $endDt = new DateTimeImmutable($end, $tz);
            if ($start && $endDt < $start) {
                $endDt = null;
            }
            if ($endDt) {
                return $endDt;
            }
        } catch (Throwable $e) {
            // fall through
        }
    }
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

function format_event_occurrence_summary(array $event, int $limit = 4): ?string
{
    $occurrences = [];
    if (!empty($event['occurrences']) && is_array($event['occurrences'])) {
        $occurrences = $event['occurrences'];
    } elseif (!empty($event['id'])) {
        try {
            $occurrences = resolve_event_occurrences_for_event(Database::connection(), $event);
        } catch (Throwable $error) {
            $occurrences = [];
        }
    }
    if (count($occurrences) <= 1) {
        return null;
    }
    $labels = [];
    $timeZone = new DateTimeZone('America/New_York');
    foreach (array_slice($occurrences, 0, max(1, $limit)) as $occurrence) {
        $occurrenceEvent = [
            'start_datetime' => $occurrence['start_datetime'] ?? null,
            'event_date' => $occurrence['event_date'] ?? $occurrence['occurrence_date'] ?? null,
            'event_time' => $occurrence['event_time'] ?? $occurrence['start_time'] ?? null,
            'timezone' => $event['timezone'] ?? 'America/New_York',
        ];
        $start = resolve_event_start_datetime($occurrenceEvent);
        if ($start instanceof DateTimeInterface) {
            $labels[] = $start->setTimezone($timeZone)->format('D, M j g:i A T');
        }
    }
    if (!$labels) {
        return null;
    }
    $suffix = count($occurrences) > count($labels) ? ' +' . (count($occurrences) - count($labels)) . ' more' : '';
    return implode(' | ', $labels) . $suffix;
}

function format_event_datetime_for_email(array $event): string
{
    $occurrenceSummary = format_event_occurrence_summary($event, 4);
    if ($occurrenceSummary !== null) {
        return $occurrenceSummary;
    }
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

function escape_email_html(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function build_email_detail_table(array $rows): string
{
    $html = '';
    foreach ($rows as $row) {
        if (!is_array($row) || count($row) < 2) {
            continue;
        }
        [$label, $value] = $row;
        $labelText = escape_email_html((string) $label);
        $valueText = escape_email_html((string) $value);
        $html .= '<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:600;width:36%;">' . $labelText . '</td>';
        $html .= '<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#0f172a;">' . $valueText . '</td></tr>';
    }
    if ($html === '') {
        return '';
    }
    return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">' . $html . '</table>';
}

function build_seat_request_email_html(string $headline, array $introLines, array $detailRows, array $footerLines): string
{
    $introHtml = '';
    foreach ($introLines as $line) {
        $introHtml .= '<p style="margin:0 0 8px 0;">' . escape_email_html((string) $line) . '</p>';
    }
    $detailTable = build_email_detail_table($detailRows);
    $footerHtml = '';
    foreach ($footerLines as $line) {
        $footerHtml .= '<p style="margin:0 0 6px 0;color:#475569;font-size:14px;">' . escape_email_html((string) $line) . '</p>';
    }

    return '<div style="font-family:Arial, sans-serif;background-color:#f8fafc;padding:24px;">'
        . '<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">'
        . '<div style="background:#0f2d3f;color:#ffffff;padding:18px 20px;">'
        . '<p style="margin:0;font-size:18px;font-weight:700;letter-spacing:0.2px;">Midway Music Hall &amp; Event Center</p>'
        . '<p style="margin:6px 0 0 0;font-size:14px;opacity:0.9;">' . escape_email_html($headline) . '</p>'
        . '</div>'
        . '<div style="padding:20px;color:#0f172a;font-size:15px;line-height:1.5;">'
        . $introHtml
        . ($detailTable !== '' ? '<div style="margin:16px 0;">' . $detailTable . '</div>' : '')
        . $footerHtml
        . '</div>'
        . '</div>'
        . '</div>';
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
    $customerEmail = isset($seatRequest['customer_email']) ? trim((string) $seatRequest['customer_email']) : '';
    if ($customerEmail && !filter_var($customerEmail, FILTER_VALIDATE_EMAIL)) {
        $customerEmail = '';
    }

    if ($customerEmail === '') {
        return;
    }

    $seatList = build_display_seat_list($seatRequest);
    $seatCount = count($seatList);
    $seatSummary = $seatCount ? implode(', ', $seatList) : 'None provided';
    $notes = trim((string) ($seatRequest['special_requests'] ?? ''));
    $notes = $notes !== '' ? $notes : 'None provided';
    $holdExpires = '';
    if (!empty($seatRequest['hold_expires_at'])) {
        try {
            $holdDate = new DateTimeImmutable($seatRequest['hold_expires_at'], new DateTimeZone('America/New_York'));
            $holdExpires = format_datetime_eastern($holdDate);
        } catch (Throwable $e) {
            $holdExpires = '';
        }
    }
    $requestId = $seatRequest['id'] ?? 'n/a';
    $customerPhone = trim((string) ($seatRequest['customer_phone'] ?? ''));
    $customerName = trim((string) ($seatRequest['customer_name'] ?? ''));
    $customerPhoneLine = $customerPhone !== '' ? $customerPhone : 'Not provided';
    [$staffInbox] = determine_seat_request_recipient($event);

    $customerGreeting = $customerName !== '' ? $customerName : 'there';
    $detailRows = [
        ['Event', $eventTitle],
        ['Event Date/Time (ET)', $eventDate],
        ['Seats Requested (' . $seatCount . ')', $seatSummary],
        ['Notes', $notes],
        ['Phone', $customerPhoneLine],
        ['Request ID', $requestId],
    ];
    if ($holdExpires !== '') {
        $detailRows[] = ['Hold Expires (ET)', $holdExpires];
    }
    $customerBody = build_seat_request_email_html(
        'Seat request received',
        [
            'Hi ' . $customerGreeting . ',',
            'Thanks for reaching out to Midway Music Hall & Event Center. We received your seat request on ' . $timestamp . '.',
            'Your request is pending staff confirmation.',
        ],
        $detailRows,
        [
            'Our team will review your request and follow up with availability and next steps.',
            'If you need to update your request, reply to this email or contact us at ' . $staffInbox . '.',
        ]
    );

    try {
        $emailer->send([
            'to' => $customerEmail,
            'from' => $emailer->notificationsSender(),
            'subject' => 'Seat Request Received - ' . $eventTitle,
            'body' => $customerBody,
            'reply_to' => $staffInbox,
            'content_type' => 'text/html',
        ]);
    } catch (Throwable $sendError) {
        error_log('[email] Seat request customer confirmation failed: ' . $sendError->getMessage());
    }
}

function notify_seat_request_confirmed_email(array $seatRequest, array $event): bool
{
    try {
        $emailer = Emailer::instance();
    } catch (Throwable $error) {
        error_log('[email] Failed to initialize emailer for seat request confirmation: ' . $error->getMessage());
        return false;
    }

    $customerEmail = isset($seatRequest['customer_email']) ? trim((string) $seatRequest['customer_email']) : '';
    if ($customerEmail === '' || !filter_var($customerEmail, FILTER_VALIDATE_EMAIL)) {
        return false;
    }

    $eventTitle = trim((string) ($event['title'] ?? ''));
    if ($eventTitle === '') {
        $eventTitle = trim((string) ($event['artist_name'] ?? 'Midway Music Hall Event'));
    }
    if ($eventTitle === '') {
        $eventTitle = 'Midway Music Hall Event';
    }
    $eventDate = format_event_datetime_for_email($event);
    $seatList = build_display_seat_list($seatRequest);
    $seatCount = count($seatList);
    $seatSummary = $seatCount ? implode(', ', $seatList) : 'None provided';
    $customerName = trim((string) ($seatRequest['customer_name'] ?? ''));
    $customerGreeting = $customerName !== '' ? $customerName : 'there';
    [$staffInbox] = determine_seat_request_recipient($event);
    $requestId = $seatRequest['id'] ?? 'n/a';

    $detailRows = [
        ['Event', $eventTitle],
        ['Event Date/Time (ET)', $eventDate],
        ['Seats Confirmed (' . $seatCount . ')', $seatSummary],
        ['Request ID', $requestId],
    ];

    $customerBody = build_seat_request_email_html(
        'Seat request confirmed',
        [
            'Hi ' . $customerGreeting . ',',
            'Good news - your seats are confirmed for ' . $eventTitle . '.',
        ],
        $detailRows,
        [
            'If you need to make changes, reply to this email or contact us at ' . $staffInbox . '.',
            'Thank you for choosing Midway Music Hall & Event Center.',
        ]
    );

    try {
        $emailer->send([
            'to' => $customerEmail,
            'from' => $emailer->notificationsSender(),
            'subject' => 'Seat Request Confirmed - ' . $eventTitle,
            'body' => $customerBody,
            'reply_to' => $staffInbox,
            'content_type' => 'text/html',
        ]);
        return true;
    } catch (Throwable $sendError) {
        error_log('[email] Seat request confirmation email failed: ' . $sendError->getMessage());
        return false;
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

function seat_request_payment_status_aliases(): array
{
    return [
        'pending' => 'pending',
        'processing' => 'pending',
        'started' => 'pending',
        'created' => 'pending',
        'authorized' => 'pending',
        'approved' => 'pending',
        'paid' => 'paid',
        'captured' => 'paid',
        'completed' => 'paid',
        'succeeded' => 'paid',
        'settled' => 'paid',
        'failed' => 'failed',
        'declined' => 'failed',
        'refunded' => 'refunded',
        'cancelled' => 'cancelled',
        'canceled' => 'cancelled',
        'voided' => 'cancelled',
        'invalidated' => 'invalidated',
        'stale' => 'invalidated',
    ];
}

function normalize_seat_request_payment_status(?string $status): ?string
{
    if ($status === null) {
        return null;
    }
    $normalized = strtolower(trim($status));
    if ($normalized === '') {
        return null;
    }
    $map = seat_request_payment_status_aliases();
    return $map[$normalized] ?? $normalized;
}

function seat_request_payment_is_paid_status(?string $status): bool
{
    return normalize_seat_request_payment_status($status) === 'paid';
}

function seat_request_payment_is_pending_status(?string $status): bool
{
    return normalize_seat_request_payment_status($status) === 'pending';
}

function seat_request_payment_blocks_expiration(?string $status): bool
{
    return seat_request_payment_is_paid_status($status);
}

function seat_request_has_payment_references(array $row): bool
{
    foreach (['payment_provider', 'payment_status', 'payment_order_id', 'payment_capture_id', 'payment_updated_at'] as $field) {
        if (!array_key_exists($field, $row)) {
            continue;
        }
        $value = $row[$field];
        if (is_string($value)) {
            if (trim($value) !== '') {
                return true;
            }
            continue;
        }
        if ($value !== null) {
            return true;
        }
    }
    return false;
}

function seat_request_is_payment_terminal_status(?string $status): bool
{
    return in_array(normalize_seat_request_status($status), ['confirmed', 'declined', 'closed', 'spam', 'expired'], true);
}

function seat_request_is_paid_pending_confirmation(array $row): bool
{
    return !seat_request_is_payment_terminal_status($row['status'] ?? null)
        && seat_request_payment_is_paid_status($row['payment_status'] ?? null);
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
    $hasPaymentStatus = layout_table_has_column($pdo, 'seat_requests', 'payment_status');
    $hasPaymentProvider = layout_table_has_column($pdo, 'seat_requests', 'payment_provider');
    $hasPaymentOrderId = layout_table_has_column($pdo, 'seat_requests', 'payment_order_id');
    $hasPaymentCaptureId = layout_table_has_column($pdo, 'seat_requests', 'payment_capture_id');
    $selectColumns = ['id'];
    if ($hasPaymentStatus) {
        $selectColumns[] = 'payment_status';
    }
    if ($hasPaymentProvider) {
        $selectColumns[] = 'payment_provider';
    }
    if ($hasPaymentOrderId) {
        $selectColumns[] = 'payment_order_id';
    }
    if ($hasPaymentCaptureId) {
        $selectColumns[] = 'payment_capture_id';
    }
    $selectColumnSql = implode(', ', $selectColumns);
    $selectSql = "SELECT {$selectColumnSql} FROM seat_requests WHERE status IN ($placeholders) AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW()";
    $select = $pdo->prepare($selectSql);
    $select->execute($statuses);
    $expiredIds = [];
    $expiredRows = [];
    while ($row = $select->fetch()) {
        if ($hasPaymentStatus && seat_request_payment_blocks_expiration($row['payment_status'] ?? null)) {
            continue;
        }
        $expiredId = (int) ($row['id'] ?? 0);
        if ($expiredId <= 0) {
            continue;
        }
        $expiredIds[] = $expiredId;
        $expiredRows[$expiredId] = $row;
    }
    if (!$expiredIds) {
        return;
    }
    $idPlaceholders = implode(',', array_fill(0, count($expiredIds), '?'));
    $updateSql = "UPDATE seat_requests SET status = 'expired', change_note = 'auto-expired hold', hold_expires_at = NULL, updated_at = NOW() WHERE id IN ($idPlaceholders)";
    $update = $pdo->prepare($updateSql);
    $update->execute($expiredIds);
    foreach ($expiredIds as $expiredId) {
        if (isset($expiredRows[$expiredId])) {
            clear_pending_square_checkout_state($pdo, $expiredId, $expiredRows[$expiredId], 'auto_expired', 'system');
        }
        record_audit('seat_request.expire', 'seat_request', $expiredId);
    }
}

function snapshot_layout_version(PDO $pdo, ?int $layoutId, string $changeNote = 'auto-snapshot', string $createdBy = 'system'): ?int
{
    if (!$layoutId) {
        return null;
    }
    $layoutSelect = layout_optional_select_clause($pdo, 'seating_layouts');
    $stmt = $pdo->prepare("SELECT layout_data, {$layoutSelect} FROM seating_layouts WHERE id = ? LIMIT 1");
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
        $createdBy ?: 'system',
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
    $selectColumns = layout_table_has_column($pdo, 'seat_requests', 'payment_status')
        ? 'selected_seats, status, hold_expires_at, payment_status'
        : 'selected_seats, status, hold_expires_at';
    $stmt = $pdo->prepare("SELECT {$selectColumns} FROM seat_requests WHERE event_id = ? FOR UPDATE");
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
                    if ($expiry < $now && !seat_request_payment_blocks_expiration($row['payment_status'] ?? null)) {
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
    $seatStmt = $pdo->prepare('SELECT selected_seats FROM seating WHERE event_id = ? AND selected_seats IS NOT NULL FOR UPDATE');
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

function apply_seat_reservations(PDO $pdo, array $seatIds, bool $captureMissing = false): array
{
    $missing = [];
    foreach ($seatIds as $seatId) {
        [$section, $rowLabel] = parse_seat_identifier($seatId);
        if (!$section || !$rowLabel) {
            continue;
        }
        $stmt = $pdo->prepare('SELECT id, selected_seats FROM seating WHERE section = ? AND row_label = ? LIMIT 1 FOR UPDATE');
        $stmt->execute([$section, $rowLabel]);
        $row = $stmt->fetch();
        if (!$row) {
            if ($captureMissing) {
                $missing[] = $seatId;
            }
            continue;
        }
        $existing = parse_selected_seats($row['selected_seats']);
        if (!in_array($seatId, $existing, true)) {
            $existing[] = $seatId;
            $update = $pdo->prepare('UPDATE seating SET selected_seats = ? WHERE id = ?');
            $update->execute([json_encode($existing), $row['id']]);
        }
    }
    return $captureMissing ? array_values(array_unique($missing)) : [];
}

function normalize_snapshot_seat_list(array $seats): array
{
    $map = [];
    foreach ($seats as $seat) {
        if (!is_string($seat)) {
            continue;
        }
        $label = trim($seat);
        if ($label === '' || isset($map[$label])) {
            continue;
        }
        $map[$label] = true;
    }
    $result = array_keys($map);
    sort($result, SORT_NATURAL);
    return $result;
}

function collect_event_seating_snapshot_data(PDO $pdo, int $eventId): array
{
    $reserved = [];
    $pending = [];
    $hold = [];
    $now = now_eastern();
    $openStatuses = open_seat_request_statuses();
    $selectColumns = layout_table_has_column($pdo, 'seat_requests', 'payment_status')
        ? 'selected_seats, status, hold_expires_at, payment_status'
        : 'selected_seats, status, hold_expires_at';
    $stmt = $pdo->prepare("SELECT {$selectColumns} FROM seat_requests WHERE event_id = ?");
    $stmt->execute([$eventId]);
    while ($row = $stmt->fetch()) {
        $seats = parse_selected_seats($row['selected_seats'] ?? []);
        if (!$seats) {
            continue;
        }
        $status = normalize_seat_request_status($row['status'] ?? null);
        if ($status === 'confirmed') {
            $reserved = array_merge($reserved, $seats);
            continue;
        }
        if (in_array($status, $openStatuses, true)) {
            $target =& $pending;
            if (!empty($row['hold_expires_at'])) {
                try {
                    $expiresAt = new DateTimeImmutable($row['hold_expires_at'], new DateTimeZone('America/New_York'));
                    if ($expiresAt > $now && !seat_request_payment_blocks_expiration($row['payment_status'] ?? null)) {
                        $target =& $hold;
                    }
                } catch (Throwable $e) {
                    // Ignore parse errors; treat as pending state
                }
            }
            $target = array_merge($target, $seats);
        }
    }
    $manualStmt = $pdo->prepare('SELECT selected_seats FROM seating WHERE event_id = ? AND selected_seats IS NOT NULL');
    $manualStmt->execute([$eventId]);
    while ($row = $manualStmt->fetch()) {
        $rowSeats = parse_selected_seats($row['selected_seats'] ?? []);
        if ($rowSeats) {
            $reserved = array_merge($reserved, $rowSeats);
        }
    }
    return [
        'reserved' => normalize_snapshot_seat_list($reserved),
        'pending' => normalize_snapshot_seat_list($pending),
        'hold' => normalize_snapshot_seat_list($hold),
    ];
}

function create_event_seating_snapshot(PDO $pdo, int $eventId, string $snapshotType = 'pre_layout_change', ?string $notes = null): ?array
{
    if (!event_seating_snapshots_table_exists($pdo)) {
        return null;
    }
    $eventStmt = $pdo->prepare('SELECT id, layout_id, layout_version_id FROM events WHERE id = ? LIMIT 1');
    $eventStmt->execute([$eventId]);
    $event = $eventStmt->fetch();
    if (!$event) {
        return null;
    }
    $snapshotData = collect_event_seating_snapshot_data($pdo, $eventId);
    $actor = audit_log_actor();
    $insert = $pdo->prepare('INSERT INTO event_seating_snapshots (event_id, layout_id, layout_version_id, snapshot_type, reserved_seats, pending_seats, hold_seats, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $insert->execute([
        $eventId,
        $event['layout_id'] ?? null,
        $event['layout_version_id'] ?? null,
        $snapshotType,
        json_encode($snapshotData['reserved']) ?: '[]',
        $snapshotData['pending'] ? json_encode($snapshotData['pending']) : null,
        $snapshotData['hold'] ? json_encode($snapshotData['hold']) : null,
        $notes,
        $actor,
    ]);
    $snapshotId = (int) $pdo->lastInsertId();
    return [
        'id' => $snapshotId,
        'snapshot_type' => $snapshotType,
        'layout_id' => $event['layout_id'] ?? null,
        'layout_version_id' => $event['layout_version_id'] ?? null,
        'reserved' => $snapshotData['reserved'],
        'pending' => $snapshotData['pending'],
        'hold' => $snapshotData['hold'],
    ];
}

function decode_snapshot_seat_column($value): array
{
    if (is_array($value)) {
        return array_values(array_filter($value, fn($seat) => is_string($seat) && trim($seat) !== ''));
    }
    if (is_string($value) && $value !== '') {
        $decoded = json_decode($value, true);
        if (is_array($decoded)) {
            return array_values(array_filter($decoded, fn($seat) => is_string($seat) && trim($seat) !== ''));
        }
    }
    return [];
}

function create_snapshot_placeholder_requests(PDO $pdo, int $eventId, array $seatIds, string $status, ?int $layoutVersionId, string $note, DateTimeImmutable $now): array
{
    if (!$seatIds) {
        return [];
    }
    $chunks = array_chunk($seatIds, 15);
    $missing = [];
    foreach ($chunks as $chunk) {
        $holdExpiresAt = null;
        $finalizedAt = null;
        if ($status === 'confirmed') {
            $finalizedAt = $now->format('Y-m-d H:i:s');
        } elseif ($status === 'hold') {
            $holdExpiresAt = compute_hold_expiration($now)->format('Y-m-d H:i:s');
        }
        $stmt = $pdo->prepare('INSERT INTO seat_requests (event_id, layout_version_id, customer_name, customer_email, customer_phone, customer_phone_normalized, selected_seats, total_seats, status, special_requests, hold_expires_at, finalized_at, created_by, updated_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())');
        $stmt->execute([
            $eventId,
            $layoutVersionId,
            'Snapshot Restore',
            '',
            '',
            null,
            json_encode($chunk),
            count($chunk),
            $status,
            $note,
            $holdExpiresAt,
            $finalizedAt,
            'snapshot-restore',
            'snapshot-restore',
        ]);
        if ($status === 'confirmed') {
            $missingSeats = apply_seat_reservations($pdo, $chunk, true);
            if ($missingSeats) {
                $missing = array_merge($missing, $missingSeats);
            }
        }
    }
    return array_values(array_unique($missing));
}

function restore_event_seating_from_snapshot(PDO $pdo, int $eventId, array $snapshotRow): array
{
    $eventStmt = $pdo->prepare('SELECT layout_id, layout_version_id, seating_enabled FROM events WHERE id = ? LIMIT 1 FOR UPDATE');
    $eventStmt->execute([$eventId]);
    $event = $eventStmt->fetch();
    if (!$event) {
        throw new RuntimeException('Event not found');
    }

    $conflicts = [];
    $targetLayoutId = $snapshotRow['layout_id'] ?? null;
    $targetLayoutVersionId = $snapshotRow['layout_version_id'] ?? null;

    if ($targetLayoutId) {
        $layoutCheck = $pdo->prepare('SELECT id FROM seating_layouts WHERE id = ? LIMIT 1');
        $layoutCheck->execute([$targetLayoutId]);
        if (!$layoutCheck->fetchColumn()) {
            $conflicts[] = ['type' => 'layout_missing', 'message' => "Layout template {$targetLayoutId} no longer exists."];
            $targetLayoutId = null;
            $targetLayoutVersionId = null;
        }
    }
    if ($targetLayoutVersionId) {
        $versionCheck = $pdo->prepare('SELECT id FROM seating_layout_versions WHERE id = ? LIMIT 1');
        $versionCheck->execute([$targetLayoutVersionId]);
        if (!$versionCheck->fetchColumn()) {
            $conflicts[] = ['type' => 'layout_version_missing', 'message' => "Layout version {$targetLayoutVersionId} no longer exists."];
            $targetLayoutVersionId = null;
        }
    }

    $updateFields = [];
    $updateParams = [];
    $currentLayoutId = $event['layout_id'] ?? null;
    $currentLayoutVersionId = $event['layout_version_id'] ?? null;
    if ($targetLayoutId !== $currentLayoutId) {
        $updateFields[] = 'layout_id = ?';
        $updateParams[] = $targetLayoutId;
    }
    if ($targetLayoutVersionId !== $currentLayoutVersionId) {
        $updateFields[] = 'layout_version_id = ?';
        $updateParams[] = $targetLayoutVersionId;
    }
    if ($targetLayoutId && (int)($event['seating_enabled'] ?? 0) !== 1) {
        $updateFields[] = 'seating_enabled = 1';
        $updateParams[] = 1;
    }
    if ($updateFields) {
        $updateParams[] = $eventId;
        $pdo->prepare('UPDATE events SET ' . implode(', ', $updateFields) . ' WHERE id = ?')->execute($updateParams);
    }

    $pdo->prepare('DELETE FROM seat_requests WHERE event_id = ?')->execute([$eventId]);
    $pdo->prepare('UPDATE seating SET selected_seats = NULL WHERE event_id = ?')->execute([$eventId]);

    $reservedSeats = decode_snapshot_seat_column($snapshotRow['reserved_seats'] ?? null);
    $pendingSeats = decode_snapshot_seat_column($snapshotRow['pending_seats'] ?? null);
    $holdSeats = decode_snapshot_seat_column($snapshotRow['hold_seats'] ?? null);

    $now = now_eastern();
    $snapshotNoteBase = isset($snapshotRow['id']) ? "Restored from snapshot #{$snapshotRow['id']}" : 'Restored from snapshot';
    $missingSeats = create_snapshot_placeholder_requests(
        $pdo,
        $eventId,
        $reservedSeats,
        'confirmed',
        $targetLayoutVersionId,
        "{$snapshotNoteBase} (confirmed)",
        $now
    );
    foreach ($missingSeats as $seat) {
        $conflicts[] = ['type' => 'seat_missing', 'seat' => $seat, 'message' => 'Seat not found in current layout'];
    }
    create_snapshot_placeholder_requests(
        $pdo,
        $eventId,
        $pendingSeats,
        'waiting',
        $targetLayoutVersionId,
        "{$snapshotNoteBase} (pending)",
        $now
    );
    create_snapshot_placeholder_requests(
        $pdo,
        $eventId,
        $holdSeats,
        'hold',
        $targetLayoutVersionId,
        "{$snapshotNoteBase} (hold)",
        $now
    );

    $finalStmt = $pdo->prepare('SELECT layout_id, layout_version_id, seating_enabled FROM events WHERE id = ? LIMIT 1');
    $finalStmt->execute([$eventId]);
    $finalEvent = $finalStmt->fetch() ?: $event;

    return [
        'layout_id' => $finalEvent['layout_id'] ?? null,
        'layout_version_id' => $finalEvent['layout_version_id'] ?? null,
        'seating_enabled' => (int)($finalEvent['seating_enabled'] ?? 0),
        'restored_reserved' => count($reservedSeats),
        'restored_pending' => count($pendingSeats),
        'restored_hold' => count($holdSeats),
        'conflicts' => $conflicts,
    ];
}

function create_seat_request_record(PDO $pdo, array $payload, array $options = []): array
{
    $createdBy = $options['created_by'] ?? 'public';
    $updatedBy = $options['updated_by'] ?? $createdBy;
    $defaultStatus = normalize_seat_request_status($options['default_status'] ?? 'new');
    $allowOverride = !empty($options['allow_status_override']);
    $forcedStatus = $options['forced_status'] ?? null;
    $sendNotifications = array_key_exists('send_notifications', $options) ? (bool) $options['send_notifications'] : true;
    $statusInput = $forcedStatus ?? ($allowOverride ? ($payload['status'] ?? null) : null);
    $status = $statusInput ? normalize_seat_request_status($statusInput) : $defaultStatus;
    if (!in_array($status, canonical_seat_request_statuses(), true)) {
        $status = $defaultStatus;
    }

    $exceptionContext = [
        'event_id' => null,
        'layout_id' => null,
        'layout_version_id' => null,
        'seat_ids' => [],
    ];
    $startedTransaction = false;
    if (!$pdo->inTransaction()) {
        $pdo->beginTransaction();
        $startedTransaction = true;
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
    $exceptionContext['seat_ids'] = $selectedSeats;
    if (empty($selectedSeats)) {
        throw new SeatRequestException('selected_seats is required', 400, [], 'missing_selected_seats', $exceptionContext);
    }

    $created = null;
    $holdDate = null;
    $event = null;

    try {
        expire_stale_holds($pdo);
        $eventIdRaw = $payload['event_id'] ?? $payload['eventId'] ?? null;
        $eventId = (int) $eventIdRaw;
        $exceptionContext['event_id'] = $eventId > 0 ? $eventId : null;
        if ($eventId <= 0) {
            throw new SeatRequestException('event_id is required', 400, [], 'missing_event_id', $exceptionContext);
        }
        $customerName = trim((string)($payload['customer_name'] ?? $payload['customerName'] ?? ''));
        if ($customerName === '') {
            throw new SeatRequestException('customer_name is required', 400, [], 'missing_customer_name', $exceptionContext);
        }
        $contactPayload = $payload['contact'] ?? $payload['contactInfo'] ?? [];
        $contactPhone = isset($contactPayload['phone']) ? trim((string)$contactPayload['phone']) : '';
        if ($contactPhone === '') {
            throw new SeatRequestException('phone is required', 400, [], 'missing_contact_phone', $exceptionContext);
        }
        $customerEmail = isset($contactPayload['email']) ? trim((string)$contactPayload['email']) : '';
        if ($customerEmail && !filter_var($customerEmail, FILTER_VALIDATE_EMAIL)) {
            throw new SeatRequestException('Invalid email address', 400, [], 'invalid_contact_email', $exceptionContext);
        }
        $customerPhoneNormalized = normalize_phone_number($contactPhone) ?: null;

        $hasCategoryTable = event_categories_table_exists($pdo);
        $hasPricingConfigColumn = events_table_has_column($pdo, 'pricing_config');
        $hasPaymentEnabledColumn = events_table_has_column($pdo, 'payment_enabled');
        $pricingSelect = $hasPricingConfigColumn ? ', e.pricing_config' : '';
        $paymentSelect = $hasPaymentEnabledColumn ? ', e.payment_enabled' : ', 0 AS payment_enabled';
        if ($hasCategoryTable) {
            $eventStmt = $pdo->prepare('SELECT e.id, e.category_id, e.title, e.artist_name, e.layout_id, e.layout_version_id, e.seating_enabled, e.start_datetime, e.event_date, e.event_time, e.timezone, e.status, e.visibility, e.seat_request_email_override, e.ticket_price, e.door_price, e.min_ticket_price, e.max_ticket_price' . $pricingSelect . $paymentSelect . ', ec.slug AS category_slug, ec.seat_request_email_to AS category_seat_request_email_to FROM events e LEFT JOIN event_categories ec ON ec.id = e.category_id WHERE e.id = ? LIMIT 1');
            $eventStmt->execute([$eventId]);
        } else {
            $eventStmt = $pdo->prepare('SELECT id, category_id, title, artist_name, layout_id, layout_version_id, seating_enabled, start_datetime, event_date, event_time, timezone, status, visibility, seat_request_email_override, ticket_price, door_price, min_ticket_price, max_ticket_price' . ($hasPricingConfigColumn ? ', pricing_config' : '') . ($hasPaymentEnabledColumn ? ', payment_enabled' : ', 0 AS payment_enabled') . ' FROM events WHERE id = ? LIMIT 1');
            $eventStmt->execute([$eventId]);
        }
        $event = $eventStmt->fetch();
        if (!$event) {
            throw new SeatRequestException('Event not found', 404, [], 'event_not_found', $exceptionContext);
        }
        $exceptionContext['layout_id'] = $event['layout_id'] ?? null;
        $exceptionContext['layout_version_id'] = $event['layout_version_id'] ?? null;
        if ($createdBy === 'public') {
            $eventStatus = strtolower(trim((string) ($event['status'] ?? 'draft')));
            $eventVisibility = strtolower(trim((string) ($event['visibility'] ?? 'private')));
            if ($eventStatus !== 'published' || $eventVisibility !== 'public') {
                throw new SeatRequestException('Seat requests are not available for this event', 403, [], 'event_not_public', $exceptionContext);
            }
        }
        $hasLayout = !empty($event['layout_id']) || !empty($event['layout_version_id']);
        if ((int)($event['seating_enabled'] ?? 0) !== 1 || !$hasLayout) {
            throw new SeatRequestException('Seating requests are not available for this event', 400, [], 'event_not_seating_enabled', $exceptionContext);
        }

        $conflicts = detect_seat_conflicts($pdo, $eventId, $selectedSeats);
        if (!empty($conflicts)) {
            throw new SeatRequestException('Seats unavailable', 409, ['conflicts' => $conflicts], 'seat_conflict', $exceptionContext);
        }

        $now = now_eastern();
        if (in_array($status, open_seat_request_statuses(), true)) {
            $holdDate = compute_hold_expiration($now);
        }
        $holdExpiry = $holdDate ? $holdDate->format('Y-m-d H:i:s') : null;
        $finalizedAt = $status === 'confirmed' ? $now->format('Y-m-d H:i:s') : null;
        $totalSeats = count($selectedSeats);
        [$layoutRowsForPricing] = fetch_layout_for_event($eventId);
        $pricingFailure = null;
        $totalAmount = resolve_seat_request_total_amount($event, $selectedSeats, $layoutRowsForPricing, $pricingFailure);
        if ($pricingFailure === 'missing_pricing_assignment') {
            throw new SeatRequestException('Selected seats are missing pricing configuration. Please contact staff to finish this reservation.', 422, [], 'missing_pricing_assignment', $exceptionContext);
        }
        $currency = 'USD';

        $layoutVersionId = $event['layout_version_id'];
        if (!$layoutVersionId && $event['layout_id']) {
            $layoutVersionId = snapshot_layout_version($pdo, $event['layout_id'], 'auto-reservation');
            if ($layoutVersionId) {
                Database::run('UPDATE events SET layout_version_id = ? WHERE id = ?', [$layoutVersionId, $eventId]);
            }
        }
        if ($layoutVersionId) {
            $exceptionContext['layout_version_id'] = $layoutVersionId;
        }
        $snapshotData = null;
        if ($layoutVersionId) {
            $snapStmt = $pdo->prepare('SELECT layout_data FROM seating_layout_versions WHERE id = ? LIMIT 1');
            $snapStmt->execute([$layoutVersionId]);
            $snapshotRow = $snapStmt->fetch();
            $snapshotData = $snapshotRow ? $snapshotRow['layout_data'] : null;
        }

        Database::run(
            'INSERT INTO seat_requests (event_id, layout_version_id, seat_map_snapshot, customer_name, customer_email, customer_phone, customer_phone_normalized, selected_seats, total_seats, total_amount, currency, special_requests, status, hold_expires_at, finalized_at, created_by, updated_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $eventId,
                $layoutVersionId,
                $snapshotData,
                $customerName,
                $customerEmail ?: '',
                $contactPhone,
                $customerPhoneNormalized,
                json_encode($selectedSeats),
                $totalSeats,
                $totalAmount,
                $currency,
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
            hydrate_seat_request_payment_details(
                $created,
                resolve_event_payment_option($event, load_payment_settings_lookup($pdo))
            );
        }
        if ($startedTransaction) {
            $pdo->commit();
        }
    } catch (Throwable $error) {
        if ($startedTransaction && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }

    if ($sendNotifications && $created && $event) {
        try {
            notify_seat_request_emails($created, $event);
        } catch (Throwable $notifyError) {
            error_log('[email] Unable to process seat request notifications: ' . $notifyError->getMessage());
        }
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
    $hasSeriesMeta = event_series_meta_table_exists($pdo);
    $paymentLookup = load_payment_settings_lookup($pdo);
    $params = [];
    $conditions = [];
    $includeDeleted = !empty($request->query['include_deleted']);
    $scope = $scopeOverride ? strtolower($scopeOverride) : strtolower((string)($request->query['scope'] ?? 'public'));
    if (!in_array($scope, ['public', 'admin'], true)) {
        $scope = 'public';
    }
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
            $conditions[] = '(COALESCE(e.status, \'draft\') = ? OR e.is_series_master = 1)';
        } else {
            $conditions[] = 'COALESCE(e.status, \'draft\') = ?';
        }
        $params[] = $status;
    }
    if ($hasArchivedColumn) {
        if ($archivedFilterRaw === '1') {
            $conditions[] = '(e.archived_at IS NOT NULL OR COALESCE(e.status, \'draft\') = \'archived\')';
        } elseif ($archivedFilterRaw === 'all') {
            // no-op
        } else {
            $conditions[] = '(e.archived_at IS NULL AND COALESCE(e.status, \'draft\') != \'archived\')';
        }
    } else {
        if ($archivedFilterRaw === '1') {
            $conditions[] = 'COALESCE(e.status, \'draft\') = ?';
            $params[] = 'archived';
        } elseif ($archivedFilterRaw === 'all') {
            // leave rows as-is
        } else {
            $conditions[] = 'COALESCE(e.status, \'draft\') != ?';
            $params[] = 'archived';
        }
    }
    if ($scope === 'public') {
        $conditions[] = "COALESCE(e.status, 'draft') = 'published'";
        $conditions[] = "COALESCE(e.visibility, 'private') = 'public'";
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
    $seriesMetaSelect = '';
    $seriesMetaJoin = '';
    if ($hasSeriesMeta) {
        $seriesMetaSelect = ', esm.schedule_label AS series_schedule_label, esm.summary AS series_summary, esm.footer_note AS series_footer_note';
        $seriesMetaJoin = ' LEFT JOIN event_series_meta esm ON esm.event_id = e.id';
    }
    $recurrenceSelect = ', rr_self.id AS recurrence_rule_id, rr_parent.id AS parent_recurrence_rule_id, rx_skip.id AS skipped_instance_exception_id, rx_skip.exception_date AS skipped_instance_exception_date'
        . ', COALESCE(rr_self.frequency, rr_parent.frequency) AS recurrence_frequency'
        . ', COALESCE(rr_self.`interval`, rr_parent.`interval`) AS recurrence_interval'
        . ', COALESCE(rr_self.byweekday, rr_parent.byweekday) AS recurrence_byweekday'
        . ', COALESCE(rr_self.bymonthday, rr_parent.bymonthday) AS recurrence_bymonthday'
        . ', COALESCE(rr_self.bysetpos, rr_parent.bysetpos) AS recurrence_bysetpos'
        . ', COALESCE(rr_self.starts_on, rr_parent.starts_on) AS recurrence_starts_on'
        . ', COALESCE(rr_self.ends_on, rr_parent.ends_on) AS recurrence_ends_on'
        . ', COALESCE(rr_self.rule_payload, rr_parent.rule_payload) AS recurrence_rule_payload';
    $occurrenceDateExpr = "COALESCE(e.event_date, DATE(e.start_datetime))";
    $recurrenceJoin = ' LEFT JOIN event_recurrence_rules rr_self ON rr_self.event_id = e.id LEFT JOIN event_recurrence_rules rr_parent ON rr_parent.event_id = e.series_master_id LEFT JOIN event_recurrence_exceptions rx_skip ON rx_skip.recurrence_id = rr_parent.id AND rx_skip.exception_type = \'skip\' AND rx_skip.exception_date = ' . $occurrenceDateExpr;
    $sql = "SELECT e.*{$categorySelect}{$seriesMetaSelect}{$recurrenceSelect} FROM events e{$seriesMetaJoin}{$categoryJoin}{$recurrenceJoin} $where $orderBy $limitClause";
    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll() ?: [];
        if ($scope === 'public' && $rows) {
            $rows = array_values(array_filter($rows, function ($row) {
                return empty($row['skipped_instance_exception_id']);
            }));
            $masterIds = [];
            foreach ($rows as $row) {
                $masterId = isset($row['series_master_id']) ? (int) $row['series_master_id'] : 0;
                if ($masterId > 0) {
                    $masterIds[$masterId] = true;
                }
            }
            foreach ($rows as $row) {
                if (!empty($row['is_series_master']) && !empty($row['id'])) {
                    unset($masterIds[(int) $row['id']]);
                }
            }
            if ($masterIds) {
                $masterIds = array_keys($masterIds);
                $placeholders = implode(',', array_fill(0, count($masterIds), '?'));
                $masterWhere = "WHERE e.id IN ({$placeholders})";
                if (!$includeDeleted) {
                    $masterWhere .= ' AND e.deleted_at IS NULL';
                }
                $masterSql = "SELECT e.*{$categorySelect}{$seriesMetaSelect}{$recurrenceSelect} FROM events e{$seriesMetaJoin}{$categoryJoin}{$recurrenceJoin} {$masterWhere}";
                $masterStmt = $pdo->prepare($masterSql);
                $masterStmt->execute($masterIds);
                $masters = $masterStmt->fetchAll() ?: [];
                if ($masters) {
                    $rows = array_merge($rows, $masters);
                }
            }
        }
        if ($rows) {
            $eventIds = array_map(static function ($row): int {
                return (int) ($row['id'] ?? 0);
            }, $rows);
            $occurrenceMap = load_event_occurrences_map($pdo, $eventIds);
            foreach ($rows as &$row) {
                $eventId = (int) ($row['id'] ?? 0);
                $occurrences = $occurrenceMap[$eventId] ?? [];
                if (!$occurrences) {
                    $fallback = build_fallback_occurrence_from_event($row);
                    $occurrences = $fallback ? [$fallback] : [];
                }
                $row = attach_occurrence_metadata_to_event($row, $occurrences);
            }
            unset($row);
        }
        if ($scope !== 'public') {
            foreach ($rows as &$row) {
                [$targetEmail, $targetSource] = determine_seat_request_recipient($row);
                if (!isset($row['status']) || $row['status'] === null || trim((string) $row['status']) === '') {
                    $row['status'] = 'draft';
                }
                if (!isset($row['visibility']) || $row['visibility'] === null || trim((string) $row['visibility']) === '') {
                    $row['visibility'] = 'private';
                }
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
        } else {
            $rows = attach_public_recurrence_previews($pdo, $rows);
            $rows = expand_public_event_rows($rows, $timeframe);
        }
        $rows = enrich_event_rows_with_images($rows);
        foreach ($rows as &$row) {
            prepare_event_pricing_config_for_response($row);
            $row['payment_option'] = resolve_event_payment_option($row, $paymentLookup);
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
    $clientIp = admin_login_client_ip();
    $throttle = combined_admin_login_throttle_status($email, $clientIp);
    if (($throttle['retry_after_seconds'] ?? 0) > 0) {
        header('Retry-After: ' . (int) $throttle['retry_after_seconds']);
        return Response::error(
            'Too many login attempts. Please wait before trying again.',
            429,
            [
                'reason' => 'login_rate_limited',
                'retry_after_seconds' => (int) $throttle['retry_after_seconds'],
            ]
        );
    }

    ensure_admins_table_exists();
    $stmt = Database::run('SELECT * FROM admins WHERE username = ? OR email = ? LIMIT 1', [$email, $email]);
    $row = $stmt->fetch();
    if ($row && password_verify($password, $row['password_hash'] ?? '')) {
        clear_admin_login_failures($email, $clientIp);
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

    destroy_admin_session();
    $identifierThrottle = record_admin_login_failure($email, $clientIp, ADMIN_LOGIN_THROTTLE_MAX_FAILURES);
    $ipThrottle = record_admin_login_failure(admin_login_ip_bucket_identifier(), $clientIp, ADMIN_LOGIN_THROTTLE_IP_MAX_FAILURES);
    $throttle = [
        'retry_after_seconds' => max(
            (int) ($identifierThrottle['retry_after_seconds'] ?? 0),
            (int) ($ipThrottle['retry_after_seconds'] ?? 0)
        ),
    ];
    if (($throttle['retry_after_seconds'] ?? 0) > 0) {
        header('Retry-After: ' . (int) $throttle['retry_after_seconds']);
        return Response::error(
            'Too many login attempts. Please wait before trying again.',
            429,
            [
                'reason' => 'login_rate_limited',
                'retry_after_seconds' => (int) $throttle['retry_after_seconds'],
            ]
        );
    }
    Response::error('Invalid credentials', 401);
});

$router->add('POST', '/api/admin/change-password', function (Request $request) {
    try {
        $session = current_admin_session();
        if (!$session || empty($session['user'])) {
            return Response::error('Unauthorized', 401);
        }
        if (!admin_csrf_origin_is_valid($request)) {
            return Response::error('Forbidden', 403);
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
        if (!admin_csrf_origin_is_valid($request)) {
            return Response::error('Forbidden', 403);
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

$router->add('POST', '/api/events/archive-past', function () {
    try {
        $pdo = Database::connection();
        $hasArchivedColumn = events_table_has_column($pdo, 'archived_at');
        $endExpr = event_end_expression('e');
        $hasScheduleExpr = event_has_schedule_expression('e');
        $conditions = [
            'e.deleted_at IS NULL',
            $hasScheduleExpr,
            "{$endExpr} < NOW()",
            "e.status = 'published'",
            "e.visibility = 'public'",
        ];
        if ($hasArchivedColumn) {
            $conditions[] = 'e.archived_at IS NULL';
        } else {
            $conditions[] = "e.status != 'archived'";
        }
        $where = 'WHERE ' . implode(' AND ', $conditions);
        if ($hasArchivedColumn) {
            $sql = "UPDATE events e SET archived_at = NOW(), status = 'archived', visibility = 'private' {$where}";
        } else {
            $sql = "UPDATE events e SET status = 'archived', visibility = 'private' {$where}";
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute();
        record_audit('event.archive.auto', 'event', null, [
            'count' => $stmt->rowCount(),
            'has_archived_column' => $hasArchivedColumn,
        ]);
        Response::success(['archived' => $stmt->rowCount()]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('POST /api/events/archive-past error: ' . $e->getMessage());
        }
        Response::error('Failed to auto-archive past events', 500);
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
    $pdo = Database::connection();
    $stmt = Database::run('SELECT * FROM events WHERE id = ? LIMIT 1', [$params['id']]);
    $event = $stmt->fetch();
    if (!$event) {
        http_response_code(404);
        header('Content-Type: text/plain');
        echo 'Event not found';
        return;
    }
    $occurrenceId = isset($request->query['occurrence_id']) ? (int) $request->query['occurrence_id'] : 0;
    $occurrences = resolve_event_occurrences_for_event($pdo, $event);
    if ($occurrenceId > 0) {
        $occurrences = array_values(array_filter($occurrences, static function (array $occurrence) use ($occurrenceId): bool {
            return (int) ($occurrence['id'] ?? 0) === $occurrenceId;
        }));
        if (!$occurrences) {
            http_response_code(404);
            header('Content-Type: text/plain');
            echo 'Occurrence not found';
            return;
        }
    } elseif (!$occurrences) {
        $fallback = build_fallback_occurrence_from_event($event);
        $occurrences = $fallback ? [$fallback] : [];
    }
    if (!$occurrences) {
        http_response_code(400);
        header('Content-Type: text/plain');
        echo 'Event start time unavailable';
        return;
    }
    $host = $_SERVER['HTTP_HOST'] ?? 'midwaymusichall.com';
    $title = $event['artist_name'] ?: ($event['title'] ?? 'Midway Music Hall Event');
    $location = trim(($event['venue_section'] ?? '') . ' ' . ($event['venue_code'] ?? ''));
    if ($location === '') {
        $location = 'Midway Music Hall, 11141 Old US Hwy 52, Winston-Salem, NC 27107';
    }
    $description = trim(($event['description'] ?? '') . "\nContact: " . ($event['contact_name'] ?? 'Venue'));
    if (count($occurrences) > 1 && $occurrenceId <= 0) {
        $description = trim($description . "\nThis calendar file includes the full multi-day event run.");
    }
    header('Content-Type: text/calendar; charset=utf-8');
    header('Content-Disposition: attachment; filename="event-' . $event['id'] . '.ics"');
    echo "BEGIN:VCALENDAR\r\n";
    echo "VERSION:2.0\r\n";
    echo "PRODID:-//Midway Music Hall//Events//EN\r\n";
    foreach (array_values($occurrences) as $index => $occurrence) {
        $occurrenceEvent = $event;
        $occurrenceEvent['start_datetime'] = $occurrence['start_datetime'] ?? ($event['start_datetime'] ?? null);
        $occurrenceEvent['end_datetime'] = $occurrence['end_datetime'] ?? ($event['end_datetime'] ?? null);
        $occurrenceEvent['event_date'] = $occurrence['event_date'] ?? ($event['event_date'] ?? null);
        $occurrenceEvent['event_time'] = $occurrence['event_time'] ?? ($event['event_time'] ?? null);
        $start = resolve_event_start_datetime($occurrenceEvent);
        if (!$start) {
            continue;
        }
        $end = resolve_event_end_datetime($occurrenceEvent);
        $dtStart = $start->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z');
        $dtEnd = $end ? $end->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z') : $start->modify('+4 hours')->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z');
        $uidSuffix = $occurrenceId > 0
            ? ('-' . $occurrenceId)
            : (count($occurrences) > 1 ? ('-' . ($occurrence['id'] ?? ($index + 1))) : '');
        $uid = sprintf('mmh-%d%s@%s', $event['id'], $uidSuffix, $host);
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
    }
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

$router->add('POST', '/api/session/refresh', function (Request $request) {
    $session = current_admin_session();
    if (!$session) {
        log_admin_session_state('POST /api/session/refresh failed');
        return Response::error('Session expired', 401);
    }
    if (!admin_csrf_origin_is_valid($request)) {
        return Response::error('Forbidden', 403);
    }
    $session = refresh_admin_session();
    if (!$session) {
        log_admin_session_state('POST /api/session/refresh failed after refresh');
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

$router->add('POST', '/api/logout', function (Request $request) {
    $session = current_admin_session();
    if ($session && !admin_csrf_origin_is_valid($request)) {
        return Response::error('Forbidden', 403);
    }
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
    $hasSeriesMeta = event_series_meta_table_exists($pdo);
    $paymentLookup = load_payment_settings_lookup($pdo);
    $seriesMetaSelect = $hasSeriesMeta ? ', esm.schedule_label AS series_schedule_label, esm.summary AS series_summary, esm.footer_note AS series_footer_note' : '';
    $seriesMetaJoin = $hasSeriesMeta ? ' LEFT JOIN event_series_meta esm ON esm.event_id = e.id' : '';
    if ($hasCategoryTable) {
        $sql = 'SELECT e.*' . $seriesMetaSelect . ' , ec.slug AS category_slug, ec.name AS category_name, ec.is_active AS category_is_active, ec.is_system AS category_is_system, ec.seat_request_email_to AS category_seat_request_email_to FROM events e' . $seriesMetaJoin . ' LEFT JOIN event_categories ec ON ec.id = e.category_id WHERE e.id = ? LIMIT 1';
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$params['id']]);
    } else {
        $sql = 'SELECT e.*' . $seriesMetaSelect . ' FROM events e' . $seriesMetaJoin . ' WHERE e.id = ? LIMIT 1';
        $stmt = $pdo->prepare($sql);
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
        prepare_event_pricing_config_for_response($event);
        $event['payment_option'] = resolve_event_payment_option($event, $paymentLookup);
        $event = attach_occurrence_metadata_to_event($event, resolve_event_occurrences_for_event($pdo, $event));
        $event['ics_url'] = '/api/events/' . $event['id'] . '.ics';
        $enriched = enrich_event_rows_with_images([$event]);
        if (!empty($enriched[0])) {
            $event = $enriched[0];
        }
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

$router->add('GET', '/api/admin/payment-settings', function () {
    $session = current_admin_session();
    if (!$session || empty($session['user'])) {
        return Response::error('Unauthorized', 401);
    }
    try {
        $pdo = Database::connection();
        if (!payment_settings_table_exists($pdo)) {
            return Response::success([
                'has_table' => false,
                'payment_settings' => [],
                'categories' => [],
            ]);
        }
        $settings = fetch_payment_settings_rows($pdo);
        foreach ($settings as &$setting) {
            $setting['provider_type'] = normalize_payment_provider_type($setting['provider_type'] ?? 'external_link');
            $setting['paypal_currency'] = normalize_paypal_currency($setting['paypal_currency'] ?? 'USD');
            $setting['paypal_enable_venmo'] = !empty($setting['paypal_enable_venmo']);
            $setting['paypal_hosted_button_id'] = normalize_paypal_hosted_button_id($setting['paypal_hosted_button_id'] ?? null);
        }
        unset($setting);
        $categories = [];
        if (event_categories_table_exists($pdo)) {
            $categoryStmt = $pdo->query('SELECT id, name, slug, is_active FROM event_categories ORDER BY name ASC');
            $categories = $categoryStmt->fetchAll() ?: [];
        }
        Response::success([
            'has_table' => true,
            'payment_settings' => $settings,
            'categories' => $categories,
            'capabilities' => [
                'provider_type' => payment_settings_table_has_column($pdo, 'provider_type'),
                'provider_type_square' => payment_settings_provider_type_supports($pdo, 'square'),
                'provider_type_paypal_orders' => payment_settings_provider_type_supports($pdo, 'paypal_orders'),
                'paypal_hosted_button_id' => payment_settings_table_has_column($pdo, 'paypal_hosted_button_id'),
                'paypal_currency' => payment_settings_table_has_column($pdo, 'paypal_currency'),
                'paypal_enable_venmo' => payment_settings_table_has_column($pdo, 'paypal_enable_venmo'),
                'paypal_orders_scaffold' => true,
            ],
        ]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('GET /api/admin/payment-settings error: ' . $e->getMessage());
        }
        Response::error('Failed to load payment settings', 500);
    }
});

$router->add('PUT', '/api/admin/payment-settings', function (Request $request) {
    $session = current_admin_session();
    if (!$session || empty($session['user'])) {
        return Response::error('Unauthorized', 401);
    }
    if (!admin_csrf_origin_is_valid($request)) {
        return Response::error('Forbidden', 403);
    }
    try {
        $pdo = Database::connection();
        if (!payment_settings_table_exists($pdo)) {
            return Response::error('Payment settings not available', 500);
        }
        $payload = read_json_body($request);
        $scope = strtolower(trim((string) ($payload['scope'] ?? 'category')));
        if (!in_array($scope, ['global', 'category'], true)) {
            return Response::error('Invalid scope value', 422);
        }
        $categoryId = null;
        if ($scope === 'category') {
            $categoryId = normalize_category_id($payload['category_id'] ?? null);
            if (!$categoryId) {
                return Response::error('category_id is required for category scope', 422);
            }
            $categoryRow = fetch_event_category_by_id($pdo, $categoryId);
            if (!$categoryRow) {
                return Response::error('Category not found', 404);
            }
        }
        $enabled = !empty($payload['enabled']);
        $limitSeats = (int) ($payload['limit_seats'] ?? 6);
        if ($limitSeats <= 0) {
            $limitSeats = 6;
        }
        $providerType = normalize_payment_provider_type($payload['provider_type'] ?? 'external_link');
        $paymentUrlInput = trim((string) ($payload['payment_url'] ?? ''));
        $paypalHostedButtonId = normalize_paypal_hosted_button_id($payload['paypal_hosted_button_id'] ?? null);
        $paypalCurrency = normalize_paypal_currency($payload['paypal_currency'] ?? 'USD');
        $paypalEnableVenmo = !empty($payload['paypal_enable_venmo']) ? 1 : 0;
        if ($enabled && $providerType === 'external_link' && $paymentUrlInput === '') {
            return Response::error('payment_url is required when external_link is enabled', 422);
        }
        if ($enabled && $providerType === 'paypal_hosted_button' && !$paypalHostedButtonId) {
            return Response::error('paypal_hosted_button_id is required when paypal_hosted_button is enabled', 422);
        }
        if ($providerType === 'square' && $paymentUrlInput !== '') {
            return Response::error('payment_url must be empty when provider_type is square', 422);
        }
        if ($providerType === 'paypal_orders' && $paymentUrlInput !== '') {
            return Response::error('payment_url must be empty when provider_type is paypal_orders', 422);
        }
        if ($paymentUrlInput !== '' && !preg_match('#^https?://#i', $paymentUrlInput)) {
            return Response::error('payment_url must start with http:// or https://', 422);
        }
        if ($providerType === 'paypal_hosted_button' && $paymentUrlInput !== '') {
            return Response::error('payment_url must be empty when provider_type is paypal_hosted_button', 422);
        }
        $buttonText = trim((string) ($payload['button_text'] ?? ''));
        if ($buttonText === '') {
            $buttonText = 'Pay Online';
        }
        $providerLabel = normalize_nullable_text($payload['provider_label'] ?? null);
        $overLimitMessage = normalize_nullable_text($payload['over_limit_message'] ?? null);
        if ($enabled && !$overLimitMessage) {
            $overLimitMessage = 'Please contact our staff to arrange payment for larger groups.';
        }
        $finePrint = normalize_nullable_text($payload['fine_print'] ?? null);
        foreach ([$providerLabel, $buttonText, $overLimitMessage, $finePrint] as $fieldText) {
            if (payment_settings_has_disallowed_markup($fieldText)) {
                return Response::error('Payment settings fields cannot contain HTML/script markup.', 422);
            }
        }
        $actor = audit_log_actor();

        $scopeCategoryKey = $scope === 'category' ? $categoryId : null;
        $existingStmt = $pdo->prepare('SELECT id FROM payment_settings WHERE scope = ? AND ((category_id IS NULL AND ? IS NULL) OR category_id = ?) LIMIT 1');
        $existingStmt->execute([$scope, $scopeCategoryKey, $scopeCategoryKey]);
        $existingId = (int) $existingStmt->fetchColumn();
        $storedPaymentUrl = $providerType === 'external_link' && $paymentUrlInput !== '' ? $paymentUrlInput : null;

        $hasProviderTypeColumn = payment_settings_table_has_column($pdo, 'provider_type');
        if ($hasProviderTypeColumn && !payment_settings_provider_type_supports($pdo, $providerType)) {
            return Response::error("payment_settings.provider_type does not support '{$providerType}' yet. Run database/20251212_schema_upgrade.sql.", 422);
        }
        $hasPaypalHostedButtonIdColumn = payment_settings_table_has_column($pdo, 'paypal_hosted_button_id');
        $hasPaypalCurrencyColumn = payment_settings_table_has_column($pdo, 'paypal_currency');
        $hasPaypalEnableVenmoColumn = payment_settings_table_has_column($pdo, 'paypal_enable_venmo');

        if ($existingId) {
            $updateParts = [
                'category_id = ?',
                'enabled = ?',
                'provider_label = ?',
                'payment_url = ?',
                'button_text = ?',
                'limit_seats = ?',
                'over_limit_message = ?',
                'fine_print = ?',
                'updated_by = ?',
                'updated_at = NOW()',
            ];
            $updateValues = [
                $scopeCategoryKey,
                $enabled ? 1 : 0,
                $providerLabel,
                $storedPaymentUrl,
                $buttonText,
                $limitSeats,
                $overLimitMessage,
                $finePrint,
                $actor,
            ];
            if ($hasProviderTypeColumn) {
                $updateParts[] = 'provider_type = ?';
                $updateValues[] = $providerType;
            }
            if ($hasPaypalHostedButtonIdColumn) {
                $updateParts[] = 'paypal_hosted_button_id = ?';
                $updateValues[] = $providerType === 'paypal_hosted_button' ? $paypalHostedButtonId : null;
            }
            if ($hasPaypalCurrencyColumn) {
                $updateParts[] = 'paypal_currency = ?';
                $updateValues[] = $providerType === 'paypal_hosted_button' ? $paypalCurrency : 'USD';
            }
            if ($hasPaypalEnableVenmoColumn) {
                $updateParts[] = 'paypal_enable_venmo = ?';
                $updateValues[] = $providerType === 'paypal_hosted_button' ? $paypalEnableVenmo : 0;
            }
            $updateValues[] = $existingId;
            $updateSql = 'UPDATE payment_settings SET ' . implode(', ', $updateParts) . ' WHERE id = ?';
            $update = $pdo->prepare($updateSql);
            $update->execute($updateValues);
            $settingId = $existingId;
        } else {
            $insertColumns = [
                'scope',
                'category_id',
                'enabled',
                'provider_label',
                'payment_url',
                'button_text',
                'limit_seats',
                'over_limit_message',
                'fine_print',
                'created_by',
                'updated_by',
            ];
            $insertValues = [
                $scope,
                $scopeCategoryKey,
                $enabled ? 1 : 0,
                $providerLabel,
                $storedPaymentUrl,
                $buttonText,
                $limitSeats,
                $overLimitMessage,
                $finePrint,
                $actor,
                $actor,
            ];
            if ($hasProviderTypeColumn) {
                $insertColumns[] = 'provider_type';
                $insertValues[] = $providerType;
            }
            if ($hasPaypalHostedButtonIdColumn) {
                $insertColumns[] = 'paypal_hosted_button_id';
                $insertValues[] = $providerType === 'paypal_hosted_button' ? $paypalHostedButtonId : null;
            }
            if ($hasPaypalCurrencyColumn) {
                $insertColumns[] = 'paypal_currency';
                $insertValues[] = $providerType === 'paypal_hosted_button' ? $paypalCurrency : 'USD';
            }
            if ($hasPaypalEnableVenmoColumn) {
                $insertColumns[] = 'paypal_enable_venmo';
                $insertValues[] = $providerType === 'paypal_hosted_button' ? $paypalEnableVenmo : 0;
            }
            $placeholders = implode(', ', array_fill(0, count($insertColumns), '?'));
            $insertSql = 'INSERT INTO payment_settings (' . implode(', ', $insertColumns) . ') VALUES (' . $placeholders . ')';
            $insert = $pdo->prepare($insertSql);
            $insert->execute($insertValues);
            $settingId = (int) $pdo->lastInsertId();
        }

        record_audit('payment_settings.save', 'payment_settings', $settingId, [
            'scope' => $scope,
            'category_id' => $scopeCategoryKey,
            'enabled' => $enabled,
            'provider_type' => $providerType,
            'limit_seats' => $limitSeats,
        ]);

        $fetch = $pdo->prepare("SELECT ps.*, ec.name AS category_name, ec.slug AS category_slug FROM payment_settings ps LEFT JOIN event_categories ec ON ec.id = ps.category_id WHERE ps.id = ? LIMIT 1");
        $fetch->execute([$settingId]);
        $row = $fetch->fetch() ?: null;
        if ($row) {
            $row['enabled'] = !empty($row['enabled']);
            $row['limit_seats'] = (int) ($row['limit_seats'] ?? 6);
            if ($row['limit_seats'] <= 0) {
                $row['limit_seats'] = 6;
            }
            $row['provider_type'] = normalize_payment_provider_type($row['provider_type'] ?? 'external_link');
            $row['paypal_currency'] = normalize_paypal_currency($row['paypal_currency'] ?? 'USD');
            $row['paypal_enable_venmo'] = !empty($row['paypal_enable_venmo']);
            $row['paypal_hosted_button_id'] = normalize_paypal_hosted_button_id($row['paypal_hosted_button_id'] ?? null);
        }
        Response::success(['payment_setting' => $row]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('PUT /api/admin/payment-settings error: ' . $e->getMessage());
        }
        Response::error('Failed to save payment settings', 500);
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
        $hasOccurrencesTable = event_occurrences_table_exists($pdo);
        $occurrencesInputProvided = array_key_exists('occurrences', $payload);
        if ($occurrencesInputProvided && !is_array($payload['occurrences'])) {
            return Response::error('occurrences must be an array', 422);
        }
        $occurrencesPayload = $occurrencesInputProvided ? array_values($payload['occurrences'] ?? []) : [];
        if ($occurrencesPayload && !$hasOccurrencesTable) {
            return Response::error('Run database/20251212_schema_upgrade.sql to enable multi-day events.', 422);
        }
        $recurrenceError = null;
        $recurrence = normalize_recurrence_request_payload($payload['recurrence'] ?? null, $recurrenceError);
        if ($recurrenceError !== null) {
            return Response::error($recurrenceError, 422);
        }
        if ($recurrence && !empty($recurrence['enabled']) && $occurrencesPayload) {
            return Response::error('Recurring generation cannot be combined with multi-day occurrences.', 422);
        }
        $isSeriesMaster = array_key_exists('is_series_master', $payload) ? !empty($payload['is_series_master']) : false;
        if ($recurrence && !empty($recurrence['enabled'])) {
            $isSeriesMaster = true;
        }
        $eventDate = isset($payload['event_date']) ? trim((string) $payload['event_date']) : null;
        $eventTime = isset($payload['event_time']) ? trim((string) $payload['event_time']) : null;
        $eventDate = $eventDate !== '' ? $eventDate : null;
        $eventTime = $eventTime !== '' ? $eventTime : null;
        if ($eventDate === null && $recurrence && !empty($recurrence['enabled'])) {
            $eventDate = $recurrence['starts_on'];
        }
        $hasExplicitScheduleInput = $occurrencesInputProvided;
        foreach (['start_datetime', 'event_date', 'event_time', 'door_time', 'end_datetime'] as $scheduleField) {
            if (!array_key_exists($scheduleField, $payload)) {
                continue;
            }
            $value = $payload[$scheduleField];
            if (is_string($value)) {
                if (trim($value) !== '') {
                    $hasExplicitScheduleInput = true;
                    break;
                }
                continue;
            }
            if ($value !== null) {
                $hasExplicitScheduleInput = true;
                break;
            }
        }
        $allowMissingSchedule = $isSeriesMaster && !$hasExplicitScheduleInput && !($recurrence['enabled'] ?? false);
        $doorTimeRaw = $payload['door_time'] ?? null;
        $doorTime = normalize_door_time_input($doorTimeRaw);
        if (!$occurrencesPayload && $doorTime === null && !$allowMissingSchedule) {
            return Response::error('door_time is required and must include a valid date and time.', 422);
        }
        if ($occurrencesPayload && $doorTime === null && $doorTimeRaw !== null && trim((string) $doorTimeRaw) !== '') {
            return Response::error('door_time must include a valid date and time when provided.', 422);
        }
        $recurrenceExceptions = $recurrence && !empty($recurrence['enabled'])
            ? ($recurrence['exceptions'] ?? [])
            : [];
        if ($recurrence && !empty($recurrence['enabled'])) {
            $firstOccurrenceDate = resolve_recurrence_first_occurrence_date($recurrence, $recurrenceExceptions);
            if ($firstOccurrenceDate === null) {
                return Response::error('Unable to resolve the first recurring date from recurrence settings.', 422);
            }
            $eventDate = $firstOccurrenceDate;
            $doorTimeOfDay = extract_time_of_day_from_value($doorTime, $timezone);
            if ($doorTimeOfDay !== null) {
                $doorTime = build_occurrence_door_datetime($eventDate, $doorTimeOfDay, $timezone);
            }
        }
        $startInput = $payload['start_datetime'] ?? null;
        $startDt = null;
        if (!$occurrencesPayload && $eventDate && $eventTime) {
            $startDt = build_event_start_datetime($eventDate, $eventTime, $timezone);
            if (!$startDt) {
                return Response::error('Invalid event_date or event_time value', 422);
            }
        } elseif (!$occurrencesPayload && $startInput) {
            try {
                $startDt = new DateTimeImmutable($startInput, new DateTimeZone($timezone));
            } catch (Throwable $e) {
                return Response::error('Invalid event_date or event_time value', 422);
            }
        }
        if (!$startDt && !$occurrencesPayload && !$allowMissingSchedule) {
            return Response::error('event_date and event_time are required', 422);
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
        $durationSeconds = resolve_event_duration_seconds([
            'start_datetime' => $startDt ? $startDt->format('Y-m-d H:i:s') : $startInput,
            'end_datetime' => $endDt ? $endDt->format('Y-m-d H:i:s') : $endInput,
            'event_date' => $eventDate,
            'event_time' => $eventTime,
            'timezone' => $timezone,
        ]);
        $occurrenceSyncPreview = null;
        if ($occurrencesPayload) {
            $occurrenceError = null;
            $occurrenceRows = normalize_event_occurrence_rows($occurrencesPayload, $timezone, $doorTime, $durationSeconds, $occurrenceError);
            if (!$occurrenceRows) {
                return Response::error($occurrenceError ?: 'At least one valid occurrence is required.', 422);
            }
            $occurrenceSyncPreview = $occurrenceRows;
            try {
                $startDt = new DateTimeImmutable($occurrenceRows[0]['start_datetime'], new DateTimeZone($timezone));
                $endDt = new DateTimeImmutable($occurrenceRows[count($occurrenceRows) - 1]['end_datetime'], new DateTimeZone($timezone));
            } catch (Throwable $error) {
                return Response::error('One or more occurrences could not be parsed.', 422);
            }
            $eventDate = $occurrenceRows[0]['occurrence_date'];
            $eventTime = $occurrenceRows[0]['start_time'];
            $doorTime = $occurrenceRows[0]['door_datetime'] ?? $doorTime;
        }
        $slugBase = slugify_string($payload['slug'] ?? ($title . ($startDt ? '-' . $startDt->format('Ymd') : '')));
        $slug = ensure_unique_slug($pdo, $slugBase);
        $venueCode = strtoupper(trim((string)($payload['venue_code'] ?? 'MMH')));
        if (!in_array($venueCode, ['MMH','TGP'], true)) {
            $venueCode = 'MMH';
        }
        $ticketPrice = $payload['ticket_price'] ?? null;
        $doorPrice = $payload['door_price'] ?? null;
        $ticketTypeInput = $payload['ticket_type'] ?? 'general_admission';
        $ticketType = in_array($ticketTypeInput, ['general_admission', 'reserved_seating', 'hybrid'], true)
            ? $ticketTypeInput
            : 'general_admission';
        $statusInput = array_key_exists('status', $payload) ? trim((string) $payload['status']) : '';
        $visibilityInput = array_key_exists('visibility', $payload) ? trim((string) $payload['visibility']) : '';
        $status = in_array($statusInput, ['draft','published','archived'], true) ? $statusInput : 'draft';
        $visibility = in_array($visibilityInput, ['public','private'], true) ? $visibilityInput : 'private';
        $hasArchivedColumn = events_table_has_column($pdo, 'archived_at');
        $archivedAt = null;
        if ($status === 'archived') {
            $visibility = 'private';
            if ($hasArchivedColumn) {
                $archivedAt = mysql_now();
            }
        }
        $rawLayoutId = array_key_exists('layout_id', $payload) ? $payload['layout_id'] : null;
        $layoutId = normalize_layout_identifier($rawLayoutId);
        $rawRequestedVersion = array_key_exists('layout_version_id', $payload) ? $payload['layout_version_id'] : null;
        $requestedVersion = normalize_layout_identifier($rawRequestedVersion);
        $explicitSeating = array_key_exists('seating_enabled', $payload) ? (!empty($payload['seating_enabled']) ? 1 : 0) : null;
        $seatingEnabled = $explicitSeating ?? ($layoutId ? 1 : 0);
        if (!$layoutId) {
            $seatingEnabled = 0;
        }
        $layoutVersionId = $layoutId ? ensure_event_layout_version($pdo, $layoutId, $requestedVersion) : null;
        $hasPricingConfigColumn = events_table_has_column($pdo, 'pricing_config');
        $pricingConfigPayloadProvided = array_key_exists('pricing_config', $payload)
            && $payload['pricing_config'] !== null
            && $payload['pricing_config'] !== ''
            && $payload['pricing_config'] !== false;
        $pricingConfig = null;
        if ($hasPricingConfigColumn) {
            $pricingConfigError = null;
            $layoutRowsForPricing = fetch_layout_rows_for_assignment($pdo, $layoutId, $layoutVersionId);
            $pricingConfig = normalize_event_pricing_config_input($payload['pricing_config'] ?? null, $layoutRowsForPricing, $pricingConfigError);
            if ($pricingConfigError !== null) {
                return Response::error($pricingConfigError, 422);
            }
        } elseif ($pricingConfigPayloadProvided) {
            return Response::error('Run database/20251212_schema_upgrade.sql to enable tiered pricing.', 422);
        }
        [$pricingMin, $pricingMax] = $pricingConfig ? get_event_pricing_config_range($pricingConfig) : [null, null];

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
        $seriesScheduleLabel = normalize_series_meta_field($payload['series_schedule_label'] ?? null);
        $seriesSummary = normalize_series_meta_field($payload['series_summary'] ?? null);
        $seriesFooter = normalize_series_meta_field($payload['series_footer_note'] ?? null);

        $hasPaymentEnabledColumn = events_table_has_column($pdo, 'payment_enabled');
        $paymentEnabled = $hasPaymentEnabledColumn && !empty($payload['payment_enabled']) ? 1 : 0;

        $contactPhoneRaw = $payload['contact_phone_raw'] ?? $payload['contact_phone'] ?? null;
        $contactPhoneNormalized = normalize_phone_number($contactPhoneRaw);
        $startString = $startDt ? $startDt->format('Y-m-d H:i:s') : null;
        $endString = $endDt ? $endDt->format('Y-m-d H:i:s') : null;
        $publishAt = $payload['publish_at'] ?? ($status === 'published' && $startString ? $startString : null);
        $hasContactNotesColumn = events_table_has_column($pdo, 'contact_notes');
        $insertColumns = [
            'artist_name' => $artist,
            'title' => $title,
            'slug' => $slug,
            'description' => $payload['description'] ?? null,
            'notes' => $payload['notes'] ?? null,
            'genre' => $payload['genre'] ?? null,
            'category_tags' => $categoryTags,
            'category_id' => $categoryId,
            'image_url' => $payload['image_url'] ?? null,
            'hero_image_id' => $payload['hero_image_id'] ?? null,
            'poster_image_id' => $payload['poster_image_id'] ?? null,
            'ticket_price' => $ticketPrice,
            'door_price' => $doorPrice,
            'min_ticket_price' => $payload['min_ticket_price'] ?? $ticketPrice ?? $pricingMin,
            'max_ticket_price' => $payload['max_ticket_price'] ?? $doorPrice ?? $ticketPrice ?? $pricingMax,
            'ticket_type' => $ticketType,
            'seating_enabled' => $seatingEnabled,
            'venue_code' => $venueCode,
            'venue_section' => $payload['venue_section'] ?? null,
            'timezone' => $timezone,
            'start_datetime' => $startString,
            'end_datetime' => $endString,
            'door_time' => $doorTime,
            'event_date' => $startDt ? $startDt->format('Y-m-d') : ($payload['event_date'] ?? null),
            'event_time' => $startDt ? $startDt->format('H:i:s') : ($payload['event_time'] ?? null),
            'age_restriction' => $payload['age_restriction'] ?? 'All Ages',
            'status' => $status,
            'visibility' => $visibility,
            'publish_at' => $publishAt,
            'layout_id' => $layoutId,
            'layout_version_id' => $layoutVersionId,
            'series_master_id' => null,
            'is_series_master' => $isSeriesMaster ? 1 : 0,
            'ticket_url' => $payload['ticket_url'] ?? null,
            'contact_name' => $payload['contact_name'] ?? null,
            'contact_phone_raw' => $contactPhoneRaw,
            'contact_phone_normalized' => $contactPhoneNormalized,
            'contact_email' => $payload['contact_email'] ?? null,
        ];
        if ($hasContactNotesColumn) {
            $insertColumns['contact_notes'] = $payload['contact_notes'] ?? null;
        }
        if ($hasPaymentEnabledColumn) {
            $insertColumns['payment_enabled'] = $paymentEnabled;
        }
        if ($hasPricingConfigColumn) {
            $insertColumns['pricing_config'] = $pricingConfig ? json_encode($pricingConfig) : null;
        }
        if ($hasArchivedColumn) {
            $insertColumns['archived_at'] = $archivedAt;
        }
        $insertColumns['seat_request_email_override'] = $seatRequestOverride;
        $insertColumns['change_note'] = 'created via API';
        $insertColumns['created_by'] = 'api';
        $insertColumns['updated_by'] = 'api';
        $placeholders = implode(', ', array_fill(0, count($insertColumns), '?'));
        $sql = 'INSERT INTO events (' . implode(', ', array_keys($insertColumns)) . ") VALUES ({$placeholders})";
        $pdo->beginTransaction();
        $stmt = $pdo->prepare($sql);
        $stmt->execute(array_values($insertColumns));
        $id = (int)$pdo->lastInsertId();
        save_event_series_meta($pdo, $id, $seriesScheduleLabel, $seriesSummary, $seriesFooter);
        $recurrenceId = upsert_event_recurrence_rule($pdo, $id, $recurrence ?? ['enabled' => false], 'api');
        if ($recurrenceId && $recurrence && ($recurrence['exceptions_provided'] ?? false)) {
            $recurrenceExceptions = replace_recurrence_exceptions($pdo, $recurrenceId, $recurrence['exceptions'] ?? [], 'api');
        }
        $recurrenceSync = $recurrenceId
            ? sync_generated_recurrence_children($pdo, $id, $recurrence, $recurrenceId, $recurrenceExceptions ?? [])
            : null;
        if ($hasOccurrencesTable && $startString !== null) {
            $syncPayload = $occurrencesPayload ?: [[
                'occurrence_date' => $eventDate,
                'start_time' => $eventTime,
            ]];
            $syncError = null;
            $syncResult = sync_event_occurrences($pdo, $id, $syncPayload, $timezone, $doorTime, $durationSeconds, $syncError);
            if (!$syncResult) {
                throw new RuntimeException($syncError ?: 'Unable to save event occurrences.');
            }
        }
        $pdo->commit();
        record_audit('event.create', 'event', $id, [
            'slug' => $slug,
            'status' => $status,
            'visibility' => $visibility,
            'venue' => $venueCode,
            'category_id' => $categoryId,
            'seating_enabled' => (bool) $seatingEnabled,
            'is_series_master' => $isSeriesMaster,
            'recurrence_id' => $recurrenceId,
            'recurrence_sync' => $recurrenceSync,
        ]);
        Response::success(['id' => $id, 'slug' => $slug]);
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (APP_DEBUG) {
            error_log('POST /api/events error: ' . $e->getMessage());
        }
        $errorExtra = APP_DEBUG ? ['error' => $e->getMessage()] : [];
        Response::error('Failed to create event', 500, $errorExtra);
    }
});

$router->add('PUT', '/api/events/:id', function (Request $request, $params) {
    try {
        $pdo = Database::connection();
        $hasCategoryTable = event_categories_table_exists($pdo);
        $hasContactNotesColumn = events_table_has_column($pdo, 'contact_notes');
        $hasPaymentEnabledColumn = events_table_has_column($pdo, 'payment_enabled');
        $hasPricingConfigColumn = events_table_has_column($pdo, 'pricing_config');
        $eventId = (int)$params['id'];
        $existingStmt = $pdo->prepare('SELECT * FROM events WHERE id = ? LIMIT 1');
        $existingStmt->execute([$eventId]);
        $existing = $existingStmt->fetch();
        if (!$existing) {
            return Response::error('Event not found', 404);
        }
        $existingMeta = fetch_event_series_meta($pdo, $eventId);
        $payload = read_json_body($request);
        $hasOccurrencesTable = event_occurrences_table_exists($pdo);
        $existingOccurrences = $hasOccurrencesTable ? fetch_event_occurrences($pdo, $eventId) : [];
        $existingIsMultiDay = count($existingOccurrences) > 1;
        $occurrencesInputProvided = array_key_exists('occurrences', $payload);
        if ($occurrencesInputProvided && !is_array($payload['occurrences'])) {
            return Response::error('occurrences must be an array', 422);
        }
        $occurrencesPayload = $occurrencesInputProvided ? array_values($payload['occurrences'] ?? []) : [];
        if ($occurrencesPayload && !$hasOccurrencesTable) {
            return Response::error('Run database/20251212_schema_upgrade.sql to enable multi-day events.', 422);
        }
        $recurrenceInputProvided = array_key_exists('recurrence', $payload);
        $recurrenceError = null;
        $recurrence = $recurrenceInputProvided
            ? normalize_recurrence_request_payload($payload['recurrence'] ?? null, $recurrenceError)
            : null;
        if ($recurrenceInputProvided && $recurrenceError !== null) {
            return Response::error($recurrenceError, 422);
        }
        $existingRecurrenceStmt = $pdo->prepare('SELECT * FROM event_recurrence_rules WHERE event_id = ? LIMIT 1');
        $existingRecurrenceStmt->execute([$eventId]);
        $existingRecurrenceRow = $existingRecurrenceStmt->fetch() ?: null;
        $existingRecurrenceExceptions = $existingRecurrenceRow
            ? load_recurrence_exceptions($pdo, (int) $existingRecurrenceRow['id'])
            : [];
        $activeRecurrence = $recurrenceInputProvided
            ? $recurrence
            : ($existingRecurrenceRow ? recurrence_rule_row_to_payload($existingRecurrenceRow) : null);
        $activeRecurrenceExceptions = ($recurrenceInputProvided && $recurrence && ($recurrence['exceptions_provided'] ?? false))
            ? ($recurrence['exceptions'] ?? [])
            : $existingRecurrenceExceptions;
        if ($activeRecurrence && !empty($activeRecurrence['enabled']) && $occurrencesPayload) {
            return Response::error('Recurring generation cannot be combined with multi-day occurrences.', 422);
        }
        $isSeriesMaster = array_key_exists('is_series_master', $payload)
            ? !empty($payload['is_series_master'])
            : !empty($existing['is_series_master']);
        if ($activeRecurrence && !empty($activeRecurrence['enabled'])) {
            $isSeriesMaster = true;
        }
        $hasExplicitScheduleInput = $occurrencesInputProvided;
        foreach (['start_datetime', 'event_date', 'event_time', 'door_time', 'end_datetime'] as $scheduleField) {
            if (!array_key_exists($scheduleField, $payload)) {
                continue;
            }
            $value = $payload[$scheduleField];
            if (is_string($value)) {
                if (trim($value) !== '') {
                    $hasExplicitScheduleInput = true;
                    break;
                }
                continue;
            }
            if ($value !== null) {
                $hasExplicitScheduleInput = true;
                break;
            }
        }
        $multiDayEnabled = array_key_exists('multi_day_enabled', $payload)
            ? !empty($payload['multi_day_enabled'])
            : ($existingIsMultiDay || count($occurrencesPayload) > 1);
        $allowMissingSchedule = $isSeriesMaster && !$hasExplicitScheduleInput && !($activeRecurrence['enabled'] ?? false);
        $artist = trim((string)($payload['artist_name'] ?? $existing['artist_name']));
        if ($artist === '') {
            return Response::error('artist_name is required', 400);
        }
        $title = trim((string)($payload['title'] ?? $existing['title'] ?? $artist));
        $timezone = $payload['timezone'] ?? $existing['timezone'] ?? 'America/New_York';
        $eventDateInput = array_key_exists('event_date', $payload) ? trim((string) $payload['event_date']) : null;
        $eventTimeInput = array_key_exists('event_time', $payload) ? trim((string) $payload['event_time']) : null;
        $eventDate = $eventDateInput !== null ? ($eventDateInput !== '' ? $eventDateInput : null) : ($existing['event_date'] ?? null);
        $eventTime = $eventTimeInput !== null ? ($eventTimeInput !== '' ? $eventTimeInput : null) : ($existing['event_time'] ?? null);
        if ($eventDate === null && $activeRecurrence && !empty($activeRecurrence['enabled'])) {
            $eventDate = $activeRecurrence['starts_on'];
        }
        $startInput = $payload['start_datetime'] ?? null;
        $shouldRecomputeStart = $occurrencesInputProvided
            || array_key_exists('event_date', $payload)
            || array_key_exists('event_time', $payload)
            || array_key_exists('timezone', $payload)
            || array_key_exists('start_datetime', $payload);
        $startDt = null;
        if ($shouldRecomputeStart && !$occurrencesPayload) {
            if ($eventDate && $eventTime) {
                $startDt = build_event_start_datetime($eventDate, $eventTime, $timezone);
                if (!$startDt && !$allowMissingSchedule) {
                    return Response::error('Invalid event_date or event_time value', 422);
                }
            } elseif ($startInput) {
                try {
                    $startDt = new DateTimeImmutable($startInput, new DateTimeZone($timezone));
                } catch (Throwable $e) {
                    return Response::error('Invalid event_date or event_time value', 422);
                }
            }
        } else {
            try {
                $startDt = $existing['start_datetime']
                    ? new DateTimeImmutable($existing['start_datetime'], new DateTimeZone($timezone))
                    : null;
            } catch (Throwable $e) {
                return Response::error('Invalid event_date or event_time value', 422);
            }
        }
        if (!$startDt && !$occurrencesPayload && $eventDate && $eventTime) {
            $startDt = build_event_start_datetime($eventDate, $eventTime, $timezone);
        }
        if ($eventDate === null && $startDt) {
            $eventDate = $startDt->format('Y-m-d');
        }
        if ($eventTime === null && $startDt) {
            $eventTime = $startDt->format('H:i:s');
        }
        if (!$startDt && !$allowMissingSchedule && !$occurrencesPayload) {
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
        if (!$endInput && $startDt && $endDt && $endDt < $startDt && $shouldRecomputeStart) {
            $endDt = null;
        }
        $doorTimeInputProvided = array_key_exists('door_time', $payload);
        $doorTimeInput = $doorTimeInputProvided
            ? $payload['door_time']
            : ($occurrencesPayload ? null : ($existing['door_time'] ?? null));
        if ($allowMissingSchedule && !$doorTimeInputProvided && !$occurrencesPayload) {
            $doorTime = $existing['door_time'] ?? null;
        } else {
            $doorTime = normalize_door_time_input($doorTimeInput);
            $doorTimeValueProvided = $doorTimeInputProvided && trim((string) $doorTimeInput) !== '';
            if ($doorTime === null && !$occurrencesPayload && (!$allowMissingSchedule || $doorTimeInputProvided)) {
                return Response::error('door_time is required and must include a valid date and time.', 422);
            }
            if ($doorTime === null && $occurrencesPayload && $doorTimeValueProvided) {
                return Response::error('door_time must include a valid date and time when provided.', 422);
            }
        }
        if ($activeRecurrence && !empty($activeRecurrence['enabled'])) {
            $firstOccurrenceDate = resolve_recurrence_first_occurrence_date($activeRecurrence, $activeRecurrenceExceptions);
            if ($firstOccurrenceDate === null) {
                return Response::error('Unable to resolve the first recurring date from recurrence settings.', 422);
            }
            $eventDate = $firstOccurrenceDate;
            if (!$eventTime) {
                return Response::error('event_time is required for recurring events.', 422);
            }
            $startDt = build_event_start_datetime($eventDate, $eventTime, $timezone);
            if (!$startDt) {
                return Response::error('Invalid event_date or event_time value', 422);
            }
            if ($doorTime !== null) {
                $doorTimeOfDay = extract_time_of_day_from_value($doorTime, $timezone);
                if ($doorTimeOfDay !== null) {
                    $doorTime = build_occurrence_door_datetime($eventDate, $doorTimeOfDay, $timezone);
                }
            }
        }
        $durationSeconds = resolve_event_duration_seconds([
            'start_datetime' => $startDt ? $startDt->format('Y-m-d H:i:s') : ($existing['start_datetime'] ?? null),
            'end_datetime' => $endDt ? $endDt->format('Y-m-d H:i:s') : ($existing['end_datetime'] ?? null),
            'event_date' => $eventDate,
            'event_time' => $eventTime,
            'timezone' => $timezone,
        ]);
        if ($occurrencesPayload) {
            $occurrenceError = null;
            $occurrenceRows = normalize_event_occurrence_rows($occurrencesPayload, $timezone, $doorTime, $durationSeconds, $occurrenceError);
            if (!$occurrenceRows) {
                return Response::error($occurrenceError ?: 'At least one valid occurrence is required.', 422);
            }
            try {
                $startDt = new DateTimeImmutable($occurrenceRows[0]['start_datetime'], new DateTimeZone($timezone));
                $endDt = new DateTimeImmutable($occurrenceRows[count($occurrenceRows) - 1]['end_datetime'], new DateTimeZone($timezone));
            } catch (Throwable $error) {
                return Response::error('One or more occurrences could not be parsed.', 422);
            }
            $eventDate = $occurrenceRows[0]['occurrence_date'];
            $eventTime = $occurrenceRows[0]['start_time'];
            $doorTime = $occurrenceRows[0]['door_datetime'] ?? $doorTime;
        } elseif ($hasOccurrencesTable && $existingIsMultiDay && $multiDayEnabled && $hasExplicitScheduleInput) {
            return Response::error('occurrences are required when updating a multi-day event schedule.', 422);
        }
        $slugInput = $payload['slug'] ?? $existing['slug'] ?? null;
        $slugBase = slugify_string($slugInput ?? ($title . ($startDt ? '-' . $startDt->format('Ymd') : '')));
        $slug = ensure_unique_slug($pdo, $slugBase, $eventId);
        $seriesMasterId = array_key_exists('series_master_id', $payload)
            ? normalize_nullable_int($payload['series_master_id'])
            : normalize_nullable_int($existing['series_master_id'] ?? null);
        if ($isSeriesMaster) {
            $seriesMasterId = null;
        }
        $venueCode = strtoupper(trim((string)($payload['venue_code'] ?? $existing['venue_code'] ?? 'MMH')));
        if (!in_array($venueCode, ['MMH','TGP'], true)) {
            $venueCode = $existing['venue_code'] ?? 'MMH';
        }
        $ticketType = in_array($payload['ticket_type'] ?? $existing['ticket_type'] ?? 'general_admission', ['general_admission','reserved_seating','hybrid'], true) ? ($payload['ticket_type'] ?? $existing['ticket_type']) : ($existing['ticket_type'] ?? 'general_admission');
        $existingStatus = trim((string) ($existing['status'] ?? ''));
        if (!in_array($existingStatus, ['draft', 'published', 'archived'], true)) {
            $existingStatus = 'draft';
        }
        $existingVisibility = trim((string) ($existing['visibility'] ?? ''));
        if (!in_array($existingVisibility, ['public', 'private'], true)) {
            $existingVisibility = 'private';
        }
        $status = $existingStatus;
        if (array_key_exists('status', $payload)) {
            $statusInput = trim((string) $payload['status']);
            $status = in_array($statusInput, ['draft', 'published', 'archived'], true) ? $statusInput : $existingStatus;
        }
        $visibility = $existingVisibility;
        if (array_key_exists('visibility', $payload)) {
            $visibilityInput = trim((string) $payload['visibility']);
            $visibility = in_array($visibilityInput, ['public', 'private'], true) ? $visibilityInput : $existingVisibility;
        }
        $hasArchivedColumn = events_table_has_column($pdo, 'archived_at');
        $archivedAt = $existing['archived_at'] ?? null;
        $touchArchivedAt = false;
        if ($hasArchivedColumn && array_key_exists('status', $payload)) {
            if ($status === 'archived') {
                $archivedAt = mysql_now();
                $visibility = 'private';
                $touchArchivedAt = true;
            } else {
                $archivedAt = null;
                $touchArchivedAt = true;
            }
        }
        $seatingEnabled = array_key_exists('seating_enabled', $payload) ? (!empty($payload['seating_enabled']) ? 1 : 0) : (int) $existing['seating_enabled'];
        $existingLayoutId = normalize_layout_identifier($existing['layout_id'] ?? null);
        $existingLayoutVersionId = normalize_layout_identifier($existing['layout_version_id'] ?? null);
        $layoutIdProvided = array_key_exists('layout_id', $payload);
        $rawLayoutValue = $layoutIdProvided ? $payload['layout_id'] : ($existing['layout_id'] ?? null);
        $layoutId = normalize_layout_identifier($rawLayoutValue);
        if ($layoutId === null && !$layoutIdProvided) {
            $layoutId = $existingLayoutId;
        }
        $layoutVersionProvided = array_key_exists('layout_version_id', $payload);
        $rawVersionValue = $layoutVersionProvided ? $payload['layout_version_id'] : ($existing['layout_version_id'] ?? null);
        $requestedVersion = normalize_layout_identifier($rawVersionValue);
        $layoutChanged = $layoutIdProvided ? $layoutId !== $existingLayoutId : false;
        if (!$layoutId) {
            $seatingEnabled = 0;
        }
        $layoutVersionId = $existingLayoutVersionId;
        $snapshotMeta = null;
        if ($layoutChanged) {
            if ($existingLayoutId) {
                $snapshotMeta = create_event_seating_snapshot($pdo, $eventId, 'pre_layout_change');
            }
            $layoutVersionId = $layoutId ? ensure_event_layout_version($pdo, $layoutId, $requestedVersion) : null;
        } elseif ($layoutVersionProvided && $layoutId) {
            $layoutVersionId = ensure_event_layout_version($pdo, $layoutId, $requestedVersion);
        } elseif (!$layoutId) {
            $layoutVersionId = null;
        }
        $pricingConfigPayloadProvided = array_key_exists('pricing_config', $payload)
            && $payload['pricing_config'] !== null
            && $payload['pricing_config'] !== ''
            && $payload['pricing_config'] !== false;
        $pricingConfig = $hasPricingConfigColumn
            ? decode_event_pricing_config($existing['pricing_config'] ?? null)
            : null;
        if ($hasPricingConfigColumn) {
            if (array_key_exists('pricing_config', $payload)) {
                $pricingConfigError = null;
                $layoutRowsForPricing = fetch_layout_rows_for_assignment($pdo, $layoutId, $layoutVersionId);
                $pricingConfig = normalize_event_pricing_config_input($payload['pricing_config'], $layoutRowsForPricing, $pricingConfigError);
                if ($pricingConfigError !== null) {
                    return Response::error($pricingConfigError, 422);
                }
            }
        } elseif ($pricingConfigPayloadProvided) {
            return Response::error('Run database/20251212_schema_upgrade.sql to enable tiered pricing.', 422);
        }
        [$pricingMin, $pricingMax] = $pricingConfig ? get_event_pricing_config_range($pricingConfig) : [null, null];

        $categoryTags = $payload['category_tags'] ?? $existing['category_tags'];
        if (is_array($categoryTags)) {
            $categoryTags = json_encode($categoryTags);
        } elseif (is_string($categoryTags)) {
            $decoded = json_decode($categoryTags, true);
            $categoryTags = $decoded ? json_encode($decoded) : $existing['category_tags'];
        }

        $valueOrExisting = static function (string $key, ?callable $transform = null) use ($payload, $existing) {
            if (array_key_exists($key, $payload)) {
                $value = $payload[$key];
                return $transform ? $transform($value) : $value;
            }
            return $existing[$key] ?? null;
        };

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
        $seriesScheduleLabel = array_key_exists('series_schedule_label', $payload)
            ? normalize_series_meta_field($payload['series_schedule_label'])
            : ($existingMeta['schedule_label'] ?? null);
        $seriesSummary = array_key_exists('series_summary', $payload)
            ? normalize_series_meta_field($payload['series_summary'])
            : ($existingMeta['summary'] ?? null);
        $seriesFooter = array_key_exists('series_footer_note', $payload)
            ? normalize_series_meta_field($payload['series_footer_note'])
            : ($existingMeta['footer_note'] ?? null);

        $contactPhoneRaw = $existing['contact_phone_raw'] ?? null;
        if (array_key_exists('contact_phone_raw', $payload)) {
            $contactPhoneRaw = normalize_nullable_text($payload['contact_phone_raw']);
        } elseif (array_key_exists('contact_phone', $payload)) {
            $contactPhoneRaw = normalize_nullable_text($payload['contact_phone']);
        }
        $contactPhoneNormalized = normalize_phone_number($contactPhoneRaw);
        $startString = $startDt ? $startDt->format('Y-m-d H:i:s') : null;
        $resolvedEventDate = $startDt ? $startDt->format('Y-m-d') : ($eventDateInput !== null ? $eventDate : ($existing['event_date'] ?? null));
        $resolvedEventTime = $startDt ? $startDt->format('H:i:s') : ($eventTimeInput !== null ? $eventTime : ($existing['event_time'] ?? null));
        $endString = $endDt ? $endDt->format('Y-m-d H:i:s') : null;

        $changeNoteInput = array_key_exists('change_note', $payload) ? trim((string) $payload['change_note']) : '';
        $changeNote = $changeNoteInput !== '' ? $changeNoteInput : 'updated via API';
        if ($layoutChanged && $snapshotMeta) {
            $snapshotLabel = sprintf('snapshot #%d', $snapshotMeta['id']);
            $changeNote = $changeNoteInput !== ''
                ? ($changeNoteInput . ' (' . $snapshotLabel . ')')
                : ('layout changed (' . $snapshotLabel . ')');
        }

        $paymentEnabled = null;
        if ($hasPaymentEnabledColumn) {
            if (array_key_exists('payment_enabled', $payload)) {
                $paymentEnabled = !empty($payload['payment_enabled']) ? 1 : 0;
            } else {
                $paymentEnabled = (int) ($existing['payment_enabled'] ?? 0);
            }
        }

        $resolvedTicketPrice = $valueOrExisting('ticket_price', 'normalize_nullable_decimal');
        $resolvedDoorPrice = $valueOrExisting('door_price', 'normalize_nullable_decimal');
        $resolvedMinTicketPrice = array_key_exists('min_ticket_price', $payload)
            ? normalize_nullable_decimal($payload['min_ticket_price'])
            : ($pricingMin ?? $valueOrExisting('min_ticket_price', 'normalize_nullable_decimal') ?? $resolvedTicketPrice);
        $resolvedMaxTicketPrice = array_key_exists('max_ticket_price', $payload)
            ? normalize_nullable_decimal($payload['max_ticket_price'])
            : ($pricingMax ?? $valueOrExisting('max_ticket_price', 'normalize_nullable_decimal') ?? $resolvedDoorPrice ?? $resolvedTicketPrice);
        $scheduleMetadataChanged = $hasExplicitScheduleInput || array_key_exists('timezone', $payload);
        $syncOccurrencePayload = null;
        if ($hasOccurrencesTable && !$allowMissingSchedule) {
            if ($occurrencesPayload) {
                $syncOccurrencePayload = $occurrencesPayload;
            } elseif (($multiDayEnabled === false || !$existingIsMultiDay) && $scheduleMetadataChanged && $startDt) {
                $syncOccurrencePayload = [[
                    'occurrence_date' => $resolvedEventDate,
                    'start_time' => $resolvedEventTime,
                ]];
            }
        }

        $updateColumns = [
            'artist_name' => $artist,
            'title' => $title,
            'slug' => $slug,
            'description' => $valueOrExisting('description', 'normalize_nullable_text'),
            'notes' => $valueOrExisting('notes', 'normalize_nullable_text'),
            'genre' => $valueOrExisting('genre', 'normalize_nullable_text'),
            'category_tags' => $categoryTags,
            'category_id' => $categoryId,
            'image_url' => $valueOrExisting('image_url', 'normalize_nullable_text'),
            'hero_image_id' => $valueOrExisting('hero_image_id', 'normalize_nullable_int'),
            'poster_image_id' => $valueOrExisting('poster_image_id', 'normalize_nullable_int'),
            'ticket_price' => $resolvedTicketPrice,
            'door_price' => $resolvedDoorPrice,
            'min_ticket_price' => $resolvedMinTicketPrice,
            'max_ticket_price' => $resolvedMaxTicketPrice,
            'ticket_type' => $ticketType,
            'seating_enabled' => $seatingEnabled,
            'venue_code' => $venueCode,
            'venue_section' => $valueOrExisting('venue_section', 'normalize_nullable_text'),
            'timezone' => $timezone,
            'start_datetime' => $startString,
            'end_datetime' => $endString,
            'door_time' => $doorTime,
            'event_date' => $resolvedEventDate,
            'event_time' => $resolvedEventTime,
            'age_restriction' => $valueOrExisting('age_restriction', 'normalize_nullable_text'),
            'status' => $status,
            'visibility' => $visibility,
            'publish_at' => array_key_exists('publish_at', $payload) ? $payload['publish_at'] : $existing['publish_at'],
            'layout_id' => $layoutId,
            'layout_version_id' => $layoutVersionId,
            'series_master_id' => $seriesMasterId,
            'is_series_master' => $isSeriesMaster ? 1 : 0,
            'ticket_url' => $valueOrExisting('ticket_url', 'normalize_nullable_text'),
            'contact_name' => $valueOrExisting('contact_name', 'normalize_nullable_text'),
            'contact_phone_raw' => $contactPhoneRaw,
            'contact_phone_normalized' => $contactPhoneNormalized,
            'contact_email' => $valueOrExisting('contact_email', 'normalize_nullable_text'),
        ];
        if ($hasContactNotesColumn) {
            $updateColumns['contact_notes'] = $valueOrExisting('contact_notes', 'normalize_nullable_text');
        }
        if ($hasArchivedColumn && $touchArchivedAt) {
            $updateColumns['archived_at'] = $archivedAt;
        }
        if ($hasPaymentEnabledColumn && $paymentEnabled !== null) {
            $updateColumns['payment_enabled'] = $paymentEnabled;
        }
        if ($hasPricingConfigColumn) {
            $updateColumns['pricing_config'] = $pricingConfig ? json_encode($pricingConfig) : null;
        }
        $updateColumns['seat_request_email_override'] = $seatRequestOverride;
        $updateColumns['change_note'] = $changeNote;
        $updateColumns['updated_by'] = 'api';
        $assignments = implode(', ', array_map(function ($col) {
            return "{$col} = ?";
        }, array_keys($updateColumns)));
        $sql = 'UPDATE events SET ' . $assignments . ' WHERE id = ?';
        $pdo->beginTransaction();
        $stmt = $pdo->prepare($sql);
        $values = array_values($updateColumns);
        $values[] = $eventId;
        $stmt->execute($values);
        save_event_series_meta($pdo, $eventId, $seriesScheduleLabel, $seriesSummary, $seriesFooter);
        $recurrenceId = $existingRecurrenceRow ? (int) $existingRecurrenceRow['id'] : null;
        $recurrenceSync = null;
        if ($recurrenceInputProvided) {
            $recurrenceId = upsert_event_recurrence_rule($pdo, $eventId, $activeRecurrence ?? ['enabled' => false], 'api');
            if ($recurrenceId && $activeRecurrence && !empty($activeRecurrence['enabled'])) {
                if ($activeRecurrence['exceptions_provided'] ?? false) {
                    $activeRecurrenceExceptions = replace_recurrence_exceptions($pdo, $recurrenceId, $activeRecurrence['exceptions'] ?? [], 'api');
                } else {
                    $activeRecurrenceExceptions = load_recurrence_exceptions($pdo, $recurrenceId);
                }
                $recurrenceSync = sync_generated_recurrence_children($pdo, $eventId, $activeRecurrence, $recurrenceId, $activeRecurrenceExceptions);
            } elseif ($existingRecurrenceRow) {
                $recurrenceSync = cleanup_disabled_recurrence_children($pdo, $eventId);
            }
        } elseif ($activeRecurrence && !empty($activeRecurrence['enabled']) && $isSeriesMaster) {
            $recurrenceSync = sync_generated_recurrence_children(
                $pdo,
                $eventId,
                $activeRecurrence,
                $existingRecurrenceRow ? (int) $existingRecurrenceRow['id'] : null,
                $activeRecurrenceExceptions
            );
        }
        if ($syncOccurrencePayload !== null) {
            $syncError = null;
            $syncResult = sync_event_occurrences($pdo, $eventId, $syncOccurrencePayload, $timezone, $doorTime, $durationSeconds, $syncError);
            if (!$syncResult) {
                throw new RuntimeException($syncError ?: 'Unable to save event occurrences.');
            }
        }
        $pdo->commit();
        record_audit('event.update', 'event', $eventId, [
            'slug' => $slug,
            'status' => $status,
            'visibility' => $visibility,
            'venue' => $venueCode,
            'category_id' => $categoryId,
            'seating_enabled' => (bool) $seatingEnabled,
            'seating_snapshot_id' => $snapshotMeta['id'] ?? null,
            'layout_id' => $layoutId,
            'layout_version_id' => $layoutVersionId,
            'series_master_id' => $seriesMasterId,
            'is_series_master' => $isSeriesMaster,
            'recurrence_id' => $recurrenceId,
            'recurrence_sync' => $recurrenceSync,
        ]);
        Response::success([
            'id' => $eventId,
            'slug' => $slug,
            'seating_snapshot_id' => $snapshotMeta['id'] ?? null,
        ]);
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (APP_DEBUG) {
            error_log('PUT /api/events/:id error: ' . $e->getMessage());
        }
        $errorExtra = APP_DEBUG ? ['error' => $e->getMessage()] : [];
        Response::error('Failed to update event', 500, $errorExtra);
    }
});

$router->add('GET', '/api/events/:id/seating-snapshots', function (Request $request, $params) {
    try {
        $pdo = Database::connection();
        if (!event_seating_snapshots_table_exists($pdo)) {
            return Response::success(['snapshots' => []]);
        }
        $eventId = (int) $params['id'];
        $limit = isset($request->query['limit']) ? (int) $request->query['limit'] : 5;
        if ($limit < 1) {
            $limit = 1;
        }
        if ($limit > 25) {
            $limit = 25;
        }
        $stmt = $pdo->prepare("SELECT id, layout_id, layout_version_id, snapshot_type, reserved_seats, pending_seats, hold_seats, notes, created_by, created_at FROM event_seating_snapshots WHERE event_id = ? ORDER BY id DESC LIMIT {$limit}");
        $stmt->execute([$eventId]);
        $snapshots = [];
        while ($row = $stmt->fetch()) {
            $snapshots[] = [
                'id' => (int) $row['id'],
                'snapshot_type' => $row['snapshot_type'],
                'layout_id' => $row['layout_id'] !== null ? (int) $row['layout_id'] : null,
                'layout_version_id' => $row['layout_version_id'] !== null ? (int) $row['layout_version_id'] : null,
                'reserved_seats' => $row['reserved_seats'] ? (json_decode($row['reserved_seats'], true) ?: []) : [],
                'pending_seats' => $row['pending_seats'] ? (json_decode($row['pending_seats'], true) ?: []) : [],
                'hold_seats' => $row['hold_seats'] ? (json_decode($row['hold_seats'], true) ?: []) : [],
                'notes' => $row['notes'] ?? null,
                'created_by' => $row['created_by'] ?? null,
                'created_at' => $row['created_at'],
            ];
        }
        Response::success(['snapshots' => $snapshots]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('GET /api/events/:id/seating-snapshots error: ' . $e->getMessage());
        }
        Response::error('Failed to load seating snapshots', 500);
    }
});

$router->add('POST', '/api/events/:id/restore-seating-snapshot', function (Request $request, $params) {
    $eventId = (int) $params['id'];
    $payload = read_json_body($request);
    $snapshotId = isset($payload['snapshot_id']) ? (int) $payload['snapshot_id'] : 0;
    if ($snapshotId <= 0) {
        return Response::error('snapshot_id is required', 400);
    }
    try {
        $pdo = Database::connection();
        if (!event_seating_snapshots_table_exists($pdo)) {
            return Response::error('Seating snapshots are not enabled', 400);
        }
        $stmt = $pdo->prepare('SELECT * FROM event_seating_snapshots WHERE id = ? AND event_id = ? LIMIT 1');
        $stmt->execute([$snapshotId, $eventId]);
        $snapshot = $stmt->fetch();
        if (!$snapshot) {
            return Response::error('Snapshot not found', 404);
        }
        $pdo->beginTransaction();
        $preSnapshot = create_event_seating_snapshot($pdo, $eventId, 'manual', 'Pre-restore checkpoint');
        $result = restore_event_seating_from_snapshot($pdo, $eventId, $snapshot);
        $pdo->commit();
        record_audit('seating.snapshot.restore', 'event', $eventId, [
            'snapshot_id' => $snapshotId,
            'pre_restore_snapshot_id' => $preSnapshot['id'] ?? null,
            'conflicts' => $result['conflicts'],
        ]);
        Response::success([
            'restored' => true,
            'snapshot_id' => $snapshotId,
            'pre_restore_snapshot_id' => $preSnapshot['id'] ?? null,
            'layout_id' => $result['layout_id'],
            'layout_version_id' => $result['layout_version_id'],
            'seating_enabled' => $result['seating_enabled'],
            'details' => $result,
        ]);
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (APP_DEBUG) {
            error_log('POST /api/events/:id/restore-seating-snapshot error: ' . $e->getMessage());
        }
        Response::error('Failed to restore seating snapshot', 500);
    }
});

$router->add('POST', '/api/events/:id/refresh-layout', function (Request $request, $params) {
    try {
        $pdo = Database::connection();
        $eventId = (int) $params['id'];
        $stmt = $pdo->prepare('SELECT id, layout_id, layout_version_id FROM events WHERE id = ? LIMIT 1');
        $stmt->execute([$eventId]);
        $event = $stmt->fetch();
        if (!$event) {
            return Response::error('Event not found', 404);
        }
        $layoutId = (int) ($event['layout_id'] ?? 0);
        if (!$layoutId) {
            return Response::error('Assign a seating layout before refreshing.', 422);
        }
        $actor = audit_log_actor();
        $newVersionId = snapshot_layout_version($pdo, $layoutId, 'manual-refresh', $actor);
        if (!$newVersionId) {
            return Response::error('Unable to snapshot the selected layout.', 500);
        }
        $update = $pdo->prepare('UPDATE events SET layout_version_id = ?, change_note = ?, updated_by = ? WHERE id = ?');
        $update->execute([$newVersionId, 'layout refresh via admin', $actor, $eventId]);
        record_audit('event.layout.refresh', 'event', $eventId, [
            'layout_id' => $layoutId,
            'layout_version_id' => $newVersionId,
        ]);
        Response::success([
            'layout_version_id' => $newVersionId,
            'layout_id' => $layoutId,
        ]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('POST /api/events/:id/refresh-layout error: ' . $e->getMessage());
        }
        Response::error('Unable to refresh layout for this event.', 500);
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
        $normalizedRule = recurrence_rule_row_to_payload($rule);
        if ($normalizedRule) {
            $rule['frequency'] = $normalizedRule['frequency'];
            $rule['interval'] = $normalizedRule['interval'];
            $rule['byweekday'] = $normalizedRule['byweekday'];
            $rule['byweekday_set'] = $normalizedRule['byweekday_set'];
            $rule['bymonthday'] = $normalizedRule['bymonthday'];
            $rule['bymonthday_set'] = $normalizedRule['bymonthday_set'];
            $rule['bysetpos'] = $normalizedRule['bysetpos'];
            $rule['bysetpos_set'] = $normalizedRule['bysetpos_set'];
            $rule['monthly_mode'] = $normalizedRule['monthly_mode'];
            $rule['starts_on'] = $normalizedRule['starts_on'];
            $rule['ends_on'] = $normalizedRule['ends_on'];
        }
        $exceptions = load_recurrence_exceptions(Database::connection(), (int) $rule['id']);
        Response::success(['recurrence' => $rule, 'exceptions' => $exceptions]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('GET /api/events/:id/recurrence error: ' . $e->getMessage());
        }
        Response::error('Failed to fetch recurrence', 500);
    }
});

$router->add('POST', '/api/recurrence/preview', function (Request $request) {
    try {
        $payload = read_json_body($request);
        $recurrenceInput = is_array($payload['recurrence'] ?? null)
            ? $payload['recurrence']
            : $payload;
        $recurrenceError = null;
        $recurrence = normalize_recurrence_request_payload($recurrenceInput, $recurrenceError);
        if ($recurrenceError !== null) {
            return Response::error($recurrenceError, 422);
        }
        if (!$recurrence || empty($recurrence['enabled'])) {
            return Response::success(['occurrence_candidates' => []]);
        }
        Response::success([
            'occurrence_candidates' => build_recurrence_exception_candidate_dates($recurrence),
        ]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('POST /api/recurrence/preview error: ' . $e->getMessage());
        }
        Response::error('Failed to preview recurrence', 500);
    }
});

$router->add('POST', '/api/events/:id/recurrence', function (Request $request, $params) {
    try {
        $pdo = Database::connection();
        $eventId = (int) $params['id'];
        $eventStmt = $pdo->prepare('SELECT * FROM events WHERE id = ? LIMIT 1');
        $eventStmt->execute([$eventId]);
        $event = $eventStmt->fetch();
        if (!$event) {
            return Response::error('Event not found', 404);
        }
        $payload = [];
        $payload = read_json_body($request);
        $recurrenceError = null;
        $recurrence = normalize_recurrence_request_payload($payload, $recurrenceError);
        if ($recurrenceError !== null || !$recurrence || empty($recurrence['enabled'])) {
            return Response::error($recurrenceError ?: 'recurrence configuration is required.', 422);
        }
        $eventTime = trim((string) ($event['event_time'] ?? ''));
        if ($eventTime === '' && !empty($event['start_datetime'])) {
            $eventTime = substr((string) $event['start_datetime'], 11, 8);
        }
        if ($eventTime === '') {
            return Response::error('Set an event time on the series master before saving recurrence.', 422);
        }
        $timezone = (string) ($event['timezone'] ?? 'America/New_York');
        $recurrenceExceptions = $recurrence['exceptions'] ?? [];
        $firstOccurrenceDate = resolve_recurrence_first_occurrence_date($recurrence, $recurrenceExceptions);
        if ($firstOccurrenceDate === null) {
            return Response::error('Unable to resolve the first recurring date from recurrence settings.', 422);
        }
        $startDt = build_event_start_datetime($firstOccurrenceDate, $eventTime, $timezone);
        if (!$startDt) {
            return Response::error('Invalid event schedule for recurring generation.', 422);
        }
        $doorTime = $event['door_time'] ?? null;
        if ($doorTime !== null) {
            $doorTimeOfDay = extract_time_of_day_from_value($doorTime, $timezone);
            if ($doorTimeOfDay !== null) {
                $doorTime = build_occurrence_door_datetime($firstOccurrenceDate, $doorTimeOfDay, $timezone);
            }
        }
        $pdo->beginTransaction();
        $updateMaster = $pdo->prepare('UPDATE events SET is_series_master = 1, series_master_id = NULL, start_datetime = ?, event_date = ?, event_time = ?, door_time = ?, change_note = ?, updated_by = ? WHERE id = ?');
        $updateMaster->execute([
            $startDt->format('Y-m-d H:i:s'),
            $firstOccurrenceDate,
            $eventTime,
            $doorTime,
            'updated via recurrence workflow',
            'api',
            $eventId,
        ]);
        $recurrenceId = upsert_event_recurrence_rule($pdo, $eventId, $recurrence, 'api');
        if ($recurrenceId && ($recurrence['exceptions_provided'] ?? false)) {
            $recurrenceExceptions = replace_recurrence_exceptions($pdo, $recurrenceId, $recurrence['exceptions'] ?? [], 'api');
        } elseif ($recurrenceId) {
            $recurrenceExceptions = load_recurrence_exceptions($pdo, $recurrenceId);
        }
        $syncResult = $recurrenceId
            ? sync_generated_recurrence_children($pdo, $eventId, $recurrence, $recurrenceId, $recurrenceExceptions ?? [])
            : null;
        $pdo->commit();
        record_audit('recurrence.save', 'event', (int) $params['id'], [
            'recurrence_id' => $recurrenceId,
            'frequency' => $recurrence['frequency'] ?? 'weekly',
            'interval' => $recurrence['interval'] ?? 1,
            'byweekday' => $recurrence['byweekday'],
            'bymonthday' => $recurrence['bymonthday'] ?? null,
            'bysetpos' => $recurrence['bysetpos'] ?? null,
            'starts_on' => $recurrence['starts_on'],
            'ends_on' => $recurrence['ends_on'] ?? null,
            'exceptions' => count($recurrenceExceptions ?? []),
            'sync' => $syncResult,
        ]);
        Response::success(['recurrence_id' => $recurrenceId, 'sync' => $syncResult]);
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (APP_DEBUG) {
            error_log('POST /api/events/:id/recurrence error: ' . $e->getMessage());
        }
        Response::error('Failed to save recurrence', 500);
    }
});

$router->add('DELETE', '/api/events/:id/recurrence', function ($request, $params) {
    try {
        $pdo = Database::connection();
        $pdo->beginTransaction();
        $stmt = $pdo->prepare('DELETE FROM event_recurrence_rules WHERE event_id = ?');
        $stmt->execute([(int) $params['id']]);
        $syncResult = null;
        if ($stmt->rowCount() > 0) {
            $syncResult = cleanup_disabled_recurrence_children($pdo, (int) $params['id']);
        }
        $pdo->commit();
        if ($stmt->rowCount() > 0) {
            record_audit('recurrence.delete', 'event', (int) $params['id'], [
                'sync' => $syncResult,
            ]);
        }
        Response::success(['deleted' => $stmt->rowCount(), 'sync' => $syncResult]);
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (APP_DEBUG) {
            error_log('DELETE /api/events/:id/recurrence error: ' . $e->getMessage());
        }
        Response::error('Failed to delete recurrence', 500);
    }
});

$router->add('POST', '/api/events/:id/recurrence/exceptions', function (Request $request, $params) {
    try {
        $pdo = Database::connection();
        $ruleStmt = $pdo->prepare('SELECT * FROM event_recurrence_rules WHERE event_id = ? LIMIT 1');
        $ruleStmt->execute([(int) $params['id']]);
        $rule = $ruleStmt->fetch();
        if (!$rule) {
            return Response::error('Recurrence rule not found', 404);
        }
        $payload = read_json_body($request);
        $exceptionError = null;
        $normalizedRows = normalize_recurrence_exception_rows([$payload], $exceptionError);
        if ($exceptionError !== null || !$normalizedRows) {
            return Response::error($exceptionError ?: 'exception_date is required', 422);
        }
        $exception = $normalizedRows[0];
        $pdo->beginTransaction();
        $insert = $pdo->prepare('INSERT INTO event_recurrence_exceptions (recurrence_id, exception_date, exception_type, override_payload, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)');
        $insert->execute([
            (int) $rule['id'],
            $exception['exception_date'],
            $exception['exception_type'],
            $exception['override_payload'] ? json_encode($exception['override_payload']) : null,
            $exception['notes'] ?? null,
            'api'
        ]);
        $exceptionId = (int) $pdo->lastInsertId();
        $recurrence = recurrence_rule_row_to_payload($rule);
        $syncResult = null;
        if ($recurrence) {
            $exceptions = load_recurrence_exceptions($pdo, (int) $rule['id']);
            $syncResult = sync_generated_recurrence_children($pdo, (int) $params['id'], $recurrence, (int) $rule['id'], $exceptions);
        }
        $pdo->commit();
        record_audit('recurrence.exception.add', 'event', (int) $params['id'], [
            'exception_id' => $exceptionId,
            'exception_date' => $exception['exception_date'],
            'exception_type' => $exception['exception_type'],
            'override_date' => $exception['override_date'] ?? null,
            'sync' => $syncResult,
        ]);
        Response::success(['exception_id' => $exceptionId, 'sync' => $syncResult]);
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (APP_DEBUG) {
            error_log('POST /api/events/:id/recurrence/exceptions error: ' . $e->getMessage());
        }
        Response::error('Failed to save exception', 500);
    }
});

$router->add('DELETE', '/api/recurrence-exceptions/:id', function ($request, $params) {
    try {
        $pdo = Database::connection();
        $fetch = $pdo->prepare('SELECT rx.id, rx.recurrence_id, rx.exception_date, rr.event_id FROM event_recurrence_exceptions rx LEFT JOIN event_recurrence_rules rr ON rr.id = rx.recurrence_id WHERE rx.id = ? LIMIT 1');
        $fetch->execute([$params['id']]);
        $row = $fetch->fetch();
        if (!$row) {
            return Response::error('Exception not found', 404);
        }
        $pdo->beginTransaction();
        $delete = $pdo->prepare('DELETE FROM event_recurrence_exceptions WHERE id = ?');
        $delete->execute([$params['id']]);
        $rule = null;
        if (!empty($row['recurrence_id'])) {
            $ruleStmt = $pdo->prepare('SELECT * FROM event_recurrence_rules WHERE id = ? LIMIT 1');
            $ruleStmt->execute([(int) $row['recurrence_id']]);
            $rule = $ruleStmt->fetch() ?: null;
        }
        $syncResult = null;
        if ($rule && !empty($row['event_id'])) {
            $recurrence = recurrence_rule_row_to_payload($rule);
            if ($recurrence) {
                $exceptions = load_recurrence_exceptions($pdo, (int) $row['recurrence_id']);
                $syncResult = sync_generated_recurrence_children($pdo, (int) $row['event_id'], $recurrence, (int) $row['recurrence_id'], $exceptions);
            }
        }
        $pdo->commit();
        record_audit('recurrence.exception.delete', 'recurrence_exception', (int) $row['id'], [
            'event_id' => $row['event_id'] ?? null,
            'recurrence_id' => $row['recurrence_id'] ?? null,
            'exception_date' => $row['exception_date'] ?? null,
            'sync' => $syncResult,
        ]);
        Response::success(['sync' => $syncResult]);
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
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
    $eventMetaStmt = $pdo->prepare("SELECT seating_enabled, COALESCE(NULLIF(TRIM(status), ''), 'draft') AS status, COALESCE(NULLIF(TRIM(visibility), ''), 'private') AS visibility FROM events WHERE id = ? LIMIT 1");
    $eventMetaStmt->execute([$eventId]);
    $eventMeta = $eventMetaStmt->fetch();
    if (!$eventMeta) {
        return Response::error('Event not found', 404);
    }
    if (!is_admin_session_authenticated()) {
        $eventStatus = strtolower((string) ($eventMeta['status'] ?? 'draft'));
        $eventVisibility = strtolower((string) ($eventMeta['visibility'] ?? 'private'));
        if ($eventStatus !== 'published' || $eventVisibility !== 'public') {
            return Response::error('Event not found', 404);
        }
    }
    [$layoutData, $stagePosition, $stageSize, $canvasSettings] = fetch_layout_for_event($eventId);
    $selectColumns = layout_table_has_column($pdo, 'seat_requests', 'payment_status')
        ? 'selected_seats, status, hold_expires_at, payment_status'
        : 'selected_seats, status, hold_expires_at';
    $stmt = $pdo->prepare("SELECT {$selectColumns} FROM seat_requests WHERE event_id = ?");
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
                if ($expires < $now && !seat_request_payment_blocks_expiration($row['payment_status'] ?? null)) {
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
        'seatingEnabled' => (int)($eventMeta['seating_enabled'] ?? 0) === 1,
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
    $pdo = Database::connection();
    $optional = layout_optional_select_clause($pdo, 'seating_layouts');
    $sql = "SELECT id, name, description, is_default, layout_data, {$optional}, created_at, updated_at FROM seating_layouts ORDER BY is_default DESC, name ASC";
    $stmt = $pdo->query($sql);
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
    $pdo = Database::connection();
    $optional = layout_optional_select_clause($pdo, 'seating_layouts');
    $sql = "SELECT id, name, description, is_default, layout_data, {$optional}, created_at, updated_at FROM seating_layouts WHERE is_default = 1 LIMIT 1";
    $stmt = $pdo->query($sql);
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
    $pdo = Database::connection();
    $optional = layout_optional_select_clause($pdo, 'seating_layouts');
    $sql = "SELECT id, name, description, is_default, layout_data, {$optional}, created_at, updated_at FROM seating_layouts WHERE id = ?";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$params['id']]);
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
    $rawName = isset($payload['name']) ? trim((string) $payload['name']) : '';
    $layoutData = $payload['layout_data'] ?? null;
    $missing = [];
    if ($rawName === '') {
        $missing[] = 'name';
    }
    if (!is_array($layoutData) || empty($layoutData)) {
        $missing[] = 'layout_data';
    }
    if ($missing) {
        return Response::error(
            'Missing required fields: ' . implode(', ', $missing),
            400,
            ['missing_fields' => $missing]
        );
    }
    $isDefault = !empty($payload['is_default']);
    if ($isDefault) {
        Database::run('UPDATE seating_layouts SET is_default = 0');
    }
    $stagePosition = isset($payload['stage_position']) ? json_encode($payload['stage_position']) : null;
    $stageSize = isset($payload['stage_size']) ? json_encode($payload['stage_size']) : null;
    $canvasSettings = isset($payload['canvas_settings']) ? json_encode($payload['canvas_settings']) : null;
    Database::run('INSERT INTO seating_layouts (name, description, is_default, layout_data, stage_position, stage_size, canvas_settings) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        $rawName,
        $payload['description'] ?? '',
        $isDefault ? 1 : 0,
        json_encode($layoutData),
        $stagePosition,
        $stageSize,
        $canvasSettings
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
    $session = current_admin_session();
    if (!$session || empty($session['user'])) {
        return Response::error('Unauthorized', 401);
    }
    try {
        $pdo = Database::connection();
        expire_stale_holds($pdo);
        $filters = [];
        $values = [];
        $eventStartExpr = event_start_expression('e');
        $eventEndExpr = event_end_expression('e');
        $hasEventIdFilter = !empty($request->query['event_id']);
        if ($hasEventIdFilter) {
            $filters[] = 'sr.event_id = ?';
            $values[] = $request->query['event_id'];
        }
        $includePastRaw = strtolower(trim((string) ($request->query['include_past'] ?? '0')));
        $includePast = in_array($includePastRaw, ['1', 'true', 'yes', 'on'], true);
        if (!$hasEventIdFilter && !$includePast) {
            $filters[] = "($eventEndExpr IS NULL OR $eventEndExpr >= NOW())";
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
    e.artist_name AS event_artist_name,
    COALESCE(NULLIF(TRIM(e.artist_name), ''), NULLIF(TRIM(e.title), '')) AS event_display_name,
    e.start_datetime,
    e.end_datetime,
    e.event_date,
    e.event_time,
    e.timezone,
    {$eventStartExpr} AS event_run_start_datetime,
    {$eventEndExpr} AS event_run_end_datetime,
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
        $rows = $stmt->fetchAll() ?: [];
        $eventIds = array_values(array_unique(array_filter(array_map(static function (array $row): int {
            return (int) ($row['event_id'] ?? 0);
        }, $rows))));
        $occurrenceMap = load_event_occurrences_map($pdo, $eventIds);
        $requests = [];
        foreach ($rows as $row) {
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
            if (empty($row['event_display_name'])) {
                $fallbackTitle = trim((string) ($row['event_artist_name'] ?? ''));
                if ($fallbackTitle === '') {
                    $fallbackTitle = trim((string) ($row['event_title'] ?? ''));
                }
                $row['event_display_name'] = $fallbackTitle !== '' ? $fallbackTitle : null;
            }
            [$targetEmail, $targetSource] = determine_seat_request_recipient($row);
            $row['seat_request_target_email'] = $targetEmail;
            $row['seat_request_target_source'] = $targetSource;
            $eventId = (int) ($row['event_id'] ?? 0);
            $eventSummary = [
                'id' => $eventId,
                'title' => $row['event_title'] ?? null,
                'artist_name' => $row['event_artist_name'] ?? null,
                'start_datetime' => $row['event_run_start_datetime'] ?? ($row['start_datetime'] ?? null),
                'end_datetime' => $row['event_run_end_datetime'] ?? ($row['end_datetime'] ?? null),
                'event_date' => $row['event_date'] ?? null,
                'event_time' => $row['event_time'] ?? null,
                'timezone' => $row['timezone'] ?? 'America/New_York',
            ];
            $occurrences = $occurrenceMap[$eventId] ?? [];
            if (!$occurrences) {
                $fallback = build_fallback_occurrence_from_event($eventSummary);
                $occurrences = $fallback ? [$fallback] : [];
            }
            $eventSummary = attach_occurrence_metadata_to_event($eventSummary, $occurrences);
            $row['event_occurrence_count'] = (int) ($eventSummary['occurrence_count'] ?? 0);
            $row['event_is_multi_day'] = (int) ($eventSummary['is_multi_day'] ?? 0);
            $row['event_run_start_datetime'] = $eventSummary['run_start_datetime'] ?? ($row['event_run_start_datetime'] ?? null);
            $row['event_run_end_datetime'] = $eventSummary['run_end_datetime'] ?? ($row['event_run_end_datetime'] ?? null);
            $row['event_run_summary'] = format_event_occurrence_summary($eventSummary, 2);
            $row['seat_display_labels'] = build_display_seat_list($row);
            hydrate_seat_request_payment_details($row);
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
    if (!admin_csrf_origin_is_valid($request)) {
        return Response::error('Forbidden', 403);
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
            'send_notifications' => false,
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
        $logContext = resolve_reservation_log_context($payload ?? [], $validationError->context ?? []);
        log_reservation_rejection([
            'event_id' => $logContext['event_id'],
            'layout_id' => $logContext['layout_id'],
            'layout_version_id' => $logContext['layout_version_id'],
            'seat_ids' => $logContext['seat_ids'],
            'request_type' => 'manual',
            'reason_code' => $validationError->reasonCode,
            'http_status' => $validationError->httpStatus,
            'message' => $validationError->getMessage(),
        ]);
        $extra = array_merge($validationError->payload, ['reason_code' => $validationError->reasonCode]);
        Response::error($validationError->getMessage(), $validationError->httpStatus, $extra);
    } catch (RuntimeException $validationError) {
        $logContext = resolve_reservation_log_context($payload ?? []);
        log_reservation_rejection([
            'event_id' => $logContext['event_id'],
            'layout_id' => $logContext['layout_id'],
            'layout_version_id' => $logContext['layout_version_id'],
            'seat_ids' => $logContext['seat_ids'],
            'request_type' => 'manual',
            'reason_code' => 'runtime_validation_error',
            'http_status' => 400,
            'message' => $validationError->getMessage(),
        ]);
        Response::error($validationError->getMessage(), 400, ['reason_code' => 'runtime_validation_error']);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('POST /api/admin/seat-requests error: ' . $e->getMessage());
        }
        $logContext = resolve_reservation_log_context($payload ?? []);
        log_reservation_rejection([
            'event_id' => $logContext['event_id'],
            'layout_id' => $logContext['layout_id'],
            'layout_version_id' => $logContext['layout_version_id'],
            'seat_ids' => $logContext['seat_ids'],
            'request_type' => 'manual',
            'reason_code' => 'server_error',
            'http_status' => 500,
            'message' => $e->getMessage(),
        ]);
        Response::error('Failed to create reservation', 500, ['reason_code' => 'server_error']);
    }
});

$router->add('POST', '/api/seat-requests/:id/approve', function (Request $request, $params) {
    $session = current_admin_session();
    if (!$session || empty($session['user'])) {
        return Response::error('Unauthorized', 401);
    }
    if (!admin_csrf_origin_is_valid($request)) {
        return Response::error('Forbidden', 403);
    }
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
            if (seat_request_has_square_pending_checkout($requestRow)) {
                clear_pending_square_checkout_state($pdo, $rid, $requestRow, 'request_already_confirmed', seat_request_admin_actor());
                $pdo->commit();
            } else {
                $pdo->rollBack();
            }
            return Response::success(['message' => 'Already confirmed']);
        }
        clear_pending_square_checkout_state($pdo, $rid, $requestRow, 'request_confirmed_without_payment', seat_request_admin_actor());
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
        $hasConfirmationSentAt = layout_table_has_column($pdo, 'seat_requests', 'confirmation_email_sent_at');
        $hasConfirmationMessageId = layout_table_has_column($pdo, 'seat_requests', 'confirmation_email_message_id');
        $pdo->prepare('UPDATE seat_requests SET status = ?, finalized_at = NOW(), hold_expires_at = NULL, updated_at = NOW(), updated_by = ?, change_note = ? WHERE id = ?')
            ->execute(['confirmed', $actor, 'approved via admin', $rid]);
        $pdo->commit();
        record_audit('seat_request.approve', 'seat_request', $rid, [
            'seats' => $seats,
        ]);
        try {
            $hasCategoryTable = event_categories_table_exists($pdo);
            if ($hasCategoryTable) {
                $eventStmt = $pdo->prepare('SELECT e.id, e.title, e.artist_name, e.start_datetime, e.event_date, e.event_time, e.timezone, e.seat_request_email_override, ec.seat_request_email_to AS category_seat_request_email_to FROM events e LEFT JOIN event_categories ec ON ec.id = e.category_id WHERE e.id = ? LIMIT 1');
            } else {
                $eventStmt = $pdo->prepare('SELECT id, title, artist_name, start_datetime, event_date, event_time, timezone, seat_request_email_override FROM events WHERE id = ? LIMIT 1');
            }
            $eventStmt->execute([$requestRow['event_id'] ?? null]);
            $eventRow = $eventStmt->fetch();
            if ($eventRow) {
                $requestRow['status'] = 'confirmed';
                $alreadySent = $hasConfirmationSentAt && !empty($requestRow['confirmation_email_sent_at']);
                if (!$alreadySent) {
                    $sent = notify_seat_request_confirmed_email($requestRow, $eventRow);
                    if ($sent && $hasConfirmationSentAt) {
                        if ($hasConfirmationMessageId) {
                            $pdo->prepare('UPDATE seat_requests SET confirmation_email_sent_at = NOW(), confirmation_email_message_id = COALESCE(confirmation_email_message_id, ?) WHERE id = ?')
                                ->execute(['sent-via-sendgrid', $rid]);
                        } else {
                            $pdo->prepare('UPDATE seat_requests SET confirmation_email_sent_at = NOW() WHERE id = ?')
                                ->execute([$rid]);
                        }
                    }
                }
            }
        } catch (Throwable $notifyError) {
            error_log('[email] Seat request confirmation notify failed: ' . $notifyError->getMessage());
        }
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

$router->add('POST', '/api/seat-requests/:id/deny', function (Request $request, $params) {
    $session = current_admin_session();
    if (!$session || empty($session['user'])) {
        return Response::error('Unauthorized', 401);
    }
    if (!admin_csrf_origin_is_valid($request)) {
        return Response::error('Forbidden', 403);
    }
    $pdo = Database::connection();
    expire_stale_holds($pdo);
    $actor = seat_request_admin_actor();
    try {
        $pdo->beginTransaction();
        $rid = (int) ($params['id'] ?? 0);
        $existingStmt = $pdo->prepare('SELECT * FROM seat_requests WHERE id = ? LIMIT 1 FOR UPDATE');
        $existingStmt->execute([$rid]);
        $existing = $existingStmt->fetch();
        if (!$existing) {
            $pdo->rollBack();
            return Response::error('Seat request not found', 404);
        }
        clear_pending_square_checkout_state($pdo, $rid, $existing, 'request_declined', $actor);
        $stmt = $pdo->prepare('UPDATE seat_requests SET status = ?, hold_expires_at = NULL, updated_at = NOW(), updated_by = ?, change_note = ? WHERE id = ?');
        $stmt->execute(['declined', $actor, 'declined via admin', $rid]);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (APP_DEBUG) {
            error_log('POST /api/seat-requests/:id/deny error: ' . $error->getMessage());
        }
        return Response::error('Failed to deny request', 500);
    }
    record_audit('seat_request.deny', 'seat_request', (int) $params['id']);
    Response::success();
});

$router->add('POST', '/api/seat-requests', function (Request $request) {
    $payload = [];
    try {
        $rawBody = trim($request->raw());
        $payload = json_decode($rawBody, true);
        if ($rawBody !== '' && json_last_error() !== JSON_ERROR_NONE) {
            log_reservation_rejection([
                'request_type' => 'public',
                'reason_code' => 'invalid_json',
                'http_status' => 400,
                'seat_ids' => [],
                'message' => json_last_error_msg(),
            ]);
            return Response::error('Invalid JSON payload', 400, ['detail' => json_last_error_msg(), 'reason_code' => 'invalid_json']);
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
        $logContext = resolve_reservation_log_context($payload ?? [], $validationError->context ?? []);
        log_reservation_rejection([
            'event_id' => $logContext['event_id'],
            'layout_id' => $logContext['layout_id'],
            'layout_version_id' => $logContext['layout_version_id'],
            'seat_ids' => $logContext['seat_ids'],
            'request_type' => 'public',
            'reason_code' => $validationError->reasonCode,
            'http_status' => $validationError->httpStatus,
            'message' => $validationError->getMessage(),
        ]);
        $extra = array_merge($validationError->payload, ['reason_code' => $validationError->reasonCode]);
        Response::error($validationError->getMessage(), $validationError->httpStatus, $extra);
    } catch (RuntimeException $validationError) {
        $logContext = resolve_reservation_log_context($payload ?? []);
        log_reservation_rejection([
            'event_id' => $logContext['event_id'],
            'layout_id' => $logContext['layout_id'],
            'layout_version_id' => $logContext['layout_version_id'],
            'seat_ids' => $logContext['seat_ids'],
            'request_type' => 'public',
            'reason_code' => 'runtime_validation_error',
            'http_status' => 400,
            'message' => $validationError->getMessage(),
        ]);
        Response::error($validationError->getMessage(), 400, ['reason_code' => 'runtime_validation_error']);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('[seat-requests] error: ' . $e->getMessage());
        }
        $logContext = resolve_reservation_log_context($payload ?? []);
        log_reservation_rejection([
            'event_id' => $logContext['event_id'],
            'layout_id' => $logContext['layout_id'],
            'layout_version_id' => $logContext['layout_version_id'],
            'seat_ids' => $logContext['seat_ids'],
            'request_type' => 'public',
            'reason_code' => 'server_error',
            'http_status' => 500,
            'message' => $e->getMessage(),
        ]);
        $extra = APP_DEBUG ? [
            'detail' => $e->getMessage(),
            'where' => $e->getFile() . ':' . $e->getLine(),
            'reason_code' => 'server_error',
        ] : ['reason_code' => 'server_error'];
        Response::error('Failed to submit seat request', 500, $extra);
    }
});

$router->add('POST', '/api/seat-requests/:id/payment/start', function (Request $request, $params) {
    try {
        $pdo = Database::connection();
        $seatRequestId = (int) ($params['id'] ?? 0);
        if ($seatRequestId <= 0) {
            return Response::error('Invalid seat request id', 422);
        }
        $pdo->beginTransaction();
        $context = load_seat_request_payment_context($pdo, $seatRequestId, true);
        if (!$context) {
            $pdo->rollBack();
            return Response::error('Seat request not found', 404);
        }
        $seatRequest = $context['seat_request'];
        $paymentOption = $context['payment_option'];
        $providerType = normalize_payment_provider_type($paymentOption['provider_type'] ?? null);
        $validationError = validate_seat_request_payment_context_for_start($seatRequest);
        if (
            $providerType === 'square'
            && $validationError
            && ($validationError['code'] ?? null) === 'PAYMENT_ALREADY_IN_PROGRESS'
            && seat_request_has_square_pending_checkout($seatRequest)
        ) {
            $existingLinkId = normalize_nullable_text($seatRequest['payment_capture_id'] ?? null);
            if ($existingLinkId !== null) {
                try {
                    $existingLink = square_retrieve_payment_link($existingLinkId);
                    if ($existingLink && !empty($existingLink['checkout_url'])) {
                        $pdo->commit();
                        Response::success([
                            'provider_type' => 'square',
                            'seat_request_id' => $seatRequestId,
                            'checkout_url' => $existingLink['checkout_url'],
                            'launch_target' => 'new_tab',
                            'payment_resumed' => true,
                        ]);
                        return;
                    }
                } catch (Throwable $squareError) {
                    if (APP_DEBUG) {
                        error_log('POST /api/seat-requests/:id/payment/start Square resume error: ' . $squareError->getMessage());
                    }
                }
            }
            invalidate_seat_request_payment_state($pdo, $seatRequestId, $seatRequest, 'square_checkout_session_unavailable');
            $context = load_seat_request_payment_context($pdo, $seatRequestId, true);
            $seatRequest = $context['seat_request'] ?? $seatRequest;
            $paymentOption = $context['payment_option'] ?? $paymentOption;
            $providerType = normalize_payment_provider_type($paymentOption['provider_type'] ?? null);
            $validationError = validate_seat_request_payment_context_for_start($seatRequest);
        }
        if ($validationError) {
            $pdo->rollBack();
            return Response::error($validationError['message'], $validationError['http_status'], [
                'code' => $validationError['code'],
                'seat_request_id' => $seatRequestId,
                'payment_summary' => $seatRequest['payment_summary'] ?? null,
            ]);
        }
        if ($providerType === 'square') {
            if (!square_provider_is_configured()) {
                $pdo->rollBack();
                return Response::error('Square payment is not configured right now.', 503, [
                    'code' => 'PAYMENT_PROVIDER_UNAVAILABLE',
                    'provider_type' => 'square',
                    'seat_request_id' => $seatRequestId,
                    'payment_summary' => $seatRequest['payment_summary'] ?? null,
                ]);
            }

            if (
                strtolower(trim((string) ($seatRequest['payment_provider'] ?? ''))) === 'square'
                && !seat_request_payment_is_paid_status($seatRequest['payment_status'] ?? null)
                && seat_request_has_payment_references($seatRequest)
            ) {
                try {
                    cancel_seat_request_provider_payment_session($seatRequest);
                } catch (Throwable $squareError) {
                    if (APP_DEBUG) {
                        error_log('POST /api/seat-requests/:id/payment/start Square cleanup error: ' . $squareError->getMessage());
                    }
                }
            }

            try {
                $paymentLink = square_create_payment_link($seatRequest);
            } catch (Throwable $squareError) {
                $pdo->rollBack();
                return Response::error(
                    APP_DEBUG ? $squareError->getMessage() : 'Square checkout is temporarily unavailable. Please try again or contact staff.',
                    502,
                    [
                        'code' => 'PAYMENT_PROVIDER_REQUEST_FAILED',
                        'provider_type' => 'square',
                        'seat_request_id' => $seatRequestId,
                    ]
                );
            }
            apply_seat_request_payment_update($pdo, $seatRequestId, [
                'payment_provider' => 'square',
                'payment_status' => 'pending',
                'payment_order_id' => $paymentLink['order_id'],
                'payment_capture_id' => $paymentLink['payment_link_id'],
                'updated_by' => 'square',
            ]);
            record_audit('seat_request.square_checkout_started', 'seat_request', $seatRequestId, [
                'order_id' => $paymentLink['order_id'],
                'payment_link_id' => $paymentLink['payment_link_id'],
            ]);
            $pdo->commit();
            Response::success([
                'provider_type' => 'square',
                'seat_request_id' => $seatRequestId,
                'checkout_url' => $paymentLink['checkout_url'],
                'launch_target' => 'new_tab',
            ]);
            return;
        }

        $pdo->rollBack();
        Response::error('Payment provider is not enabled yet in this environment', 501, [
            'code' => 'PAYMENT_NOT_IMPLEMENTED',
            'provider_type' => $paymentOption['provider_type'] ?? null,
            'seat_request_id' => $seatRequestId,
            'payment_summary' => $seatRequest['payment_summary'] ?? null,
        ]);
    } catch (Throwable $error) {
        if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (APP_DEBUG) {
            error_log('POST /api/seat-requests/:id/payment/start error: ' . $error->getMessage());
        }
        Response::error('Failed to start payment', 500);
    }
});

$router->add('POST', '/api/webhooks/square', function (Request $request) {
    try {
        if (resolve_square_webhook_signature_key() === null || resolve_square_webhook_notification_url() === null) {
            return Response::error('Square webhook is not configured', 503);
        }
        if (!square_webhook_signature_is_valid($request)) {
            return Response::error('Forbidden', 403);
        }
        $payload = json_decode(trim($request->raw()), true);
        if (!is_array($payload)) {
            return Response::error('Invalid Square webhook payload', 400);
        }

        $eventType = strtolower(trim((string) ($payload['type'] ?? '')));
        if ($eventType === '') {
            return Response::success(['received' => true]);
        }

        $payment = square_extract_payment_from_webhook($payload);
        if (!is_array($payment)) {
            return Response::success(['received' => true]);
        }

        $orderId = normalize_nullable_text($payment['order_id'] ?? null);
        if ($orderId === null) {
            return Response::success(['received' => true]);
        }

        $pdo = Database::connection();
        $pdo->beginTransaction();
        $stmt = $pdo->prepare('SELECT * FROM seat_requests WHERE payment_provider = ? AND payment_order_id = ? LIMIT 1 FOR UPDATE');
        $stmt->execute(['square', $orderId]);
        $seatRequest = $stmt->fetch();
        if (!$seatRequest) {
            $pdo->commit();
            return Response::success(['received' => true]);
        }

        $paymentStatus = strtoupper(trim((string) ($payment['status'] ?? '')));
        if ($paymentStatus === 'COMPLETED') {
            $paymentId = normalize_nullable_text($payment['id'] ?? null);
            apply_seat_request_payment_update($pdo, (int) $seatRequest['id'], [
                'payment_provider' => 'square',
                'payment_status' => 'paid',
                'payment_order_id' => $orderId,
                'payment_capture_id' => $paymentId,
                'updated_by' => 'square-webhook',
            ]);
            record_audit('seat_request.square_payment_completed', 'seat_request', (int) $seatRequest['id'], [
                'order_id' => $orderId,
                'payment_id' => $paymentId,
                'event_type' => $eventType,
            ]);
        }

        $pdo->commit();
        Response::success(['received' => true]);
    } catch (Throwable $error) {
        if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (APP_DEBUG) {
            error_log('POST /api/webhooks/square error: ' . $error->getMessage());
        }
        Response::error('Failed to process Square webhook', 500);
    }
});

$router->add('POST', '/api/seat-requests/:id/payment/create-order', function (Request $request, $params) {
    try {
        $pdo = Database::connection();
        $seatRequestId = (int) ($params['id'] ?? 0);
        if ($seatRequestId <= 0) {
            return Response::error('Invalid seat request id', 422);
        }
        $context = load_seat_request_payment_context($pdo, $seatRequestId, true);
        if (!$context) {
            return Response::error('Seat request not found', 404);
        }
        $seatRequest = $context['seat_request'];
        $paymentOption = $context['payment_option'];
        $validationError = validate_seat_request_payment_context_for_start($seatRequest);
        if ($validationError) {
            return Response::error($validationError['message'], $validationError['http_status'], [
                'code' => $validationError['code'],
                'provider_type' => $paymentOption['provider_type'] ?? null,
                'seat_request_id' => $seatRequestId,
                'payment_summary' => $seatRequest['payment_summary'] ?? null,
            ]);
        }
        Response::error('PayPal Orders integration is not enabled yet in this environment', 501, [
            'code' => 'PAYMENT_NOT_IMPLEMENTED',
            'provider_type' => 'paypal_orders',
            'seat_request_id' => $seatRequestId,
            'currency' => normalize_paypal_currency($seatRequest['currency'] ?? 'USD'),
            'payment_summary' => $seatRequest['payment_summary'] ?? null,
        ]);
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('POST /api/seat-requests/:id/payment/create-order error: ' . $error->getMessage());
        }
        Response::error('Failed to process payment scaffold request', 500);
    }
});

$router->add('POST', '/api/seat-requests/:id/payment/capture', function (Request $request, $params) {
    try {
        $pdo = Database::connection();
        $seatRequestId = (int) ($params['id'] ?? 0);
        if ($seatRequestId <= 0) {
            return Response::error('Invalid seat request id', 422);
        }
        $context = load_seat_request_payment_context($pdo, $seatRequestId, true);
        if (!$context) {
            return Response::error('Seat request not found', 404);
        }
        $seatRequest = $context['seat_request'];
        $paymentOption = $context['payment_option'];
        $validationError = validate_seat_request_payment_context_for_start($seatRequest);
        if ($validationError) {
            return Response::error($validationError['message'], $validationError['http_status'], [
                'code' => $validationError['code'],
                'provider_type' => $paymentOption['provider_type'] ?? null,
                'seat_request_id' => $seatRequestId,
                'payment_summary' => $seatRequest['payment_summary'] ?? null,
            ]);
        }
        Response::error('PayPal Orders integration is not enabled yet in this environment', 501, [
            'code' => 'PAYMENT_NOT_IMPLEMENTED',
            'provider_type' => 'paypal_orders',
            'seat_request_id' => $seatRequestId,
            'currency' => normalize_paypal_currency($seatRequest['currency'] ?? 'USD'),
            'payment_summary' => $seatRequest['payment_summary'] ?? null,
        ]);
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('POST /api/seat-requests/:id/payment/capture error: ' . $error->getMessage());
        }
        Response::error('Failed to process payment scaffold request', 500);
    }
});

$router->add('PUT', '/api/seat-requests/:id', function (Request $request, $params) {
    $session = current_admin_session();
    if (!$session || empty($session['user'])) {
        return Response::error('Unauthorized', 401);
    }
    if (!admin_csrf_origin_is_valid($request)) {
        return Response::error('Forbidden', 403);
    }
    try {
        $pdo = Database::connection();
        expire_stale_holds($pdo);
        $pdo->beginTransaction();
        $payload = read_json_body($request);
        if (array_key_exists('selectedSeats', $payload) && !array_key_exists('selected_seats', $payload)) {
            $payload['selected_seats'] = $payload['selectedSeats'];
        }
        $requestId = (int) $params['id'];
        $existingStmt = $pdo->prepare('SELECT id, event_id, status, selected_seats, total_amount, currency, payment_provider, payment_status, payment_order_id, payment_capture_id, payment_updated_at FROM seat_requests WHERE id = ? LIMIT 1');
        $existingStmt->execute([$requestId]);
        $existing = $existingStmt->fetch();
        if (!$existing) {
            $pdo->rollBack();
            return Response::error('Seat request not found', 404);
        }
        $originalStatus = normalize_seat_request_status($existing['status'] ?? 'new');
        $targetStatus = normalize_seat_request_status($existing['status'] ?? 'new');
        $fields = [];
        $values = [];
        $metaChanges = [];
        $paymentInvalidated = false;
        $existingSeatList = parse_selected_seats($existing['selected_seats'] ?? []);
        $normalizedExistingSeats = normalize_snapshot_seat_list($existingSeatList);
        if (array_key_exists('status', $payload)) {
            $newStatus = normalize_seat_request_status($payload['status']);
            if (!in_array($newStatus, canonical_seat_request_statuses(), true)) {
                $pdo->rollBack();
                return Response::error('Invalid status', 400);
            }
            if ($newStatus === 'confirmed') {
                $pdo->rollBack();
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
                clear_pending_square_checkout_state($pdo, $requestId, $existing, 'request_status_changed_to_' . $newStatus, seat_request_admin_actor());
            } elseif (
                in_array($newStatus, open_seat_request_statuses(), true)
                && !array_key_exists('hold_expires_at', $payload)
                && !seat_request_payment_blocks_expiration($existing['payment_status'] ?? null)
            ) {
                $fields[] = 'hold_expires_at = ?';
                $values[] = compute_hold_expiration(now_eastern())->format('Y-m-d H:i:s');
            }
        }
        $selectedSeatsPayload = $payload['selected_seats'] ?? null;
        if ($selectedSeatsPayload !== null) {
            if (!is_array($selectedSeatsPayload)) {
                $pdo->rollBack();
                return Response::error('selected_seats must be an array of seat labels', 400);
            }
            $seatList = array_values(array_filter(array_map(function ($seat) {
                return is_string($seat) ? trim($seat) : '';
            }, $selectedSeatsPayload), function ($seat) {
                return $seat !== '';
            }));
            if (in_array($targetStatus, ['confirmed', 'declined', 'closed', 'spam'], true)) {
                $pdo->rollBack();
                return Response::error('Seats are locked once a request is finalized. Reopen it first.', 409);
            }
            $normalizedNextSeats = normalize_snapshot_seat_list($seatList);
            if ($normalizedNextSeats !== $normalizedExistingSeats) {
                $pricingFailure = null;
                $recomputed = recompute_seat_request_amount_for_event(
                    $pdo,
                    (int) ($existing['event_id'] ?? 0),
                    $seatList,
                    $pricingFailure
                );
                $fields[] = 'selected_seats = ?';
                $values[] = json_encode($seatList);
                $fields[] = 'total_seats = ?';
                $values[] = count($seatList);
                $fields[] = 'total_amount = ?';
                $values[] = $recomputed['total_amount'];
                $fields[] = 'currency = ?';
                $values[] = $recomputed['currency'];
                $metaChanges['seats'] = count($seatList);
                $metaChanges['total_amount'] = [
                    'from' => normalize_nullable_decimal($existing['total_amount'] ?? null),
                    'to' => $recomputed['total_amount'],
                ];
                if ($pricingFailure !== null) {
                    $metaChanges['pricing_warning'] = $pricingFailure;
                }
                if (seat_request_has_payment_references($existing)) {
                    $paymentInvalidated = true;
                    $metaChanges['payment_invalidated'] = true;
                }
            }
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
                    $pdo->rollBack();
                    return Response::error('Invalid hold_expires_at value', 400);
                }
            }
        }
        if (!$fields) {
            $pdo->rollBack();
            return Response::error('No valid fields provided', 400);
        }
        $fields[] = 'updated_by = ?';
        $values[] = seat_request_admin_actor();
        $values[] = $requestId;
        $sql = 'UPDATE seat_requests SET ' . implode(', ', $fields) . ' WHERE id = ?';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($values);
        if ($paymentInvalidated) {
            invalidate_seat_request_payment_state($pdo, $requestId, $existing, 'seat_selection_changed');
        }
        if (!empty($metaChanges)) {
            record_audit('seat_request.update', 'seat_request', $requestId, $metaChanges);
        }
        $pdo->commit();
        Response::success();
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (APP_DEBUG) {
            error_log('PUT /api/seat-requests/:id error: ' . $e->getMessage());
        }
        Response::error('Failed to update seat request', 500);
    }
});

$router->add('DELETE', '/api/seat-requests/:id', function (Request $request, $params) {
    $session = current_admin_session();
    if (!$session || empty($session['user'])) {
        return Response::error('Unauthorized', 401);
    }
    if (!admin_csrf_origin_is_valid($request)) {
        return Response::error('Forbidden', 403);
    }
    try {
        $pdo = Database::connection();
        $pdo->beginTransaction();
        $existingStmt = $pdo->prepare('SELECT * FROM seat_requests WHERE id = ? LIMIT 1 FOR UPDATE');
        $existingStmt->execute([(int) ($params['id'] ?? 0)]);
        $existing = $existingStmt->fetch();
        if (!$existing) {
            $pdo->rollBack();
            return Response::error('Seat request not found', 404);
        }
        try {
            cancel_seat_request_provider_payment_session($existing);
        } catch (Throwable $error) {
            if (APP_DEBUG) {
                error_log('DELETE /api/seat-requests/:id Square cleanup error: ' . $error->getMessage());
            }
        }
        $stmt = $pdo->prepare('DELETE FROM seat_requests WHERE id = ?');
        $stmt->execute([(int) ($params['id'] ?? 0)]);
        $pdo->commit();
    } catch (Throwable $error) {
        if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (APP_DEBUG) {
            error_log('DELETE /api/seat-requests/:id error: ' . $error->getMessage());
        }
        return Response::error('Failed to delete seat request', 500);
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

        $visibilityFilter = "e.status = 'published' AND e.visibility = 'public' AND e.deleted_at IS NULL";
        $eventStartExpr = event_start_expression('e');
        $eventEndExpr = event_end_expression('e');
        $eventHasScheduleExpr = event_has_schedule_expression('e');
        $currentMonthStartExpr = "TIMESTAMP(DATE_FORMAT(CURDATE(), '%Y-%m-01 00:00:00'))";
        $nextMonthStartExpr = "TIMESTAMP(DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01 00:00:00'))";

        $upcoming = (int) $pdo->query(
            "SELECT COUNT(*) FROM events e
             WHERE {$visibilityFilter}
               AND {$eventHasScheduleExpr}
               AND {$eventEndExpr} >= NOW()
               AND {$eventStartExpr} < DATE_ADD(NOW(), INTERVAL 2 MONTH)"
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
            "SELECT COUNT(*) FROM events e
             WHERE {$visibilityFilter}
               AND {$eventHasScheduleExpr}
               AND {$eventEndExpr} >= {$currentMonthStartExpr}
               AND {$eventStartExpr} < {$nextMonthStartExpr}"
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
            'logo' => [
                'png' => [
                    '1x' => '/iconslogos/mmh-logo@1x.png',
                    '2x' => '/iconslogos/mmh-logo@2x.png',
                    '3x' => '/iconslogos/mmh-logo@3x.png',
                ],
                'webp' => [
                    '1x' => '/iconslogos/mmh-logo@1x.webp',
                    '2x' => '/iconslogos/mmh-logo@2x.webp',
                    '3x' => '/iconslogos/mmh-logo@3x.webp',
                ],
            ],
            'mark' => null,
            'default_event' => [
                'png' => [
                    '1x' => '/iconslogos/mmh-default-event@1x.png',
                    '2x' => '/iconslogos/mmh-default-event@2x.png',
                    '3x' => '/iconslogos/mmh-default-event@3x.png',
                ],
                'webp' => [
                    '1x' => '/iconslogos/mmh-default-event@1x.webp',
                    '2x' => '/iconslogos/mmh-default-event@2x.webp',
                    '3x' => '/iconslogos/mmh-default-event@3x.webp',
                ],
            ],
        ];
        $beachPriceLabel = trim((string)($settings['beach_price_label'] ?? ''));
        $beachPriceNote = trim((string)($settings['beach_price_note'] ?? ''));
        $announcementRaw = decode_settings_json($settings, 'announcement_banner', []);
        $announcementSeverity = $announcementRaw['severity'] ?? 'info';
        $announcement = [
            'enabled' => !empty($announcementRaw['enabled']),
            'message' => trim((string)($announcementRaw['message'] ?? '')),
            'label' => trim((string)($announcementRaw['label'] ?? '')),
            'link_url' => trim((string)($announcementRaw['link_url'] ?? '')),
            'link_text' => trim((string)($announcementRaw['link_text'] ?? '')),
            'severity' => in_array($announcementSeverity, ['info', 'warning', 'urgent'], true)
                ? $announcementSeverity
                : 'info',
        ];
        if ($announcement['link_url'] === '' || $announcement['link_text'] === '') {
            $announcement['link_url'] = '';
            $announcement['link_text'] = '';
        }
        $reservationBannerRaw = decode_settings_json($settings, 'reservation_banner', []);
        $reservationBannerSeverity = $reservationBannerRaw['severity'] ?? 'info';
        $reservationBanner = [
            'enabled' => !empty($reservationBannerRaw['enabled']),
            'message' => trim((string)($reservationBannerRaw['message'] ?? '')),
            'label' => trim((string)($reservationBannerRaw['label'] ?? '')),
            'link_url' => trim((string)($reservationBannerRaw['link_url'] ?? '')),
            'link_text' => trim((string)($reservationBannerRaw['link_text'] ?? '')),
            'severity' => in_array($reservationBannerSeverity, ['info', 'warning', 'urgent'], true)
                ? $reservationBannerSeverity
                : 'info',
        ];
        if ($reservationBanner['link_url'] === '' || $reservationBanner['link_text'] === '') {
            $reservationBanner['link_url'] = '';
            $reservationBanner['link_text'] = '';
        }
        $announcementPopupRaw = decode_settings_json($settings, 'announcement_popup', []);
        $announcementPopupSeverity = $announcementPopupRaw['severity'] ?? 'info';
        $announcementPopup = [
            'enabled' => !empty($announcementPopupRaw['enabled']),
            'message' => trim((string)($announcementPopupRaw['message'] ?? '')),
            'link_url' => trim((string)($announcementPopupRaw['link_url'] ?? '')),
            'link_text' => trim((string)($announcementPopupRaw['link_text'] ?? '')),
            'severity' => in_array($announcementPopupSeverity, ['info', 'warning', 'urgent'], true)
                ? $announcementPopupSeverity
                : 'info',
            'allow_during_seat_selection' => !empty($announcementPopupRaw['allow_during_seat_selection']),
        ];
        if ($announcementPopup['link_url'] === '' || $announcementPopup['link_text'] === '') {
            $announcementPopup['link_url'] = '';
            $announcementPopup['link_text'] = '';
        }

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
                'announcement' => $announcement,
                'reservation_banner' => $reservationBanner,
                'announcement_popup' => $announcementPopup,
                'beach_price_label' => $beachPriceLabel,
                'beach_price_note' => $beachPriceNote,
                'settings' => [
                    'beach_price_label' => $beachPriceLabel,
                    'beach_price_note' => $beachPriceNote,
                ],
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
            $hasPaymentSettings = payment_settings_table_exists($pdo);
            $hasPaymentProviderType = payment_settings_table_has_column($pdo, 'provider_type');
            $hasPaymentProviderTypeSquare = payment_settings_provider_type_supports($pdo, 'square');
            $hasPaymentProviderTypePaypalOrders = payment_settings_provider_type_supports($pdo, 'paypal_orders');
            $hasPaypalHostedButtonId = payment_settings_table_has_column($pdo, 'paypal_hosted_button_id');
            $hasPaypalCurrency = payment_settings_table_has_column($pdo, 'paypal_currency');
            $hasPaypalEnableVenmo = payment_settings_table_has_column($pdo, 'paypal_enable_venmo');
            $hasSeatRequestPaymentProvider = layout_table_has_column($pdo, 'seat_requests', 'payment_provider');
            $hasSeatRequestPaymentStatus = layout_table_has_column($pdo, 'seat_requests', 'payment_status');
            $hasSeatRequestPaymentOrderId = layout_table_has_column($pdo, 'seat_requests', 'payment_order_id');
            $hasSeatRequestPaymentCaptureId = layout_table_has_column($pdo, 'seat_requests', 'payment_capture_id');
            $hasSeatRequestPaymentUpdatedAt = layout_table_has_column($pdo, 'seat_requests', 'payment_updated_at');
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
                'has_payment_settings' => $hasPaymentSettings,
                'has_payment_provider_type' => $hasPaymentProviderType,
                'has_payment_provider_type_square' => $hasPaymentProviderTypeSquare,
                'has_payment_provider_type_paypal_orders' => $hasPaymentProviderTypePaypalOrders,
                'has_paypal_hosted_button_id' => $hasPaypalHostedButtonId,
                'has_paypal_currency' => $hasPaypalCurrency,
                'has_paypal_enable_venmo' => $hasPaypalEnableVenmo,
                'has_seat_request_payment_provider' => $hasSeatRequestPaymentProvider,
                'has_seat_request_payment_status' => $hasSeatRequestPaymentStatus,
                'has_seat_request_payment_order_id' => $hasSeatRequestPaymentOrderId,
                'has_seat_request_payment_capture_id' => $hasSeatRequestPaymentCaptureId,
                'has_seat_request_payment_updated_at' => $hasSeatRequestPaymentUpdatedAt,
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
    if (!enforce_admin_route_guard($request)) {
        exit;
    }
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
