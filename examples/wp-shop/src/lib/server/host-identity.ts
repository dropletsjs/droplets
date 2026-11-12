/**
 * Host-asserted identity: the WordPress account is the only login.
 *
 * When a logged-in WordPress user who can `manage_options` causes a request
 * to wp-shop (a fragment the plugin fetches on the server, or a request it
 * proxies under `/droplets/` or `/api/`), the plugin adds
 *
 *   x-wp-shop-user: base64url(JSON {sub, role, exp, method, path, aud}).base64url(HMAC-SHA256)
 *
 * keyed with WP_SHOP_HOST_SECRET, which only the plugin and wp-shop hold.
 * It lives at most 60 seconds and names the one request it was made for:
 * its method, and its path and query on wp-shop. `aud` says which way it
 * goes: `wp-shop` for the plugin's, `wordpress` for wp-shop's own writes
 * back (`x-wp-shop-service`, see wp.ts), so one is never taken for the
 * other. A write back also names its body, `body`: the SHA-256 (hex) of
 * the bytes sent, so a signed header moves no other body. The writes back
 * have a key of their own, WP_SHOP_SERVICE_SECRET: the two must differ
 * (`secretPair`). The plugin strips any `x-wp-shop-user` the browser sent.
 *
 * Reading one, in this order: a size cap and the shape, then the MAC
 * (`crypto.subtle.verify`) before anything is parsed, then plain
 * `JSON.parse`, own keys copied into an object without a prototype, each
 * checked for its type, then `exp`, the method, the path, `aud` and the
 * body. Anything else is no identity at all: the request is a visitor's.
 *
 * Plain functions with the secret passed in, so the tests drive them;
 * hooks.server.ts calls them with the environment's.
 */

export const ASSERTION_HEADER = "x-wp-shop-user";
/** wp-shop's writes back to WordPress's REST API carry this one. */
export const SERVICE_HEADER = "x-wp-shop-service";

/** The longest header read; anything longer is not looked at. */
export const MAX_ASSERTION_BYTES = 1024;
/** An assertion is good for at most this long after it was made. */
export const MAX_LIFETIME_S = 60;
/** Clock drift allowed between WordPress and wp-shop. */
const SKEW_S = 5;
export const MIN_SECRET_BYTES = 32;

export type Audience = "wp-shop" | "wordpress";

export type Claims = {
  /** The WordPress user's login. */
  sub: string;
  /** What the plugin vouches for: a user who can `manage_options`. */
  role: "administrator";
  /** Expiry, in seconds since the epoch. */
  exp: number;
  method: string;
  /** The path and query on the receiving server, as sent. */
  path: string;
  aud: Audience;
  /** The SHA-256 of the request body, hex: on wp-shop's writes back only. */
  body?: string;
};

/** Who `locals.admin` is: the WordPress account behind the request. */
export type HostAdmin = { name: string; role: "administrator" };

const encoder = new TextEncoder();

/** A secret when it is long enough to sign with; without it nothing verifies. */
export const usableSecret = (secret: string | undefined): string | undefined =>
  secret && encoder.encode(secret).length >= MIN_SECRET_BYTES ? secret : undefined;

/** Why both secrets are refused, when they are the same value. */
export const SAME_SECRETS =
  "WP_SHOP_HOST_SECRET and WP_SHOP_SERVICE_SECRET are the same value: each direction needs its own secret. " +
  "No WordPress admin is recognized and nothing is written back until they differ.";

/**
 * The two secrets: `host` (WP_SHOP_HOST_SECRET, WordPress → wp-shop,
 * `x-wp-shop-user`) and `service` (WP_SHOP_SERVICE_SECRET, wp-shop →
 * WordPress, `x-wp-shop-service`), each when usable. The same value for
 * both is refused: neither is used, and `error` says why.
 */
export type SecretPair = { host: string | undefined; service: string | undefined; error: string | null };

export function secretPair(host: string | undefined, service: string | undefined): SecretPair {
  if (host && service && host === service) return { host: undefined, service: undefined, error: SAME_SECRETS };
  return { host: usableSecret(host), service: usableSecret(service), error: null };
}

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keys.set(secret, key);
  }
  return key;
}

