/**
 * `event.cookies`, as in SvelteKit. Runtime-neutral: plain strings in, the
 * `Set-Cookie` values out, added to the response by the app.
 */
import { CookiesInPrerenderError, type Cookies, type CookieSerializeOptions, type ReadonlyCookies } from "./server.ts";

/** RFC 6265 token: the characters a cookie name may have. */
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** What a cookie value may hold once encoded. */
const COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;
/** Domain and path: no separators, no line breaks. */
const ATTRIBUTE = /^[\x20-\x3A\x3C-\x7E]*$/;

function tryDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape: the raw value, as SvelteKit reads it.
    return value;
  }
}

export type ParseCookiesInput = { header: string; decode?: (value: string) => string };

/** The `Cookie` header as name → value; the first of a repeated name wins. */
export function parseCookies({ header, decode = tryDecode }: ParseCookiesInput): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of header.split(";")) {
    const at = pair.indexOf("=");
    if (at < 0) continue;
    const name = pair.slice(0, at).trim();
    if (!name || cookies.has(name)) continue;
    let value = pair.slice(at + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    cookies.set(name, decode(value));
  }
  return cookies;
}

const SAME_SITE = { strict: "Strict", lax: "Lax", none: "None" } as const;
const PRIORITY = { low: "Low", medium: "Medium", high: "High" } as const;

export type SerializeCookieInput = { name: string; value: string; options: CookieSerializeOptions };

/** One `Set-Cookie` value. Throws for a name, value or attribute a header cannot carry. */
export function serializeCookie({ name, value, options }: SerializeCookieInput): string {
  if (!COOKIE_NAME.test(name)) throw new TypeError(`cookie name ${JSON.stringify(name)} is not a valid token`);
  const encoded = (options.encode ?? encodeURIComponent)(value);
  if (!COOKIE_VALUE.test(encoded)) throw new TypeError(`cookie ${name}: the encoded value has characters a cookie cannot carry`);

  let cookie = `${name}=${encoded}`;
  if (options.maxAge !== undefined) {
    if (!Number.isFinite(options.maxAge)) throw new TypeError(`cookie ${name}: maxAge must be a number of seconds`);
    cookie += `; Max-Age=${Math.floor(options.maxAge)}`;
  }
  if (options.domain) {
    if (!ATTRIBUTE.test(options.domain)) throw new TypeError(`cookie ${name}: invalid domain`);
    cookie += `; Domain=${options.domain}`;
  }
  if (!ATTRIBUTE.test(options.path)) throw new TypeError(`cookie ${name}: invalid path`);
  cookie += `; Path=${options.path}`;
  if (options.expires) cookie += `; Expires=${options.expires.toUTCString()}`;
  if (options.httpOnly) cookie += "; HttpOnly";
  if (options.secure) cookie += "; Secure";
  if (options.partitioned) cookie += "; Partitioned";
  if (options.priority) cookie += `; Priority=${PRIORITY[options.priority]}`;
  if (options.sameSite) {
    const sameSite = options.sameSite === true ? "strict" : options.sameSite;
    if (!Object.hasOwn(SAME_SITE, sameSite)) throw new TypeError(`cookie ${name}: sameSite must be "lax", "strict" or "none"`);
    // Browsers drop it: a cross-site cookie must be Secure.
    if (sameSite === "none" && !options.secure) {
      throw new TypeError(`cookie ${name}: sameSite "none" needs secure: true`);
    }
    cookie += `; SameSite=${SAME_SITE[sameSite]}`;
  }
  return cookie;
}

type CheckedOptionsInput = { options: CookieSerializeOptions | undefined };

/** `options`, once `path` is there and absolute: the response may reach the browser through a host, under its URLs. */
function checkedOptions({ options }: CheckedOptionsInput): CookieSerializeOptions {
  if (typeof options?.path !== "string") {
    throw new Error("You must specify a `path` when setting, deleting or serializing cookies");
  }
  if (!options.path.startsWith("/")) {
    throw new Error(`cookie path must be absolute ("/" or "/admin"), got ${JSON.stringify(options.path)}`);
  }
  return options;
}

type IsLoopbackInput = { hostname: string };

/** `localhost` and the loopback addresses: plain HTTP there is a dev server. */
function isLoopback({ hostname }: IsLoopbackInput): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export type CookieJar = {
  cookies: Cookies;
  /** The `Set-Cookie` values recorded so far, in order. */
  setCookies(): string[];
};

