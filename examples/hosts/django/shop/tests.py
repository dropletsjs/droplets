"""The host's own logic, against a stand-in shop (`httpx.MockTransport`):
what the proxy and the pages send the shop, what they refuse before the
shop is asked, and what they pass back to the browser.

    python manage.py test
"""

import io
from http.cookiejar import CookieJar, DefaultCookiePolicy
from unittest import mock
from wsgiref.util import setup_testing_defaults

import httpx
from django.core.handlers.wsgi import WSGIHandler
from django.test import Client, SimpleTestCase, override_settings

from . import upstream

FRAGMENT = '<djs-shop data-droplet="{}">…</djs-shop>'


class StandInShop:
    """The shop: answers each request with `answer(request)` and keeps what it was asked."""

    def __init__(self, answer=None):
        self.requests: list[httpx.Request] = []
        self.answer = answer or self.fragments

    @staticmethod
    def fragments(request: httpx.Request) -> httpx.Response:
        droplet = request.url.path.removeprefix("/droplets/")
        return httpx.Response(200, headers={"content-type": "text/html"}, text=FRAGMENT.format(droplet))

    def __call__(self, request: httpx.Request) -> httpx.Response:
        request.read()
        self.requests.append(request)
        return self.answer(request)


class ShopTestCase(SimpleTestCase):
    def setUp(self):
        self.shop = StandInShop()
        original = upstream.client
        upstream.client = httpx.Client(
            transport=httpx.MockTransport(lambda request: self.shop(request)),
            follow_redirects=False,
            cookies=CookieJar(policy=DefaultCookiePolicy(allowed_domains=[])),
        )
        self.addCleanup(setattr, upstream, "client", original)
        self.browser = Client()

    def asked(self, path: str) -> list[httpx.Request]:
        return [request for request in self.shop.requests if request.url.path == path]


def wsgi(method: str, path: str, body: bytes = b"", **environ) -> tuple[str, list[tuple[str, str]], bytes]:
    """One request through Django's WSGI handler, as a server would make it: the status, every header line, the body."""
    env = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "wsgi.input": io.BytesIO(body),
        "CONTENT_LENGTH": str(len(body)),
    }
    env.update(environ)
    setup_testing_defaults(env)
    env["HTTP_HOST"] = "localhost"
    started = {}

    def start_response(status, headers, exc_info=None):
        started.update(status=status, headers=headers)

    answer = WSGIHandler()(env, start_response)
    try:
        content = b"".join(answer)
    finally:
        answer.close()
    return started["status"], started["headers"], content


