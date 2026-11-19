"""A same-origin proxy for what the browser asks the shop for (`/index.js`,
`/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*`), so its
cookies are first-party and nothing is cross-origin.
"""

import logging

import httpx
from django.conf import settings
from django.http import HttpResponse, StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from . import upstream

logger = logging.getLogger(__name__)

METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]

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

# Per hop, no longer true once httpx has decoded the body, or written by
# the WSGI server itself (`date`). `set-cookie` goes on through pass_set_cookies.
DROPPED_RESPONSE_HEADERS = {
    "connection",
    "content-encoding",
    "content-length",
    "date",
    "keep-alive",
    "set-cookie",
    "transfer-encoding",
}


def _text(status: int, message: str) -> HttpResponse:
    return HttpResponse(message, status=status, content_type="text/plain")


def _has_dot_segment(path: str) -> bool:
    """A `.` or `..` segment in the decoded path: never a shop route."""
    return any(segment in (".", "..") for segment in path.split("/"))


def _body_length(request) -> int:
    try:
        return int(request.META.get("CONTENT_LENGTH") or 0)
    except ValueError:
        return 0


def _stream(answer: httpx.Response):
    try:
        yield from answer.iter_bytes()
    finally:
        answer.close()


# The shop checks a form post's Origin itself, and a CSRF token from this
# host would mean nothing to it.
@csrf_exempt
@require_http_methods(METHODS)
def proxy(request):
    # The route and the method are settled; the body is not read until the
    # path and its size pass.
    if _has_dot_segment(request.path):
        return _text(400, "Bad request.")
    has_body = request.method not in ("GET", "HEAD")
    if has_body and _body_length(request) > settings.DATA_UPLOAD_MAX_MEMORY_SIZE:
        return _text(413, "Payload too large.")

    headers = {"x-droplet-location": upstream.SHOP_ORIGIN}
    for name in FORWARDED_REQUEST_HEADERS:
        value = request.headers.get(name)
        if value:
            headers[name] = value
    cookie = upstream.shop_cookies(request)
    if cookie:
        headers["cookie"] = cookie
    # Concatenated, not resolved: a path like `//elsewhere` stays a path on the shop.
    upstream_request = upstream.client.build_request(
        request.method,
        upstream.SHOP_INTERNAL_URL + request.get_full_path(),
        headers=headers,
        content=request.body if has_body else None,
    )
    try:
        answer = upstream.client.send(upstream_request, stream=True)
    except httpx.HTTPError as error:
        logger.error("[shop proxy] %s %s: %r", request.method, request.path, error)
        return _text(502, "The shop is unreachable.")

    response = StreamingHttpResponse(_stream(answer), status=answer.status_code)
    if "content-type" not in answer.headers:
        del response["Content-Type"]
    # httpx joins a repeated header with ", ", which every header but Set-Cookie allows.
    for name in answer.headers.keys():
        if name not in DROPPED_RESPONSE_HEADERS:
            response[name] = answer.headers[name]
    upstream.pass_set_cookies(response, answer.headers.get_list("set-cookie"))
    return response
