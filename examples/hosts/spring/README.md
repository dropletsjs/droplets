# Java (Spring Boot)

A Spring Boot app that embeds droplets. `IndexController` fetches each
fragment from the droplets server with `RestClient` and hands the HTML to a
Thymeleaf template, which loads `/index.js` once. `ShopPages` and
`ShopProxy` run the [shop demo](../../shop) on `/gallery`,
`/product/<slug>`, `/login` and `/admin` through a same-origin proxy.

```bash
docker compose up --build
open http://localhost:8016          # the three Svelte droplets
open http://localhost:8016/gallery  # the shop (demo login: admin / droplets)
```

Set `SHOP_SECRET` and `DROPLETS_SECRET` first (32 or more random characters
each, `openssl rand -hex 32`), in the environment or a `.env` file beside
`docker-compose.yml`: compose refuses to start without them. `pnpm test:hosts`
generates its own for a run.

Compose starts three services: `droplets` (the Svelte example, published on
http://localhost:8000), `shop` (reached only by the host) and `web` (this
app, on http://localhost:8016). Every port is published on `127.0.0.1`.

## Details

Spring Boot 4 on Java 25: Spring MVC on Tomcat (virtual threads),
Thymeleaf, and `RestClient` on the JDK's `HttpClient`. The code is in
`src/main/java/com/example/droplets/`, the templates in
`src/main/resources/templates/`.

### The basic page (`/`)

`IndexController` asks the droplets server for `client`, `ssr-hydrate` and
`ssr-nohydrate` concurrently (a virtual thread each) with the `who` query
(default `Spring Boot`). It fetches from `DROPLETS_INTERNAL_URL` and sends
`DROPLETS_PUBLIC_URL` as `x-droplet-location`, so the fragments point the
browser at the public origin; `templates/index.html` loads `/index.js` from
that origin. The browser loads each droplet's JavaScript from
`http://localhost:8000`, a different origin than the page, so the droplets
server runs with `cors: true` (`examples/frameworks/svelte/droplets.config.ts`).

### The shop demo (`Shop`, `ShopPages`, `ShopProxy`)

- `/index.js`, `/env.js`, `/index.css`, `/droplets/**`, `/assets/**` and
  `/api/**` are proxied to the shop under this origin, so its cookies (the
  cart, the admin session) are first-party and nothing is cross-origin. The
  proxy forwards a fixed list of request headers (none that names a host),
  reads the request body whole up to 4 MB (`413` past it), streams the
  answer back and passes `Set-Cookie` and redirects back untouched.
- Nothing in Spring reads a request body before the proxy:
  `spring.servlet.multipart.enabled=false` and
  `spring.mvc.formcontent.filter.enabled=false` (`application.properties`).
- `x-droplet-location` is the origin of `SHOP_PUBLIC_URL`, written out in the
  environment: never the request's Host. The shop lists that origin in
  `DROPLETS_TRUSTED_ORIGINS`.
- The pages fetch their fragments concurrently with the browser's `Cookie`
  cut down to the shop's own `cart_id` and `shop_admin` (so does the proxy,
  which also refuses a path with a `.` or `..` segment once decoded),
  the page URL as `Referer`, and never follow redirects. Only an HTML answer
  (2xx or 500) is inserted (`th:utext`), into the Thymeleaf templates under
  `templates/shop/`. Their `Set-Cookie` goes back with the page, a droplet's
  redirect is answered as it is, and their `Link` preloads go into its
  `<head>`.
- One `RestClient` serves every visitor, on an `HttpClient` with no cookie
  handler: a shared cookie store would hand one visitor's cart and session
  to the next.
- The layout's stylesheet is `src/main/resources/static/shop.css`, the same
  file in every host but WordPress.
- The contract the pages follow is [`CONTRACT.md`](../../shop/CONTRACT.md).

### Environment

