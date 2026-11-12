/**
 * The shop demo (examples/shop) on this host, in Web-standard terms
 * (Request in, Response or HTML out), so the framework only routes to it:
 *
 * - `proxy()`: a same-origin proxy for what the browser asks the shop for
 *   (`/index.js`, `/droplets/*`, `/assets/*`, `/api/*`), so its cookies are
 *   first-party and nothing is cross-origin;
 * - `fragment()`, `product()`, `linkTags()`: what the pages need to fetch
 *   the shop's fragments on the server and compose them.
 *
 * The contract they follow is examples/shop/CONTRACT.md.
 */

export type ShopConfig = {
  /** How this process reaches the shop (`http://shop:8300` in Docker). */
  internalUrl: string;
  /**
   * This host's own public origin. It goes out as `x-droplet-location` on
   * every request, written out in the config: never the client's Host.
   */
  publicUrl: string;
};

/** One fragment fetch, as the page needs it. */
export type Fragment = {
  html: string;
  status: number;
  location: string | null;
  cookies: string[];
  link: string | null;
};

/** What the product page needs to know before it fetches its fragments. */
export type Product = { id: string; slug: string; name: string; category: { slug: string; name: string } };

/** The browser's request, as the shop should see it. */
export type PageRequest = {
  /** The page's path and query, as the browser asked for it. */
  path: string;
  /** The browser's `Cookie` header, passed on as it is. */
  cookie: string | null;
};

/** One preload from a fragment's `Link` header. */
export type Preload = { rel: "preload" | "modulepreload"; href: string; as?: string };

/** What the browser's request may tell the shop; nothing that names a host. `cookie` goes on filtered. */
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
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

/** Statuses that carry no body. */
const NO_BODY = new Set([101, 204, 205, 304]);

/** The shop's own cookies, the only ones it is sent: another app's on this origin stay here. */
const SHOP_COOKIES = ["cart_id", "shop_admin"];

/** The browser's `Cookie` header with the shop's cookies only, or null. */
function shopCookies(header: string | null): string | null {
  const kept: string[] = [];
  for (const pair of (header ?? "").split(";")) {
    if (SHOP_COOKIES.includes(pair.split("=")[0]!.trim())) kept.push(pair.trim());
  }
  return kept.length > 0 ? kept.join("; ") : null;
}

export const escapeHtml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );

/** The query parameters of `query` named in `keys`, in that order. */
export function pick(query: URLSearchParams, keys: string[]): URLSearchParams {
  const picked = new URLSearchParams();
  for (const key of keys) for (const value of query.getAll(key)) picked.append(key, value);
  return picked;
}

export function createShop({ internalUrl, publicUrl }: ShopConfig) {
  const internal = internalUrl.replace(/\/+$/, "");
  const origin = new URL(publicUrl).origin;

  /** Passes one browser request on to the shop, and its answer back untouched. */
  async function proxy(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const headers = new Headers({ "x-droplet-location": origin });
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const cookie = shopCookies(request.headers.get("cookie"));
    if (cookie) headers.set("cookie", cookie);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    try {
      // Concatenated, not resolved: a path like `//elsewhere` stays a path on the shop.
      const upstream = await fetch(internal + url.pathname + url.search, {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        // Streams the body through (Node's fetch wants it said).
        duplex: "half",
      } as RequestInit);
      const out = new Headers();
      upstream.headers.forEach((value, name) => {
        if (!DROPPED_RESPONSE_HEADERS.has(name)) out.set(name, value);
      });
      // Untouched: the shop never sets Domain, so they belong to this origin.
      for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
      const body = request.method === "HEAD" || NO_BODY.has(upstream.status) ? null : upstream.body;
      return new Response(body, { status: upstream.status, headers: out });
    } catch (error) {
      console.error(`[shop proxy] ${request.method} ${url.pathname}:`, error);
      return new Response("The shop is unreachable.", { status: 502, headers: { "content-type": "text/plain" } });
    }
  }

  /**
   * `GET /droplets/<id>?<params>`, with the browser's cookies and this page
   * as the host. Only an HTML answer is a fragment (a 500 carries the
   * droplet's error page); anything else may echo the props, so it is
   * never inserted.
   */
  async function fragment(page: PageRequest, id: string, params = new URLSearchParams()): Promise<Fragment> {
    const url = `${internal}/droplets/${encodeURIComponent(id)}?${params}`;
    const headers: Record<string, string> = { accept: "text/html", "x-droplet-location": origin, referer: origin + page.path };
    const cookie = shopCookies(page.cookie);
    if (cookie) headers["cookie"] = cookie;
    const result: Fragment = { html: "", status: 502, location: null, cookies: [], link: null };
    try {
      const response = await fetch(url, { headers, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) });
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
    const why = result.status === 502 ? "unreachable" : `HTTP ${result.status}`;
    result.html = `<p class="shop-unavailable">The ${escapeHtml(id)} droplet is unavailable (${why}).</p>`;
    return result;
  }

  /** A product's name, category and id, from the product page's public `_data` read. */
  async function product(slug: string): Promise<Product | null> {
    const url = `${internal}/droplets/product-page/_data?${new URLSearchParams({ slug })}`;
    try {
      const response = await fetch(url, {
        headers: { "x-droplet-location": origin, accept: "application/json" },
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { data?: { product?: Partial<Product> } } | null;
      const found = body?.data?.product;
      if (typeof found?.id !== "string" || typeof found.name !== "string" || typeof found.slug !== "string") return null;
      return {
        id: found.id,
        slug: found.slug,
        name: found.name,
        category: { slug: String(found.category?.slug ?? ""), name: String(found.category?.name ?? "") },
      };
    } catch {
      return null;
    }
  }

  /** The fragments' `Link` preloads, parsed: on the shop's (this host's) origin only. */
  function preloads(fragments: Fragment[]): Preload[] {
    const found = new Map<string, Preload>();
    for (const { link } of fragments) {
      for (const part of (link ?? "").split(/,(?=\s*<)/)) {
        const match = /^\s*<([^>]*)>(.*)$/.exec(part);
        if (!match) continue;
        const params = Object.fromEntries(
          match[2]!
            .split(";")
            .map((param) => param.split("=").map((piece) => piece.trim().replace(/^"|"$/g, "")))
            .filter(([key, value]) => key && value),
        ) as Record<string, string>;
        if (params["rel"] !== "preload" && params["rel"] !== "modulepreload") continue;
        let href: URL;
        try {
          href = new URL(match[1]!);
        } catch {
          continue;
        }
        if (href.origin !== origin) continue;
        found.set(`${params["rel"]} ${href.href}`, { rel: params["rel"], href: href.href, as: params["as"] });
      }
    }
    return [...found.values()];
  }

  /** The same preloads, as tags for the page's head. */
  function linkTags(fragments: Fragment[]): string {
    return preloads(fragments)
      .map(({ rel, href, as }) => `<link rel="${rel}" href="${escapeHtml(href)}"${as ? ` as="${escapeHtml(as)}"` : ""}>`)
      .join("\n");
  }

  return { origin, proxy, fragment, product, preloads, linkTags };
}
