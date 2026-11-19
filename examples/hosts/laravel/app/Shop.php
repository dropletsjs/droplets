<?php

namespace App;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response as ShopResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Response;

/**
 * The shop demo (examples/shop) as this host talks to it: its fragments,
 * fetched on the server all at once, and the same-origin proxy for what the
 * browser asks it for. The contract both follow is examples/shop/CONTRACT.md.
 */
final class Shop
{
    /** The stack this host is, in the footer: the one thing that differs between hosts. */
    public const STACK = 'Laravel 13';

    /** What the browser's request may tell the shop; nothing that names a host, nothing per hop. `cookie` goes on filtered. */
    private const REQUEST_HEADERS = [
        'accept',
        'accept-language',
        'content-type',
        'if-none-match',
        'origin',
        'referer',
        'user-agent',
        'x-droplet-props',
        'x-droplets-build',
    ];

    /**
     * Per hop (RFC 9110 §7.6.1), no longer true once the client has decoded
     * the body, or set apart (`set-cookie`, which may come more than once).
     */
    private const DROPPED_RESPONSE_HEADERS = [
        'connection',
        'keep-alive',
        'proxy-authenticate',
        'proxy-authorization',
        'proxy-connection',
        'te',
        'trailer',
        'transfer-encoding',
        'upgrade',
        'content-encoding',
        'content-length',
        'set-cookie',
    ];

    /** The shop's own cookies, the only ones it is sent: another app's on this origin stay here. */
    private const COOKIES = ['cart_id', 'shop_admin'];

    /** How this app reaches the shop (`http://shop:8300` in Docker). */
    private readonly string $internalUrl;

    /**
     * This host's own public origin. It goes out as `x-droplet-location` on
     * every request to the shop, written out in the config: never the
     * client's Host.
     */
    private readonly string $origin;

    public function __construct()
    {
        $this->internalUrl = rtrim((string) config('services.shop.internal_url'), '/');
        $url = parse_url((string) config('services.shop.public_url'));
        $port = isset($url['port']) ? ':'.$url['port'] : '';
        $this->origin = ($url['scheme'] ?? 'http').'://'.($url['host'] ?? 'localhost').$port;
    }

    /**
     * The client for one request to the shop: no redirect followed, no cookie
     * kept. Laravel gives each request a Guzzle client with a cookie jar of
     * its own; `cookies => false` turns it off, so only the visitor's own
     * `Cookie` header ever goes out.
     */
    private function client(PendingRequest $request, int $timeout): PendingRequest
    {
        return $request
            ->withoutRedirecting()
            ->connectTimeout(5)
            ->timeout($timeout)
            ->withOptions(['cookies' => false, 'expect' => false]);
    }

    /** The browser's `Cookie` header with the shop's cookies only, or null. */
    public function cookieHeader(Request $request): ?string
    {
        $kept = [];
        foreach (explode(';', (string) $request->headers->get('cookie')) as $pair) {
            if (in_array(trim(explode('=', $pair, 2)[0]), self::COOKIES, true)) {
                $kept[] = trim($pair);
            }
        }

        return $kept === [] ? null : implode('; ', $kept);
    }

    /**
     * The page's query as `[key, value]` pairs, repeated keys kept and names
     * untouched (`$request->query()` is PHP's `$_GET`, which merges `a=1&a=2`
     * and turns `a.b` into `a_b`).
     */
    public function query(Request $request): array
    {
        $pairs = [];
        foreach (explode('&', (string) $request->server('QUERY_STRING')) as $piece) {
            if ($piece === '') {
                continue;
            }
            [$key, $value] = array_pad(explode('=', $piece, 2), 2, '');
            $pairs[] = [urldecode($key), urldecode($value)];
        }

        return $pairs;
    }

    /** The page's query parameters named in `$keys`, in that order. */
    public function pick(Request $request, array $keys): array
    {
        $query = $this->query($request);
        $picked = [];
        foreach ($keys as $key) {
            foreach ($query as $pair) {
                if ($pair[0] === $key) {
                    $picked[] = $pair;
                }
            }
        }

        return $picked;
    }

