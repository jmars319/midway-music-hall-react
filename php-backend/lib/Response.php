<?php

namespace Midway\Backend;

class Response
{
    public static function json(array $payload, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode($payload);
    }

    public static function success(array $payload = [], int $status = 200): void
    {
        $payload = array_merge(['success' => true], $payload);
        self::json($payload, $status);
    }

    public static function error(string $message, int $status = 500, array $extra = []): void
    {
        $payload = array_merge(['success' => false, 'message' => $message], $extra);
        self::json($payload, $status);
    }
}
