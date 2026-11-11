/**
 * `event.host`, where a droplet renders (the host page), and the droplet's
 * location, where it is served from. Runtime-neutral: the server, the SSR
 * bundle and the build share it.
 *
 * On the server `host` comes from the request the classic way, and `handle`
 * in `hooks.server.ts` may replace it. While prerendering without a known
 * host it is a stand-in whose `origin`, `pathname` and `href` are tokens,
 * swapped for the real host on every request that serves the render.
 *
 * Both come from what a client sends, so only web URLs pass: `http:` or
 * `https:`, without credentials or hash. A `javascript:` or `data:` value
 * never reaches a link, a script URL or a redirect.
 */
import { HostUrlPropsErrorInPrerender } from "./server.ts";
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

/**
 * What stands for `host.origin` and `host.pathname` in a build-time render,
 * and for the droplets server's location (`droplet.origin`, `actionUrl()`,
 * every file the SSR bundle imports): where a render is served from is only
 * known per request. The location token is a URL, so `new URL(token + path)`
 * works on it.
 */
export type HostTokens = { host: string; path: string; location: string };

export type HostTokensInput = { nonce?: string };

/**
 * The tokens of one build. The nonce is random per build and stays on the
 * server, with the renders: content a user wrote cannot hold a token that
 * gets replaced.
 */
export function hostTokens({ nonce = "" }: HostTokensInput = {}): HostTokens {
  const suffix = nonce ? `_${nonce}` : "";
  return {
    host: `__$DROPLET_HOST${suffix}$__`,
    path: `__$DROPLET_PATH${suffix}$__`,
    location: `http://droplets.invalid/__$DROPLET_LOCATION${suffix}$__`,
  };
}

/**
 * What the tokens of a build-time render become for one request: the host
 * it renders on, and the location it is served from (the request's
 * resolved location; never an untrusted header).
 */
export type TokenValues = { host: URL; location: string };

/** A fresh nonce for `hostTokens`: 16 hex characters. */
export function tokenNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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

/**
 * The host of a render made at build without one: `origin`, `pathname` and
 * `href` (and `toString()`, `toJSON()`) give tokens. Any other URL field
 * throws `HostUrlPropsErrorInPrerender`, and the access is kept in
 * `violation`, so a `try`/`catch` in the droplet's code cannot hide it: the
 * build checks it after every render.
 */
export type HostProbe = { host: URL; violation: HostUrlPropsErrorInPrerender | undefined };

/** The fields of a URL that have no token: reading one needs the real host. */
const URL_FIELDS = new Set(["hash", "host", "hostname", "password", "port", "protocol", "search", "searchParams", "username"]);

export type PrerenderHostInput = { droplet: string; entry: string; tokens?: HostTokens };

export function prerenderHost({ droplet, entry, tokens = hostTokens() }: PrerenderHostInput): HostProbe {
  const href = `${tokens.host}${tokens.path}`;
  const allowed: Record<string, unknown> = {
    origin: tokens.host,
    pathname: tokens.path,
    href,
    toString: () => href,
    toJSON: () => href,
    valueOf: () => href,
    constructor: URL,
  };
  const probe: HostProbe = { host: undefined as unknown as URL, violation: undefined };
  probe.host = new Proxy(Object.create(URL.prototype) as URL, {
    get(_target, property) {
      if (typeof property === "symbol") return undefined;
      if (Object.hasOwn(allowed, property)) return allowed[property];
      // Only what a URL has: framework probes (`then`, `__v_skip`, …) are
      // not the droplet reading the host.
      if (!URL_FIELDS.has(property)) return undefined;
      const error = new HostUrlPropsErrorInPrerender(droplet, entry, property);
      probe.violation ??= error;
      throw error;
    },
  });
  return probe;
}

const ESCAPE_HTML: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPE_HTML[char] ?? char);
}

type EscapeRegExpInput = { value: string };

function escapeRegExp({ value }: EscapeRegExpInput): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type SwapInput = {
  text: string;
  values: TokenValues;
  tokens: HostTokens;
  write: (value: string) => string;
};

/**
 * `text` with each token replaced by its value, written by `write`, plain
 * and `encodeURIComponent`d. One pass: a value is never read for tokens again.
 */
function swap({ text, values: { host, location }, tokens, write }: SwapInput): string {
  if (!text.includes("DROPLET_")) return text;
  const values = new Map<string, string>();
  const pairs = [
    [tokens.host, host.origin],
    [tokens.path, host.pathname],
    [tokens.location, location],
  ] as const;
  for (const [token, value] of pairs) {
    values.set(token, write(value));
    values.set(encodeURIComponent(token), write(encodeURIComponent(value)));
  }
  const pattern = new RegExp([...values.keys()].map((value) => escapeRegExp({ value })).join("|"), "g");
  return text.replace(pattern, (token) => values.get(token) ?? token);
}

export type ReplaceHostTokensInput = { html: string; values: TokenValues; tokens?: HostTokens };

/**
 * A build-time render's HTML for one request: tokens replaced, escaped for
 * attributes and text. Only those positions: a token inside an inline
 * `<script>` or `<style>` gets HTML escaping too, not JS or CSS escaping
 * (`origin`, `pathname` and a location cannot carry `<`, `>` or `"`;
 * documented).
 */
export function replaceHostTokens({ html, values, tokens = hostTokens() }: ReplaceHostTokensInput): string {
  return swap({ text: html, values, tokens, write: escapeHtml });
}

export type ReplaceHostTokensInDataInput<T> = { data: T; values: TokenValues; tokens?: HostTokens };

/** Build-time server data (or error) for one request: tokens replaced inside its strings. */
export function replaceHostTokensInData<T>({ data, values, tokens = hostTokens() }: ReplaceHostTokensInDataInput<T>): T {
  if (data === undefined) return data;
  const json = JSON.stringify(data);
  if (json === undefined || !json.includes("DROPLET_")) return data;
  const write = (value: string): string => JSON.stringify(value).slice(1, -1);
  return JSON.parse(swap({ text: json, values, tokens, write })) as T;
}
