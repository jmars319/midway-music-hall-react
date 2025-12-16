<?php

namespace Midway\Backend;

use DateTimeInterface;
use RuntimeException;

const MANIFEST_VERSION = 2;

function process_image_variants(string $sourcePath, string $originalFilename, string $mime): array
{
    if (!is_file($sourcePath)) {
        return [
            'intrinsic_width' => null,
            'intrinsic_height' => null,
            'optimized_variants' => [],
            'webp_variants' => [],
            'optimized_srcset' => null,
            'webp_srcset' => null,
            'fallback_original' => '/uploads/' . ltrim($originalFilename, '/'),
            'manifest_path' => null,
            'derived_files' => [],
            'optimization_status' => 'failed',
            'processing_notes' => 'Source file missing',
        ];
    }

    $info = @getimagesize($sourcePath);
    if (!$info) {
        return [
            'intrinsic_width' => null,
            'intrinsic_height' => null,
            'optimized_variants' => [],
            'webp_variants' => [],
            'optimized_srcset' => null,
            'webp_srcset' => null,
            'fallback_original' => '/uploads/' . ltrim($originalFilename, '/'),
            'manifest_path' => null,
            'derived_files' => [],
            'optimization_status' => 'failed',
            'processing_notes' => 'Unable to read image metadata',
        ];
    }

    $width = (int) ($info[0] ?? 0);
    $height = (int) ($info[1] ?? 0);
    $type = $info[2] ?? null;
    if ($width <= 0 || $height <= 0) {
        return [
            'intrinsic_width' => $width ?: null,
            'intrinsic_height' => $height ?: null,
            'optimized_variants' => [],
            'webp_variants' => [],
            'optimized_srcset' => null,
            'webp_srcset' => null,
            'fallback_original' => '/uploads/' . ltrim($originalFilename, '/'),
            'manifest_path' => null,
            'derived_files' => [],
            'optimization_status' => 'failed',
            'processing_notes' => 'Invalid intrinsic dimensions',
        ];
    }

    $image = create_image_resource($sourcePath, $type);
    if (!$image) {
        return [
            'intrinsic_width' => $width,
            'intrinsic_height' => $height,
            'optimized_variants' => [],
            'webp_variants' => [],
            'optimized_srcset' => null,
            'webp_srcset' => null,
            'fallback_original' => '/uploads/' . ltrim($originalFilename, '/'),
            'manifest_path' => null,
            'derived_files' => [],
            'optimization_status' => 'skipped',
            'processing_notes' => 'Unsupported image format',
        ];
    }

    $image = apply_exif_orientation($image, $sourcePath, $type, $width, $height);
    $targets = determine_responsive_targets($width);
    $baseName = pathinfo($originalFilename, PATHINFO_FILENAME);
    $extension = strtolower(pathinfo($originalFilename, PATHINFO_EXTENSION));
    $optimizedVariants = [];
    $webpVariants = [];
    $derivedFiles = [];
    $notes = [];

    foreach ($targets as $targetWidth) {
        if ($targetWidth <= 0) {
            continue;
        }
        $scale = $targetWidth / $width;
        $targetHeight = max(1, (int) round($height * $scale));
        $resized = imagecreatetruecolor($targetWidth, $targetHeight);
        if ($type === IMAGETYPE_PNG || $type === IMAGETYPE_GIF || $type === IMAGETYPE_WEBP) {
            imagealphablending($resized, false);
            imagesavealpha($resized, true);
        }
        imagecopyresampled($resized, $image, 0, 0, 0, 0, $targetWidth, $targetHeight, $width, $height);

        $optimizedFilename = $baseName . '-w' . $targetWidth . '.' . $extension;
        $optimizedFullPath = rtrim(UPLOADS_RESPONSIVE_OPTIMIZED_DIR, '/') . '/' . $optimizedFilename;
        if (save_image_resource($resized, $type, $optimizedFullPath)) {
            $optimizedUrl = '/uploads/variants/optimized/' . $optimizedFilename;
            $optimizedVariants[] = [
                'url' => $optimizedUrl,
                'width' => $targetWidth,
                'height' => $targetHeight,
                'path' => $optimizedFullPath,
                'size' => @filesize($optimizedFullPath) ?: null,
            ];
            $derivedFiles[] = $optimizedFullPath;
        } else {
            $notes[] = "Failed optimized variant {$targetWidth}px";
        }

        $webpFilename = $baseName . '-w' . $targetWidth . '.webp';
        $webpFullPath = rtrim(UPLOADS_RESPONSIVE_WEBP_DIR, '/') . '/' . $webpFilename;
        if (function_exists('imagewebp')) {
            $webpResource = $resized;
            if ($type === IMAGETYPE_PNG || $type === IMAGETYPE_WEBP || $type === IMAGETYPE_GIF) {
                imagepalettetotruecolor($webpResource);
                imagealphablending($webpResource, true);
                imagesavealpha($webpResource, true);
            }
            $webpQuality = defined('IMAGE_WEBP_QUALITY') ? (int) IMAGE_WEBP_QUALITY : 90;
            $webpQuality = clamp_quality_value($webpQuality);
            if (@imagewebp($webpResource, $webpFullPath, $webpQuality)) {
                $webpUrl = '/uploads/variants/webp/' . $webpFilename;
                $webpVariants[] = [
                    'url' => $webpUrl,
                    'width' => $targetWidth,
                    'height' => $targetHeight,
                    'path' => $webpFullPath,
                    'size' => @filesize($webpFullPath) ?: null,
                ];
                $derivedFiles[] = $webpFullPath;
            } else {
                $notes[] = "Failed webp variant {$targetWidth}px";
            }
        } else {
            $notes[] = 'WebP not supported on host';
        }

        imagedestroy($resized);
    }

    imagedestroy($image);

    $optimizedSrcset = build_srcset_string($optimizedVariants);
    $webpSrcset = build_srcset_string($webpVariants);
    $manifest = [
        'version' => MANIFEST_VERSION,
        'generated_at' => gmdate(DateTimeInterface::ATOM),
        'original' => '/uploads/' . ltrim($originalFilename, '/'),
        'relative' => ltrim($originalFilename, '/'),
        'intrinsic_width' => $width,
        'intrinsic_height' => $height,
        'mime' => $mime,
        'variants' => [
            'optimized' => $optimizedVariants,
            'webp' => $webpVariants,
        ],
        'srcset' => [
            'optimized' => $optimizedSrcset,
            'webp' => $webpSrcset,
        ],
        'derived_files' => $derivedFiles,
    ];
    $manifestPath = persist_image_manifest($originalFilename, $manifest);

    return [
        'intrinsic_width' => $width,
        'intrinsic_height' => $height,
        'optimized_variants' => $optimizedVariants,
        'webp_variants' => $webpVariants,
        'optimized_srcset' => $optimizedSrcset,
        'webp_srcset' => $webpSrcset,
        'fallback_original' => '/uploads/' . ltrim($originalFilename, '/'),
        'manifest_path' => $manifestPath,
        'derived_files' => $derivedFiles,
        'optimization_status' => ($optimizedVariants || $webpVariants) ? 'complete' : 'skipped',
        'processing_notes' => implode('; ', array_unique(array_filter($notes))),
        'optimized_path' => $optimizedVariants ? end($optimizedVariants)['url'] : null,
        'webp_path' => $webpVariants ? end($webpVariants)['url'] : null,
    ];
}

