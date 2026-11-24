# C# (ASP.NET Core)

An ASP.NET Core app on .NET 10 that embeds droplets with Razor Pages. Each
page model fetches its fragments from the droplets server with an
`HttpClient` from `IHttpClientFactory` and the Razor page prints them with
`Html.Raw`; the page loads `/index.js` once. `/` shows the Svelte example's
three droplets; `/gallery`, `/product/<slug>`, `/login` and `/admin` run
the [shop demo](../../shop) through a same-origin proxy (minimal API
endpoints).

```bash
docker compose up --build
open http://localhost:8014          # the three Svelte droplets
open http://localhost:8014/gallery  # the shop (demo login: admin / droplets)
```

Set `SHOP_SECRET` and `DROPLETS_SECRET` first (32 or more random characters
each, `openssl rand -hex 32`), in the environment or a `.env` file beside
`docker-compose.yml`: compose refuses to start without them. `pnpm test:hosts`
generates its own for a run.

Compose starts three services: `droplets` (the Svelte example, published on
http://localhost:8000), `shop` (reached only by the host) and `web` (this
app, on http://localhost:8014). Every port is published on `127.0.0.1`.

## Details

### Layout

- `src/`: the app (`DropletsHost.csproj`, `Microsoft.NET.Sdk.Web`, no
  package beyond the framework).
  - `HostApp.cs` builds it: the named clients, Razor Pages, the proxy,
    `wwwroot/` as static files. `Program.cs` runs it.
  - `HostSettings.cs` reads the four URLs from configuration (the
    environment, in Docker).
  - `Shop/`: the proxy (`ShopProxy.cs`), the fragment fetches
    (`ShopFragments.cs`) and what is read from the browser's request
    (`ShopRequest.cs`).
  - `Pages/`: `Index` (the Svelte example), `Gallery`, `Product`, `Login`,
    `Admin` and the layout `Shared/_ShopLayout.cshtml`; `ShopPage.cs` is
    their base page model.
- `test/`: xUnit tests of the host's own logic against the app on Kestrel,
  the shop replaced by a fake `HttpMessageHandler`. The image's build runs
  them (`dotnet test`) before it publishes.
- Both projects restore from their `packages.lock.json` (`--locked-mode`).

### The basic page (`/`)

`Pages/Index.cshtml.cs` asks the droplets server for `client`,
`ssr-hydrate` and `ssr-nohydrate` concurrently (`Task.WhenAll`) with the
`who` query (default `ASP.NET Core`). It fetches from
`DROPLETS_INTERNAL_URL` and sends `DROPLETS_PUBLIC_URL` as
`x-droplet-location`, so the fragments point the browser at the public
origin; `Pages/Index.cshtml` loads `/index.js` from that origin. The browser
loads each droplet's JavaScript from `http://localhost:8000`, a different
origin than the page, so the droplets server runs with `cors: true`
(`examples/frameworks/svelte/droplets.config.ts`).

### The shop demo

- `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*` and
  `/api/*` are proxied to the shop under this origin (`MapMethods`), so its
  cookies (the cart, the admin session) are first-party and nothing is
  cross-origin. The proxy forwards a fixed list of request headers (none
  that names a host), buffers a request body up to 4 MB (413 above it) and
  streams the answer back with its status, `Set-Cookie` and redirects
  untouched.
- `x-droplet-location` is the origin of `SHOP_PUBLIC_URL`, written out in
  the environment: never the request's Host. The shop lists that origin in
  `DROPLETS_TRUSTED_ORIGINS`.
- The pages fetch their fragments concurrently with the browser's `Cookie`
  cut down to the shop's own `cart_id` and `shop_admin` (so does the proxy,
  which also refuses a request target that is not a path, or has a `.` or
  `..` segment once decoded), the page URL as `Referer`, and never follow
  redirects. Only an HTML answer (2xx, 500 or 504) is inserted. Their
  `Set-Cookie` goes back with the page, a droplet's redirect is answered as
  it is, and their `Link` preloads go into its `<head>`.
- Every visitor's requests go through the same pooled handler, so it keeps
  no cookies (`UseCookies = false`): a shared container would hand one
  visitor's cart and session to the next.
- The layout's stylesheet is `src/wwwroot/shop.css`, the same file in every
  host but WordPress.
- The contract the pages follow is [`CONTRACT.md`](../../shop/CONTRACT.md).

### Environment