const toBase64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const fromBase64url = (text: string) => new Uint8Array(Buffer.from(text, "base64url"));

/** `<payload>.<mac>`: base64url of 1 to 1000 characters, a dot, the 43 of an HMAC-SHA256. */
const SHAPE = /^([A-Za-z0-9_-]{1,1000})\.([A-Za-z0-9_-]{43})$/;
/** A WordPress login (`sanitize_user`, strict): letters, digits, space, `_ . @ -`. */
const LOGIN = /^[A-Za-z0-9 _.@-]{1,60}$/;
const METHOD = /^[A-Z]{3,7}$/;
/** A path and query, as a request line has it: starts with one `/`. */
const PATH = /^\/(?![/\\])[\x21-\x7e]{0,2047}$/;
/** A SHA-256, hex. */
const BODY = /^[0-9a-f]{64}$/;
const CLAIM_KEYS = ["sub", "role", "exp", "method", "path", "aud", "body"] as const;

/** Signs `claims`: what the plugin does (host secret), and wp-shop for its writes back (service secret). */
export async function signAssertion(claims: Claims, secret: string): Promise<string> {
  const payload = toBase64url(encoder.encode(JSON.stringify(claims)));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64url(new Uint8Array(mac))}`;
}

/** The SHA-256 of `text`, hex: what a write's `body` claim holds. */
export async function bodyDigest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Buffer.from(hash).toString("hex");
}

/** What the request must be for the assertion to count; `body` is the received body's digest, for a write. */
export type Expected = { aud: Audience; method: string; path: string; body?: string; now?: number };

/** The claims of a valid assertion for this request, or `null`. Never throws. */
export async function verifyAssertion(
  header: string | null | undefined,
  secret: string | undefined,
  expected: Expected,
): Promise<Claims | null> {
  const key = usableSecret(secret);
  if (!key || typeof header !== "string" || header.length > MAX_ASSERTION_BYTES) return null;
  const match = SHAPE.exec(header);
  if (!match) return null;
  const [, payload, mac] = match as unknown as [string, string, string];

  // The MAC first: nothing of the payload is decoded before it holds.
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", await hmacKey(key), fromBase64url(mac), encoder.encode(payload));
  } catch {
    return null;
  }
  if (!valid) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64url(payload)));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  // Own keys only, into an object without a prototype: a `__proto__` key
  // in the JSON is data, never a prototype, and nothing is inherited.
  const claims: Record<string, unknown> = Object.create(null);
  for (const name of CLAIM_KEYS) {
    if (Object.hasOwn(parsed, name)) claims[name] = (parsed as Record<string, unknown>)[name];
  }
  const { sub, role, exp, method, path, aud, body } = claims;
  if (typeof sub !== "string" || !LOGIN.test(sub)) return null;
  if (role !== "administrator") return null;
  if (typeof exp !== "number" || !Number.isSafeInteger(exp)) return null;
  if (typeof method !== "string" || !METHOD.test(method)) return null;
  if (typeof path !== "string" || !PATH.test(path)) return null;
  if (aud !== "wp-shop" && aud !== "wordpress") return null;
  if (body !== undefined && (typeof body !== "string" || !BODY.test(body))) return null;

  const now = Math.floor((expected.now ?? Date.now()) / 1000);
  if (exp <= now || exp > now + MAX_LIFETIME_S + SKEW_S) return null;
  if (method !== expected.method.toUpperCase() || path !== expected.path || aud !== expected.aud) return null;
  // The body claim and the body received: both or neither, and the same.
  if ((body ?? null) !== (expected.body ?? null)) return null;
  return { sub, role, exp, method, path, aud, ...(typeof body === "string" ? { body } : {}) };
}

/** The admin a verified assertion names. */
export const adminOf = (claims: Claims): HostAdmin => ({ name: claims.sub, role: claims.role });

/** The path and query a request was sent to, as the assertion binds it. */
export const requestPath = (url: URL) => `${url.pathname}${url.search}`;
