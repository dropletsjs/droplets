"""The shop demo (examples/shop) on this host, beside the basic page.

- A same-origin proxy for what the browser asks the shop for (`/index.js`,
  `/droplets/*`, `/assets/*`, `/api/*`), so its cookies are first-party and
  nothing is cross-origin.
- Four pages (`/gallery`, `/product/{slug}`, `/login`, `/admin`) that fetch
  the shop's fragments on the server and compose them in one layout.

The contract they follow is examples/shop/CONTRACT.md.
"""

import asyncio
import os
import re
from http.cookiejar import CookieJar, DefaultCookiePolicy
from pathlib import Path
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.templating import Jinja2Templates
from markupsafe import Markup
from starlette.background import BackgroundTask

# The stack this host is, in the footer: the one thing that differs between hosts.
STACK = "FastAPI"

# How this process reaches the shop (`http://shop:8300` in Docker).
SHOP_INTERNAL_URL = os.environ.get("SHOP_INTERNAL_URL", "http://localhost:8300").rstrip("/")
# This host's own public origin. It goes out as `x-droplet-location` on every
# request, written out here: never the client's Host.
_public = urlsplit(os.environ.get("SHOP_PUBLIC_URL", "http://localhost:8001"))
SHOP_ORIGIN = f"{_public.scheme}://{_public.netloc}"

# What the browser's request may tell the shop; nothing that names a host. `cookie` goes on filtered.
FORWARDED_REQUEST_HEADERS = [
    "accept",
    "accept-language",
    "content-type",
    "if-none-match",
    "origin",
    "referer",
    "user-agent",
    "x-droplet-props",
    "x-droplets-build",
]

# Per hop, or no longer true once httpx has decoded the body.
DROPPED_RESPONSE_HEADERS = {
    "connection",
    "content-encoding",
    "content-length",
    "keep-alive",
    "set-cookie",
    "transfer-encoding",
}

# The shop's own cookies, the only ones it is sent: another app's on this origin stay here.
SHOP_COOKIES = ("cart_id", "shop_admin")

router = APIRouter()
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")
# One client for every visitor, so it must never keep cookies: httpx's
# default jar would store the first visitor's cart_id (and admin session)
# from a proxied answer and send it with everyone else's requests. The
# browser's own Cookie header is forwarded as it is; nothing is remembered.
client = httpx.AsyncClient(
    timeout=10.0,
    follow_redirects=False,
    cookies=CookieJar(policy=DefaultCookiePolicy(allowed_domains=[])),
)


def _raw_target(request: Request) -> str:
    """The request's path and query exactly as the browser sent them."""
    path = request.scope["raw_path"].decode("latin-1")
    query = request.scope["query_string"].decode("latin-1")
    return f"{path}?{query}" if query else path


def _shop_cookies(request: Request) -> str | None:
    """The browser's `Cookie` header with the shop's cookies only, or None."""
    pairs = (pair.strip() for pair in request.headers.get("cookie", "").split(";"))
    kept = [pair for pair in pairs if pair.split("=", 1)[0].strip() in SHOP_COOKIES]
    return "; ".join(kept) if kept else None


def _has_dot_segment(request: Request) -> bool:
    """A `.` or `..` segment, once decoded: never a shop route."""
    path = request.scope["raw_path"].decode("latin-1")
    return any(unquote(segment) in (".", "..") for segment in path.split("/"))


def _set_cookies(response: Response, cookies: list[str]) -> None:
    # Untouched: the shop never sets Domain, so they belong to this origin.
    for cookie in cookies:
        response.headers.append("set-cookie", cookie)


# ---- The proxy --------------------------------------------------------------


METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]


@router.api_route("/index.js", methods=METHODS, include_in_schema=False)
@router.api_route("/env.js", methods=METHODS, include_in_schema=False)
@router.api_route("/index.css", methods=METHODS, include_in_schema=False)
@router.api_route("/droplets/{rest:path}", methods=METHODS, include_in_schema=False)
@router.api_route("/assets/{rest:path}", methods=METHODS, include_in_schema=False)
@router.api_route("/api/{rest:path}", methods=METHODS, include_in_schema=False)
async def proxy(request: Request) -> Response:
    if _has_dot_segment(request):
        return Response("Bad request.", status_code=400, media_type="text/plain")
    headers = {"x-droplet-location": SHOP_ORIGIN}
    for name in FORWARDED_REQUEST_HEADERS:
        value = request.headers.get(name)
        if value:
            headers[name] = value
    cookie = _shop_cookies(request)
    if cookie:
        headers["cookie"] = cookie
    has_body = request.method not in ("GET", "HEAD")
    # Concatenated, not resolved: a path like `//elsewhere` stays a path on the shop.
    upstream_request = client.build_request(
        request.method,
        SHOP_INTERNAL_URL + _raw_target(request),
        headers=headers,
        content=request.stream() if has_body else None,
    )
    try:
        upstream = await client.send(upstream_request, stream=True)
    except httpx.HTTPError as error:
        print(f"[shop proxy] {request.method} {request.url.path}: {error!r}")
        return Response("The shop is unreachable.", status_code=502, media_type="text/plain")

    response = StreamingResponse(
        upstream.aiter_bytes() if request.method != "HEAD" else iter(()),
        status_code=upstream.status_code,
        background=BackgroundTask(upstream.aclose),
    )
    for name, value in upstream.headers.multi_items():
        if name.lower() not in DROPPED_RESPONSE_HEADERS:
            response.headers.append(name, value)
    _set_cookies(response, upstream.headers.get_list("set-cookie"))
    return response


# ---- Fragments ----------------------------------------------------------------