    /** `[key, value]` pairs → a query string, every piece encoded. */
    public static function buildQuery(array $pairs): string
    {
        return implode('&', array_map(static fn (array $pair) => rawurlencode($pair[0]).'='.rawurlencode($pair[1]), $pairs));
    }

    /**
     * The shop's `Set-Cookie` lines onto `$response`. Symfony keeps cookies
     * as objects and writes them out itself, so each is parsed back: name,
     * value as it came, Path, Domain, Expires and Max-Age, Secure, HttpOnly,
     * SameSite, Partitioned. The shop never sets Domain, so they belong to
     * this origin.
     */
    public static function passCookies(Response $response, array $cookies): void
    {
        foreach ($cookies as $cookie) {
            try {
                $response->headers->setCookie(Cookie::fromString($cookie));
            } catch (\InvalidArgumentException $error) {
                Log::error('[shop] Set-Cookie not passed on: '.$error->getMessage());
            }
        }
    }

    /** The shop's answer's headers, lowercased: name => list of values. */
    private static function headersOf(ShopResponse $response): array
    {
        $headers = [];
        foreach ($response->headers() as $name => $values) {
            $headers[strtolower($name)] = array_merge($headers[strtolower($name)] ?? [], (array) $values);
        }

        return $headers;
    }

    // ---- The proxy ----------------------------------------------------------------