/** `url`: the request as the browser reached this server. */
export type CookiesOptions = { request: Request; url: URL };

type OutgoingCookie = { name: string; value: string; expired: boolean; header: string };

type FindLatestInput = { name: string };

/**
 * The cookies of one request. Defaults as in SvelteKit: `httpOnly`,
 * `sameSite: "lax"`, and `secure` except over plain HTTP to `localhost` or
 * a loopback address, judged by `url`.
 */
export function createCookies({ request, url }: CookiesOptions): CookieJar {
  const header = request.headers.get("cookie") ?? "";
  const defaults = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: !(url.protocol === "http:" && isLoopback({ hostname: url.hostname })),
  };
  /** Set in this request, by domain, path and name: the last one wins. */
  const outgoing = new Map<string, OutgoingCookie>();

  function findLatest({ name }: FindLatestInput): OutgoingCookie | undefined {
    let found: OutgoingCookie | undefined;
    for (const cookie of outgoing.values()) if (cookie.name === name) found = cookie;
    return found;
  }

  const cookies: Cookies = {
    get(name, options) {
      const set = findLatest({ name });
      if (set) return set.expired ? undefined : set.value;
      return parseCookies({ header, decode: options?.decode }).get(name);
    },
    getAll(options) {
      const all = parseCookies({ header, decode: options?.decode });
      for (const cookie of outgoing.values()) {
        if (cookie.expired) all.delete(cookie.name);
        else all.set(cookie.name, cookie.value);
      }
      return [...all].map(([name, value]) => ({ name, value }));
    },
    set(name, value, options) {
      const merged = { ...defaults, ...checkedOptions({ options }) };
      const cookieHeader = serializeCookie({ name, value, options: merged });
      const expired = merged.maxAge !== undefined && merged.maxAge <= 0;
      const key = `${merged.domain ?? ""};${merged.path};${name}`;
      outgoing.delete(key);
      outgoing.set(key, { name, value, expired, header: cookieHeader });
    },
    delete(name, options) {
      cookies.set(name, "", { ...checkedOptions({ options }), maxAge: 0 });
    },
    serialize(name, value, options) {
      return serializeCookie({ name, value, options: { ...defaults, ...checkedOptions({ options }) } });
    },
  };
  return { cookies, setCookies: () => [...outgoing.values()].map((cookie) => cookie.header) };
}

export type ReadonlyCookiesInput = { cookies: Cookies };

type RefuseInput = { method: string };

/**
 * The cookies a droplet's `load` and `transform` see: read only. A droplet
 * renders as a host asked for it, maybe from its server; what it sets would
 * reach the browser only if that host passed it on. Cookies are set where a
 * request is the user's own: `handle`, `+server.ts` (and form actions).
 */
export function readonlyCookies({ cookies }: ReadonlyCookiesInput): ReadonlyCookies {
  function refuse({ method }: RefuseInput): () => never {
    return () => {
      throw new Error(
        `cookies.${method}() is not available in a droplet's load or transform: cookies are read there, and set in form actions, handle or +server.ts`,
      );
    };
  }
  return {
    get: (name, options) => cookies.get(name, options),
    getAll: (options) => cookies.getAll(options),
    // Not in the type; there for JavaScript, with the reason.
    ...({ set: refuse({ method: "set" }), delete: refuse({ method: "delete" }), serialize: refuse({ method: "serialize" }) } as object),
  };
}

/** `where` names the render in the error; `record` keeps the error for the build to check. */
export type PrerenderCookiesInput = { where: string; record: (error: Error) => void };

/**
 * The cookies of a build-time render: every method throws
 * `CookiesInPrerenderError` and records it, so a `try`/`catch` cannot hide
 * it from the build.
 */
export function prerenderCookies({ where, record }: PrerenderCookiesInput): Cookies {
  function refuse({ method }: RefuseInput): () => never {
    return () => {
      const error = new CookiesInPrerenderError(where, method);
      record(error);
      throw error;
    };
  }
  return {
    get: refuse({ method: "get" }),
    getAll: refuse({ method: "getAll" }),
    set: refuse({ method: "set" }),
    delete: refuse({ method: "delete" }),
    serialize: refuse({ method: "serialize" }),
  };
}
