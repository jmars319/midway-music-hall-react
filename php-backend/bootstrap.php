<?php

use Midway\Backend\Env;
use Midway\Backend\Request;

require __DIR__ . '/lib/Env.php';
require __DIR__ . '/lib/Database.php';
require __DIR__ . '/lib/Response.php';
require __DIR__ . '/lib/Router.php';
require __DIR__ . '/lib/Request.php';
require __DIR__ . '/lib/ImageUtils.php';

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

define('LAYOUT_HISTORY_MAX', (int) Env::get('LAYOUT_HISTORY_MAX', 200));
define('LAYOUT_HISTORY_RETENTION_DAYS', (int) Env::get('LAYOUT_HISTORY_RETENTION_DAYS', 90));

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$request = new Request();
