<?php

namespace Midway\Backend;

use Closure;
use ReflectionFunction;
use ReflectionMethod;

class Router
{
    private array $routes = [];

    public function add($methods, string $pattern, callable $handler): void
    {
        $methods = (array) $methods;
        foreach ($methods as $method) {
            $this->routes[] = [
                'method' => strtoupper($method),
                'pattern' => $this->normalize($pattern),
                'regex' => $this->compilePattern($pattern),
                'handler' => $handler,
            ];
        }
    }

    public function dispatch(Request $request): bool
    {
        $method = strtoupper($request->method);
        $path = $this->normalize($request->path);

        foreach ($this->routes as $route) {
            if ($route['method'] !== $method) {
                continue;
            }
            if (preg_match($route['regex'], $path, $matches)) {
                $params = [];
                foreach ($matches as $key => $value) {
                    if (!is_string($key)) {
                        continue;
                    }
                    $params[$key] = $value;
                }
                $this->invokeHandler($route['handler'], $request, $params);
                return true;
            }
        }

        return false;
    }

    private function normalize(string $path): string
    {
        $path = '/' . trim($path, '/');
        return $path === '/' ? '/' : rtrim($path, '/');
    }

    private function compilePattern(string $pattern): string
    {
        $normalized = $this->normalize($pattern);
        $regex = preg_replace_callback('/:([A-Za-z0-9_]+)/', function ($matches) {
            $name = $matches[1];
            return '(?P<' . $name . '>[^/]+)';
        }, $normalized);
        return '#^' . $regex . '$#';
    }

    private function invokeHandler(callable $handler, Request $request, array $params): void
    {
        $count = $this->countParameters($handler);
        if ($count >= 2) {
            $handler($request, $params);
        } elseif ($count === 1) {
            $handler($request);
        } else {
            $handler();
        }
    }

    private function countParameters(callable $handler): int
    {
        if ($handler instanceof Closure || is_string($handler)) {
            $ref = new ReflectionFunction($handler);
            return $ref->getNumberOfParameters();
        }
        if (is_array($handler) && count($handler) === 2) {
            $ref = new ReflectionMethod($handler[0], $handler[1]);
            return $ref->getNumberOfParameters();
        }
        return 2;
    }
}
