<?php

use Midway\Backend\Env;
use Midway\Backend\Request;

require __DIR__ . '/lib/Env.php';
require __DIR__ . '/lib/Database.php';
require __DIR__ . '/lib/Response.php';
require __DIR__ . '/lib/Router.php';
require __DIR__ . '/lib/Request.php';
require __DIR__ . '/lib/ImageUtils.php';
require __DIR__ . '/lib/Emailer.php';

Env::load(__DIR__ . '/.env');

$debug = filter_var(Env::get('APP_DEBUG', false), FILTER_VALIDATE_BOOL);
define('APP_DEBUG', $debug);
error_reporting($debug ? E_ALL : 0);
ini_set('display_errors', $debug ? '1' : '0');

date_default_timezone_set('UTC');

$defaultTrustedOrigins = 'https://midwaymusichall.net,https://www.midwaymusichall.net,http://localhost:3000,http://127.0.0.1:3000';
define('DEFAULT_TRUSTED_WEB_ORIGINS', $defaultTrustedOrigins);

$resolveAppPath = static function ($value, string $defaultPath): string {
    $raw = trim((string) $value);
    if ($raw === '') {
        return $defaultPath;
    }
    $isAbsolute = $raw[0] === '/'
        || preg_match('/^[A-Za-z]:[\\\\\\/]/', $raw) === 1;
    if ($isAbsolute) {
        return $raw;
    }
    return rtrim(dirname(__DIR__), '/') . '/' . ltrim($raw, '/');
};

$uploadDir = Env::get('UPLOAD_DIR', 'uploads');
$absUploadDir = __DIR__ . '/' . trim($uploadDir, '/');
if (!is_dir($absUploadDir)) {
    mkdir($absUploadDir, 0775, true);
}

$optimizedDir = $absUploadDir . '/optimized';
if (!is_dir($optimizedDir)) {
    mkdir($optimizedDir, 0775, true);
}

$webpDir = $absUploadDir . '/webp';
if (!is_dir($webpDir)) {
    mkdir($webpDir, 0775, true);
}

$responsiveDir = $absUploadDir . '/variants';
$responsiveOptimizedDir = $responsiveDir . '/optimized';
$responsiveWebpDir = $responsiveDir . '/webp';
$storageDir = $resolveAppPath(Env::get('APP_STORAGE_DIR', ''), dirname(__DIR__) . '/storage');
$manifestDir = $resolveAppPath(Env::get('IMAGE_MANIFEST_DIR', ''), rtrim($storageDir, '/') . '/image-manifests');
$legacyManifestDir = $absUploadDir . '/manifests';
$loginThrottleDir = rtrim($storageDir, '/') . '/login-throttle';
foreach ([$responsiveDir, $responsiveOptimizedDir, $responsiveWebpDir, $storageDir, $manifestDir, $loginThrottleDir] as $dir) {
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
}

define('UPLOADS_DIR', $absUploadDir);
define('UPLOADS_OPTIMIZED_DIR', $optimizedDir);
define('UPLOADS_WEBP_DIR', $webpDir);
define('UPLOADS_RESPONSIVE_DIR', $responsiveDir);
define('UPLOADS_RESPONSIVE_OPTIMIZED_DIR', $responsiveOptimizedDir);
define('UPLOADS_RESPONSIVE_WEBP_DIR', $responsiveWebpDir);
define('UPLOADS_MANIFEST_DIR', $manifestDir);
define('LEGACY_UPLOADS_MANIFEST_DIR', $legacyManifestDir);
define('APP_STORAGE_DIR', $storageDir);
define('ADMIN_LOGIN_THROTTLE_DIR', $loginThrottleDir);

define('IMAGE_MAX_DIMENSION', (int) Env::get('IMAGE_MAX_DIMENSION', 2000));
define('IMAGE_JPEG_QUALITY', (int) Env::get('IMAGE_JPEG_QUALITY', 85));
define('IMAGE_WEBP_QUALITY', (int) Env::get('IMAGE_WEBP_QUALITY', 85));
define('IMAGE_PNG_COMPRESSION', (int) Env::get('IMAGE_PNG_COMPRESSION', 6));
define('IMAGE_UPLOAD_MAX_BYTES', (int) Env::get('IMAGE_UPLOAD_MAX_BYTES', 8 * 1024 * 1024));
define('RESPONSIVE_IMAGE_WIDTH_PROFILES', [
    'icon' => [32, 48, 64, 96, 128, 160, 192, 256],
    'thumb' => [96, 128, 160, 192, 240, 320, 480],
    'hero' => [640, 768, 1024, 1280, 1440, 1920],
    'gallery' => [320, 480, 640, 768, 1024, 1440, 1920],
]);
$responsiveUnion = [];
foreach (RESPONSIVE_IMAGE_WIDTH_PROFILES as $profile) {
    if (!is_array($profile)) {
        continue;
    }
    $responsiveUnion = array_merge($responsiveUnion, $profile);
}
$responsiveUnion = array_values(array_unique(array_map('intval', $responsiveUnion)));
sort($responsiveUnion, SORT_NUMERIC);
define('RESPONSIVE_IMAGE_WIDTHS', $responsiveUnion);