async def fragment(request: Request, droplet: str, params: list[tuple[str, str]] | None = None) -> dict:
    """`GET /droplets/<id>?<params>` → `{ html, status, location, cookies, link }`.

    Only an HTML answer is a fragment (a 500 carries the droplet's error
    page); anything else may echo the props, so it is never inserted.
    """
    url = f"{SHOP_INTERNAL_URL}/droplets/{quote(droplet, safe='')}?{urlencode(params or [])}"
    # The browser's request, as the shop should see it: its shop cookies, this page as the host.
    headers = {"accept": "text/html", "x-droplet-location": SHOP_ORIGIN, "referer": SHOP_ORIGIN + _raw_target(request)}
    cookie = _shop_cookies(request)
    if cookie:
        headers["cookie"] = cookie
    result = {"html": Markup(""), "status": 502, "location": None, "cookies": [], "link": None}
    try:
        response = await client.get(url, headers=headers)
        result["status"] = response.status_code
        result["cookies"] = response.headers.get_list("set-cookie")
        result["link"] = response.headers.get("link")
        content_type = response.headers.get("content-type", "")
        if 300 <= response.status_code < 400:
            result["location"] = response.headers.get("location")
        elif (response.is_success or response.status_code == 500) and content_type.startswith("text/html"):
            # Trusted markup from the shop: inserted as it is.
            result["html"] = Markup(response.text)
            return result
    except httpx.HTTPError as error:
        print(f"[shop] {droplet}: {error!r}")
    reason = "unreachable" if result["status"] == 502 else f"HTTP {result['status']}"
    result["html"] = Markup('<p class="shop-unavailable">The {} droplet is unavailable ({}).</p>').format(
        droplet, reason
    )
    return result


async def product(slug: str) -> dict | None:
    """A product's name, category and id, from the product page's public `_data` read."""
    url = f"{SHOP_INTERNAL_URL}/droplets/product-page/_data?{urlencode({'slug': slug})}"
    try:
        response = await client.get(url, headers={"x-droplet-location": SHOP_ORIGIN, "accept": "application/json"})
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
            if f"{href.scheme}://{href.netloc}" != SHOP_ORIGIN:
                continue
            tag = {"rel": params["rel"], "href": match.group(1), "as": params.get("as")}
            if tag not in tags:
                tags.append(tag)
    return tags


def _query(request: Request) -> list[tuple[str, str]]:
    return parse_qsl(request.scope["query_string"].decode("latin-1"), keep_blank_values=True)


def pick(request: Request, keys: list[str]) -> list[tuple[str, str]]:
    """The page's query parameters named in `keys`, in that order."""
    query = _query(request)
    return [(key, value) for wanted in keys for key, value in query if key == wanted]


async def render(
    request: Request,
    template: str,
    *,
    title: str,
    current: str | None,
    wanted: list[tuple[str, list[tuple[str, str]]]],
    status: int = 200,
    **context,
) -> Response:
    """Fetches the toasts (first in the body), the header's cart and the page's fragments,
    then answers: a droplet's redirect as it is, otherwise the page, with
    every `Set-Cookie` the fragments sent."""
    toasts, cart, *fragments = await asyncio.gather(
        fragment(request, "toast-center"),
        fragment(request, "shopping-cart", [("variant", "badge")]),
        *(fragment(request, droplet, params) for droplet, params in wanted),
    )
    results = [toasts, cart, *fragments]
    cookies = [cookie for result in results for cookie in result["cookies"]]
    redirect = next((result for result in results if result["location"]), None)
    if redirect:
        response: Response = Response(status_code=redirect["status"], headers={"location": redirect["location"]})
    else:
        response = templates.TemplateResponse(
            request,
            template,
            {
                "stack": STACK,
                "title": title,
                "current": current,
                "links": link_tags(results),
                "toasts": toasts["html"],
                "cart": cart["html"],
                "fragments": [result["html"] for result in fragments],
                **context,
            },
            status_code=status,
        )
    response.headers["cache-control"] = "private, no-store"
    _set_cookies(response, cookies)
    return response


# ---- Pages ----------------------------------------------------------------------


@router.api_route("/shop.css", methods=["GET", "HEAD"], include_in_schema=False)
async def stylesheet() -> FileResponse:
    return FileResponse(Path(__file__).parent / "static" / "shop.css", media_type="text/css")


@router.get("/gallery", include_in_schema=False)
async def gallery(request: Request) -> Response:
    # The whole query to both: the shop drops what a droplet does not take.
    query = _query(request)
    return await render(
        request,
        "shop/gallery.html",
        title="Gallery",
        current="/gallery",
        wanted=[("product-filter", query), ("product-library", query)],
    )


@router.get("/product/{slug}", include_in_schema=False)
async def product_page(request: Request, slug: str) -> Response:
    found = await product(slug)
    if not found:
        return await render(request, "shop/not-found.html", title="Not found", current=None, wanted=[], status=404)
    comments = pick(request, ["order", "page", "showing"]) + [("productId", found["id"])]
    # `v`, when the link had one: the shop serves its build's page for the
    # current version and redirects an old one to this URL without it.
    page = [("slug", found["slug"])] + pick(request, ["v"])
    return await render(
        request,
        "shop/product.html",
        title=found["name"],
        current=None,
        wanted=[("product-page", page), ("product-comments", comments)],
        product=found,
        category=found.get("category") or {},
    )


@router.get("/login", include_in_schema=False)
async def login(request: Request) -> Response:
    return await render(
        request, "shop/login.html", title="Log in", current=None, wanted=[("login", pick(request, ["next"]))]
    )


@router.get("/admin", include_in_schema=False)
async def admin(request: Request) -> Response:
    return await render(
        request,
        "shop/admin.html",
        title="Admin",
        current="/admin",
        wanted=[("product-admin", pick(request, ["view", "id"]))],
    )