function determine_responsive_targets(int $intrinsicWidth): array
{
    $targets = [];
    $configured = defined('RESPONSIVE_IMAGE_WIDTHS') && is_array(RESPONSIVE_IMAGE_WIDTHS) ? RESPONSIVE_IMAGE_WIDTHS : [160, 240, 320, 480, 768, 1024, 1440, 1920];
    foreach ($configured as $candidate) {
        $candidate = (int) $candidate;
        if ($candidate > 0 && $candidate <= $intrinsicWidth) {
            $targets[] = $candidate;
        }
    }
    if (empty($targets)) {
        $targets[] = $intrinsicWidth;
    }
    $targets = array_values(array_unique($targets));
    sort($targets, SORT_NUMERIC);
    return $targets;
}

function build_srcset_string(array $variants): ?string
{
    if (!$variants) {
        return null;
    }
    $parts = [];
    foreach ($variants as $variant) {
        if (empty($variant['url']) || empty($variant['width'])) {
            continue;
        }
        $parts[] = $variant['url'] . ' ' . (int) $variant['width'] . 'w';
    }
    return $parts ? implode(', ', $parts) : null;
}

function persist_image_manifest(string $filename, array $payload): ?string
{
    $baseName = pathinfo($filename, PATHINFO_FILENAME);
    if ($baseName === '') {
        return null;
    }
    $manifestPath = rtrim(UPLOADS_MANIFEST_DIR, '/') . '/' . $baseName . '.json';
    $payload['manifest_path'] = $manifestPath;
    @file_put_contents($manifestPath, json_encode($payload, JSON_PRETTY_PRINT));
    return $manifestPath;
}

function load_image_manifest(string $fileUrl): ?array
{
    $relative = relative_upload_path($fileUrl);
    if (!$relative) {
        return null;
    }
    $baseName = pathinfo($relative, PATHINFO_FILENAME);
    if ($baseName === '') {
        return null;
    }
    $manifestPath = rtrim(UPLOADS_MANIFEST_DIR, '/') . '/' . $baseName . '.json';
    if (!is_file($manifestPath)) {
        return null;
    }
    $decoded = json_decode(file_get_contents($manifestPath), true);
    if (!is_array($decoded)) {
        return null;
    }
    return $decoded;
}

