<?php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = __DIR__ . $path;
if ($path !== '/' && is_file($file)) {
    return false; // serve static files (uploads, etc.)
}

// Serve the admin SPA index directly when requesting /admin or /admin/
// This makes the built frontend available at /admin without additional server config.
if (($path === '/admin' || $path === '/admin/') && is_file(__DIR__ . '/admin/index.html')) {
    header('Content-Type: text/html; charset=UTF-8');
    readfile(__DIR__ . '/admin/index.html');
    return;
}

require __DIR__ . '/index.php';
