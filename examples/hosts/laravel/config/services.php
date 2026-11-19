<?php

// The two droplets servers this host talks to, each by two URLs: the one
// this app reaches it on, and the one the browser does. The public one is
// what goes out as x-droplet-location, written out here: never the Host of
// the browser's request.
return [

    // The shop demo (examples/shop): its fragments and the proxy.
    'shop' => [
        'internal_url' => env('SHOP_INTERNAL_URL', 'http://localhost:8300'),
        // This host's own public origin: the browser reaches the shop through it.
        'public_url' => env('SHOP_PUBLIC_URL', 'http://localhost:8013'),
    ],

    // The Svelte example (examples/frameworks/svelte), for the basic page at `/`.
    'droplets' => [
        'internal_url' => env('DROPLETS_INTERNAL_URL', 'http://localhost:8000'),
        'public_url' => env('DROPLETS_PUBLIC_URL', 'http://localhost:8000'),
    ],

];