function relative_upload_path(string $fileUrl): ?string
{
    if (!is_string($fileUrl) || trim($fileUrl) === '') {
        return null;
    }
    if (str_starts_with($fileUrl, '/uploads/')) {
        $relative = ltrim(substr($fileUrl, strlen('/uploads/')), '/');
        return $relative !== '' ? $relative : null;
    }
    if (str_starts_with($fileUrl, 'uploads/')) {
        $relative = ltrim(substr($fileUrl, strlen('uploads/')), '/');
        return $relative !== '' ? $relative : null;
    }
    return null;
}

function asset_url_is_absolute(?string $url): bool
{
    if (!is_string($url)) {
        return false;
    }
    $trimmed = trim($url);
    if ($trimmed === '') {
        return false;
    }
    return str_starts_with($trimmed, 'http://')
        || str_starts_with($trimmed, 'https://')
        || str_starts_with($trimmed, '//')
        || str_starts_with($trimmed, 'data:');
}

function upload_asset_path_from_url(?string $url): ?string
{
    if (!is_string($url) || trim($url) === '') {
        return null;
    }
    $relative = relative_upload_path($url);
    if (!$relative) {
        return null;
    }
    return rtrim(UPLOADS_DIR, '/') . '/' . $relative;
}

function upload_asset_exists(?string $url): bool
{
    if (!is_string($url)) {
        return false;
    }
    $trimmed = trim($url);
    if ($trimmed === '') {
        return false;
    }
    if (asset_url_is_absolute($trimmed)) {
        return true;
    }
    $path = upload_asset_path_from_url($trimmed);
    if (!$path) {
        return false;
    }
    return is_file($path);
}

function normalize_existing_upload_url(?string $url): ?string
{
    if (!is_string($url)) {
        return null;
    }
    $trimmed = trim($url);
    if ($trimmed === '') {
        return null;
    }
    if (!upload_asset_exists($trimmed)) {
        return null;
    }
    if (str_starts_with($trimmed, 'uploads/')) {
        return '/' . ltrim($trimmed, '/');
    }
    return $trimmed;
}

function normalize_manifest_variants(array $variants): array
{
    $filtered = [];
    foreach ($variants as $variant) {
        if (!is_array($variant)) {
            continue;
        }
        $url = normalize_existing_upload_url($variant['url'] ?? null);
        if (!$url) {
            continue;
        }
        $width = isset($variant['width']) ? (int) $variant['width'] : null;
        $height = isset($variant['height']) ? (int) $variant['height'] : null;
        $filtered[] = array_merge($variant, [
            'url' => $url,
            'width' => $width,
            'height' => $height,
        ]);
    }
    usort($filtered, function ($a, $b) {
        return ($a['width'] ?? PHP_INT_MAX) <=> ($b['width'] ?? PHP_INT_MAX);
    });
    return $filtered;
}

function build_variant_payload_from_manifest(string $fileUrl, array $manifest): array
{
    $optimizedVariants = normalize_manifest_variants((array) ($manifest['variants']['optimized'] ?? []));
    $webpVariants = normalize_manifest_variants((array) ($manifest['variants']['webp'] ?? []));

    $optimizedSrcset = build_srcset_string($optimizedVariants);
    $webpSrcset = build_srcset_string($webpVariants);
    $resolvedFileUrl = normalize_existing_upload_url($fileUrl) ?? $fileUrl;
    $original = normalize_existing_upload_url($manifest['original'] ?? $fileUrl);
    if (!$original) {
        $original = normalize_existing_upload_url($fileUrl);
    }
    $fallbackOriginal = $original ?? $resolvedFileUrl ?? null;

    $optimizedRepresentative = $optimizedVariants ? end($optimizedVariants) : null;
    $webpRepresentative = $webpVariants ? end($webpVariants) : null;

    return [
        'file_url' => $resolvedFileUrl ?? $fileUrl,
        'original' => $original,
        'fallback_original' => $fallbackOriginal,
        'optimized' => $optimizedRepresentative['url'] ?? null,
        'webp' => $webpRepresentative['url'] ?? null,
        'optimized_variants' => $optimizedVariants,
        'webp_variants' => $webpVariants,
        'optimized_srcset' => $optimizedSrcset,
        'webp_srcset' => $webpSrcset,
        'intrinsic_width' => $manifest['intrinsic_width'] ?? null,
        'intrinsic_height' => $manifest['intrinsic_height'] ?? null,
    ];
}

