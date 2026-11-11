/**
 * What guards the routes that take a body: the `Origin` check against
 * cross-site form submissions, and the size limits. Both answer before
 * `handle`, like SvelteKit's `csrf.checkOrigin` and body size limit.
 */
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { normalizeOrigin, normalizeTrustedOrigins, type BodyLimits } from "../core/config.ts";
import type { DevLog } from "./dev-log.ts";

/** Methods a cross-site form, or a fetch without preflight, can send with a body. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Body types a page on another site can send without a CORS preflight. */
const SIMPLE_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"]);

export type MediaTypeInput = { request: Request };

/** The media type of a request, lowercase and without parameters; `""` without one. */
export function mediaType({ request }: MediaTypeInput): string {
  const [type = ""] = (request.headers.get("content-type") ?? "").split(";");
  return type.trim().toLowerCase();
}

export type IsCrossSiteCapableInput = { request: Request };

/**
 * A form submission another site can make the browser send with the user's
 * cookies and no preflight: an unsafe method with a form-urlencoded,
 * multipart or `text/plain` body, as SvelteKit checks it. JSON bodies need a
 * preflight, which CORS already answers.
 */
export function isCrossSiteCapable({ request }: IsCrossSiteCapableInput): boolean {
  return UNSAFE_METHODS.has(request.method.toUpperCase()) && SIMPLE_TYPES.has(mediaType({ request }));
}

type IsUntypedInput = { request: Request };

/**
 * An unsafe method without a body type: what `fetch(url, { mode: "no-cors",
 * body: new Blob([…]) })` sends from another site, no preflight, cookies
 * included. A handler that calls `request.json()` would read it.
 */
function isUntyped({ request }: IsUntypedInput): boolean {
  return UNSAFE_METHODS.has(request.method.toUpperCase()) && mediaType({ request }) === "";
}

/** The origins of `DROPLETS_TRUSTED_ORIGINS`, by raw value: parsed once, a bad entry warned about once. */
const fromEnv = new Map<string, string[]>();

export type TrustedOriginsWithInput = { configured: readonly string[]; raw: string | undefined; devLog?: DevLog | undefined };

/**
 * `trustedOrigins` from the config with `DROPLETS_TRUSTED_ORIGINS`, a
 * comma-separated list read at runtime, added: the hosts can change without
 * a build. An entry that is not an origin is skipped, with a warning under `vite dev`.
 */
export function trustedOriginsWith({ configured, raw, devLog }: TrustedOriginsWithInput): readonly string[] {
  if (!raw?.trim()) return configured;
  let parsed = fromEnv.get(raw);
  if (!parsed) {
    parsed = [];
    for (const entry of raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)) {
      try {
        parsed.push(...normalizeTrustedOrigins({ origins: [entry] }));
      } catch {
        devLog?.badEnvEntry({ variable: "DROPLETS_TRUSTED_ORIGINS", entry });
      }
    }
    if (parsed.includes("*")) devLog?.anyLocation({ option: "DROPLETS_TRUSTED_ORIGINS" });
    fromEnv.set(raw, parsed);
  }
  return [...new Set([...configured, ...parsed])];
}

/** The locations of `DROPLETS_ORIGIN`, by raw value, as `fromEnv` keeps them. */
const originFromEnv = new Map<string, string[]>();

export type OriginWithInput = { configured: readonly string[]; raw: string | undefined; devLog?: DevLog | undefined };

/**
 * `origin` from the config with `DROPLETS_ORIGIN`, a comma-separated list
 * of locations read at runtime, added. An entry that is not a location is
 * skipped, with a warning under `vite dev`.
 */
export function originWith({ configured, raw, devLog }: OriginWithInput): readonly string[] {
  if (!raw?.trim()) return configured;
  let parsed = originFromEnv.get(raw);
  if (!parsed) {
    parsed = [];
    for (const entry of raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)) {
      try {
        parsed.push(...normalizeOrigin({ value: entry }));
      } catch {
        devLog?.badEnvEntry({ variable: "DROPLETS_ORIGIN", entry });
      }
    }
    if (parsed.includes("*")) devLog?.anyLocation({ option: "DROPLETS_ORIGIN" });
    originFromEnv.set(raw, parsed);
  }
  return [...new Set([...configured, ...parsed])];
}

type IsGuardedPathInput = { path: string; extra?: readonly string[] };

/**
 * Paths whose requests are checked and limited: droplet routes, `+server.ts`
 * and `extra` (the import map's, which answers `POST` too).
 */
function isGuardedPath({ path, extra = [] }: IsGuardedPathInput): boolean {
  return path === "/api" || path.startsWith("/api/") || path.startsWith("/droplets/") || extra.includes(path);
}

type WantsJsonInput = { path: string };

/** `/api/*` and `_data` answer JSON; fragments and the rest, text. */
function wantsJson({ path }: WantsJsonInput): boolean {
  return path === "/api" || path.startsWith("/api/") || /\/_data\/?$/.test(path);
}

type RefuseInput = { c: Context; status: 403 | 413 | 431; message: string };

function refuse({ c, status, message }: RefuseInput): Response {
  return wantsJson({ path: c.req.path }) ? c.json({ message }, status) : c.text(message, status);
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
    if (!isGuardedPath({ path: c.req.path, extra: options.extraPaths })) return next();
    const formLike = isCrossSiteCapable({ request: c.req.raw });
    if (!formLike && !isUntyped({ request: c.req.raw })) return next();
    const trusted = options.trustedOrigins();
    if (trusted.includes("*")) return next();
    const origin = c.req.header("origin");
    if (!origin && !formLike) return next();
    if (origin && (trusted.includes(origin) || options.ownOrigins(c).includes(origin))) return next();
    return refuse({ c, status: 403, message: `Cross-site ${c.req.method.toUpperCase()} form submissions are forbidden` });
  };
}

type LimitForInput = { type: string; limits: BodyLimits };

/** The limit for a body of this media type. */
function limitFor({ type, limits }: LimitForInput): number {
  if (type === "application/json" || type.endsWith("+json")) return limits.json;
  if (type === "application/x-www-form-urlencoded" || type === "text/plain") return limits.form;
  return limits.multipart;
}

export type SizeLimitsOptions = { limits: BodyLimits; extraPaths?: readonly string[] };

/**
 * `413` for a body over its type's limit, `431` for an `x-droplet-props`
 * header over its own. A body without a `content-length` is counted as it
 * streams in.
 */
export function sizeLimits({ limits, extraPaths = [] }: SizeLimitsOptions): MiddlewareHandler {
  const tooLarge = (c: Context) => refuse({ c, status: 413, message: "Payload Too Large" });
  const byLimit = new Map<number, MiddlewareHandler>();
  return async (c, next) => {
    if (!isGuardedPath({ path: c.req.path, extra: extraPaths })) return next();
    const props = c.req.header("x-droplet-props");
    if (props !== undefined && props.length > limits.props) {
      return refuse({ c, status: 431, message: "x-droplet-props is too large; send the props in a POST body" });
    }
    const maxSize = limitFor({ type: mediaType({ request: c.req.raw }), limits });
    if (!Number.isFinite(maxSize)) return next();
    let limit = byLimit.get(maxSize);
    if (!limit) {
      limit = bodyLimit({ maxSize, onError: tooLarge });
      byLimit.set(maxSize, limit);
    }
    return limit(c, next);
  };
}
