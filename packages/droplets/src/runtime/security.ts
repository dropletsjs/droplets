/**
 * What guards the routes that take a body: the `Origin` check against
 * cross-site form submissions, and the size limits. Both answer before
 * `handle`, like SvelteKit's `csrf.checkOrigin` and body size limit.
 */
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { normalizeOrigin, normalizeTrustedOrigins, type BodyLimits } from "../core/config.ts";
import { logger } from "../core/logger.ts";

/** Methods a cross-site form, or a fetch without preflight, can send with a body. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Body types a page on another site can send without a CORS preflight. */
const SIMPLE_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"]);

/** The media type of a request, lowercase and without parameters; `""` without one. */
export function mediaType(request: Request): string {
  const [type = ""] = (request.headers.get("content-type") ?? "").split(";");
  return type.trim().toLowerCase();
}

/**
 * A form submission another site can make the browser send with the user's
 * cookies and no preflight: an unsafe method with a form-urlencoded,
 * multipart or `text/plain` body, as SvelteKit checks it. JSON bodies need a
 * preflight, which CORS already answers.
 */
export function isCrossSiteCapable(request: Request): boolean {
  return UNSAFE_METHODS.has(request.method.toUpperCase()) && SIMPLE_TYPES.has(mediaType(request));
}

/**
 * An unsafe method without a body type: what `fetch(url, { mode: "no-cors",
 * body: new Blob([…]) })` sends from another site, no preflight, cookies
 * included. A handler that calls `request.json()` would read it.
 */
export function isUntyped(request: Request): boolean {
  return UNSAFE_METHODS.has(request.method.toUpperCase()) && mediaType(request) === "";
}

/** Where "Trusting any location" is explained, for the warning `"*"` gets. */
const ANY_LOCATION_DOCS = "https://dropletsjs.dev/guides/security/#trusting-any-location";

/** The warning for a `"*"` in `option`, which trusts any location a request's headers name. */
export function warnAnyLocation(option: string): void {
  logger.warn("framework", `${option}: "*" trusts any forwarded location; see ${ANY_LOCATION_DOCS}`);
}

/** The origins of `DROPLETS_TRUSTED_ORIGINS`, by raw value: parsed once, a bad entry warned about once. */
const fromEnv = new Map<string, string[]>();

/**
 * `trustedOrigins` from the config with `DROPLETS_TRUSTED_ORIGINS`, a
 * comma-separated list read at runtime, added: the hosts can change without
 * a build. An entry that is not an origin is skipped, with a warning.
 */
export function trustedOriginsWith(configured: readonly string[], raw: string | undefined): readonly string[] {
  if (!raw?.trim()) return configured;
  let parsed = fromEnv.get(raw);
  if (!parsed) {
    parsed = [];
    for (const entry of raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)) {
      try {
        parsed.push(...normalizeTrustedOrigins([entry]));
      } catch {
        logger.warn("framework", `DROPLETS_TRUSTED_ORIGINS: ignoring ${JSON.stringify(entry)}, not an origin such as https://shop.example`);
      }
    }
    if (parsed.includes("*")) warnAnyLocation("DROPLETS_TRUSTED_ORIGINS");
    fromEnv.set(raw, parsed);
  }
  return [...new Set([...configured, ...parsed])];
}

/** The locations of `DROPLETS_ORIGIN`, by raw value, as `fromEnv` keeps them. */
const originFromEnv = new Map<string, string[]>();

/**
 * `origin` from the config with `DROPLETS_ORIGIN`, a comma-separated list
 * of locations read at runtime, added. An entry that is not a location is
 * skipped, with a warning.
 */
