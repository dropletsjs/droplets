"""Droplets embedded from a Django view.

The view fetches each droplet as an HTML fragment from the droplets server,
with `x-droplet-location` set to the origin browsers will use, and pastes
the fragments into a template. The page loads `/index.js` once; the
elements then hydrate themselves.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, urlencode

import httpx
from django.conf import settings
from django.shortcuts import render
from django.utils.html import format_html
from django.utils.safestring import SafeString, mark_safe
from django.views.decorators.http import require_safe

logger = logging.getLogger(__name__)

DROPLETS_INTERNAL_URL = settings.DROPLETS_INTERNAL_URL
DROPLETS_PUBLIC_URL = settings.DROPLETS_PUBLIC_URL

# The Svelte example's droplets (examples/frameworks/svelte), one per mode.
IDS = ["client", "ssr-hydrate", "ssr-nohydrate"]


def fetch_droplet(client: httpx.Client, droplet: str, **props: str) -> SafeString:
    """GET /droplets/<id>?props -> the droplet element's fragment, or an inline error."""
    query = f"?{urlencode(props)}" if props else ""
    try:
        # Never follows a redirect (the client's default).
        response = client.get(
            f"{DROPLETS_INTERNAL_URL}/droplets/{quote(droplet, safe='')}{query}",
            headers={"accept": "text/html", "x-droplet-location": DROPLETS_PUBLIC_URL},
        )
    except httpx.HTTPError as error:
        # The error names the internal URL: it goes to the log, not the page.
        logger.error("[droplets] %s: %r", droplet, error)
        return format_html('<p class="error">droplet "{}" unavailable</p>', droplet)
    # Only an HTML answer is a fragment (a 500 carries the droplet's error
    # page); anything else may echo the props, so it is never pasted.
    is_html = response.headers.get("content-type", "").startswith("text/html")
    if (response.is_success or response.status_code == 500) and is_html:
        return mark_safe(response.text)
    return format_html('<p class="error">droplet "{}" unavailable: HTTP {}</p>', droplet, response.status_code)


@require_safe
def index(request):
    who = request.GET.get("who", "Django")
    with httpx.Client(timeout=5.0) as client, ThreadPoolExecutor(max_workers=len(IDS)) as pool:
        fragments = list(pool.map(lambda droplet: fetch_droplet(client, droplet, who=who), IDS))
    return render(request, "basic/index.html", {"droplets_public_url": DROPLETS_PUBLIC_URL, "fragments": fragments})
