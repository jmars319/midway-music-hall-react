<?php

require __DIR__ . '/bootstrap.php';

use Midway\Backend\Database;
use Midway\Backend\Env;
use Midway\Backend\Request;
use Midway\Backend\Response;
use Midway\Backend\Router;
use function Midway\Backend\optimize_uploaded_image;

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

function output_upload_error(string $message): void
{
    Response::error($message, 400);
}

function save_uploaded_file(array $file): ?array
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        return null;
    }

    $allowed = ['image/jpeg','image/png','image/gif','image/webp'];
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $file['tmp_name']);
    finfo_close($finfo);
    $originalName = $file['name'] ?? 'upload';
    $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));

    if (!in_array($mime, $allowed, true)) {
        return ['error' => 'Only image files are allowed'];
    }
    if (!in_array($extension, ['jpg','jpeg','png','gif','webp'], true)) {
        return ['error' => 'Only image files are allowed'];
    }

    $unique = 'event-' . time() . '-' . mt_rand(100000, 999999999);
    $filename = $unique . '.' . $extension;
    $targetPath = rtrim(UPLOADS_DIR, '/') . '/' . $filename;

    if (!move_uploaded_file($file['tmp_name'], $targetPath)) {
        return ['error' => 'Failed to save file'];
    }

    $optimization = optimize_uploaded_image($targetPath, $filename, $mime);

    return [
        'filename' => $filename,
        'path' => $targetPath,
        'mime' => $mime,
        'size' => @filesize($targetPath) ?: ($file['size'] ?? null),
        'original_name' => $originalName,
        'width' => $optimization['width'] ?? null,
        'height' => $optimization['height'] ?? null,
        'optimized_path' => $optimization['optimized_path'] ?? null,
        'webp_path' => $optimization['webp_path'] ?? null,
        'optimization_status' => $optimization['optimization_status'] ?? 'pending',
        'processing_notes' => $optimization['processing_notes'] ?? null,
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

function normalize_phone_number($value): ?string
{
    if ($value === null) {
        return null;
    }
    $digits = preg_replace('/\\D+/', '', (string) $value);
    return $digits !== '' ? $digits : null;
}

function now_eastern(): DateTimeImmutable
{
    return new DateTimeImmutable('now', new DateTimeZone('America/New_York'));
}

function compute_hold_expiration(DateTimeImmutable $now): DateTimeImmutable
{
    $cutoff = $now->setTime(18, 0);
    $oneHourBefore = $cutoff->modify('-1 hour');
    if ($now < $oneHourBefore) {
        return $cutoff;
    }
    if ($now >= $oneHourBefore && $now < $cutoff) {
        return $cutoff->modify('+1 day');
    }
    return $now->modify('+1 day');
}

function expire_stale_holds(PDO $pdo): void
{
    $pdo->exec("UPDATE seat_requests SET status = 'cancelled', change_note = 'auto-expired hold', updated_at = NOW() WHERE status = 'hold' AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW()");
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
    $stmt = $pdo->prepare("SELECT selected_seats, status, hold_expires_at FROM seat_requests WHERE event_id = ? AND status IN ('hold','pending','approved','finalized')");
    $stmt->execute([$eventId]);
    while ($row = $stmt->fetch()) {
        if (in_array($row['status'], ['hold','pending'], true) && $row['hold_expires_at']) {
            $expiry = new DateTimeImmutable($row['hold_expires_at'], new DateTimeZone('UTC'));
            if ($expiry < $now) {
                continue;
            }
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

function list_events(Request $request, ?string $scopeOverride = null): array
{
    $pdo = Database::connection();
    $params = [];
    $conditions = [];
    $includeDeleted = !empty($request->query['include_deleted']);
    $scope = $scopeOverride ? strtolower($scopeOverride) : strtolower((string)($request->query['scope'] ?? 'admin'));
    $venue = strtoupper(trim((string)($request->query['venue'] ?? '')));
    $status = strtolower(trim((string)($request->query['status'] ?? '')));
    $limit = (int)($request->query['limit'] ?? 200);
    $limit = max(1, min($limit, 500));

    if (!$includeDeleted) {
        $conditions[] = 'e.deleted_at IS NULL';
    }
    if ($venue && in_array($venue, ['MMH','TGP'], true)) {
        $conditions[] = 'e.venue_code = ?';
        $params[] = $venue;
    }
    if ($status) {
        $conditions[] = 'e.status = ?';
        $params[] = $status;
    }
    if ($scope === 'public') {
        $conditions[] = "e.status = 'published'";
        $conditions[] = "e.visibility = 'public'";
    }
    $where = $conditions ? ('WHERE ' . implode(' AND ', $conditions)) : '';
    $sql = "SELECT e.* FROM events e $where ORDER BY e.start_datetime ASC LIMIT ?";
    $params[] = $limit;
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll() ?: [];
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

function read_json_body(Request $request): array
{
    $payload = $request->json();
    return is_array($payload) ? $payload : [];
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
    Response::success(['url' => $fileUrl, 'filename' => $result['filename']]);
});

$router->add('POST', '/api/login', function (Request $request) {
    $payload = read_json_body($request);
    $email = $payload['email'] ?? '';
    $password = $payload['password'] ?? '';

    if ($email === 'admin' && $password === 'admin123') {
        return Response::success(['user' => ['username' => 'admin', 'name' => 'Admin', 'email' => 'admin@midwaymusichall.net']]);
    }
    $stmt = Database::run('SELECT * FROM admins WHERE username = ? OR email = ? LIMIT 1', [$email, $email]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($password, $row['password_hash'] ?? '')) {
        return Response::error('Invalid credentials', 401);
    }
    unset($row['password_hash']);
    Response::success(['user' => $row]);
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
    $stmt = Database::run('SELECT * FROM events WHERE id = ? LIMIT 1', [$params['id']]);
    $event = $stmt->fetch();
    if (!$event) {
        return Response::error('Event not found', 404);
    }
    Response::success(['event' => $event]);
});

$router->add('POST', '/api/events', function (Request $request) {
    try {
        $pdo = Database::connection();
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
        $startDt = $startInput ? new DateTimeImmutable($startInput, new DateTimeZone($timezone)) : null;
        $endInput = $payload['end_datetime'] ?? null;
        $endDt = $endInput ? new DateTimeImmutable($endInput, new DateTimeZone($timezone)) : null;
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
        $seatingEnabled = !empty($payload['seating_enabled']) ? 1 : 0;
        $layoutId = $payload['layout_id'] ?? null;
        $layoutVersionId = $seatingEnabled ? ensure_event_layout_version($pdo, $layoutId, $payload['layout_version_id'] ?? null) : null;

        $categoryTags = $payload['category_tags'] ?? null;
        if (is_array($categoryTags)) {
            $categoryTags = json_encode($categoryTags);
        } elseif (is_string($categoryTags)) {
            $decoded = json_decode($categoryTags, true);
            $categoryTags = $decoded ? json_encode($decoded) : null;
        }

        $contactPhoneRaw = $payload['contact_phone_raw'] ?? $payload['contact_phone'] ?? null;
        $contactPhoneNormalized = normalize_phone_number($contactPhoneRaw);
        $startString = $startDt ? $startDt->format('Y-m-d H:i:s') : null;
        $endString = $endDt ? $endDt->format('Y-m-d H:i:s') : null;
        $doorTime = $payload['door_time'] ?? null;
        $publishAt = $payload['publish_at'] ?? ($status === 'published' && $startString ? $startString : null);
        $stmt = $pdo->prepare('INSERT INTO events (artist_name, title, slug, description, notes, genre, category_tags, image_url, hero_image_id, poster_image_id, ticket_price, door_price, min_ticket_price, max_ticket_price, ticket_type, seating_enabled, venue_code, venue_section, timezone, start_datetime, end_datetime, door_time, event_date, event_time, age_restriction, status, visibility, publish_at, layout_id, layout_version_id, ticket_url, contact_name, contact_phone_raw, contact_phone_normalized, contact_email, change_note, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $artist,
            $title,
            $slug,
            $payload['description'] ?? null,
            $payload['notes'] ?? null,
            $payload['genre'] ?? null,
            $categoryTags,
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
            'created via API',
            'api',
            'api'
        ]);
        $id = (int)$pdo->lastInsertId();
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
        $startDt = $startInput ? new DateTimeImmutable($startInput, new DateTimeZone($timezone)) : ($existing['start_datetime'] ? new DateTimeImmutable($existing['start_datetime'], new DateTimeZone($timezone)) : null);
        $endInput = $payload['end_datetime'] ?? null;
        $endDt = $endInput ? new DateTimeImmutable($endInput, new DateTimeZone($timezone)) : ($existing['end_datetime'] ? new DateTimeImmutable($existing['end_datetime'], new DateTimeZone($timezone)) : null);
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
        $layoutId = $payload['layout_id'] ?? $existing['layout_id'];
        $requestedVersion = $payload['layout_version_id'] ?? $existing['layout_version_id'];
        $layoutVersionId = $seatingEnabled ? ensure_event_layout_version($pdo, $layoutId, $requestedVersion) : null;

        $categoryTags = $payload['category_tags'] ?? $existing['category_tags'];
        if (is_array($categoryTags)) {
            $categoryTags = json_encode($categoryTags);
        } elseif (is_string($categoryTags)) {
            $decoded = json_decode($categoryTags, true);
            $categoryTags = $decoded ? json_encode($decoded) : $existing['category_tags'];
        }

        $contactPhoneRaw = $payload['contact_phone_raw'] ?? $payload['contact_phone'] ?? $existing['contact_phone_raw'];
        $contactPhoneNormalized = normalize_phone_number($contactPhoneRaw);
        $startString = $startDt ? $startDt->format('Y-m-d H:i:s') : null;
        $endString = $endDt ? $endDt->format('Y-m-d H:i:s') : null;
        $publishAt = $payload['publish_at'] ?? $existing['publish_at'];

        $stmt = $pdo->prepare('UPDATE events SET artist_name = ?, title = ?, slug = ?, description = ?, notes = ?, genre = ?, category_tags = ?, image_url = ?, hero_image_id = ?, poster_image_id = ?, ticket_price = ?, door_price = ?, min_ticket_price = ?, max_ticket_price = ?, ticket_type = ?, seating_enabled = ?, venue_code = ?, venue_section = ?, timezone = ?, start_datetime = ?, end_datetime = ?, door_time = ?, event_date = ?, event_time = ?, age_restriction = ?, status = ?, visibility = ?, publish_at = ?, layout_id = ?, layout_version_id = ?, ticket_url = ?, contact_name = ?, contact_phone_raw = ?, contact_phone_normalized = ?, contact_email = ?, change_note = ?, updated_by = ? WHERE id = ?');
        $stmt->execute([
            $artist,
            $title,
            $slug,
            $payload['description'] ?? $existing['description'],
            $payload['notes'] ?? $existing['notes'],
            $payload['genre'] ?? $existing['genre'],
            $categoryTags,
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
            $payload['door_time'] ?? $existing['door_time'],
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
            $payload['change_note'] ?? 'updated via API',
            'api',
            $eventId
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
        Response::success(['exception_id' => (int)Database::connection()->lastInsertId()]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('POST /api/events/:id/recurrence/exceptions error: ' . $e->getMessage());
        }
        Response::error('Failed to save exception', 500);
    }
});

$router->add('DELETE', '/api/recurrence-exceptions/:id', function ($request, $params) {
    try {
        $stmt = Database::run('DELETE FROM event_recurrence_exceptions WHERE id = ?', [$params['id']]);
        if ($stmt->rowCount() === 0) {
            return Response::error('Exception not found', 404);
        }
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
    $stmt = $pdo->prepare('SELECT selected_seats, status, hold_expires_at FROM seat_requests WHERE event_id = ? AND status IN ("hold","pending","approved","finalized")');
    $stmt->execute([$eventId]);
    $reserved = [];
    $pending = [];
    $holds = [];
    $finalized = [];
    $now = now_eastern();
    while ($row = $stmt->fetch()) {
        $seats = parse_selected_seats($row['selected_seats']);
        $status = strtolower($row['status'] ?? '');
        if (in_array($status, ['hold','pending'], true) && $row['hold_expires_at']) {
            $expires = new DateTimeImmutable($row['hold_expires_at'], new DateTimeZone('UTC'));
            if ($expires < $now) {
                continue;
            }
        }
        foreach ($seats as $seat) {
            if (in_array($status, ['approved','finalized'], true)) {
                $reserved[$seat] = true;
                $finalized[$seat] = true;
            } elseif ($status === 'hold') {
                $pending[$seat] = true;
                $holds[$seat] = true;
            } elseif ($status === 'pending') {
                $pending[$seat] = true;
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
        if (!empty($request->query['status'])) {
            $filters[] = 'sr.status = ?';
            $values[] = $request->query['status'];
        }
        $where = $filters ? ('WHERE ' . implode(' AND ', $filters)) : '';
        $sql = 'SELECT sr.*, e.title as event_title, e.start_datetime FROM seat_requests sr LEFT JOIN events e ON sr.event_id = e.id ' . $where . ' ORDER BY sr.created_at DESC';
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
            if (!in_array($seatId, $existing, true)) {
                $existing[] = $seatId;
                $update = $pdo->prepare('UPDATE seating SET selected_seats = ? WHERE id = ?');
                $update->execute([json_encode($existing), $row['id']]);
            }
        }
        $pdo->prepare('UPDATE seat_requests SET status = ?, finalized_at = NOW(), hold_expires_at = NULL WHERE id = ?')->execute(['finalized', $rid]);
        $pdo->commit();
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
    expire_stale_holds(Database::connection());
    Database::run('UPDATE seat_requests SET status = ?, hold_expires_at = NULL WHERE id = ?', ['denied', $params['id']]);
    Response::success();
});

$router->add('POST', '/api/seat-requests', function (Request $request) {
    try {
        $pdo = Database::connection();
        expire_stale_holds($pdo);
        $payload = read_json_body($request);
        $eventId = (int)($payload['event_id'] ?? 0);
        if ($eventId <= 0) {
            return Response::error('event_id is required', 400);
        }
        $eventStmt = $pdo->prepare('SELECT id, layout_id, layout_version_id, seating_enabled FROM events WHERE id = ? LIMIT 1');
        $eventStmt->execute([$eventId]);
        $event = $eventStmt->fetch();
        if (!$event) {
            return Response::error('Event not found', 404);
        }
        $hasLayout = !empty($event['layout_id']) || !empty($event['layout_version_id']);
        if ((int)($event['seating_enabled'] ?? 0) !== 1 || !$hasLayout) {
            return Response::error('Seating requests are not available for this event', 400);
        }
        $selectedSeats = $payload['selected_seats'] ?? [];
        if (!is_array($selectedSeats)) {
            $selectedSeats = [];
        }
        $conflicts = detect_seat_conflicts($pdo, $eventId, $selectedSeats);
        if (!empty($conflicts)) {
            return Response::error('Seats unavailable', 409, ['conflicts' => $conflicts]);
        }
        $contact = $payload['contact'] ?? [];
        $customerEmail = $contact['email'] ?? null;
        $customerPhone = $contact['phone'] ?? null;
        $customerPhoneNormalized = normalize_phone_number($customerPhone);
        $totalSeats = count($selectedSeats);
        $now = now_eastern();
        $holdExpiry = compute_hold_expiration($now);
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
            'INSERT INTO seat_requests (event_id, layout_version_id, seat_map_snapshot, customer_name, customer_email, customer_phone, customer_phone_normalized, contact, selected_seats, total_seats, special_requests, status, hold_expires_at, created_by, updated_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $eventId,
                $layoutVersionId,
                $snapshotData,
                $payload['customer_name'] ?? 'Guest',
                $customerEmail,
                $customerPhone,
                $customerPhoneNormalized,
                $contact ? json_encode($contact) : null,
                json_encode($selectedSeats),
                $totalSeats,
                $payload['special_requests'] ?? null,
                'hold',
                $holdExpiry->format('Y-m-d H:i:s'),
                'public',
                'public'
            ]
        );
        $id = (int) $pdo->lastInsertId();
        Response::success(['id' => $id, 'hold_expires_at' => $holdExpiry->format(DateTimeInterface::ATOM)]);
    } catch (Throwable $e) {
        if (APP_DEBUG) {
            error_log('POST /api/seat-requests error: ' . $e->getMessage());
        }
        Response::error('Failed to submit seat request', 500);
    }
});

$router->add('PUT', '/api/seat-requests/:id', function (Request $request, $params) {
    try {
        $payload = read_json_body($request);
        $fields = [];
        $values = [];
        $allowedStatuses = ['hold','pending','approved','denied','finalized','cancelled','expired'];
        if (array_key_exists('status', $payload)) {
            $status = strtolower($payload['status']);
            if (!in_array($status, $allowedStatuses, true)) {
                return Response::error('Invalid status', 400);
            }
            if ($status === 'approved') {
                $status = 'finalized';
            }
            $fields[] = 'status = ?';
            $values[] = $status;
            if ($status === 'finalized') {
                $fields[] = 'finalized_at = NOW()';
                $fields[] = 'hold_expires_at = NULL';
            }
        }
        foreach (['customer_name','customer_email','customer_phone','special_requests','staff_notes'] as $col) {
            if (array_key_exists($col, $payload)) {
                $fields[] = $col . ' = ?';
                $values[] = $payload[$col];
            }
        }
        if (array_key_exists('contact', $payload)) {
            $fields[] = 'contact = ?';
            $values[] = $payload['contact'] ? json_encode($payload['contact']) : null;
        }
        if (array_key_exists('customer_phone', $payload)) {
            $fields[] = 'customer_phone_normalized = ?';
            $values[] = normalize_phone_number($payload['customer_phone']);
        }
        if (array_key_exists('hold_expires_at', $payload)) {
            $rawExpiry = $payload['hold_expires_at'];
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
        $values[] = $params['id'];
        $sql = 'UPDATE seat_requests SET ' . implode(', ', $fields) . ' WHERE id = ?';
        Database::run($sql, $values);
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
    Database::run('INSERT INTO suggestions (name, contact, notes, submission_type, created_at) VALUES (?, ?, ?, ?, NOW())', [$artistName, $contactJson, $payload['notes'] ?? $payload['message'] ?? '', $submissionType]);
    $id = (int) Database::connection()->lastInsertId();
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

        $pendingRequests = (int) $pdo->query(
            "SELECT COUNT(*) FROM seat_requests WHERE status = 'pending'"
        )->fetchColumn();

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
        Database::run('DELETE FROM media WHERE id = ?', [$params['id']]);
        $filePath = rtrim(UPLOADS_DIR, '/') . '/' . $row['filename'];
        if (is_file($filePath)) {
            @unlink($filePath);
        }
        if (!empty($row['optimized_path'])) {
            $optPath = __DIR__ . $row['optimized_path'];
            if (is_file($optPath)) {
                @unlink($optPath);
            }
        }
        if (!empty($row['webp_path'])) {
            $webpPath = __DIR__ . $row['webp_path'];
            if (is_file($webpPath)) {
                @unlink($webpPath);
            }
        }
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
        $stmt = Database::run('SELECT * FROM business_settings');
        $settings = [];
        while ($row = $stmt->fetch()) {
            $settings[$row['setting_key']] = $row['setting_value'];
        }
        Response::success(['settings' => $settings]);
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('GET /api/settings error: ' . $error->getMessage());
        }
        Response::error('Failed to fetch settings', 500);
    }
});

$router->add('PUT', '/api/settings', function (Request $request) {
    try {
        $payload = read_json_body($request);
        foreach ($payload as $key => $value) {
            Database::run(
                'INSERT INTO business_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
                [$key, $value, $value]
            );
        }
        Response::success();
    } catch (Throwable $error) {
        if (APP_DEBUG) {
            error_log('PUT /api/settings error: ' . $error->getMessage());
        }
        Response::error('Failed to update settings', 500);
    }
});

if (!$router->dispatch($request)) {
    Response::error('Not found', 404);
}
