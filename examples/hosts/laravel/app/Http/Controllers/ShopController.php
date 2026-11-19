<?php

namespace App\Http\Controllers;

use App\Shop;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** The shop's pages: each fetches its fragments from the shop at once and composes them in one Blade layout. */
final class ShopController
{
    public function __construct(private readonly Shop $shop) {}

    public function gallery(Request $request): Response
    {
        // The whole query to both: the shop drops what a droplet does not take.
        $query = $this->shop->query($request);

        return $this->render($request, 'gallery', 'Gallery', '/gallery', [['product-filter', $query], ['product-library', $query]]);
    }

    public function product(Request $request, string $slug): Response
    {
        $product = $this->shop->product($slug);
        if ($product === null) {
            return $this->render($request, 'not-found', 'Not found', null, [], 404);
        }
        $comments = [...$this->shop->pick($request, ['order', 'page', 'showing']), ['productId', $product['id']]];
        // `v`, when the link had one: the shop serves its build's page for the
        // current version and redirects an old one to this URL without it.
        $page = [['slug', (string) ($product['slug'] ?? '')], ...$this->shop->pick($request, ['v'])];

        return $this->render($request, 'product', $product['name'], null, [['product-page', $page], ['product-comments', $comments]], 200, [
            'product' => $product,
            'category' => is_array($product['category'] ?? null) ? $product['category'] : [],
        ]);
    }

    public function cart(Request $request): Response
    {
        return $this->render($request, 'cart', 'Cart', null, [['shopping-cart', [['variant', 'inline']]]]);
    }

    public function login(Request $request): Response
    {
        return $this->render($request, 'login', 'Log in', null, [['login', $this->shop->pick($request, ['next'])]]);
    }

    public function admin(Request $request): Response
    {
        return $this->render($request, 'admin', 'Admin', '/admin', [['product-admin', $this->shop->pick($request, ['view', 'id'])]]);
    }

    /**
     * Fetches the toasts (first in the body), the header's cart and the page's
     * fragments, all at once, then answers: a droplet's redirect as it is,
     * otherwise the page, with every `Set-Cookie` the fragments sent.
     */
    private function render(Request $request, string $view, string $title, ?string $current, array $wanted = [], int $status = 200, array $vars = []): Response
    {
        $results = $this->shop->fragments($request, [['toast-center', []], ['shopping-cart', [['variant', 'badge']]], ...$wanted]);
        $redirect = current(array_filter($results, static fn (array $result) => $result['location'] !== null));
        $response = $redirect
            ? response('', $redirect['status'], ['Location' => $redirect['location']])
            : response()->view('shop.'.$view, [
                'stack' => Shop::STACK,
                'title' => $title,
                'current' => $current,
                'links' => $this->shop->linkTags($results),
                'toasts' => $results[0]['html'],
                'cart' => $results[1]['html'],
                'fragments' => array_column(array_slice($results, 2), 'html'),
                ...$vars,
            ], $status);
        // Rendered with the visitor's cookies.
        $response->headers->set('Cache-Control', 'private, no-store');
        Shop::passCookies($response, array_merge(...array_column($results, 'cookies')));

        return $response;
    }
}
