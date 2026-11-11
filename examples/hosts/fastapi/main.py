"""Droplets embedded from FastAPI.

The handler fetches each droplet as an HTML fragment from the droplets server,
with `x-droplet-location` set to the origin browsers will use, and pastes the
fragments into a Jinja template. The page loads `/index.js` once; the elements
then hydrate themselves.
"""

import asyncio
import os
from pathlib import Path
from urllib.parse import urlencode

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
        response = await client.get(
            f"{DROPLETS_INTERNAL_URL}/droplets/{droplet}{query}",
            headers={"x-droplet-location": DROPLETS_PUBLIC_URL},
            timeout=5.0,
        )
        response.raise_for_status()
        return Markup(response.text)
    except httpx.HTTPError as error:
        return Markup(f'<p class="error">droplet "{droplet}" unavailable: {error}</p>')


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
