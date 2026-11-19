<?php

namespace Tests\Feature;

use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** The proxy to the shop (App\Shop::proxy): what goes out, what comes back, what it refuses. */
final class ProxyTest extends TestCase
{
    public function test_sends_the_listed_headers_the_shops_cookies_and_its_own_origin(): void
    {
        Http::fake(['*' => Http::response('{}', 200, ['Content-Type' => 'application/json'])]);

        $this->call('GET', '/api/cart?x=1', server: [
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_COOKIE' => 'other=secret; cart_id=abc; laravel_session=s',
            'HTTP_X_FORWARDED_HOST' => 'evil.example',
            'HTTP_FORWARDED' => 'host=evil.example',
            'HTTP_X_DROPLET_LOCATION' => 'https://evil.example',
            'HTTP_AUTHORIZATION' => 'Bearer token',
        ])->assertOk();

        Http::assertSent(fn (Request $sent) => $sent->url() === 'http://shop.internal:8300/api/cart?x=1'
            && $sent->method() === 'GET'
            && $sent->header('x-droplet-location') === ['https://shop.example']
            && $sent->header('cookie') === ['cart_id=abc']
            && $sent->header('accept') === ['application/json']
            && $sent->header('Host') === ['shop.internal:8300']
            && ! $sent->hasHeader('x-forwarded-host')
            && ! $sent->hasHeader('forwarded')
            && ! $sent->hasHeader('authorization'));
    }

    public function test_sends_no_cookie_header_without_a_shop_cookie(): void
    {
        Http::fake(['*' => Http::response('', 204)]);

        $this->call('GET', '/index.js', server: ['HTTP_COOKIE' => 'other=secret'])->assertNoContent();

        Http::assertSent(fn (Request $sent) => ! $sent->hasHeader('cookie'));
    }

    public function test_sends_the_body_as_it_came_with_the_method_on_the_wire(): void
    {
        Http::fake(['*' => Http::response('', 303, ['Location' => '/product/mug'])]);
        $body = "--b\r\nContent-Disposition: form-data; name=\"qty\"\r\n\r\n1\r\n--b--\r\n";

        $this->call('POST', '/droplets/product-page?/add', server: [
            'CONTENT_TYPE' => 'multipart/form-data; boundary=b',
            'HTTP_X_HTTP_METHOD_OVERRIDE' => 'DELETE',
            'HTTP_ORIGIN' => 'https://shop.example',
        ], content: $body)->assertStatus(303);

        Http::assertSent(fn (Request $sent) => $sent->method() === 'POST'
            && $sent->url() === 'http://shop.internal:8300/droplets/product-page?/add'
            && $sent->body() === $body
            && $sent->header('content-type') === ['multipart/form-data; boundary=b']
            && $sent->header('origin') === ['https://shop.example']);
    }

    public function test_passes_the_answer_back_without_the_per_hop_headers(): void
    {
        Http::fake(['*' => Http::response('', 303, [
            'Location' => '/admin',
            'Set-Cookie' => ['shop_admin=signed.value; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax', 'cart_id=; Max-Age=0; Path=/'],
            'Connection' => 'close, x-hop',
            'X-Hop' => '1',
            'Keep-Alive' => 'timeout=5',
            'X-Kept' => 'yes',
        ])]);

        $response = $this->call('POST', '/droplets/login?/login', content: 'user=admin');

        $response->assertStatus(303)
            ->assertHeader('Location', '/admin')
            ->assertHeader('X-Kept', 'yes')
            ->assertHeaderMissing('X-Hop')
            ->assertHeaderMissing('Keep-Alive')
            ->assertHeaderMissing('Connection');
        $cookies = [];
        foreach ($response->headers->getCookies() as $cookie) {
            $cookies[$cookie->getName()] = $cookie;
        }
        $this->assertSame('signed.value', $cookies['shop_admin']->getValue());
        $this->assertTrue($cookies['shop_admin']->isHttpOnly());
        $this->assertSame('lax', $cookies['shop_admin']->getSameSite());
        $this->assertSame('/', $cookies['shop_admin']->getPath());
        $this->assertTrue($cookies['cart_id']->isCleared());
        Http::assertSentCount(1);
    }

    public static function dotSegments(): array
    {
        return [['/droplets/%2e%2e/api/cart'], ['/assets/%2E/x.js'], ['/api/a/../b'], ['/droplets/x/%2E%2e']];
    }

    #[DataProvider('dotSegments')]
    public function test_refuses_a_path_with_a_dot_segment(string $path): void
    {
        Http::fake();

        $this->call('GET', $path)->assertStatus(400)->assertSeeText('Bad request.');

        Http::assertNothingSent();
    }

    public function test_answers_502_when_the_shop_is_unreachable(): void
    {
        Http::fake(['*' => Http::failedConnection()]);

        $this->call('GET', '/index.js')->assertStatus(502)->assertSeeText('The shop is unreachable.');
    }

    public function test_keeps_no_cookie_between_visitors(): void
    {
        Http::fake(['*' => Http::response('{}', 200, ['Set-Cookie' => 'cart_id=first-visitor; Path=/'])]);

        $this->call('POST', '/api/cart/items', server: ['CONTENT_TYPE' => 'application/json'], content: '{"productId":"p","qty":1}');
        $this->call('GET', '/api/cart');

        $sent = Http::recorded();
        $this->assertCount(2, $sent);
        $this->assertFalse($sent[1][0]->hasHeader('cookie'));
    }
}
