#!/usr/bin/env php
<?php

use Midway\Backend\Env;
use Midway\Backend\Database;

require __DIR__ . '/../lib/Env.php';
require __DIR__ . '/../lib/Database.php';

if (php_sapi_name() !== 'cli') {
    fwrite(STDERR, "This helper is intended to run from the command line.\n");
    exit(1);
}

Env::load(__DIR__ . '/../.env');
$pdo = Database::connection();
$settings = [];
$keys = ['hero_images', 'tgp_hero_images'];
$placeholders = implode(',', array_fill(0, count($keys), '?'));
$stmt = $pdo->prepare("SELECT setting_key, setting_value FROM business_settings WHERE setting_key IN ({$placeholders})");
$stmt->execute($keys);
while ($row = $stmt->fetch()) {
    $settings[$row['setting_key']] = $row['setting_value'];
}

$uploadDir = Env::get('UPLOAD_DIR', 'uploads');
$absUploads = realpath(__DIR__ . '/../' . trim($uploadDir, '/')) ?: (__DIR__ . '/../' . trim($uploadDir, '/'));
$optimizedDir = $absUploads . '/optimized';
$webpDir = $absUploads . '/webp';

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
        $details = describeVariant($imageUrl, $absUploads, $optimizedDir, $webpDir);
        echo '- ' . $imageUrl . PHP_EOL;
        echo '  original: ' . ($details['original_exists'] ? 'present (' . $details['original_size'] . ')' : 'missing') . PHP_EOL;
        echo '  optimized: ' . ($details['optimized_url'] ? ('present (' . $details['optimized_size'] . ') -> ' . $details['optimized_url']) : 'missing') . PHP_EOL;
        echo '  webp: ' . ($details['webp_url'] ? ('present (' . $details['webp_size'] . ') -> ' . $details['webp_url']) : 'missing') . PHP_EOL;
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

function describeVariant(string $url, string $uploadsDir, string $optimizedDir, string $webpDir): array
{
    $result = [
        'original_exists' => false,
        'original_size' => '0 B',
        'optimized_url' => null,
        'optimized_size' => '0 B',
        'webp_url' => null,
        'webp_size' => '0 B',
    ];

    if (!str_starts_with($url, '/uploads/')) {
        return $result;
    }

    $relative = ltrim(substr($url, strlen('/uploads/')), '/');
    if ($relative === '') {
        return $result;
    }

    $originalPath = $uploadsDir . '/' . $relative;
    if (is_file($originalPath)) {
        $result['original_exists'] = true;
        $result['original_size'] = formatBytes(filesize($originalPath));
    }

    $basename = pathinfo($relative, PATHINFO_FILENAME);
    $extension = pathinfo($relative, PATHINFO_EXTENSION);
    if ($basename && $extension) {
        $optimizedRelative = 'optimized/' . $basename . '-optimized.' . $extension;
        $optimizedPath = $optimizedDir . '/' . $basename . '-optimized.' . $extension;
        if (is_file($optimizedPath)) {
            $result['optimized_url'] = '/uploads/' . $optimizedRelative;
            $result['optimized_size'] = formatBytes(filesize($optimizedPath));
        }

        $webpRelative = 'webp/' . $basename . '.webp';
        $webpPath = $webpDir . '/' . $basename . '.webp';
        if (is_file($webpPath)) {
            $result['webp_url'] = '/uploads/' . $webpRelative;
            $result['webp_size'] = formatBytes(filesize($webpPath));
        }
    }

    return $result;
}

function formatBytes($bytes): string
{
    if (!is_numeric($bytes) || $bytes <= 0) {
        return '0 B';
    }
    $units = ['B', 'KB', 'MB', 'GB'];
    $power = (int) floor(log($bytes, 1024));
    $power = min($power, count($units) - 1);
    $value = $bytes / (1024 ** $power);
    return number_format($value, $power === 0 ? 0 : 2) . ' ' . $units[$power];
}
