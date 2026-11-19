<?php

namespace App\Http\Controllers;

use App\Shop;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** What the browser asks the shop for, on this origin: its cookies are first-party and nothing is cross-origin. */
final class ShopProxyController
{
    public function __invoke(Request $request, Shop $shop): Response
    {
        if (Shop::hasDotSegment($request->getPathInfo())) {
            return response('Bad request.', 400, ['Content-Type' => 'text/plain; charset=utf-8']);
        }

        return $shop->proxy($request);
    }
}
