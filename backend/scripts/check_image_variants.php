#!/usr/bin/env php
<?php

use Midway\Backend\Database;
use Midway\Backend\Env;
use function Midway\Backend\determine_responsive_targets;
use function Midway\Backend\load_image_manifest;
use function Midway\Backend\relative_upload_path;

require __DIR__ . '/../lib/Env.php';
require __DIR__ . '/../lib/Database.php';

if (php_sapi_name() !== 'cli') {
    fwrite(STDERR, "This helper is intended to run from the command line.\n");
    exit(1);
}

Env::load(__DIR__ . '/../.env');
$uploadDir = Env::get('UPLOAD_DIR', 'uploads');
$absUploads = realpath(__DIR__ . '/../' . trim($uploadDir, '/')) ?: (__DIR__ . '/../' . trim($uploadDir, '/'));
define('UPLOADS_DIR', $absUploads);
define('UPLOADS_RESPONSIVE_DIR', $absUploads . '/variants');
define('UPLOADS_RESPONSIVE_OPTIMIZED_DIR', UPLOADS_RESPONSIVE_DIR . '/optimized');
define('UPLOADS_RESPONSIVE_WEBP_DIR', UPLOADS_RESPONSIVE_DIR . '/webp');
define('UPLOADS_MANIFEST_DIR', $absUploads . '/manifests');
define('RESPONSIVE_IMAGE_WIDTHS', [160, 240, 320, 480, 768, 1024, 1440, 1920]);

require __DIR__ . '/../lib/ImageUtils.php';

$pdo = Database::connection();
$settings = [];
$keys = ['hero_images', 'tgp_hero_images', 'site_logo', 'site_brand_mark', 'default_event_image'];
$placeholders = implode(',', array_fill(0, count($keys), '?'));
$stmt = $pdo->prepare("SELECT setting_key, setting_value FROM business_settings WHERE setting_key IN ({$placeholders})");
$stmt->execute($keys);
while ($row = $stmt->fetch()) {
    $settings[$row['setting_key']] = $row['setting_value'];
}

$groups = [
    'Main hero images' => decodeSetting($settings, 'hero_images'),
    'TGP hero images' => decodeSetting($settings, 'tgp_hero_images'),
];

foreach ($groups as $label => $images) {
    echo PHP_EOL . '== ' . $label . ' ==' . PHP_EOL;
    if (!$images) {
        echo "No images configured.\n";
        continue;
    }
    foreach ($images as $imageUrl) {
        printImageAudit($imageUrl, $absUploads);
    }
}

$brandingAssets = [
    'Site logo' => $settings['site_logo'] ?? '',
    'Brand mark' => $settings['site_brand_mark'] ?? '',
    'Default event image' => $settings['default_event_image'] ?? '',
];

echo PHP_EOL . '== Branding assets ==' . PHP_EOL;
foreach ($brandingAssets as $label => $url) {
    if (!$url) {
        echo "- {$label}: not configured" . PHP_EOL;
        continue;
    }
    echo "- {$label}:" . PHP_EOL;
    printImageAudit($url, $absUploads, '  ');
}

echo PHP_EOL . '== Sample published event images ==' . PHP_EOL;
$eventStmt = $pdo->query("SELECT id, artist_name, title, image_url FROM events WHERE status = 'published' AND visibility = 'public' ORDER BY COALESCE(start_datetime, CONCAT(event_date, ' 00:00:00')) ASC LIMIT 25");
$events = $eventStmt->fetchAll() ?: [];
if (!$events) {
    echo "No published events found.\n";
} else {
    foreach ($events as $event) {
        $label = sprintf('#%s %s', $event['id'] ?? '?', ($event['artist_name'] ?: $event['title'] ?: 'Event'));
        $imageUrl = trim((string) ($event['image_url'] ?? ''));
        if ($imageUrl === '') {
            echo "- {$label}: no custom image (site default applies)" . PHP_EOL;
            continue;
        }
        echo "- {$label}:" . PHP_EOL;
        printImageAudit($imageUrl, $absUploads, '  ');
    }
}

function decodeSetting(array $settings, string $key): array
{
    if (!array_key_exists($key, $settings)) {
        return [];
    }
    $raw = trim((string) $settings[$key]);
    if ($raw === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return [];
    }
    return array_values(array_filter(array_map('strval', $decoded), function ($value) {
        return $value !== '';
    }));
}

function printImageAudit(string $url, string $uploadsDir, string $prefix = '')
{
    $display = $prefix ? $prefix . 'source: ' . $url : '- ' . $url;
    echo $display . PHP_EOL;
    if (!str_starts_with($url, '/uploads/')) {
        echo $prefix . "  external image (skipped)" . PHP_EOL;
        return;
    }
    $relative = relative_upload_path($url);
    if (!$relative) {
        echo $prefix . "  invalid uploads path" . PHP_EOL;
        return;
    }
    $originalPath = rtrim($uploadsDir, '/') . '/' . $relative;
    if (!is_file($originalPath)) {
        echo $prefix . "  original missing on disk" . PHP_EOL;
        return;
    }
    $info = @getimagesize($originalPath) ?: [null, null];
    $intrinsicWidth = $info[0] ?? null;
    $intrinsicHeight = $info[1] ?? null;
    $manifest = load_image_manifest($url);
    $targets = $intrinsicWidth ? determine_responsive_targets($intrinsicWidth) : RESPONSIVE_IMAGE_WIDTHS;

    $optimizedVariants = [];
    $webpVariants = [];
    if ($manifest) {
        $optimizedVariants = (array) ($manifest['variants']['optimized'] ?? []);
        $webpVariants = (array) ($manifest['variants']['webp'] ?? []);
    }

    $availableOptimized = collectVariantWidths($optimizedVariants);
    $availableWebp = collectVariantWidths($webpVariants);
    $missingOptimized = array_values(array_diff($targets, $availableOptimized));
    $missingWebp = array_values(array_diff($targets, $availableWebp));

    echo $prefix . "  intrinsic: " . ($intrinsicWidth ? "{$intrinsicWidth}x{$intrinsicHeight}" : 'unknown') . PHP_EOL;
    echo $prefix . '  optimized widths: ' . formatWidthList($availableOptimized, $missingOptimized) . PHP_EOL;
    echo $prefix . '  webp widths: ' . formatWidthList($availableWebp, $missingWebp) . PHP_EOL;
    if (!$manifest) {
        echo $prefix . "  manifest: missing (variants will regenerate on next upload)" . PHP_EOL;
    }
}

function collectVariantWidths(array $variants): array
{
    $widths = [];
    foreach ($variants as $variant) {
        if (!empty($variant['width']) && !empty($variant['path'])) {
            if (is_file($variant['path'])) {
                $widths[] = (int) $variant['width'];
            }
        } elseif (!empty($variant['width'])) {
            $widths[] = (int) $variant['width'];
        }
    }
    $widths = array_values(array_unique($widths));
    sort($widths, SORT_NUMERIC);
    return $widths;
}

function formatWidthList(array $available, array $missing): string
{
    $parts = [];
    if ($available) {
        $parts[] = 'ok [' . implode(', ', array_map(fn($w) => $w . 'w', $available)) . ']';
    } else {
        $parts[] = 'none';
    }
    if ($missing) {
        $parts[] = 'missing [' . implode(', ', array_map(fn($w) => $w . 'w', $missing)) . ']';
    } else {
        $parts[] = 'complete';
    }
    return implode('; ', $parts);
}