define('LAYOUT_HISTORY_MAX', (int) Env::get('LAYOUT_HISTORY_MAX', 200));
define('LAYOUT_HISTORY_RETENTION_DAYS', (int) Env::get('LAYOUT_HISTORY_RETENTION_DAYS', 90));
define('ADMIN_LOGIN_THROTTLE_WINDOW_SECONDS', max(60, (int) Env::get('ADMIN_LOGIN_THROTTLE_WINDOW_SECONDS', 15 * 60)));
define('ADMIN_LOGIN_THROTTLE_MAX_FAILURES', max(3, (int) Env::get('ADMIN_LOGIN_THROTTLE_MAX_FAILURES', 10)));
define('ADMIN_LOGIN_THROTTLE_IP_MAX_FAILURES', max(10, (int) Env::get('ADMIN_LOGIN_THROTTLE_IP_MAX_FAILURES', 30)));
define('ADMIN_LOGIN_THROTTLE_BACKOFF_SECONDS', [30, 120, 600]);

$forwardedProtoRaw = trim((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
$forwardedProto = strtolower(trim(explode(',', $forwardedProtoRaw)[0] ?? ''));
$isSecureRequest = in_array($forwardedProto, ['https'], true)
    || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');

$sessionCookie = Env::get('ADMIN_SESSION_COOKIE', 'mmh_admin');
$sessionLifetime = max(3600, (int) Env::get('ADMIN_SESSION_LIFETIME', 60 * 60 * 24 * 7));
$sessionIdle = max(900, (int) Env::get('ADMIN_SESSION_IDLE_TIMEOUT', 60 * 60 * 4));
$sessionSecureEnv = Env::get('ADMIN_SESSION_COOKIE_SECURE', null);
$sessionSecure = $sessionSecureEnv === null
    ? $isSecureRequest
    : filter_var($sessionSecureEnv, FILTER_VALIDATE_BOOL);
define('ADMIN_SESSION_LIFETIME', $sessionLifetime);
define('ADMIN_SESSION_IDLE_TIMEOUT', $sessionIdle);
if (session_status() === PHP_SESSION_NONE) {
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_strict_mode', '1');
    session_name($sessionCookie);
    session_set_cookie_params([
        'lifetime' => ADMIN_SESSION_LIFETIME,
        'path' => '/',
        'secure' => $sessionSecure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
$configuredOrigins = Env::get('CORS_ALLOW_ORIGINS', Env::get('CORS_ALLOW_ORIGIN', DEFAULT_TRUSTED_WEB_ORIGINS));
$originList = array_values(array_filter(array_map('trim', explode(',', (string) $configuredOrigins))));
$matchedOrigin = null;
if ($requestOrigin && $originList) {
    foreach ($originList as $candidate) {
        if (strcasecmp($candidate, $requestOrigin) === 0) {
            $matchedOrigin = $candidate;
            break;
        }
    }
}
$allowOrigin = $matchedOrigin;
if ($allowOrigin !== null) {
    header('Access-Control-Allow-Origin: ' . $allowOrigin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
if ($allowOrigin !== null) {
    header('Access-Control-Allow-Credentials: true');
}

header('X-Frame-Options: SAMEORIGIN');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header("Permissions-Policy: fullscreen=(self 'https://www.google.com'), geolocation=()");
header('Cross-Origin-Opener-Policy: same-origin');
$cspDirectives = [
    "default-src 'self'",
    "img-src 'self' data: https://www.google.com https://maps.googleapis.com https://maps.gstatic.com https://fonts.gstatic.com",
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://c2.godaddy.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://maps.googleapis.com https://maps.gstatic.com",
    "frame-src https://www.google.com",
    "form-action 'self'",
    "base-uri 'self'"
];
$cspPolicy = implode('; ', $cspDirectives);
$cspMode = strtolower((string) Env::get('CSP_MODE', $debug ? 'report-only' : 'enforce'));
if ($cspMode === 'enforce') {
    header('Content-Security-Policy: ' . $cspPolicy);
} else {
    header('Content-Security-Policy-Report-Only: ' . $cspPolicy);
}
$hstsEnabledEnv = Env::get('HSTS_ENABLED', null);
$hstsEnabled = $hstsEnabledEnv !== null
    ? filter_var($hstsEnabledEnv, FILTER_VALIDATE_BOOL)
    : filter_var(Env::get('FORCE_STRICT_TRANSPORT', false), FILTER_VALIDATE_BOOL);
if ($hstsEnabled && $isSecureRequest) {
    $maxAge = max(0, (int) Env::get('HSTS_MAX_AGE', 63072000));
    $includeSubdomains = filter_var(Env::get('HSTS_INCLUDE_SUBDOMAINS', true), FILTER_VALIDATE_BOOL);
    $preload = filter_var(Env::get('HSTS_PRELOAD', false), FILTER_VALIDATE_BOOL);
    $header = 'Strict-Transport-Security: max-age=' . $maxAge;
    if ($includeSubdomains) {
        $header .= '; includeSubDomains';
    }
    if ($preload) {
        $header .= '; preload';
    }
    header($header);
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$request = new Request();
