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

define('UPLOADS_DIR', $absUploadDir);
define('UPLOADS_OPTIMIZED_DIR', $optimizedDir);
define('UPLOADS_WEBP_DIR', $webpDir);

define('IMAGE_MAX_DIMENSION', (int) Env::get('IMAGE_MAX_DIMENSION', 2000));
define('IMAGE_JPEG_QUALITY', (int) Env::get('IMAGE_JPEG_QUALITY', 85));
define('IMAGE_WEBP_QUALITY', (int) Env::get('IMAGE_WEBP_QUALITY', 85));
define('IMAGE_PNG_COMPRESSION', (int) Env::get('IMAGE_PNG_COMPRESSION', 6));
define('IMAGE_UPLOAD_MAX_BYTES', (int) Env::get('IMAGE_UPLOAD_MAX_BYTES', 8 * 1024 * 1024));

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
$hsts = Env::get('FORCE_STRICT_TRANSPORT', false);
if ($hsts && (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')) {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$request = new Request();
