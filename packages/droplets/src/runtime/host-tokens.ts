/**
 * The tokens a build writes where `host` and this server's location are only
 * known per request, and their replacement in every answer that holds them.
 * Only a build that computes either per request needs this module: with
 * `location` and `host` both set, the server bundle never imports it (see
 * `virtual:droplets-config`, which hands it to the app as `tokens`).
 */
import { HostUrlPropsErrorInPrerender } from "./server.ts";

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

/** What the app replaces tokens with: `DropletsAppOptions.tokens`. */
export type HostTokenReplacers = {
  hostTokens: typeof hostTokens;
  tokenNonce: typeof tokenNonce;
  prerenderHost: typeof prerenderHost;
  replaceHostTokens: typeof replaceHostTokens;
  replaceHostTokensInData: typeof replaceHostTokensInData;
};

export const replacers: HostTokenReplacers = { hostTokens, tokenNonce, prerenderHost, replaceHostTokens, replaceHostTokensInData };
