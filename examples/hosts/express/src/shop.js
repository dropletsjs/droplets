/**
 * The shop demo (examples/shop) on this host, beside the basic page:
 *
 * - a same-origin proxy for what the browser asks the shop for (`/index.js`,
 *   `/droplets/*`, `/assets/*`, `/api/*`), so its cookies are first-party
 *   and nothing is cross-origin;
 * - four pages (`/gallery`, `/product/:slug`, `/login`, `/admin`) that fetch
 *   the shop's fragments on the server and compose them in one layout.
 *
 * The contract they follow is examples/shop/CONTRACT.md.
 */
import { Readable } from "node:stream";
import express, { Router } from "express";

/** The stack this host is, in the footer: the one thing that differs between hosts. */
const STACK = "Express 5";

/** What the browser's request may tell the shop; nothing that names a host. */
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "cookie",
  "if-none-match",
  "origin",
  "referer",
  "user-agent",
  "x-droplet-props",
  "x-droplets-build",
];

/** Per hop, or no longer true once fetch has decoded the body. */
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "set-cookie",
  "transfer-encoding",
]);

const PROXIED = ["/index.js", "/droplets", "/assets", "/api"];

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

/** The query parameters of `query` named in `keys`, in that order. */
const pick = (query, keys) => {
  const picked = new URLSearchParams();
  for (const key of keys) for (const value of query.getAll(key)) picked.append(key, value);
  return picked;
};

/**
 * `internalUrl`: how this process reaches the shop (`http://shop:8300` in
 * Docker). `publicUrl`: this host's own public origin. It goes out as
 * `x-droplet-location` on every request, written out here: never the
 * client's Host.
 */
