<?php

namespace Midway\Backend;

class Request
{
    public string $method;
    public string $path;
    public array $query;
    public array $body;
    public ?array $json;
    public array $files;
    public array $headers;

    public function __construct()
    {
        $this->method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $uri = $_SERVER['REQUEST_URI'] ?? '/';
        $parsed = parse_url($uri);
        $this->path = $parsed['path'] ?? '/';
        $this->query = $_GET ?? [];
        $this->files = $_FILES ?? [];
        $this->headers = function_exists('getallheaders') ? (getallheaders() ?: []) : [];

        $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
        $raw = file_get_contents('php://input');
        $jsonBody = null;
        if (is_string($contentType) && str_contains(strtolower($contentType), 'application/json')) {
            $jsonBody = json_decode($raw, true);
            if (!is_array($jsonBody)) {
                $jsonBody = [];
            }
            $this->body = $jsonBody;
        } else {
            $this->body = $_POST ?? [];
        }
        $this->json = $jsonBody;
    }

    public function json(): array
    {
        return $this->json ?? [];
    }

    public function input(string $key, $default = null)
    {
        if (array_key_exists($key, $this->body)) {
            return $this->body[$key];
        }
        if ($this->json && array_key_exists($key, $this->json)) {
            return $this->json[$key];
        }
        return $default;
    }
}