| Variable | Service | Default in compose |
|---|---|---|
| `DROPLETS_INTERNAL_URL` | web | `http://droplets:8000` |
| `DROPLETS_PUBLIC_URL` | web | `${DROPLETS_URL:-http://localhost:8000}` |
| `SHOP_INTERNAL_URL` | web | `http://shop:8300` |
| `SHOP_PUBLIC_URL` | web | `${WEB_URL:-http://localhost:8014}` |
| `DROPLETS_TRUSTED_ORIGINS` | droplets | the droplets URL and this host's URL |
| `DROPLETS_TRUSTED_ORIGINS` | shop | this host's URL |

`WEB_PORT`, `WEB_URL`, `DROPLETS_PORT` and `DROPLETS_URL` move the published
ports and public URLs; `tests/hosts/run.mjs` sets them for
`HOSTS_PORT_BASE`. The app reads its four variables through ASP.NET Core's
configuration, so `appsettings.json` or command-line arguments work too.

### Without Docker

With the .NET 10 SDK, a droplets server on port 8000 and, for `/gallery`,
the shop on 8300 started with `DROPLETS_TRUSTED_ORIGINS=http://localhost:8014`
(see the [shop's README](../../shop/README.md)):

```bash
dotnet test test                                 # the host's own tests
dotnet run --project src --urls http://localhost:8014
```

### Checks

From the repository root: `pnpm test:hosts aspnet` (the shop flow in
Chromium, against this compose stack; the image's build runs `dotnet test`
first). `pnpm typecheck:hosts` covers the Node hosts only. The guide's page:
[ASP.NET Core](https://dropletsjs.dev/integrate/hosts/aspnet/).

## Facts

- Web service publishes `127.0.0.1:${WEB_PORT:-8014}:8014`. `docker-compose.yml:37`
- Droplets service publishes `127.0.0.1:${DROPLETS_PORT:-8000}:8000`. `docker-compose.yml:11`
- Droplets service builds `examples/frameworks/Dockerfile` from the repository root (the Svelte example by default). `docker-compose.yml:9`, `../../frameworks/Dockerfile:24`
- Droplets service `DROPLETS_TRUSTED_ORIGINS` lists `DROPLETS_URL` and `WEB_URL`. `docker-compose.yml:14`
- Droplets server (Svelte example) has `cors: true`. `../../frameworks/svelte/droplets.config.ts:16`
- Shop service builds `examples/shop/Dockerfile` and only exposes 8300, unpublished. `docker-compose.yml:21`, `docker-compose.yml:23`
- Shop service `DROPLETS_TRUSTED_ORIGINS` is `WEB_URL`. `docker-compose.yml:32`
- Shop demo login is `admin` / `droplets` (demo values only). `docker-compose.yml:26`, `docker-compose.yml:27`
- Shop service `SHOP_SECRET` and `DROPLETS_SECRET` are required from the environment (`${VAR:?…}`), no default. `docker-compose.yml:28`, `docker-compose.yml:30`
- Web env `DROPLETS_INTERNAL_URL` is `http://droplets:8000`. `docker-compose.yml:39`
- Web env `DROPLETS_PUBLIC_URL` is `${DROPLETS_URL:-http://localhost:8000}`. `docker-compose.yml:40`
- Web env `SHOP_INTERNAL_URL` is `http://shop:8300`. `docker-compose.yml:41`
- Web env `SHOP_PUBLIC_URL` is `${WEB_URL:-http://localhost:8014}`. `docker-compose.yml:42`
- Dockerfile builds on `mcr.microsoft.com/dotnet/sdk:10.0` and runs on `mcr.microsoft.com/dotnet/aspnet:10.0`. `Dockerfile:1`, `Dockerfile:11`
- Dockerfile restores from the lock files (`--locked-mode`), runs `dotnet test`, then `dotnet publish`. `Dockerfile:5`, `Dockerfile:8`, `Dockerfile:9`
- Dockerfile listens on 8014 (`ASPNETCORE_HTTP_PORTS`) as the image's non-root `app` user. `Dockerfile:14`, `Dockerfile:16`
- Dockerignore leaves out `bin/`, `obj/` and `.env`. `.dockerignore:1`, `.dockerignore:3`
- App targets `net10.0` with the Web SDK and no package reference; warnings are errors. `src/DropletsHost.csproj:1`, `src/DropletsHost.csproj:4`, `src/DropletsHost.csproj:7`
- Tests use xUnit v3 (`xunit.v3` 3.2.2), `Microsoft.NET.Test.Sdk` and the app as a project reference. `test/DropletsHost.Tests.csproj:16`, `test/DropletsHost.Tests.csproj:21`
- Settings `SHOP_INTERNAL_URL` defaults to `http://localhost:8300`, trailing slashes stripped. `src/HostSettings.cs:13`
- Settings shop origin is scheme, host and port of `SHOP_PUBLIC_URL`, default `http://localhost:8014`. `src/HostSettings.cs:15`, `src/HostSettings.cs:21`
- Settings `DROPLETS_INTERNAL_URL` and `DROPLETS_PUBLIC_URL` default to `http://localhost:8000`. `src/HostSettings.cs:17`, `src/HostSettings.cs:18`
- Settings are read from configuration when first resolved, as a singleton. `src/HostApp.cs:32`
- Clients `shop` (timeout 10 s) and `droplets` (timeout 10 s) come from `IHttpClientFactory`. `src/HostApp.cs:33`, `src/HostApp.cs:35`
- Clients' handler keeps no cookies, follows no redirects and decompresses nothing. `src/HostApp.cs:23`
- Razor output encodes no Unicode range as entities (`UnicodeRanges.All`). `src/HostApp.cs:40`
- App serves `wwwroot/` (`/shop.css`) as static files. `src/HostApp.cs:45`
- Basic page droplets are `client`, `ssr-hydrate`, `ssr-nohydrate`. `src/Pages/Index.cshtml.cs:14`
- Basic page `who` defaults to `ASP.NET Core`. `src/Pages/Index.cshtml.cs:19`
- Basic page fetches the three fragments with `Task.WhenAll`. `src/Pages/Index.cshtml.cs:21`
- Basic page fragment fetch sends `accept: text/html` and `x-droplet-location: DROPLETS_PUBLIC_URL`. `src/Pages/Index.cshtml.cs:28`, `src/Pages/Index.cshtml.cs:29`
- Basic page pastes only a 2xx, 500 or 504 `text/html` answer; anything else renders `<p class="error">` with the status, the id HTML-encoded. `src/Pages/Index.cshtml.cs:36`, `src/Pages/Index.cshtml.cs:40`
- Basic page fragment failure is logged and renders a fixed `<p class="error">`: the error names the internal URL. `src/Pages/Index.cshtml.cs:45`, `src/Pages/Index.cshtml.cs:46`
- Basic page loads `DROPLETS_PUBLIC_URL` + `/index.js`. `src/Pages/Index.cshtml:9`
- Shop footer stack name is `ASP.NET Core`. `src/Pages/ShopPage.cs:14`
- Shop proxy routes are `/index.js`, `/env.js`, `/index.css`, `/droplets/*`, `/assets/*`, `/api/*`. `src/Shop/ShopProxy.cs:15`
- Shop proxy methods are `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`. `src/Shop/ShopProxy.cs:13`
- Shop proxy forwards only `accept`, `accept-language`, `content-type`, `if-none-match`, `origin`, `referer`, `user-agent`, `x-droplet-props`, `x-droplets-build`, plus `cookie` cut down to `cart_id` and `shop_admin`. `src/Shop/ShopProxy.cs:18`, `src/Shop/ShopProxy.cs:81`, `src/Shop/ShopRequest.cs:16`
- Shop proxy refuses with 400 a target that does not start with `/`, or has a `.` or `..` segment once decoded. `src/Shop/ShopProxy.cs:53`, `src/Shop/ShopRequest.cs:39`, `src/Shop/ShopRequest.cs:41`
- Shop proxy target is the raw path and query (`IHttpRequestFeature.RawTarget`) concatenated onto `SHOP_INTERNAL_URL`: `//elsewhere` stays a path on the shop. `src/Shop/ShopRequest.cs:20`, `src/Shop/ShopProxy.cs:61`
- Shop proxy buffers a request body up to 4 MB and answers 413 `The body is too large.` above it, before the shop is asked. `src/Shop/ShopProxy.cs:11`, `src/Shop/ShopProxy.cs:67`, `src/Shop/ShopProxy.cs:115`, `src/Shop/ShopProxy.cs:121`
- Shop `x-droplet-location` is the `SHOP_PUBLIC_URL` origin, never the request's Host. `src/Shop/ShopProxy.cs:73`, `src/Shop/ShopFragments.cs:32`
- Shop proxy answers 502 `The shop is unreachable.` when the shop is down, and logs the error. `src/Shop/ShopProxy.cs:92`, `src/Shop/ShopProxy.cs:93`
- Shop proxy drops `connection`, `content-length`, `keep-alive`, `proxy-authenticate`, `proxy-connection`, `te`, `trailer`, `transfer-encoding`, `upgrade` from the answer; every other header, `Set-Cookie` and `Location` included, goes back as it came. `src/Shop/ShopProxy.cs:32`, `src/Shop/ShopProxy.cs:103`
- Shop proxy streams the answer and sends no body for `HEAD`. `src/Shop/ShopProxy.cs:88`, `src/Shop/ShopProxy.cs:105`
- Shop fragment fetch sends `accept: text/html`, `x-droplet-location`, the page (shop origin plus raw target) as `referer` and the browser's `cookie` cut down to the shop's. `src/Shop/ShopFragments.cs:31`, `src/Shop/ShopFragments.cs:33`, `src/Shop/ShopFragments.cs:34`
- Shop fragments of a page are fetched concurrently (`Task.WhenAll`). `src/Shop/ShopFragments.cs:20`
- Shop fragment 3xx keeps its `location`. `src/Shop/ShopFragments.cs:50`
- Shop fragment inserted only when 2xx, 500 or 504 and `text/html`. `src/Shop/ShopFragments.cs:52`
- Shop fragment otherwise renders `<p class="shop-unavailable">` with the id HTML-encoded. `src/Shop/ShopFragments.cs:64`
- Shop product lookup reads `/droplets/product-page/_data?slug=` (timeout 10 s) and needs string `id` and `name`. `src/Shop/ShopFragments.cs:71`, `src/Shop/ShopFragments.cs:76`, `src/Shop/ShopFragments.cs:83`
- Shop query is parsed in order with repeated keys kept (`+` as a space). `src/Shop/ShopRequest.cs:48`, `src/Shop/ShopRequest.cs:60`
- Shop `Link` preloads kept only for `preload`/`modulepreload` on the shop origin. `src/Shop/ShopRequest.cs:93`, `src/Shop/ShopRequest.cs:95`
- Shop pages always fetch `toast-center` and `shopping-cart` with `variant=badge`. `src/Pages/ShopPage.cs:37`
- Shop pages answer `cache-control: private, no-store` and every fragment's `Set-Cookie`. `src/Pages/ShopPage.cs:38`, `src/Pages/ShopPage.cs:39`
- Shop page redirect: the first fragment with a `location` answers the page with its status. `src/Pages/ShopPage.cs:41`, `src/Pages/ShopPage.cs:45`
- Gallery passes the whole query to `product-filter` and `product-library`. `src/Pages/Gallery.cshtml.cs:10`
- Product page answers 404 when the product is not found. `src/Pages/Product.cshtml.cs:13`
- Product page comments props are `order`, `page`, `showing` plus `productId`. `src/Pages/Product.cshtml.cs:15`
- Product page props are `slug` plus `v` (when the link had one). `src/Pages/Product.cshtml.cs:18`
- Login page passes `next`. `src/Pages/Login.cshtml.cs:8`
- Admin page passes `view` and `id`. `src/Pages/Admin.cshtml.cs:9`
- Shop layout loads `/shop.css` and `/index.js` from this origin. `src/Pages/Shared/_ShopLayout.cshtml:8`, `src/Pages/Shared/_ShopLayout.cshtml:14`
- Shop layout speculation rules prefetch `/product/*`, eagerness `moderate`. `src/Pages/Shared/_ShopLayout.cshtml:13`
- Shop layout puts the toasts fragment first in the body. `src/Pages/Shared/_ShopLayout.cshtml:17`
- Shop layout prints fragments with `Html.Raw`; everything else Razor encodes. `src/Pages/Shared/_ShopLayout.cshtml:17`, `src/Pages/Shared/_ShopLayout.cshtml:22`
- Tests run the app on Kestrel on a free loopback port, the shop client's handler replaced. `test/FakeShop.cs:48`, `test/FakeShop.cs:54`
- Tests check the location header against a spoofed `Host`, `X-Forwarded-Host`, `Forwarded` and `x-droplet-location`, and that `authorization` is not forwarded. `test/ProxyTests.cs:12`
- Tests check dot segments (`..`, `%2e%2e`, `.`), an absolute-form target and a body over 4 MB are refused before the shop is asked. `test/ProxyTests.cs:52`, `test/ProxyTests.cs:69`
- Tests check a non-HTML answer echoing a `<script>` is never inserted. `test/PageTests.cs:36`
- Typecheck: no `package.json`, so `pnpm typecheck:hosts` does not cover this host. `../../../tests/hosts/typecheck.mjs:19`
- Host test URL is `http://localhost:8014`; `pnpm test:hosts aspnet` runs the shop flow. `../../../tests/hosts/run.mjs:71`
- Host test checks a new visitor gets nobody else's cart or session. `../../../tests/hosts/e2e/shop.spec.ts:288`
