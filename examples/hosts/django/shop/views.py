"""The shop demo (examples/shop) on this host, beside the basic page.

Four pages (`/gallery`, `/product/<slug>`, `/login`, `/admin`) fetch the
shop's fragments on the server and compose them in one layout; the proxy
for everything else is `proxy.py`. The contract they follow is
examples/shop/CONTRACT.md.
"""

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote, urlencode, urlsplit

import httpx
from django.http import FileResponse, HttpResponse
from django.shortcuts import render
from django.utils.html import format_html
from django.utils.safestring import mark_safe
from django.views.decorators.http import require_safe

from . import upstream

logger = logging.getLogger(__name__)

STYLESHEET = Path(__file__).parent / "static" / "shop.css"


# ---- Fragments ----------------------------------------------------------------


def fragment(droplet: str, params: list[tuple[str, str]], headers: dict[str, str]) -> dict:
    """`GET /droplets/<id>?<params>` → `{ html, status, location, cookies, link }`.

    Only an HTML answer is a fragment (a 500 or 504 carries the droplet's
    error page); anything else may echo the props, so it is never inserted.
    """
    url = f"{upstream.SHOP_INTERNAL_URL}/droplets/{quote(droplet, safe='')}?{urlencode(params)}"
    result = {"html": "", "status": 502, "location": None, "cookies": [], "link": None}
    try:
        response = upstream.client.get(url, headers=headers)
        result["status"] = response.status_code
        result["cookies"] = response.headers.get_list("set-cookie")
        result["link"] = response.headers.get("link")
        content_type = response.headers.get("content-type", "")
        if 300 <= response.status_code < 400:
            result["location"] = response.headers.get("location")
        elif (response.is_success or response.status_code in (500, 504)) and content_type.startswith("text/html"):
            # Trusted markup from the shop: inserted as it is.
            result["html"] = mark_safe(response.text)
            return result
    except httpx.HTTPError as error:
        logger.error("[shop] %s: %r", droplet, error)
    reason = "unreachable" if result["status"] == 502 else f"HTTP {result['status']}"
    result["html"] = format_html('<p class="shop-unavailable">The {} droplet is unavailable ({}).</p>', droplet, reason)
    return result


def fragment_headers(request) -> dict[str, str]:
    """The browser's request, as the shop should see it: its shop cookies, this page as the host."""
    headers = {
        "accept": "text/html",
        "x-droplet-location": upstream.SHOP_ORIGIN,
        "referer": upstream.SHOP_ORIGIN + request.get_full_path(),
    }
    cookie = upstream.shop_cookies(request)
    if cookie:
        headers["cookie"] = cookie
    return headers


def product(slug: str) -> dict | None:
    """A product's name, category and id, from the product page's public `_data` read."""
    url = f"{upstream.SHOP_INTERNAL_URL}/droplets/product-page/_data?{urlencode({'slug': slug})}"
    try:
        response = upstream.client.get(
            url, headers={"x-droplet-location": upstream.SHOP_ORIGIN, "accept": "application/json"}
        )
        if not response.is_success:
            return None
        found = (response.json().get("data") or {}).get("product") or {}
    except (httpx.HTTPError, ValueError, AttributeError):
        return None
    if isinstance(found.get("id"), str) and isinstance(found.get("name"), str):
        return found
    return None


_LINK = re.compile(r"^\s*<([^>]*)>(.*)$")


def link_tags(results: list[dict]) -> list[dict]:
    """The fragments' `Link` preloads, for the page's head: on the shop's origin only."""
    tags: list[dict] = []
    for result in results:
        for part in re.split(r",(?=\s*<)", result["link"] or ""):
            match = _LINK.match(part)
            if not match:
                continue
            params = {}
            for param in match.group(2).split(";"):
                key, _, value = param.partition("=")
                key, value = key.strip(), value.strip().strip('"')
                if key and value:
                    params[key] = value
            if params.get("rel") not in ("preload", "modulepreload"):
                continue
            href = urlsplit(match.group(1))
            if f"{href.scheme}://{href.netloc}" != upstream.SHOP_ORIGIN:
                continue
            # `as` is a keyword in Django's template tags.
            tag = {"rel": params["rel"], "href": match.group(1), "kind": params.get("as")}
            if tag not in tags:
                tags.append(tag)
    return tags


def query(request) -> list[tuple[str, str]]:
    return [(key, value) for key, values in request.GET.lists() for value in values]


def pick(request, keys: list[str]) -> list[tuple[str, str]]:
    """The page's query parameters named in `keys`, in that order."""
    return [(key, value) for key in keys for value in request.GET.getlist(key)]


def shop_page(request, template: str, *, title: str, current: str | None, wanted, status: int = 200, **context):
    """Fetches the toasts (first in the body), the header's cart and the page's fragments,
    then answers: a droplet's redirect as it is, otherwise the page, with
    every `Set-Cookie` the fragments sent."""
    headers = fragment_headers(request)
    jobs = [("toast-center", []), ("shopping-cart", [("variant", "badge")]), *wanted]
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        results = list(pool.map(lambda job: fragment(job[0], job[1], headers), jobs))
    toasts, cart, *fragments = results
    redirect = next((result for result in results if result["location"]), None)
    if redirect:
        response = HttpResponse(status=redirect["status"], headers={"location": redirect["location"]})
    else:
        response = render(
            request,
            template,
            {
                "stack": upstream.STACK,
                "title": title,
                "current": current,
                "links": link_tags(results),
                "toasts": toasts["html"],
                "cart": cart["html"],
                "fragments": [result["html"] for result in fragments],
                **context,
            },
            status=status,
        )
    response["Cache-Control"] = "private, no-store"
    upstream.pass_set_cookies(response, [cookie for result in results for cookie in result["cookies"]])
    return response


# ---- Pages ----------------------------------------------------------------------


@require_safe
def stylesheet(request):
    return FileResponse(STYLESHEET.open("rb"), content_type="text/css")


@require_safe
def gallery(request):
    # The whole query to both: the shop drops what a droplet does not take.
    params = query(request)
    return shop_page(
        request,
        "shop/gallery.html",
        title="Gallery",
        current="/gallery",
        wanted=[("product-filter", params), ("product-library", params)],
    )


@require_safe
def product_page(request, slug: str):
    found = product(slug)
    if not found:
        return shop_page(request, "shop/not-found.html", title="Not found", current=None, wanted=[], status=404)
    comments = pick(request, ["order", "page", "showing"]) + [("productId", found["id"])]
    # `v`, when the link had one: the shop serves its build's page for the
    # current version and redirects an old one to this URL without it.
    page = [("slug", found["slug"])] + pick(request, ["v"])
    return shop_page(
        request,
        "shop/product.html",
        title=found["name"],
        current=None,
        wanted=[("product-page", page), ("product-comments", comments)],
        product=found,
        category=found.get("category") or {},
    )


@require_safe
def login(request):
    return shop_page(
        request, "shop/login.html", title="Log in", current=None, wanted=[("login", pick(request, ["next"]))]
    )


@require_safe
def admin(request):
    return shop_page(
        request,
        "shop/admin.html",
        title="Admin",
        current="/admin",
        wanted=[("product-admin", pick(request, ["view", "id"]))],
    )