function delete_image_with_variants(string $fileUrl): void
{
    $relative = relative_upload_path($fileUrl);
    if (!$relative) {
        return;
    }
    $originalPath = rtrim(UPLOADS_DIR, '/') . '/' . $relative;
    $manifest = load_image_manifest($fileUrl);
    $derivedFiles = [];
    if ($manifest && !empty($manifest['derived_files'])) {
        foreach ((array) $manifest['derived_files'] as $path) {
            if (is_string($path) && is_file($path)) {
                $derivedFiles[] = $path;
            }
        }
    } else {
        $baseName = pathinfo($relative, PATHINFO_FILENAME);
        $extension = pathinfo($relative, PATHINFO_EXTENSION);
        foreach ([UPLOADS_RESPONSIVE_OPTIMIZED_DIR => $extension, UPLOADS_RESPONSIVE_WEBP_DIR => 'webp'] as $dir => $ext) {
            foreach (RESPONSIVE_IMAGE_WIDTHS as $width) {
                $candidate = rtrim($dir, '/') . '/' . $baseName . '-w' . $width . '.' . $ext;
                if (is_file($candidate)) {
                    $derivedFiles[] = $candidate;
                }
            }
        }
    }
    $manifestPath = null;
    if ($manifest && !empty($manifest['manifest_path'])) {
        $manifestPath = $manifest['manifest_path'];
    } else {
        $baseName = pathinfo($relative, PATHINFO_FILENAME);
        $candidate = rtrim(UPLOADS_MANIFEST_DIR, '/') . '/' . $baseName . '.json';
        if (is_file($candidate)) {
            $manifestPath = $candidate;
        }
    }
    $filesToDelete = array_filter(array_merge([$originalPath], $derivedFiles, [$manifestPath]));
    atomic_delete_files($filesToDelete);
}

function atomic_delete_files(array $paths): void
{
    $moves = [];
    foreach ($paths as $path) {
        if (!$path || !is_string($path) || !is_file($path)) {
            continue;
        }
        $temp = $path . '.del.' . bin2hex(random_bytes(4));
        if (!@rename($path, $temp)) {
            foreach (array_reverse($moves) as [$orig, $tmp]) {
                if (is_file($tmp)) {
                    @rename($tmp, $orig);
                }
            }
            throw new RuntimeException('Failed to prepare files for deletion');
        }
        $moves[] = [$path, $temp];
    }

    foreach ($moves as [, $temp]) {
        if (is_file($temp)) {
            @unlink($temp);
        }
    }
}

function create_image_resource(string $path, ?int $type)
{
    switch ($type) {
        case IMAGETYPE_JPEG:
            return @imagecreatefromjpeg($path);
        case IMAGETYPE_PNG:
            return @imagecreatefrompng($path);
        case IMAGETYPE_GIF:
            return @imagecreatefromgif($path);
        case IMAGETYPE_WEBP:
            return function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($path) : null;
        default:
            return null;
    }
}

function clamp_quality_value(int $value, int $min = 1, int $max = 100): int
{
    return max($min, min($max, $value));
}

function save_image_resource($resource, ?int $type, string $path): bool
{
    switch ($type) {
        case IMAGETYPE_JPEG:
            if (function_exists('imageinterlace')) {
                imageinterlace($resource, true);
            }
            $quality = defined('IMAGE_JPEG_QUALITY') ? (int) IMAGE_JPEG_QUALITY : 88;
            $quality = clamp_quality_value($quality);
            return @imagejpeg($resource, $path, $quality);
        case IMAGETYPE_PNG:
            $compression = defined('IMAGE_PNG_COMPRESSION') ? (int) IMAGE_PNG_COMPRESSION : 6;
            $compression = max(0, min(9, $compression));
            return @imagepng($resource, $path, $compression);
        case IMAGETYPE_GIF:
            return @imagegif($resource, $path);
        case IMAGETYPE_WEBP:
            $quality = defined('IMAGE_WEBP_QUALITY') ? (int) IMAGE_WEBP_QUALITY : 90;
            $quality = clamp_quality_value($quality);
            return function_exists('imagewebp') ? @imagewebp($resource, $path, $quality) : false;
        default:
            return false;
    }
}

function apply_exif_orientation($resource, string $path, ?int $type, ?int &$width = null, ?int &$height = null)
{
    if ($type !== IMAGETYPE_JPEG || !function_exists('exif_read_data')) {
        return $resource;
    }
    $exif = @exif_read_data($path);
    if (!$exif || empty($exif['Orientation'])) {
        return $resource;
    }
    $orientation = (int) $exif['Orientation'];
    switch ($orientation) {
        case 3:
            return imagerotate($resource, 180, 0);
        case 6:
            $rotated = imagerotate($resource, -90, 0);
            if ($width !== null && $height !== null) {
                [$width, $height] = [$height, $width];
            }
            return $rotated;
        case 8:
            $rotated = imagerotate($resource, 90, 0);
            if ($width !== null && $height !== null) {
                [$width, $height] = [$height, $width];
            }
            return $rotated;
        default:
            return $resource;
    }
}
