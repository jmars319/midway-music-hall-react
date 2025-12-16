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
$manifestDir = $absUploadDir . '/manifests';
foreach ([$responsiveDir, $responsiveOptimizedDir, $responsiveWebpDir, $manifestDir] as $dir) {
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

define('IMAGE_MAX_DIMENSION', (int) Env::get('IMAGE_MAX_DIMENSION', 2000));
define('IMAGE_JPEG_QUALITY', (int) Env::get('IMAGE_JPEG_QUALITY', 85));
define('IMAGE_WEBP_QUALITY', (int) Env::get('IMAGE_WEBP_QUALITY', 85));
define('IMAGE_PNG_COMPRESSION', (int) Env::get('IMAGE_PNG_COMPRESSION', 6));
define('IMAGE_UPLOAD_MAX_BYTES', (int) Env::get('IMAGE_UPLOAD_MAX_BYTES', 8 * 1024 * 1024));
define('RESPONSIVE_IMAGE_WIDTHS', [160, 240, 320, 480, 768, 1024, 1440, 1920]);

define('LAYOUT_HISTORY_MAX', (int) Env::get('LAYOUT_HISTORY_MAX', 200));
define('LAYOUT_HISTORY_RETENTION_DAYS', (int) Env::get('LAYOUT_HISTORY_RETENTION_DAYS', 90));

$sessionCookie = Env::get('ADMIN_SESSION_COOKIE', 'mmh_admin');
$sessionLifetime = max(3600, (int) Env::get('ADMIN_SESSION_LIFETIME', 60 * 60 * 24 * 7));
$sessionIdle = max(900, (int) Env::get('ADMIN_SESSION_IDLE_TIMEOUT', 60 * 60 * 4));
$sessionSecure = filter_var(Env::get('ADMIN_SESSION_COOKIE_SECURE', false), FILTER_VALIDATE_BOOL);
define('ADMIN_SESSION_LIFETIME', $sessionLifetime);
define('ADMIN_SESSION_IDLE_TIMEOUT', $sessionIdle);
if (session_status() === PHP_SESSION_NONE) {
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
$configuredOrigins = Env::get('CORS_ALLOW_ORIGINS', Env::get('CORS_ALLOW_ORIGIN', 'https://midwaymusichall.net,http://localhost:3000'));
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
if (!$matchedOrigin) {
    $matchedOrigin = $originList[0] ?? '*';
}
$allowOrigin = $matchedOrigin ?: '*';
$sendCredentials = $allowOrigin !== '*';
header('Access-Control-Allow-Origin: ' . $allowOrigin);
if ($allowOrigin !== '*') {
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
if ($sendCredentials) {
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
$cspMode = strtolower((string) Env::get('CSP_MODE', 'report-only'));
if ($cspMode === 'enforce') {
    header('Content-Security-Policy: ' . $cspPolicy);
} else {
    header('Content-Security-Policy-Report-Only: ' . $cspPolicy);
}
$isHttps = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
$hstsEnabledEnv = Env::get('HSTS_ENABLED', null);
$hstsEnabled = $hstsEnabledEnv !== null
    ? filter_var($hstsEnabledEnv, FILTER_VALIDATE_BOOL)
    : filter_var(Env::get('FORCE_STRICT_TRANSPORT', false), FILTER_VALIDATE_BOOL);
if ($hstsEnabled && $isHttps) {
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
