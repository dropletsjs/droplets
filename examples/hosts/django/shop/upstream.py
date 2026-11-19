"""What the shop's pages and its proxy share: the one HTTP client, the
origin sent as `x-droplet-location`, the browser's cookies cut down to the
shop's, and the shop's `Set-Cookie` lines passed on as they came.
"""

from http.cookiejar import CookieJar, DefaultCookiePolicy
from http.cookies import Morsel
from urllib.parse import urlsplit

import httpx
from django.conf import settings

# The stack this host is, in the footer: the one thing that differs between hosts.
STACK = "Django"

SHOP_INTERNAL_URL = settings.SHOP_INTERNAL_URL
# This host's own public origin. It goes out as `x-droplet-location` on every
# request, written out in the settings: never the client's Host.
_public = urlsplit(settings.SHOP_PUBLIC_URL)
SHOP_ORIGIN = f"{_public.scheme}://{_public.netloc}"

# The shop's own cookies, the only ones it is sent: another app's on this origin stay here.
SHOP_COOKIES = ("cart_id", "shop_admin")

# One client for every visitor and every thread, so it must never keep
# cookies: httpx's default jar would store the first visitor's cart_id (and
# admin session) from an answer and send it with everyone else's requests.
# The browser's own Cookie header is forwarded as it is; nothing is remembered.
client = httpx.Client(
    timeout=10.0,
    follow_redirects=False,
    cookies=CookieJar(policy=DefaultCookiePolicy(allowed_domains=[])),
)


def shop_cookies(request) -> str | None:
    """The browser's `Cookie` header with the shop's cookies only, or None."""
    pairs = (pair.strip() for pair in request.headers.get("cookie", "").split(";"))
    kept = [pair for pair in pairs if pair.split("=", 1)[0].strip() in SHOP_COOKIES]
    return "; ".join(kept) if kept else None


class _SetCookieLine(Morsel):
    """A `Set-Cookie` line as the shop wrote it, written out unparsed."""

    def __init__(self, line: str):
        super().__init__()
        self._line = line

    def OutputString(self, attrs=None):
        return self._line


def pass_set_cookies(response, lines: list[str]) -> None:
    """Every `Set-Cookie` line onto a Django response, untouched.

    A Django response keeps one value per header name; its handlers write
    several `Set-Cookie` lines only from `response.cookies`, each morsel's
    `OutputString()`. Parsing the shop's lines into morsels would
    rewrite them, so each goes in as it came, under a key of its own.
    """
    for line in lines:
        response.cookies[f"shop-set-cookie-{len(response.cookies)}"] = _SetCookieLine(line)
