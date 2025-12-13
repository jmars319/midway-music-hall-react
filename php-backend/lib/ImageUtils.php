<?php

namespace Midway\Backend;

function optimize_uploaded_image(string $sourcePath, string $originalFilename, string $mime): array
{
    if (!file_exists($sourcePath)) {
        return [
            'width' => null,
            'height' => null,
            'optimized_path' => null,
            'webp_path' => null,
            'optimization_status' => 'failed',
            'processing_notes' => 'Source file missing.'
        ];
    }

    $info = @getimagesize($sourcePath);
    if (!$info) {
        return [
            'width' => null,
            'height' => null,
            'optimized_path' => null,
            'webp_path' => null,
            'optimization_status' => 'failed',
            'processing_notes' => 'Unable to read image metadata.'
        ];
    }

    $width = $info[0] ?? null;
    $height = $info[1] ?? null;
    $type = $info[2] ?? null;
    $maxDimension = defined('IMAGE_MAX_DIMENSION') ? max(600, IMAGE_MAX_DIMENSION) : 2000;
    $optimizedPath = null;
    $webpPath = null;
    $status = 'complete';
    $notes = '';

    $image = create_image_resource($sourcePath, $type);
    if (!$image) {
        return [
            'width' => $width,
            'height' => $height,
            'optimized_path' => null,
            'webp_path' => null,
            'optimization_status' => 'skipped',
            'processing_notes' => 'Unsupported image type for optimization.'
        ];
    }

    $image = apply_exif_orientation($image, $sourcePath, $type, $width, $height);

    $resized = $image;
    $longestSide = max($width ?? 0, $height ?? 0);
    if ($longestSide && $longestSide > $maxDimension) {
        $scale = $maxDimension / $longestSide;
        $targetWidth = max(1, (int) round(($width ?? 0) * $scale));
        $targetHeight = max(1, (int) round(($height ?? 0) * $scale));
        $resized = imagecreatetruecolor($targetWidth, $targetHeight);
        if ($type === IMAGETYPE_PNG || $type === IMAGETYPE_WEBP) {
            imagealphablending($resized, false);
            imagesavealpha($resized, true);
        }
        imagecopyresampled($resized, $image, 0, 0, 0, 0, $targetWidth, $targetHeight, $width, $height);
        $width = $targetWidth;
        $height = $targetHeight;
    }

    $optimizedFilename = pathinfo($originalFilename, PATHINFO_FILENAME) . '-optimized.' . pathinfo($originalFilename, PATHINFO_EXTENSION);
    $optimizedFullPath = rtrim(UPLOADS_OPTIMIZED_DIR, '/') . '/' . $optimizedFilename;

    if (save_image_resource($resized, $type, $optimizedFullPath)) {
        $optimizedPath = '/uploads/optimized/' . $optimizedFilename;
    } else {
        $status = 'skipped';
        $notes = 'Failed to write optimized asset.';
    }

    $webpFilename = pathinfo($originalFilename, PATHINFO_FILENAME) . '.webp';
    $webpFullPath = rtrim(UPLOADS_WEBP_DIR, '/') . '/' . $webpFilename;
    if (function_exists('imagewebp')) {
        if ($type === IMAGETYPE_PNG || $type === IMAGETYPE_WEBP) {
            imagepalettetotruecolor($resized);
            imagealphablending($resized, true);
            imagesavealpha($resized, true);
        }
        $webpQuality = defined('IMAGE_WEBP_QUALITY') ? IMAGE_WEBP_QUALITY : 85;
        $webpQuality = max(50, min(100, (int) $webpQuality));
        if (@imagewebp($resized, $webpFullPath, $webpQuality)) {
            $webpPath = '/uploads/webp/' . $webpFilename;
        } else {
            $notes .= ' Failed to generate WebP variant.';
        }
    } else {
        $notes .= ' WebP not supported on host.';
    }

    if ($resized !== $image) {
        imagedestroy($resized);
    }
    imagedestroy($image);

    return [
        'width' => $width,
        'height' => $height,
        'optimized_path' => $optimizedPath,
        'webp_path' => $webpPath,
        'optimization_status' => $status,
        'processing_notes' => trim($notes)
    ];
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

function save_image_resource($resource, ?int $type, string $path): bool
{
    switch ($type) {
        case IMAGETYPE_JPEG:
            if (function_exists('imageinterlace')) {
                imageinterlace($resource, true);
            }
            $quality = defined('IMAGE_JPEG_QUALITY') ? (int) IMAGE_JPEG_QUALITY : 85;
            $quality = max(60, min(95, $quality));
            return @imagejpeg($resource, $path, $quality);
        case IMAGETYPE_PNG:
            $compression = defined('IMAGE_PNG_COMPRESSION') ? (int) IMAGE_PNG_COMPRESSION : 6;
            $compression = max(0, min(9, $compression));
            return @imagepng($resource, $path, $compression);
        case IMAGETYPE_GIF:
            return @imagegif($resource, $path);
        case IMAGETYPE_WEBP:
            $quality = defined('IMAGE_WEBP_QUALITY') ? (int) IMAGE_WEBP_QUALITY : 85;
            $quality = max(50, min(100, $quality));
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