class ProxyTests(ShopTestCase):
    def test_sends_its_own_origin_and_only_the_listed_headers(self):
        self.browser.get(
            "/droplets/product-filter?q=mug",
            HTTP_ACCEPT="text/html",
            HTTP_X_DROPLET_LOCATION="https://evil.example",
            HTTP_X_FORWARDED_HOST="evil.example",
            HTTP_FORWARDED="host=evil.example",
            HTTP_COOKIE="cart_id=c1; theme=dark; shop_admin=s1",
        )
        [request] = self.shop.requests
        self.assertEqual(str(request.url), "http://localhost:8300/droplets/product-filter?q=mug")
        self.assertEqual(request.headers["x-droplet-location"], "http://localhost:8012")
        self.assertEqual(request.headers["cookie"], "cart_id=c1; shop_admin=s1")
        self.assertEqual(request.headers["host"], "localhost:8300")
        self.assertNotIn("x-forwarded-host", request.headers)
        self.assertNotIn("forwarded", request.headers)

    def test_refuses_a_dot_segment_before_asking_the_shop(self):
        for path in ["/droplets/../admin", "/assets/%2e%2e/secret", "/api/./cart"]:
            with self.subTest(path=path):
                self.assertEqual(self.browser.get(path).status_code, 400)
        self.assertEqual(self.shop.requests, [])

    def test_refuses_a_method_it_does_not_proxy(self):
        self.assertEqual(self.browser.generic("TRACE", "/api/cart").status_code, 405)
        self.assertEqual(self.shop.requests, [])

    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=16)
    def test_refuses_a_body_over_the_limit_before_reading_it(self):
        response = self.browser.generic("POST", "/droplets/login?/login", b"x" * 17, content_type="text/plain")
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.shop.requests, [])

    def test_passes_a_post_on_without_a_csrf_token(self):
        self.shop.answer = lambda request: httpx.Response(303, headers={"location": "/admin"})
        browser = Client(enforce_csrf_checks=True)
        response = browser.post("/droplets/login?/login", {"user": "admin"}, HTTP_ORIGIN="http://localhost:8012")
        self.assertEqual(response.status_code, 303)
        [request] = self.shop.requests
        self.assertEqual(request.method, "POST")
        self.assertTrue(request.headers["content-type"].startswith("multipart/form-data; boundary="))
        self.assertIn(b'name="user"\r\n\r\nadmin\r\n', request.content)
        self.assertEqual(request.headers["origin"], "http://localhost:8012")

    def test_answers_every_set_cookie_and_the_redirect_untouched(self):
        cookies = [
            "shop_admin=a.b=c; Path=/; HttpOnly; SameSite=Lax",
            "cart_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0",
        ]
        self.shop.answer = lambda request: httpx.Response(
            303, headers=[("location", "/admin"), *(("set-cookie", cookie) for cookie in cookies)]
        )
        status, headers, _ = wsgi("POST", "/droplets/login", b"user=admin", QUERY_STRING="/login")
        self.assertEqual(status, "303 See Other")
        self.assertIn(("location", "/admin"), [(name.lower(), value) for name, value in headers])
        self.assertEqual([value for name, value in headers if name.lower() == "set-cookie"], cookies)

    def test_streams_the_answer_without_the_headers_httpx_decoded(self):
        self.shop.answer = lambda request: httpx.Response(
            200,
            headers={"content-type": "text/javascript", "cache-control": "no-store", "content-encoding": "identity"},
            content=b"export {};",
        )
        response = self.browser.get("/index.js")
        self.assertEqual(b"".join(response.streaming_content), b"export {};")
        self.assertEqual(response["content-type"], "text/javascript")
        self.assertEqual(response["cache-control"], "no-store")
        self.assertFalse(response.has_header("content-encoding"))

    def test_answers_502_when_the_shop_is_down(self):
        def down(request):
            raise httpx.ConnectError("refused", request=request)

        self.shop.answer = down
        response = self.browser.get("/api/cart")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.content, b"The shop is unreachable.")