| Variable | Service | Default in compose |
|---|---|---|
| `DROPLETS_INTERNAL_URL` | web | `http://droplets:8000` |
| `DROPLETS_PUBLIC_URL` | web | `${DROPLETS_URL:-http://localhost:8000}` |
| `SHOP_INTERNAL_URL` | web | `http://shop:8300` |
| `SHOP_PUBLIC_URL` | web | `${WEB_URL:-http://localhost:8016}` |
| `DROPLETS_TRUSTED_ORIGINS` | droplets | the droplets URL and this host's URL |
| `DROPLETS_TRUSTED_ORIGINS` | shop | this host's URL |

`WEB_PORT`, `WEB_URL`, `DROPLETS_PORT` and `DROPLETS_URL` move the published
ports and public URLs; `tests/hosts/run.mjs` sets them for
`HOSTS_PORT_BASE`.

### Without Docker

With JDK 25 and Maven 3.9, a droplets server on port 8000 and, for
`/gallery`, the shop on 8300 started with
`DROPLETS_TRUSTED_ORIGINS=http://localhost:8016` (see the
[shop's README](../../shop/README.md)):

```bash
mvn spring-boot:run
```

### Checks

`mvn package` runs `src/test` first (the `Dockerfile` does too, so a failing
test stops the image build). From the repository root:
`pnpm test:hosts spring` (the shop flow in Chromium, against this compose
stack). `pnpm typecheck:hosts` covers the Node hosts only. The guide's page:
[Spring Boot](https://dropletsjs.dev/integrate/hosts/spring/).

## Facts

- Web service publishes `127.0.0.1:${WEB_PORT:-8016}:8016`. `docker-compose.yml:37`
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
- Web env `SHOP_PUBLIC_URL` is `${WEB_URL:-http://localhost:8016}`. `docker-compose.yml:42`
- Dockerfile builds on `maven:3.9-eclipse-temurin-25` with `mvn package` (tests first) and runs the jar on `eclipse-temurin:25-jre` as user 1000. `Dockerfile:1`, `Dockerfile:7`, `Dockerfile:9`, `Dockerfile:12`
- Dockerfile runs `java -jar app.jar`; the app listens on 8016. `Dockerfile:14`, `src/main/resources/application.properties:1`
- Dockerignore leaves out `target/` and IDE files. `.dockerignore:1`
- Maven parent is `spring-boot-starter-parent` 4.1.2, Java 25; dependencies `spring-boot-starter-webmvc`, `spring-boot-starter-thymeleaf`, test `spring-boot-starter-test`; no droplets package. `pom.xml:9`, `pom.xml:21`, `pom.xml:27`, `pom.xml:31`, `pom.xml:35`
- Tomcat runs on virtual threads. `src/main/resources/application.properties:3`
- Multipart parsing and the form-content filter are off: nothing reads a body before the proxy. `src/main/resources/application.properties:7`, `src/main/resources/application.properties:8`
- Request headers may total 32 KB. `src/main/resources/application.properties:11`
- HTTP client is the JDK's `HttpClient`, HTTP/1.1, `Redirect.NEVER`, no cookie handler, connect timeout 5 s. `src/main/java/com/example/droplets/Application.java:33`, `src/main/java/com/example/droplets/Application.java:34`, `src/main/java/com/example/droplets/Application.java:35`
- Shared `RestClient` read timeout 10 s; the basic page's own client 5 s. `src/main/java/com/example/droplets/Application.java:44`, `src/main/java/com/example/droplets/IndexController.java:34`
- Fragments are fetched on a virtual-thread-per-task executor. `src/main/java/com/example/droplets/Application.java:50`, `src/main/java/com/example/droplets/Shop.java:170`
- Basic page `DROPLETS_INTERNAL_URL` and `DROPLETS_PUBLIC_URL` default to `http://localhost:8000`. `src/main/java/com/example/droplets/IndexController.java:45`, `src/main/java/com/example/droplets/IndexController.java:46`
- Basic page droplets are `client`, `ssr-hydrate`, `ssr-nohydrate`. `src/main/java/com/example/droplets/IndexController.java:32`
- Basic page `who` defaults to `Spring Boot`. `src/main/java/com/example/droplets/IndexController.java:53`
- Basic page fragment fetch sends `accept: text/html` and `x-droplet-location: DROPLETS_PUBLIC_URL`, no redirect followed. `src/main/java/com/example/droplets/IndexController.java:75`
- Basic page pastes only a 2xx or 500 `text/html` answer; anything else renders `<p class="error">` with the status, the id escaped (`HtmlUtils.htmlEscape`). `src/main/java/com/example/droplets/IndexController.java:82`, `src/main/java/com/example/droplets/IndexController.java:85`
- Basic page fragment failure is logged and renders a fixed `<p class="error">`: the error names the internal URL. `src/main/java/com/example/droplets/IndexController.java:90`
- Basic page template loads `${dropletsPublicUrl}/index.js`. `src/main/resources/templates/index.html:7`
- Shop footer stack name is `Spring Boot`. `src/main/java/com/example/droplets/Shop.java:37`
- Shop `SHOP_INTERNAL_URL` defaults to `http://localhost:8300`, trailing slashes stripped. `src/main/java/com/example/droplets/Shop.java:83`, `src/main/java/com/example/droplets/Shop.java:87`
- Shop origin is scheme and authority of `SHOP_PUBLIC_URL`, default `http://localhost:8016`. `src/main/java/com/example/droplets/Shop.java:84`, `src/main/java/com/example/droplets/Shop.java:89`
- Shop proxy forwards only `accept`, `accept-language`, `content-type`, `if-none-match`, `origin`, `referer`, `user-agent`, `x-droplet-props`, `x-droplets-build`, plus `cookie` cut down to `cart_id` and `shop_admin`. `src/main/java/com/example/droplets/Shop.java:40`, `src/main/java/com/example/droplets/Shop.java:53`
- Shop proxy and fragment `Referer` use the raw path and query as the browser sent them (`getRequestURI()`, `getQueryString()`). `src/main/java/com/example/droplets/Shop.java:95`
- Shop page query is read from the raw query string, in order, repeated keys kept, a malformed escape left as it was; never `getParameter`. `src/main/java/com/example/droplets/Shop.java:121`
- Shop proxy routes are `/index.js`, `/env.js`, `/index.css`, `/droplets/**`, `/assets/**`, `/api/**`. `src/main/java/com/example/droplets/ShopProxy.java:70`
- Shop proxy methods are `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`. `src/main/java/com/example/droplets/ShopProxy.java:71`
- Shop proxy refuses a path with a `.` or `..` segment, once decoded, with 400 `Bad request.` `src/main/java/com/example/droplets/ShopProxy.java:73`, `src/main/java/com/example/droplets/Shop.java:112`
- Shop proxy URL is concatenated, not resolved: `//elsewhere` stays a path on the shop. `src/main/java/com/example/droplets/ShopProxy.java:80`
- Shop proxy reads the request body whole up to 4 MB before sending it; a declared or actual body over that answers 413 `Payload too large.` `src/main/java/com/example/droplets/ShopProxy.java:39`, `src/main/java/com/example/droplets/ShopProxy.java:90`, `src/main/java/com/example/droplets/ShopProxy.java:94`
- Shop proxy `x-droplet-location` is the `SHOP_PUBLIC_URL` origin, never the request's Host. `src/main/java/com/example/droplets/ShopProxy.java:107`
- Shop proxy sends an empty body only when the request had a `content-type`. `src/main/java/com/example/droplets/ShopProxy.java:115`
- Shop proxy drops the per-hop headers, those the answer's `connection` names, and `content-length`, and re-appends `set-cookie`. `src/main/java/com/example/droplets/ShopProxy.java:45`, `src/main/java/com/example/droplets/ShopProxy.java:123`, `src/main/java/com/example/droplets/ShopProxy.java:132`
- Shop proxy streams the answer; no body for `HEAD`. `src/main/java/com/example/droplets/ShopProxy.java:133`
- Shop proxy answers 502 `The shop is unreachable.` when the shop is down and nothing was sent yet. `src/main/java/com/example/droplets/ShopProxy.java:138`, `src/main/java/com/example/droplets/ShopProxy.java:140`
- Shop fragment fetch sends `accept: text/html`, `x-droplet-location`, the page as `referer` and the browser's `cookie` cut down to the shop's. `src/main/java/com/example/droplets/Shop.java:189`, `src/main/java/com/example/droplets/Shop.java:190`
- Shop fragment 3xx keeps its `location`. `src/main/java/com/example/droplets/Shop.java:200`
- Shop fragment inserted only when 2xx or 500 and `text/html`. `src/main/java/com/example/droplets/Shop.java:203`
- Shop fragment otherwise renders `<p class="shop-unavailable">` with the id escaped (`HtmlUtils.htmlEscape`). `src/main/java/com/example/droplets/Shop.java:215`
- Shop product lookup reads `/droplets/product-page/_data?slug=` and needs string `id` and `name`. `src/main/java/com/example/droplets/Shop.java:221`, `src/main/java/com/example/droplets/Shop.java:235`
- Shop `Link` preloads kept only for `preload`/`modulepreload` on the public origin. `src/main/java/com/example/droplets/Shop.java:260`
- Shop pages always fetch `toast-center` and `shopping-cart` with `variant=badge`, concurrently. `src/main/java/com/example/droplets/ShopPages.java:90`, `src/main/java/com/example/droplets/ShopPages.java:91`
- Shop pages answer `cache-control: private, no-store` and every fragment's `Set-Cookie`. `src/main/java/com/example/droplets/ShopPages.java:96`, `src/main/java/com/example/droplets/ShopPages.java:98`
- Shop page redirect: the first fragment with a `location` answers the page with its status. `src/main/java/com/example/droplets/ShopPages.java:100`
- Shop stylesheet `/shop.css` is served by Spring Boot's static resources from `src/main/resources/static/shop.css`.
- Gallery passes the whole query to `product-filter` and `product-library`. `src/main/java/com/example/droplets/ShopPages.java:39`
- Product page answers 404 when the product is not found. `src/main/java/com/example/droplets/ShopPages.java:46`
- Product page comments props are `order`, `page`, `showing` plus `productId`. `src/main/java/com/example/droplets/ShopPages.java:49`
- Product page props are `slug` plus `v` (when the link had one). `src/main/java/com/example/droplets/ShopPages.java:54`
- Login page passes `next`. `src/main/java/com/example/droplets/ShopPages.java:65`
- Admin page passes `view` and `id`. `src/main/java/com/example/droplets/ShopPages.java:72`
- Shop page templates replace their `<html>` with the layout's `page(main)` fragment and hand it their `<main>`. `src/main/resources/templates/shop/layout.html:2`, `src/main/resources/templates/shop/gallery.html:2`
- Shop layout loads `/shop.css` and `/index.js` from this origin. `src/main/resources/templates/shop/layout.html:7`, `src/main/resources/templates/shop/layout.html:10`
- Shop layout speculation rules prefetch `/product/*`, eagerness `moderate`. `src/main/resources/templates/shop/layout.html:9`
- Shop layout puts the toasts fragment first in the body. `src/main/resources/templates/shop/layout.html:13`
- Unit tests cover the cookie filter, dot segments, the query, the `Link` filter, the escaped note, and the proxy's 400, 413 and 502. `src/test/java/com/example/droplets/ShopTest.java`
- Typecheck: no `package.json`, so `pnpm typecheck:hosts` does not cover this host. `../../../tests/hosts/typecheck.mjs:20`
- Host test URL is `http://localhost:8016`; `pnpm test:hosts spring` runs the shop flow. `../../../tests/hosts/run.mjs:71`
- Host test checks a new visitor gets nobody else's cart or session. `../../../tests/hosts/e2e/shop.spec.ts:288`