export function shop({ internalUrl, publicUrl }) {
  const internal = internalUrl.replace(/\/+$/, "");
  const origin = new URL(publicUrl).origin;
  const router = Router();

  // ---- The proxy --------------------------------------------------------

  async function proxy(req, res) {
    const headers = new Headers({ "x-droplet-location": origin });
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = req.get(name);
      if (value) headers.set(name, value);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    try {
      // Concatenated, not resolved: a path like `//elsewhere` stays a path on the shop.
      const upstream = await fetch(internal + req.originalUrl, {
        method: req.method,
        headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: "half",
        redirect: "manual",
      });
      res.status(upstream.status);
      upstream.headers.forEach((value, name) => {
        if (!DROPPED_RESPONSE_HEADERS.has(name)) res.setHeader(name, value);
      });
      // Untouched: the shop never sets Domain, so they belong to this origin.
      const cookies = upstream.headers.getSetCookie();
      if (cookies.length > 0) res.setHeader("set-cookie", cookies);
      if (!upstream.body || req.method === "HEAD") return res.end();
      Readable.fromWeb(upstream.body).pipe(res);
    } catch (error) {
      console.error(`[shop proxy] ${req.method} ${req.path}:`, error);
      if (!res.headersSent) res.status(502).type("text").send("The shop is unreachable.");
      else res.destroy();
    }
  }
  for (const path of PROXIED) router.use(path, proxy);

  // ---- Fragments --------------------------------------------------------

  /** The browser's request, as the shop should see it: its cookies, this page as the host. */
  const fragmentHeaders = (req) => {
    const headers = { accept: "text/html", "x-droplet-location": origin, referer: origin + req.originalUrl };
    const cookie = req.get("cookie");
    if (cookie) headers.cookie = cookie;
    return headers;
  };

  /**
   * `GET /droplets/<id>?<params>` → `{ html, status, location, cookies, link }`.
   * Only an HTML answer is a fragment (a 500 carries the droplet's error
   * page); anything else may echo the props, so it is never inserted.
   */
  async function fragment(req, id, params = new URLSearchParams()) {
    const url = `${internal}/droplets/${encodeURIComponent(id)}?${params}`;
    /** @type {{ html: string, status: number, location: string | null, cookies: string[], link: string | null }} */
    const result = { html: "", status: 502, location: null, cookies: [], link: null };
    try {
      const response = await fetch(url, { headers: fragmentHeaders(req), redirect: "manual" });
      result.status = response.status;
      result.cookies = response.headers.getSetCookie();
      result.link = response.headers.get("link");
      if (response.status >= 300 && response.status < 400) {
        result.location = response.headers.get("location");
      } else if (
        (response.ok || response.status === 500) &&
        (response.headers.get("content-type") ?? "").startsWith("text/html")
      ) {
        result.html = await response.text();
        return result;
      }
      await response.body?.cancel();
    } catch (error) {
      console.error(`[shop] ${id}:`, error);
    }
    result.html = `<p class="shop-unavailable">The ${escapeHtml(id)} droplet is unavailable (${result.status === 502 ? "unreachable" : `HTTP ${result.status}`}).</p>`;
    return result;
  }

  /** A product's name, category and id, from the product page's public `_data` read. */
  async function product(slug) {
    const url = `${internal}/droplets/product-page/_data?${new URLSearchParams({ slug })}`;
    try {
      const response = await fetch(url, { headers: { "x-droplet-location": origin, accept: "application/json" }, redirect: "manual" });
      if (!response.ok) return null;
      const body = /** @type {any} */ (await response.json());
      const found = body?.data?.product;
      return typeof found?.id === "string" && typeof found?.name === "string" ? found : null;
    } catch {
      return null;
    }
  }

  /** The fragments' `Link` preloads, as tags for the page's head: on the shop's origin only. */
  function linkTags(fragments) {
    const tags = new Set();
    for (const { link } of fragments) {
      for (const part of (link ?? "").split(/,(?=\s*<)/)) {
        const match = /^\s*<([^>]*)>(.*)$/.exec(part);
        if (!match) continue;
        const params = Object.fromEntries(
          match[2]
            .split(";")
            .map((param) => param.split("=").map((piece) => piece.trim().replace(/^"|"$/g, "")))
            .filter(([key, value]) => key && value),
        );
        if (params.rel !== "preload" && params.rel !== "modulepreload") continue;
        let href;
        try {
          href = new URL(match[1]);
        } catch {
          continue;
        }
        if (href.origin !== origin) continue;
        const as = params.as ? ` as="${escapeHtml(params.as)}"` : "";
        tags.add(`<link rel="${params.rel}" href="${escapeHtml(href.href)}"${as}>`);
      }
    }
    return [...tags].join("\n");
  }

  // ---- The layout -------------------------------------------------------

  function layout({ title, current, head, toasts, cart, body }) {
    const nav = [
      ["/gallery", "Gallery"],
      ["/admin", "Admin"],
    ]
      .map(([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${label}</a>`)
      .join("");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Droplets Shop on ${STACK}</title>
<link rel="stylesheet" href="/shop.css">
${head}
<script type="speculationrules">{"prefetch":[{"where":{"href_matches":"/product/*"},"eagerness":"moderate"}]}</script>
<script type="module" src="/index.js"></script>
</head>
<body class="shop">
${toasts}
<header class="shop-header"><div class="shop-wrap">
<a class="shop-logo" href="/gallery"><span aria-hidden="true">◆</span> Droplets Shop</a>
<nav class="shop-nav" aria-label="Shop">${nav}</nav>
<div class="shop-cart">${cart}</div>
</div></header>
<main class="shop-main shop-wrap">
${body}
</main>
<footer class="shop-footer"><div class="shop-wrap">
<p class="shop-stack">${STACK}</p>
<p>Droplets demo shop · host: ${STACK} · droplets: &lt;djs-shop&gt;</p>
<p><a href="/gallery">Gallery</a> · <a href="/admin">Admin</a> · <a href="/">The Svelte example</a></p>
</div></footer>
</body>
</html>
`;
  }

  /**
   * Fetches the toasts (first in the body), the header's cart and the page's
   * fragments, then answers: a
   * droplet's redirect as it is, otherwise the page, with every
   * `Set-Cookie` the fragments sent.
   */
  async function render(req, res, { title, current, status = 200, fragments: wanted, body }) {
    const [toasts, cart, ...fragments] = await Promise.all([
      fragment(req, "toast-center"),
      fragment(req, "shopping-cart", new URLSearchParams({ variant: "badge" })),
      ...wanted.map(([id, params]) => fragment(req, id, params)),
    ]);
    const all = [toasts, cart, ...fragments];
    res.set("cache-control", "private, no-store");
    for (const { cookies } of all) for (const cookie of cookies) res.append("set-cookie", cookie);
    const redirect = all.find((result) => result.location);
    if (redirect) return res.status(redirect.status).location(redirect.location).end();
    res
      .status(status)
      .type("html")
      .send(layout({ title, current, head: linkTags(all), toasts: toasts.html, cart: cart.html, body: body(fragments.map((f) => f.html)) }));
  }

  const queryOf = (req) => new URLSearchParams(req.originalUrl.split("?")[1] ?? "");

  // ---- Pages ------------------------------------------------------------

  router.get("/shop.css", express.static(new URL("../public", import.meta.url).pathname));

  router.get("/gallery", (req, res) => {
    // The whole query to both: the shop drops what a droplet does not take.
    const query = queryOf(req);
    return render(req, res, {
      title: "Gallery",
      current: "/gallery",
      fragments: [
        ["product-filter", query],
        ["product-library", query],
      ],
      body: ([filter, library]) => `<section class="shop-hero">
<h1>Everything a demo shop needs.</h1>
<p>Rendered by six frameworks, embedded by ${STACK}.</p>
</section>
<div class="shop-gallery">
<aside>${filter}</aside>
<div>${library}</div>
</div>`,
    });
  });

  router.get("/product/:slug", async (req, res) => {
    const found = await product(req.params.slug);
    if (!found) {
      return render(req, res, {
        title: "Not found",
        current: null,
        status: 404,
        fragments: [],
        body: () => `<div class="shop-narrow shop-notice"><h1>Not found</h1><p>This product does not exist.</p><p><a href="/gallery">Back to the gallery</a></p></div>`,
      });
    }
    const comments = pick(queryOf(req), ["order", "page", "showing"]);
    comments.set("productId", found.id);
    // `v`, when the link had one: the shop serves its build's page for the
    // current version and redirects an old one to this URL without it.
    const pageProps = pick(queryOf(req), ["v"]);
    pageProps.set("slug", found.slug);
    const category = found.category ?? {};
    return render(req, res, {
      title: found.name,
      current: null,
      fragments: [
        ["product-page", pageProps],
        ["product-comments", comments],
      ],
      body: ([page, list]) => `<nav class="shop-crumbs" aria-label="Breadcrumb">
<a href="/gallery">Gallery</a> ›
<a href="/gallery?${escapeHtml(new URLSearchParams({ category: String(category.slug ?? "") }))}">${escapeHtml(category.name ?? "")}</a> ›
<span aria-current="page">${escapeHtml(found.name)}</span>
</nav>
${page}
<section class="shop-comments">${list}</section>`,
    });
  });

  router.get("/login", (req, res) =>
    render(req, res, {
      title: "Log in",
      current: null,
      fragments: [["login", pick(queryOf(req), ["next"])]],
      body: ([login]) => `<div class="shop-narrow">${login}</div>`,
    }),
  );

  router.get("/admin", (req, res) =>
    render(req, res, {
      title: "Admin",
      current: "/admin",
      fragments: [["product-admin", pick(queryOf(req), ["view", "id"])]],
      body: ([admin]) => admin,
    }),
  );

  return router;
}
