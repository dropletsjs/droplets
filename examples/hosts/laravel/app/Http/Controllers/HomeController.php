<?php

namespace App\Http\Controllers;

use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response as DropletResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\View\View;

/** `/`: the Svelte example's three droplets (examples/frameworks/svelte), one per mode, fetched at once. */
final class HomeController
{
    private const IDS = ['client', 'ssr-hydrate', 'ssr-nohydrate'];

    public function __invoke(Request $request): View
    {
        // Server to server (inside Docker: the service name).
        $internalUrl = rtrim((string) config('services.droplets.internal_url'), '/');
        // Browser-facing, written onto every fragment.
        $publicUrl = rtrim((string) config('services.droplets.public_url'), '/');
        $who = $request->query('who');
        $who = is_string($who) ? $who : 'Laravel';

        $answers = Http::pool(fn (Pool $pool) => array_map(
            fn (string $id) => $pool->as($id)
                ->withHeaders(['accept' => 'text/html', 'x-droplet-location' => $publicUrl])
                ->withoutRedirecting()
                ->timeout(10)
                ->get($internalUrl.'/droplets/'.rawurlencode($id).'?'.http_build_query(['who' => $who])),
            self::IDS,
        ));

        $fragments = [];
        foreach (self::IDS as $id) {
            $answer = $answers[$id] ?? null;
            $status = $answer instanceof DropletResponse ? $answer->status() : 0;
            // Only an HTML answer is a fragment (a 500 or 504 carries the droplet's
            // error page); anything else may echo the props, so it is never pasted.
            $isHtml = $answer instanceof DropletResponse && str_starts_with((string) $answer->header('content-type'), 'text/html');
            $fragments[] = (($status >= 200 && $status < 300) || in_array($status, [500, 504], true)) && $isHtml
                ? $answer->body()
                : sprintf('<p class="error">droplet "%s" unavailable: %s</p>', e($id), $status ? 'HTTP '.$status : 'unreachable');
        }

        return view('index', ['dropletsPublic' => $publicUrl, 'fragments' => $fragments]);
    }
}
