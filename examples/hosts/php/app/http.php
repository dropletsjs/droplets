<?php
/**
 * Server-to-server HTTP with curl: several requests at once (`curl_multi`),
 * never following a redirect, never keeping a cookie.
 *
 * No handle here has a cookie file, a cookie jar or a share handle, and each
 * one lives for one request of one visitor: a cookie the shop sets on one
 * visitor's answer can never ride along with someone else's request. The
 * browser's own `Cookie` header is what goes out, when a caller passes it.
 */

declare(strict_types=1);

/**
 * Sends each of `$requests` (`['method' => …, 'url' => …, 'headers' => [name => value], 'body' => ?string]`)
 * in parallel. Each answer, under the request's key: `status` (0 when it never
 * arrived), `headers` (lowercase name => list of values) and `body`.
 */
function http_all(array $requests, int $timeout = 10): array
{
    $multi = curl_multi_init();
    $handles = [];
    $headers = [];
    foreach ($requests as $key => $request) {
        $headers[$key] = [];
        $lines = [];
        foreach ($request['headers'] ?? [] as $name => $value) {
            $lines[] = $name . ': ' . $value;
        }
        // No `Expect: 100-continue` round trip before a body.
        $lines[] = 'Expect:';
        $method = $request['method'] ?? 'GET';
        $handle = curl_init($request['url']);
        curl_setopt_array($handle, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_NOBODY => $method === 'HEAD',
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => $timeout,
            // Asks for any encoding curl can decode, and decodes it: the
            // body passed on is plain, so `content-encoding` is dropped.
            CURLOPT_ENCODING => '',
            CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$headers, $key): int {
                if (str_starts_with($line, 'HTTP/')) {
                    // A new status line (after a `100 Continue`): start over.
                    $headers[$key] = [];
                } elseif (str_contains($line, ':')) {
                    [$name, $value] = explode(':', $line, 2);
                    $headers[$key][strtolower(trim($name))][] = trim($value);
                }
                return strlen($line);
            },
        ]);
        if (isset($request['body'])) {
            curl_setopt($handle, CURLOPT_POSTFIELDS, $request['body']);
        }
        curl_multi_add_handle($multi, $handle);
        $handles[$key] = $handle;
    }

    do {
        $status = curl_multi_exec($multi, $running);
        if ($running && $status === CURLM_OK) {
            curl_multi_select($multi, 1.0);
        }
    } while ($running && $status === CURLM_OK);

    $responses = [];
    foreach ($handles as $key => $handle) {
        $failed = curl_errno($handle) !== 0;
        if ($failed) {
            error_log('[http] ' . $requests[$key]['url'] . ': ' . curl_error($handle));
        }
        $responses[$key] = [
            'status' => $failed ? 0 : (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE),
            'headers' => $failed ? [] : $headers[$key],
            'body' => $failed ? '' : (string) curl_multi_getcontent($handle),
        ];
        curl_multi_remove_handle($multi, $handle);
        curl_close($handle);
    }
    curl_multi_close($multi);
    return $responses;
}

/** One request; see `http_all`. */
function http_one(array $request, int $timeout = 10): array
{
    return http_all([$request], $timeout)[0];
}

/** The first value of header `$name` in an answer, or null. */
function http_header(array $response, string $name): ?string
{
    return $response['headers'][$name][0] ?? null;
}

/** HTML-escapes `$value` for text and attributes. */
function h(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Renders `app/views/<name>.php` with `$vars` in scope, to a string. */
function view(string $name, array $vars = []): string
{
    extract($vars, EXTR_SKIP);
    ob_start();
    require __DIR__ . '/views/' . $name . '.php';
    return (string) ob_get_clean();
}
