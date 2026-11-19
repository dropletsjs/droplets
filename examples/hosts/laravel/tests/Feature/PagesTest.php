<?php

namespace Tests\Feature;

use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** The shop's pages (App\Http\Controllers\ShopController): what each asks the shop for, and what it pastes. */
final class PagesTest extends TestCase
{
    private static function html(string $id, string $body = ''): array
    {
        return [sprintf('<djs-shop data-droplet="%s">%s</djs-shop>', $id, $body), 200, ['Content-Type' => 'text/html; charset=utf-8']];
    }

    /** Every droplet of a page answering with its own element, unless `$answers` says otherwise. */
    private function fakeShop(array $answers = []): void
    {
        $fake = [];
        foreach ($answers as $pattern => $answer) {
            $fake[$pattern] = Http::response(...$answer);
        }
        foreach (['toast-center', 'shopping-cart', 'product-filter', 'product-library', 'product-comments', 'login', 'product-admin'] as $id) {
            $fake["shop.internal:8300/droplets/$id?*"] ??= Http::response(...self::html($id));
            $fake["shop.internal:8300/droplets/$id"] ??= $fake["shop.internal:8300/droplets/$id?*"];
        }
        Http::preventStrayRequests();
        Http::fake($fake);
    }

    public function test_the_gallery_asks_for_its_fragments_as_the_browsers_page(): void
    {
        $this->fakeShop();

        $this->call('GET', '/gallery?q=mug&a.b=1&a.b=2', server: ['HTTP_COOKIE' => 'cart_id=abc; other=x'])
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertSee('<djs-shop data-droplet="product-library">', false)
            ->assertSee('Laravel 13');

        Http::assertSent(fn (Request $sent) => $sent->url() === 'http://shop.internal:8300/droplets/product-library?q=mug&a.b=1&a.b=2'
            && $sent->header('accept') === ['text/html']
            && $sent->header('x-droplet-location') === ['https://shop.example']
            && $sent->header('referer') === ['https://shop.example/gallery?q=mug&a.b=1&a.b=2']
            && $sent->header('cookie') === ['cart_id=abc']);
        Http::assertSent(fn (Request $sent) => $sent->url() === 'http://shop.internal:8300/droplets/shopping-cart?variant=badge');
        Http::assertSentCount(4);
    }

    public function test_pastes_only_an_html_answer(): void
    {
        $this->fakeShop([
            'shop.internal:8300/droplets/product-library?*' => ['<script>alert(1)</script>', 400, ['Content-Type' => 'text/plain']],
            'shop.internal:8300/droplets/product-filter?*' => ['<script>alert(2)</script>', 200, ['Content-Type' => 'application/json']],
        ]);

        $this->call('GET', '/gallery?q=%3Cscript%3E')
            ->assertOk()
            ->assertDontSee('<script>alert', false)
            ->assertSee('The product-library droplet is unavailable (HTTP 400).')
            ->assertSee('The product-filter droplet is unavailable (HTTP 200).');
    }

    public function test_passes_a_fragments_redirect_on_with_its_cookies(): void
    {
        $this->fakeShop([
            'shop.internal:8300/droplets/product-page/_data?*' => ['{"data":{"product":{"id":"p1","slug":"mug","name":"Mug","category":{"slug":"cups","name":"Cups"}}}}', 200, ['Content-Type' => 'application/json']],
            'shop.internal:8300/droplets/product-page?*' => ['', 302, ['Location' => 'https://shop.example/product/mug']],
            'shop.internal:8300/droplets/toast-center' => ['<djs-shop></djs-shop>', 200, ['Content-Type' => 'text/html', 'Set-Cookie' => 'cart_id=new; Path=/; HttpOnly']],
        ]);

        $response = $this->call('GET', '/product/mug?v=0123456789&page=2&ignored=1');

        $response->assertStatus(302)->assertHeader('Location', 'https://shop.example/product/mug');
        $this->assertSame('new', $response->headers->getCookies()[0]->getValue());
        Http::assertSent(fn (Request $sent) => $sent->url() === 'http://shop.internal:8300/droplets/product-page?slug=mug&v=0123456789');
        Http::assertSent(fn (Request $sent) => $sent->url() === 'http://shop.internal:8300/droplets/product-comments?page=2&productId=p1');
    }

    public function test_an_unknown_product_is_a_404(): void
    {
        $this->fakeShop(['shop.internal:8300/droplets/product-page/_data?*' => ['{"error":"not found"}', 404, ['Content-Type' => 'application/json']]]);

        $this->call('GET', '/product/nothing')->assertNotFound()->assertSee('This product does not exist.');
        Http::assertNotSent(fn (Request $sent) => str_contains($sent->url(), '/droplets/product-page?'));
    }

    public function test_escapes_what_the_shop_says_about_a_product(): void
    {
        $this->fakeShop([
            'shop.internal:8300/droplets/product-page/_data?*' => ['{"data":{"product":{"id":"p1","slug":"mug","name":"<b>Mug</b>","category":{"slug":"a&b","name":"<i>Cups</i>"}}}}', 200, ['Content-Type' => 'application/json']],
            'shop.internal:8300/droplets/product-page?*' => self::html('product-page'),
        ]);

        $this->call('GET', '/product/mug')
            ->assertOk()
            ->assertDontSee('<b>Mug</b>', false)
            ->assertSee('&lt;i&gt;Cups&lt;/i&gt;', false)
            ->assertSee('/gallery?category=a%26b', false);
    }

    public function test_answers_only_get_and_head_on_a_page(): void
    {
        Http::fake();

        $this->call('POST', '/gallery')->assertStatus(405);
        Http::assertNothingSent();
    }
}