    /** Whether `$path` has a `.` or `..` segment once decoded: never a shop route. */
    public static function hasDotSegment(string $path): bool
    {
        foreach (explode('/', $path) as $segment) {
            if (in_array(rawurldecode($segment), ['.', '..'], true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Passes the browser's request on to the shop and its answer back: status,
     * headers less the per-hop ones, every `Set-Cookie`, a redirect as it is.
     * The body goes on as the browser sent it (`php://input`, which holds
     * multipart posts too: `enable_post_data_reading` is off, see php.ini).
     */
    public function proxy(Request $request): Response
    {
        // The method on the wire: getMethod() would take `X-HTTP-Method-Override` or `_method`.
        $method = $request->getRealMethod();
        $headers = ['x-droplet-location' => $this->origin];
        foreach (self::REQUEST_HEADERS as $name) {
            $value = $request->headers->get($name);
            if ($value !== null && $value !== '') {
                $headers[$name] = $value;
            }
        }
        $cookie = $this->cookieHeader($request);
        if ($cookie !== null) {
            $headers['cookie'] = $cookie;
        }
        $options = in_array($method, ['GET', 'HEAD'], true) ? [] : ['body' => $request->getContent()];

        try {
            // Concatenated, not resolved: a path like `//elsewhere` stays a path on the shop.
            $answer = $this->client(Http::withHeaders($headers), 15)->send($method, $this->internalUrl.$request->getRequestUri(), $options);
        } catch (\Throwable $error) {
            Log::error('[shop proxy] '.$method.' '.$request->getPathInfo().': '.$error->getMessage());

            return response('The shop is unreachable.', 502, ['Content-Type' => 'text/plain; charset=utf-8']);
        }

        $received = self::headersOf($answer);
        // And whatever the shop's `Connection` names as per hop.
        $dropped = self::DROPPED_RESPONSE_HEADERS;
        foreach ($received['connection'] ?? [] as $value) {
            foreach (explode(',', $value) as $name) {
                $dropped[] = strtolower(trim($name));
            }
        }

        $response = response($method === 'HEAD' ? '' : $answer->body(), $answer->status());
        foreach ($received as $name => $values) {
            if (! in_array($name, $dropped, true)) {
                $response->headers->set($name, $values);
            }
        }
        self::passCookies($response, $received['set-cookie'] ?? []);

        return $response;
    }

    // ---- Fragments ------------------------------------------------------------------

    /**
     * `GET /droplets/<id>?<pairs>` for each of `$wanted` (`[id, pairs]`), in
     * parallel, as the browser's request: its cookies, this page as the host.
     * Each answer: `html`, `status`, `location`, `cookies`, `link`. Only an HTML
     * answer is a fragment (a 500 carries the droplet's error page); anything
     * else may echo the props, so it is never inserted.
     */
    public function fragments(Request $request, array $wanted): array
    {
        $headers = ['accept' => 'text/html', 'x-droplet-location' => $this->origin, 'referer' => $this->origin.$request->getRequestUri()];
        $cookie = $this->cookieHeader($request);
        if ($cookie !== null) {
            $headers['cookie'] = $cookie;
        }
        $answers = Http::pool(fn (Pool $pool) => array_map(function (int $key) use ($pool, $headers, $wanted) {
            [$id, $pairs] = $wanted[$key];
            $query = $pairs === [] ? '' : '?'.self::buildQuery($pairs);

            return $this->client($pool->as("f$key")->withHeaders($headers), 10)->get($this->internalUrl.'/droplets/'.rawurlencode($id).$query);
        }, array_keys($wanted)));

        $results = [];
        foreach ($wanted as $key => [$id]) {
            $answer = $answers["f$key"] ?? null;
            if (! $answer instanceof ShopResponse) {
                Log::error('[shop] '.$id.': '.($answer instanceof \Throwable ? $answer->getMessage() : 'no answer'));
            }
            $status = $answer instanceof ShopResponse ? $answer->status() : 502;
            $received = $answer instanceof ShopResponse ? self::headersOf($answer) : [];
            $result = [
                'html' => '',
                'status' => $status,
                'location' => null,
                'cookies' => $received['set-cookie'] ?? [],
                'link' => $received['link'][0] ?? null,
            ];
            $isHtml = str_starts_with($received['content-type'][0] ?? '', 'text/html');
            if ($status >= 300 && $status < 400) {
                $result['location'] = $received['location'][0] ?? null;
            } elseif ((($status >= 200 && $status < 300) || $status === 500) && $isHtml) {
                // Trusted markup from the shop: inserted as it is.
                $result['html'] = $answer->body();
                $results[$key] = $result;

                continue;
            }
            $reason = $status === 502 ? 'unreachable' : 'HTTP '.$status;
            $result['html'] = sprintf('<p class="shop-unavailable">The %s droplet is unavailable (%s).</p>', e($id), e($reason));
            $results[$key] = $result;
        }

        return $results;
    }

    /** A product's name, category and id, from the product page's public `_data` read. */
    public function product(string $slug): ?array
    {
        try {
            $answer = $this->client(Http::withHeaders(['x-droplet-location' => $this->origin, 'accept' => 'application/json']), 5)
                ->get($this->internalUrl.'/droplets/product-page/_data?'.self::buildQuery([['slug', $slug]]));
        } catch (\Throwable $error) {
            Log::error('[shop] product '.$slug.': '.$error->getMessage());

            return null;
        }
        if ($answer->status() !== 200) {
            return null;
        }
        $body = json_decode($answer->body(), true);
        $product = is_array($body) && is_array($body['data'] ?? null) ? ($body['data']['product'] ?? null) : null;

        return is_array($product) && is_string($product['id'] ?? null) && is_string($product['name'] ?? null) ? $product : null;
    }

    /** The fragments' `Link` preloads, for the page's head: on this origin only. */
    public function linkTags(array $results): array
    {
        $tags = [];
        foreach ($results as $result) {
            foreach (preg_split('/,(?=\s*<)/', (string) $result['link']) as $part) {
                if (! preg_match('/^\s*<([^>]*)>(.*)$/s', $part, $match)) {
                    continue;
                }
                $params = [];
                foreach (explode(';', $match[2]) as $param) {
                    [$key, $value] = array_pad(array_map(static fn ($piece) => trim($piece, " \t\""), explode('=', $param, 2)), 2, '');
                    if ($key !== '' && $value !== '') {
                        $params[strtolower($key)] = $value;
                    }
                }
                $rel = $params['rel'] ?? '';
                $href = $match[1];
                if (($rel !== 'preload' && $rel !== 'modulepreload') || ! str_starts_with($href, $this->origin.'/')) {
                    continue;
                }
                $tags[$href.' '.$rel] = ['rel' => $rel, 'href' => $href, 'as' => $params['as'] ?? null];
            }
        }

        return array_values($tags);
    }
}