export function originWith(configured: readonly string[], raw: string | undefined): readonly string[] {
  if (!raw?.trim()) return configured;
  let parsed = originFromEnv.get(raw);
  if (!parsed) {
    parsed = [];
    for (const entry of raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)) {
      try {
        parsed.push(...normalizeOrigin(entry));
      } catch {
        logger.warn(
          "framework",
          `DROPLETS_ORIGIN: ignoring ${JSON.stringify(entry)}, not a location such as https://shop.example or https://shop.example/mfe`,
        );
      }
    }
    if (parsed.includes("*")) warnAnyLocation("DROPLETS_ORIGIN");
    originFromEnv.set(raw, parsed);
  }
  return [...new Set([...configured, ...parsed])];
}

/**
 * Paths whose requests are checked and limited: droplet routes, `+server.ts`
 * and `extra` (the import map's, which answers `POST` too).
 */
export function isGuardedPath(path: string, extra: readonly string[] = []): boolean {
  return path === "/api" || path.startsWith("/api/") || path.startsWith("/droplets/") || extra.includes(path);
}

/** `/api/*` and `_data` answer JSON; fragments and the rest, text. */
function wantsJson(path: string): boolean {
  return path === "/api" || path.startsWith("/api/") || /\/_data\/?$/.test(path);
}

function refuse(c: Context, status: 403 | 413 | 431, message: string): Response {
  return wantsJson(c.req.path) ? c.json({ message }, status) : c.text(message, status);
}

export type OriginCheck = {
  /** Origins allowed besides the server's own, for this request; `"*"` allows all. */
  trustedOrigins: () => readonly string[];
  /** The origins the browser reaches this server at: the request's and its resolved location's. */
  ownOrigins: (c: Context) => string[];
  /** Exact paths checked besides the droplet and `/api` routes. */
  extraPaths?: readonly string[];
};

/**
 * `403` for a cross-site-capable request whose `Origin` is not one of this
 * server's or trusted. A missing `Origin` is refused as well, as SvelteKit
 * does: every browser sends one with such a request. A request with no body
 * type is refused when it has an `Origin` that is not trusted; without one
 * it is not a browser's (a host's server fetching), and passes.
 */
export function originCheck(options: OriginCheck): MiddlewareHandler {
  return async (c, next) => {
    if (!isGuardedPath(c.req.path, options.extraPaths)) return next();
    const formLike = isCrossSiteCapable(c.req.raw);
    if (!formLike && !isUntyped(c.req.raw)) return next();
    const trusted = options.trustedOrigins();
    if (trusted.includes("*")) return next();
    const origin = c.req.header("origin");
    if (!origin && !formLike) return next();
    if (origin && (trusted.includes(origin) || options.ownOrigins(c).includes(origin))) return next();
    return refuse(c, 403, `Cross-site ${c.req.method.toUpperCase()} form submissions are forbidden`);
  };
}

/** The limit for a body of this media type. */
function limitFor(type: string, limits: BodyLimits): number {
  if (type === "application/json" || type.endsWith("+json")) return limits.json;
  if (type === "application/x-www-form-urlencoded" || type === "text/plain") return limits.form;
  return limits.multipart;
}

/**
 * `413` for a body over its type's limit, `431` for an `x-droplet-props`
 * header over its own. A body without a `content-length` is counted as it
 * streams in.
 */
export function sizeLimits(limits: BodyLimits, extraPaths: readonly string[] = []): MiddlewareHandler {
  const tooLarge = (c: Context) => refuse(c, 413, "Payload Too Large");
  const byLimit = new Map<number, MiddlewareHandler>();
  return async (c, next) => {
    if (!isGuardedPath(c.req.path, extraPaths)) return next();
    const props = c.req.header("x-droplet-props");
    if (props !== undefined && props.length > limits.props) {
      return refuse(c, 431, "x-droplet-props is too large; send the props in a POST body");
    }
    const maxSize = limitFor(mediaType(c.req.raw), limits);
    if (!Number.isFinite(maxSize)) return next();
    let limit = byLimit.get(maxSize);
    if (!limit) {
      limit = bodyLimit({ maxSize, onError: tooLarge });
      byLimit.set(maxSize, limit);
    }
    return limit(c, next);
  };
}
