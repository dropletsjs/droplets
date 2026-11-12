"""Droplets embedded from FastAPI.

The handler fetches each droplet as an HTML fragment from the droplets server,
with `x-droplet-location` set to the origin browsers will use, and pastes the
fragments into a Jinja template. The page loads `/index.js` once; the elements
then hydrate themselves.
"""

import asyncio
import os
from pathlib import Path
from urllib.parse import quote, urlencode

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from markupsafe import Markup

from shop import router as shop_router

# Server-to-server address (inside Docker: the service name).
DROPLETS_INTERNAL_URL = os.environ.get("DROPLETS_INTERNAL_URL", "http://localhost:8000")
# Browser-facing address, written onto every fragment.
DROPLETS_PUBLIC_URL = os.environ.get("DROPLETS_PUBLIC_URL", "http://localhost:8000")

# The Svelte example's droplets (examples/frameworks/svelte), one per mode.
IDS = ["client", "ssr-hydrate", "ssr-nohydrate"]

app = FastAPI()
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")

# The shop demo: /gallery, /product/{slug}, /login, /admin, and its proxy.
app.include_router(shop_router)


async def fetch_droplet(client: httpx.AsyncClient, droplet: str, **props: str) -> Markup:
    """GET /droplets/<id>?props -> the droplet element's fragment, or an inline error."""
    query = f"?{urlencode(props)}" if props else ""
    try:
        # Never follows a redirect (the client's default).
        response = await client.get(
            f"{DROPLETS_INTERNAL_URL}/droplets/{quote(droplet, safe='')}{query}",
            headers={"accept": "text/html", "x-droplet-location": DROPLETS_PUBLIC_URL},
            timeout=5.0,
        )
    except httpx.HTTPError as error:
        # The error names the internal URL: it goes to the log, not the page.
        print(f"[droplets] {droplet}: {error!r}")
        return Markup('<p class="error">droplet "{}" unavailable</p>').format(droplet)
    # Only an HTML answer is a fragment (a 500 carries the droplet's error
    # page); anything else may echo the props, so it is never pasted.
    is_html = response.headers.get("content-type", "").startswith("text/html")
    if (response.is_success or response.status_code == 500) and is_html:
        return Markup(response.text)
    return Markup('<p class="error">droplet "{}" unavailable: HTTP {}</p>').format(droplet, response.status_code)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request, who: str = "FastAPI") -> HTMLResponse:
    async with httpx.AsyncClient() as client:
        fragments = await asyncio.gather(
            *(fetch_droplet(client, droplet, who=who) for droplet in IDS)
        )

    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "droplets_public_url": DROPLETS_PUBLIC_URL,
            "fragments": fragments,
        },
    )