class PageTests(ShopTestCase):
    def test_fetches_each_fragment_as_the_browser_with_this_page_as_referer(self):
        response = self.browser.get("/gallery?category=mugs&q=tea", HTTP_COOKIE="cart_id=c1; theme=dark")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["cache-control"], "private, no-store")
        asked = {request.url.path for request in self.shop.requests}
        self.assertEqual(
            asked,
            {
                "/droplets/toast-center",
                "/droplets/shopping-cart",
                "/droplets/product-filter",
                "/droplets/product-library",
            },
        )
        for request in self.shop.requests:
            self.assertEqual(request.headers["x-droplet-location"], "http://localhost:8012")
            self.assertEqual(request.headers["referer"], "http://localhost:8012/gallery?category=mugs&q=tea")
            self.assertEqual(request.headers["cookie"], "cart_id=c1")
        [library] = self.asked("/droplets/product-library")
        self.assertEqual(library.url.query, b"category=mugs&q=tea")
        html = response.content.decode()
        self.assertLess(html.index('data-droplet="toast-center"'), html.index("<header"))

    def test_pastes_only_an_html_answer(self):
        def answer(request):
            if request.url.path == "/droplets/product-filter":
                return httpx.Response(400, json={"error": "<script>alert(1)</script>"})
            if request.url.path == "/droplets/product-library":
                return httpx.Response(500, headers={"content-type": "text/html"}, text="<p>The droplet failed.</p>")
            if request.url.path == "/droplets/shopping-cart":
                return httpx.Response(504, headers={"content-type": "text/html"}, text="<p>The droplet timed out.</p>")
            return StandInShop.fragments(request)

        self.shop.answer = answer
        html = self.browser.get("/gallery").content.decode()
        self.assertNotIn("alert(1)", html)
        self.assertIn("The product-filter droplet is unavailable (HTTP 400).", html)
        self.assertIn("<p>The droplet failed.</p>", html)
        self.assertIn("<p>The droplet timed out.</p>", html)

    def test_escapes_the_droplet_id_in_the_unavailable_note(self):
        from .views import fragment

        self.shop.answer = lambda request: httpx.Response(404, text="no")
        self.assertIn("&lt;b&gt;", fragment("<b>", [], {})["html"])

    def test_answers_a_fragments_redirect_for_the_page_with_its_cookies(self):
        def answer(request):
            if request.url.path == "/droplets/product-page":
                return httpx.Response(
                    302,
                    headers=[("location", "http://localhost:8012/product/mug"), ("set-cookie", "cart_id=c2; Path=/")],
                )
            if request.url.path == "/droplets/product-page/_data":
                return httpx.Response(200, json={"data": {"product": {"id": "p1", "name": "Mug", "slug": "mug"}}})
            return StandInShop.fragments(request)

        self.shop.answer = answer
        status, headers, _ = wsgi("GET", "/product/mug", QUERY_STRING="v=0123456789")
        named = [(name.lower(), value) for name, value in headers]
        self.assertEqual(status, "302 Found")
        self.assertIn(("location", "http://localhost:8012/product/mug"), named)
        self.assertIn(("set-cookie", "cart_id=c2; Path=/"), named)
        self.assertIn(("cache-control", "private, no-store"), named)
        [page] = self.asked("/droplets/product-page")
        self.assertEqual(page.url.query, b"slug=mug&v=0123456789")

    def test_answers_404_for_a_product_the_shop_does_not_have(self):
        def answer(request):
            if request.url.path == "/droplets/product-page/_data":
                return httpx.Response(404, json={"error": "Not found"})
            return StandInShop.fragments(request)

        self.shop.answer = answer
        response = self.browser.get("/product/nothing-here")
        self.assertEqual(response.status_code, 404)
        self.assertContains(response, "This product does not exist.", status_code=404)
        self.assertEqual(self.asked("/droplets/product-page"), [])

    def test_passes_on_only_the_keys_each_droplet_takes(self):
        self.browser.get("/admin?view=edit&id=p1&next=/elsewhere&debug=1")
        [admin] = self.asked("/droplets/product-admin")
        self.assertEqual(admin.url.query, b"view=edit&id=p1")
        self.browser.get("/login?next=/admin&view=list")
        [login] = self.asked("/droplets/login")
        self.assertEqual(login.url.query, b"next=%2Fadmin")

    def test_puts_only_the_shops_preloads_in_the_head(self):
        def answer(request):
            response = StandInShop.fragments(request)
            response.headers["link"] = (
                '<http://localhost:8012/assets/a.js>; rel="modulepreload", '
                '<https://elsewhere.example/b.js>; rel="modulepreload", '
                '<http://localhost:8012/assets/c.css>; rel="stylesheet"'
            )
            return response

        self.shop.answer = answer
        html = self.browser.get("/gallery").content.decode()
        self.assertEqual(html.count('<link rel="modulepreload" href="http://localhost:8012/assets/a.js">'), 1)
        self.assertNotIn("elsewhere.example", html)
        self.assertNotIn("assets/c.css", html)

    def test_serves_the_shared_stylesheet(self):
        response = self.browser.get("/shop.css")
        self.assertEqual(response["content-type"], "text/css")
        self.assertIn(b".shop-header", b"".join(response.streaming_content))


class BasicPageTests(SimpleTestCase):
    def test_fetches_the_three_droplets_with_the_public_url(self):
        seen = []

        def answer(request):
            seen.append(request)
            return httpx.Response(200, headers={"content-type": "text/html"}, text=f"<p>{request.url.path}</p>")

        transport = httpx.MockTransport(answer)
        real = httpx.Client

        def client(**options):
            return real(transport=transport, **options)

        with mock.patch("basic.views.httpx.Client", client):
            response = Client().get("/?who=Ana")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            sorted(request.url.path for request in seen),
            ["/droplets/client", "/droplets/ssr-hydrate", "/droplets/ssr-nohydrate"],
        )
        for request in seen:
            self.assertEqual(request.headers["x-droplet-location"], "http://localhost:8000")
            self.assertEqual(request.url.query, b"who=Ana")
        self.assertContains(response, '<script type="module" src="http://localhost:8000/index.js"></script>')
