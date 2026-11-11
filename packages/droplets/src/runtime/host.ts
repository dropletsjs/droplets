/**
 * `event.host`, where a droplet renders (the host page), and the droplet's
 * location, where it is served from. Runtime-neutral: the server, the SSR
 * bundle and the build share it.
 *
 * On the server `host` comes from the request the classic way, and `handle`
 * in `hooks.server.ts` may replace it. While prerendering without a known
 * host it is a stand-in of tokens (`host-tokens.ts`).
 *
 * Both come from what a client sends, so only web URLs pass: `http:` or
 * `https:`, without credentials or hash. A `javascript:` or `data:` value
 * never reaches a link, a script URL or a redirect.
 */
import type { HostTokens } from "./host-tokens.ts";
import { isLocationPrefix, webUrl, withinTrusted } from "./web-url.ts";

export { webUrl, withinTrusted };

export type ParseHostInput = { value: unknown };

/** A host from a string or a URL: a web URL (see `webUrl`), or `null`. */
export function parseHost({ value }: ParseHostInput): URL | null {
  return webUrl({ value });
}

type WithPrefixInput = { origin: string; prefix: string | undefined };

/**
 * `origin` with `prefix`, without a trailing slash: `https://shop.example/mfe`.
 * `origin` alone when the prefix is missing, is not an `isLocationPrefix`,
 * or would leave the origin once joined.
 */
function withPrefix({ origin, prefix }: WithPrefixInput): string {
  if (prefix === undefined || !isLocationPrefix({ prefix })) return origin;
  const url = webUrl({ value: `${origin}${prefix}` });
  if (!url || url.origin !== origin || url.search !== "" || !isLocationPrefix({ prefix: url.pathname })) return origin;
  return `${origin}${url.pathname.replace(/\/+$/, "")}`;
}

type ParseLocationInput = { value: unknown };

/**
 * Where a droplets server is reached, from a URL: its origin and the path
 * prefix it is served under (`https://shop.example/mfe`), without a
 * trailing slash, query or hash. `null` unless it is a web URL; a path that
 * is no valid prefix is dropped (see `withPrefix`).
 */
function parseLocation({ value }: ParseLocationInput): string | null {
  const url = webUrl({ value });
  return url ? withPrefix({ origin: url.origin, prefix: url.pathname }) : null;
}

/** The headers that can name where this server is reached, in the order they are tried. */
export type LocationSource = "x-droplet-location" | "forwarded" | "x-forwarded-host";

/** One location a request's headers name, and the header that named it. */
export type HeaderLocation = { source: LocationSource; location: string };

/** A host as a proxy writes it: a name or an IP literal, and a port. Nothing that a URL would read as more. */
const AUTHORITY = /^(?:[a-z0-9_.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

type ForwardedOriginInput = { proto: string; host: string | undefined };

function forwardedOrigin({ proto, host }: ForwardedOriginInput): string | null {
  if (!host || !AUTHORITY.test(host)) return null;
  return webUrl({ value: `${proto}://${host}` })?.origin ?? null;
}

export type HeaderLocationsInput = { headers: Headers; requestUrl: URL };

/**
 * The locations this request's headers name, in order: `x-droplet-location`
 * (one URL, its path the prefix); the first element of RFC 7239
 * `Forwarded` (`proto` and `host`); the first `X-Forwarded-Proto` and
 * `X-Forwarded-Host`, with `X-Forwarded-Port` when the host has none. The
 * last two take their prefix from `X-Forwarded-Prefix`. First values only:
 * the first proxy wrote them, the ones after it only appended. A header
 * that does not parse is left out. None of them is trusted yet.
 */
export function headerLocations({ headers, requestUrl }: HeaderLocationsInput): HeaderLocation[] {
  const found: HeaderLocation[] = [];
  const sent = headers.get("x-droplet-location");
  const named = sent === null || sent.includes(",") ? null : parseLocation({ value: sent.trim() });
  if (named) found.push({ source: "x-droplet-location", location: named });

  const protocol = requestUrl.protocol.replace(/:$/, "");
  const prefix = firstValue({ value: headers.get("x-forwarded-prefix") });
  const forwarded = headers.get("forwarded");
  if (forwarded) {
    const { host, proto } = parseForwarded({ header: forwarded });
    const origin = forwardedOrigin({ proto: proto ?? protocol, host });
    if (origin) found.push({ source: "forwarded", location: withPrefix({ origin, prefix }) });
  }
  const forwardedHost = firstValue({ value: headers.get("x-forwarded-host") });
  if (forwardedHost) {
    const port = firstValue({ value: headers.get("x-forwarded-port") });
    const withPort =
      port && /^\d{1,5}$/.test(port) && Number(port) <= 65535 && !/:\d+$/.test(forwardedHost) ? `${forwardedHost}:${port}` : forwardedHost;
    const proto = firstValue({ value: headers.get("x-forwarded-proto") }) ?? protocol;
    const origin = forwardedOrigin({ proto, host: withPort });
    if (origin) found.push({ source: "x-forwarded-host", location: withPrefix({ origin, prefix }) });
  }
  return found;
}

type Forwarded = { host?: string; proto?: string };

type ParseForwardedInput = { header: string };

/** `host` and `proto` of the first element of an RFC 7239 `Forwarded` header. */
function parseForwarded({ header }: ParseForwardedInput): Forwarded {
  const first = header.split(",")[0] ?? "";
  const found: Forwarded = {};
  for (const pair of first.split(";")) {
    const at = pair.indexOf("=");
    if (at < 0) continue;
    const name = pair.slice(0, at).trim().toLowerCase();
    const value = pair
      .slice(at + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
    if (name === "host" || name === "proto") found[name] = value;
  }
  return found;
}

type FirstValueInput = { value: string | null };

/** The first value of a header a chain of proxies may have appended to. */
function firstValue({ value }: FirstValueInput): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first ? first : undefined;
}

export type HostFromHeadersInput = { headers: Headers; location: URL };

/**
 * The host page when the request body names none: its `Origin`, else
 * `location`, where this server is reached (an origin only: the path is
 * `/`). `Origin` must be a web URL, `null` is skipped.
 */
export function hostFromHeaders({ headers, location }: HostFromHeadersInput): URL {
  const origin = headers.get("origin");
  if (origin && origin !== "null") {
    const url = webUrl({ value: origin });
    if (url) return new URL(url.origin);
  }
  return new URL(location.origin);
}

export type FixedHostInput = { fixed: string; reported: URL | null };

/**
 * `event.host` under `host` of the config: that origin, with the reported
 * page's path and query when the page is on it; the origin alone for any
 * other page or none. `Origin` is never read.
 */
export function fixedHost({ fixed, reported }: FixedHostInput): URL {
  const url = new URL(fixed);
  if (reported?.origin !== url.origin) return url;
  // Set, never joined: a path like `//evil.example` stays a path.
  url.pathname = reported.pathname;
  url.search = reported.search;
  return url;
}

export type FixedPrerenderHostInput = { fixed: string; tokens?: HostTokens | undefined };

/**
 * The host of a render made at build for `host` of the config: a real URL
 * of that origin, so `hostname`, `protocol` and `port` read as they are and
 * `search` and `hash` are empty. Its page is not known: with `tokens`,
 * `pathname` and `href` are the path token, replaced per request.
 */
export function fixedPrerenderHost({ fixed, tokens }: FixedPrerenderHostInput): URL {
  const url = new URL(fixed);
  if (!tokens) return url;
  const href = `${url.origin}${tokens.path}`;
  const overrides: Record<string, unknown> = {
    pathname: tokens.path,
    href,
    toString: () => href,
    toJSON: () => href,
    valueOf: () => href,
  };
  return new Proxy(url, {
    get(target, property) {
      if (typeof property === "string" && Object.hasOwn(overrides, property)) return overrides[property];
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
