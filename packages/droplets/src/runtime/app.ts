import { Hono } from "hono";
import type { Context, ExecutionContext, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { prefersJson } from "./accept.ts";
import { decodeBase64Json, encodeBase64 } from "./base64.ts";
import { gzipAnswer, withNoTransform } from "./compress.ts";
import { createCookies, prerenderCookies, readonlyCookies } from "./cookies.ts";
import { readRuntimeEnv } from "./env-store.ts";
import { CONTEXT_HEADERS, createEventFetch } from "./event-fetch.ts";
import { ACTION_NAME, backUrl, formResultKey, isReservedQueryKey, RETURN_KEY, splitFormResults } from "./form.ts";
import { formSecret, mintFormResult, readFormResult } from "./form-token.server.ts";
import { fixedHost, fixedPrerenderHost, headerLocations, hostFromHeaders, parseHost, withinTrusted } from "./host.ts";
import type { HostTokenReplacers } from "./host-tokens.ts";
import { isUnhandled } from "./load.ts";
import { dropletElement } from "./element.ts";
import { prerenderKey, propsKey } from "./props.ts";
import { requestInfo, withRequestInfo } from "./request-store.ts";
import { createLoadHeaders, storedHeaders } from "./load-headers.ts";
import { publicEnvScript, serverKey } from "./server-records.ts";
import { plainJson } from "./plain-json.ts";
import { isJsonType, mediaType, originCheck, sizeLimits, trustedOriginsWith, wantsJson } from "./security.ts";
import { allowedMethods, API_METHODS, type ApiMatch, type ApiMethod } from "./routes.ts";
import {
  HttpError,
  isActionFailure,
  isCookiesInPrerenderError,
  isHostUrlPropsErrorInPrerender,
  isHttpError,
  isRedirect,
  type Action,
  type ActionEvent,
  type ActionResult,
  type Handle,
  type HandleServerError,
  type ImportMap,
  type ImportMapHandler,
  type LoadEvent,
  type Locals,
  type RequestEvent,
  type TransformEvent,
} from "./server.ts";
import type { DevLog } from "./dev-log.ts";
import { DEFAULTS, type BodyLimits, type DropletsCorsOptions } from "../core/config.ts";
import type { HydrateMode } from "../renderer.ts";

export type RenderResult = {
  html?: string;
  /** HTML the renderer wants before the markup, inside the element (styles, bootstrap). */
  head?: string;
  body?: string;
  data?: unknown;
  serverData?: unknown;
  /** The id core gave this render; the browser receives it to hydrate with. */
  renderId?: string;
  /** A load failed: `error` is for the error page, as it leaves the server. */
  failed?: true;
  error?: unknown;
};

/** What the server load produced: `{ data }`, or the error for the error page. */
export type DropletPayload = { data: unknown; failed?: undefined } | { failed: true; error: unknown };

export type DropletMeta = {
  exists: boolean;
  ssr: boolean;
  hydrate?: HydrateMode;
  /** Has build-time renders to look up before rendering live. */
  prerender?: boolean;
};

type MaybePromise<T> = T | Promise<T>;

/** A render may carry an action's result: the component's `form`. */
export type RenderDroplet = (name: string, event: LoadEvent, options?: { form?: unknown }) => MaybePromise<RenderResult | null>;
export type LoadDropletData = (name: string, event: LoadEvent) => MaybePromise<DropletPayload>;
export type LoadClientModule = (name: string) => MaybePromise<string | null>;
export type GetDropletMeta = (name: string) => MaybePromise<DropletMeta>;
export type GetHandle = () => MaybePromise<Handle | undefined>;
/**
 * A droplet's form action by name: `"none"` when the droplet exports no
 * `actions`, `"missing"` when it has none by that name.
 */
export type FindAction = (droplet: string, name: string) => MaybePromise<Action | "none" | "missing">;
export type MatchApi = (pathname: string) => MaybePromise<ApiMatch | null>;
/** Renders `+error.*` for an error as it left the server; `null` without one. */
export type RenderError = (name: string, error: unknown, props?: Record<string, unknown>) => MaybePromise<RenderResult | null>;

/**
 * A render made at build: the droplet's HTML and its server data, or, when
 * the load failed, the HTML of `+error.*` and the error.
 */
export type PrerenderedDroplet = {
  html: string;
  data?: unknown;
  /** The id of the build-time render, for hydration. */
  renderId?: string;
  failed?: true;
  error?: unknown;
  /** The nonce of the build's host tokens (see `hostTokens`), for a host-agnostic render. */
  nonce?: string;
  /** What the load set with `setHeaders`, served with the render. */
  headers?: Record<string, string>;
};

/**
 * Finds the build-time render for a prop set, by `propsKey`. `null` when
 * `entries` did not list those props.
 */
export type LoadPrerendered = (name: string, key: string, event: LoadEvent) => MaybePromise<PrerenderedDroplet | null>;

export type DropletsAppOptions = {
  /** Tag name of the host element. Default: `djs-droplet`. */
  element?: string | undefined;
  /** Health check path, answered before `handle`. `false` turns it off. Default: `/health`. */
  health?: string | false | undefined;
  renderDroplet: RenderDroplet;
  loadDropletData?: LoadDropletData;
  getDropletMeta?: GetDropletMeta;
  loadClientModule?: LoadClientModule;
  /** What `/index.js` serves, as it is: the build's file, or the dev loader. */
  loadEntryClient?: () => MaybePromise<string | null>;
  /**
   * The public variables read at runtime (`public: true` without `static`),
   * with their values for this request: what `/env.js` hands the page,
   * before any droplet loads. `{}` (no such variable) answers 404.
   */
  publicEnv?: () => MaybePromise<Record<string, string | undefined>>;
  /**
   * The module the `/index.js` stub imports, relative to the server
   * (`assets/index.<hash>.js`): announced with every fragment as a
   * `modulepreload`. `null` when `/index.js` is the module itself (dev).
   */
  entryModule?: () => MaybePromise<string | null>;
  /** What `/index.css` serves: an `@import` of the shared stylesheet; `null` when there is none. */
  loadGlobalStyle?: () => MaybePromise<string | null>;
  /**
   * Every stylesheet of a droplet, relative to the server (`assets/…`), in
   * cascade order; `[]` when it has none. `style.css` imports them, and
   * fragments link and preload them.
   */
  dropletStyles?: (name: string) => MaybePromise<string[]>;
  /**
   * Whether fragments carry a `Link` header with what the browser will ask
   * for next, for the host to pass on. Default: `true`.
   */
  linkHeader?: boolean;
  /** The `handle` export of `src/hooks.server.ts`, looked up per request. */
  getHandle?: GetHandle;
  /** Resolves `/api/*` to a `+server.ts` module. */
  matchApi?: MatchApi;
  /** Renders `+error.*` when a load fails; `null` when there is none. */
  renderError?: RenderError;
  /** The `handleError` export of `src/hooks.server.ts`, looked up per error. */
  getHandleError?: () => MaybePromise<HandleServerError | undefined>;
  /** Runs the `props` schema from `+droplet.ts`; throws `error(400)` on a mismatch. */
  validateProps?: (name: string, props: Record<string, unknown>) => MaybePromise<Record<string, unknown>>;
  /** Build-time renders of droplets with `prerender = true`. */
  loadPrerendered?: LoadPrerendered;
  /** Finds the form actions of `+droplet.server.ts`. Without it, a form post answers 405. */
  findAction?: FindAction;
  /** The droplet's `transform`, run over its HTML on every request. */
  transformDroplet?: (name: string, event: TransformEvent) => MaybePromise<string>;
  /**
   * Prerendering: the fragment answers `{ key, html, data }` (or
   * `{ key, html, failed, error }`) as JSON for the build to store. A render
   * without a `host` in its body gets the token stand-in (see `prerenderHost`).
   */
  building?: boolean;
  /** HTML for `/`; `null` answers 404. */
  loadIndex?: () => MaybePromise<string | null>;
  /** Where the import map is served; `auto` only while there are externals. */
  importMap?: { path: string; auto: boolean } | false | undefined;
  /** The `importmap` export of `src/importmap.server.ts`, looked up per request. */
  getImportMap?: () => MaybePromise<ImportMapHandler | undefined>;
  /** The client build's external imports, handed to `importmap`. */
  externals?: () => MaybePromise<string[]>;
  /** Enables cross-origin access to every route; see `DropletsConfig.cors`. */
  cors?: DropletsCorsOptions | undefined;
  /** The warnings of `vite dev` and the build (`createDevLog`); a production server has none and warns about nothing. */
  devLog?: DevLog | undefined;
  /**
   * Origins allowed to send form submissions besides this server's, also
   * bounding `event.host` and trusted when a location header names them
   * (`"*"`: any); `DROPLETS_TRUSTED_ORIGINS` adds to them per request. See
   * `DropletsConfig.trustedOrigins`.
   */
  trustedOrigins?: readonly string[] | undefined;
  /**
   * The one location this server is reached at (see
   * `DropletsConfig.location`): every request's, with no header read.
   */
  location?: string | undefined;
  /**
   * The origin of the page every droplet renders on (see
   * `DropletsConfig.host`): `event.host` stays on it, a form post from it
   * passes the origin check, and a prerender renders an entry without a
   * `host` there.
   */
  host?: string | undefined;
  /** See `DropletsConfig.fragmentCacheControl`. Default: `private, no-store, no-transform`. */
  fragmentCacheControl?: string | false | undefined;
  /** See `DropletsConfig.csrf`. Default: the `Origin` check is on. */
  csrf?: { checkOrigin: boolean } | undefined;
  /** See `DropletsConfig.limits`. */
  limits?: BodyLimits | undefined;
  /** Short per-build token appended to asset URLs as `?c=`. */
  buildHash?: string;
  /**
   * The nonce of the tokens the SSR bundle writes for this server's
   * location (see `hostTokens`): the files it imports, `droplet.url()`
   * outside a request. Replaced in every fragment, its data and `_data`;
   * a prerender stores its renders under the same nonce.
   */
  tokenNonce?: string;
  /**
   * Internal: how this app writes and replaces the tokens of `host` and the
   * location (`host-tokens.ts`). Absent when the build fixes both
   * (`location` and `host`): nothing is replaced, and stored renders are
   * served as they are.
   */
  tokens?: HostTokenReplacers | undefined;
};

/** The context a droplet was rendered with; travels to the client and back. */
type WireContext = { host: string; props: Record<string, unknown> };

/** Everything the droplet middleware resolved, handed to the route handlers. */
type DropletContext = {
  droplet: string;
  dropletLocation: string;
  event: LoadEvent;
  wire: WireContext;
  noSSR: boolean;
  clientOnly: boolean;
  meta: DropletMeta;
  /** What the load (and a form action) sets with `setHeaders`. */
  headers: Headers;
  /** The props schema ran: a form action runs it before the render that follows. */
  prepared?: boolean;
};

type LiveHtmlInput = { ctx: DropletContext; html: string };
type LiveDataInput<T> = { ctx: DropletContext; data: T };

/** The droplet's stylesheet URL for the element, and the `Link` header value (`""` when off). */
type FragmentAssets = { stylesheet: string | undefined; link: string };

type AppEnv = {
  Variables: {
    event: RequestEvent;
    droplet?: DropletContext;
    /** The JSON body of a render request, read once. */
    body?: Record<string, unknown> | undefined;
    /** While prerendering without a host: the stand-in and what read it (a `HostProbe`). */
    hostProbe?: { host: URL; violation: Error | undefined };
    /** While prerendering an entry without a host, under `host` of the config: the host it renders for. */
    configHost?: URL;
    /** The request's cookies and the ones the response sets (a `CookieJar`, inlined: this type is public). */
    cookieJar?: { cookies: RequestEvent["cookies"]; setCookies(): string[] };
    /** While prerendering: a use of `cookies`, which stops the build. */
    prerenderViolation?: Error;
    /** Where the browser reaches this server, resolved once per request (see `resolveLocation`). */
    location?: string;
    /**
     * The `__droplet_form_*` values `host` carried, by key, taken out of it
     * before any of the app's code sees it (no-JavaScript action results).
     */
    formResults?: Map<string, string>;
    /** The request's `Referer`, read before anything rebuilds the request (the body limit does). */
    referer?: string | undefined;
    /** `event.fetch` of this request, made with the location. */
    fetch: typeof fetch;
    /** A form action ran: its JSON answer is a script's to read, never a fragment. */
    isAction?: boolean;
  };
};

type AppContext = Context<AppEnv>;

/** What `createDropletsApp`, `createServerApp` and `createNodeServerApp` return. */
export type DropletsApp = Hono<AppEnv>;

type DropletContextInput = { c: AppContext };

/** Reads what the droplet middleware resolved; only valid behind it. */
function dropletContext({ c }: DropletContextInput): DropletContext {
  const ctx = c.get("droplet");
  if (!ctx) throw new Error("Route is missing the droplet middleware.");
  return ctx;
}

const ONE_MONTH_SECONDS = 2592000;

/** Response headers a cross-origin host reads: preloads, and the build that answered. */
const EXPOSED_HEADERS = ["Link", "x-droplets-build"];

type WithExposedHeadersInput = { options: DropletsCorsOptions };

/** The user's `cors` options, with the headers the framework sends exposed. */
function withExposedHeaders({ options }: WithExposedHeadersInput): DropletsCorsOptions {
  return {
    ...options,
    exposeHeaders: [...new Set([...(options.exposeHeaders ?? []), ...EXPOSED_HEADERS])],
  };
}

type StyleImportsInput = { files: readonly string[] };

/**
 * `style.css` of a droplet: an import per stylesheet, relative to
 * `/droplets/<id>/style.css`, so it resolves under any origin or prefix the
 * server is reached through.
 */
export function styleImports({ files }: StyleImportsInput): string {
  return files.map((file) => `@import url(${JSON.stringify(`../../${file}`)});\n`).join("");
}

/** Body types of a form submission: a form action, not a render. */
const FORM_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data"]);

type IsActionRequestInput = { request: Request };

/** A `POST` whose body is a form: it runs a form action. */
function isActionRequest({ request }: IsActionRequestInput): boolean {
  return request.method === "POST" && FORM_TYPES.has(mediaType({ request }));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ReadBodyJsonInput = { c: AppContext };

/**
 * The JSON body of a render request as plain data (`plainJson`: no
 * `__proto__` key, 64 levels at most), or `undefined`: not a POST, not a
 * JSON media type (the one `sizeLimits` reads), malformed, not an object.
 * A malformed body is treated as "no body"; the droplet still renders.
 */
async function readBodyJson({ c }: ReadBodyJsonInput): Promise<Record<string, unknown> | undefined> {
  if (c.req.method !== "POST" || !isJsonType({ type: mediaType({ request: c.req.raw }) })) return undefined;
  let parsed: unknown;
  try {
    // A clone, so `event.request` stays readable for the droplet's own load.
    parsed = await c.req.raw.clone().json();
  } catch {
    return undefined;
  }
  const body = plainJson({ value: parsed });
  return isObject(body) ? body : undefined;
}

type ContextFromBodyInput = { body: Record<string, unknown> | undefined };

/** `{ context: { host, props } }`, `{ host, props }` or `{ props }`. */
function contextFromBody({ body }: ContextFromBodyInput): Partial<WireContext> {
  if (!body) return {};
  const source = isObject(body["context"]) ? body["context"] : body;
  return {
    ...(typeof source["host"] === "string" ? { host: source["host"] } : {}),
    ...(isObject(source["props"]) ? { props: source["props"] } : {}),
  };
}

/** The routes whose POST body is a render context: the fragment and `_data`. */
const RENDER_ROUTE = /^\/droplets\/[^/]+(?:\/_data)?$/;

type NotFoundInput = { c: Context };

/** `Not Found`, in the shape of the route: `{ message }` under `_data` and `/api`, text elsewhere. */
function notFound({ c }: NotFoundInput): Response {
  return wantsJson({ path: c.req.path }) ? c.json({ message: "Not Found" }, 404) : c.text("Not Found", 404);
}

type MethodNotAllowedInput = { c: Context; allow: string };

/** `Method Not Allowed` with `allow`, in the shape of the route, as `notFound`. */
function methodNotAllowed({ c, allow }: MethodNotAllowedInput): Response {
  const message = "Method Not Allowed";
  return wantsJson({ path: c.req.path }) ? c.json({ message }, 405, { allow }) : c.text(message, 405, { allow });
}

type IsStaticPathInput = { path: string };

/** `/index.js`, `/index.css`, `/env.js` and everything under `/assets/`: what a page loads as files, which never pass through `handle`. */
function isStaticPath({ path }: IsStaticPathInput): boolean {
  return path === "/index.js" || path === "/index.css" || path === "/env.js" || path.startsWith("/assets/");
}

const ENV_MAX_AGE_SECONDS = 600;

/** The `Cache-Control` of `/env.js` by raw `DROPLETS_ENV_MAX_AGE`: parsed once, a bad value warned about once. */
const envCacheControls = new Map<string, string>();

type EnvCacheControlInput = { raw: string | undefined; devLog: DevLog | undefined };

/**
 * `public, max-age=600`, or `DROPLETS_ENV_MAX_AGE` seconds, `0` for
 * `no-store`; any other value is ignored, with a warning under `vite dev`.
 */
function envCacheControl({ raw, devLog }: EnvCacheControlInput): string {
  const fallback = `public, max-age=${ENV_MAX_AGE_SECONDS}`;
  if (!raw?.trim()) return fallback;
  let value = envCacheControls.get(raw);
  if (value === undefined) {
    const seconds = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
    if (!Number.isSafeInteger(seconds)) devLog?.badEnvMaxAge({ value: raw, fallback });
    value = !Number.isSafeInteger(seconds) ? fallback : seconds === 0 ? "no-store" : `public, max-age=${seconds}`;
    envCacheControls.set(raw, value);
  }
  return value;
}

type PropsFromRequestInput = { c: AppContext; devLog: DevLog | undefined };

function propsFromRequest({ c, devLog }: PropsFromRequestInput): Record<string, unknown> | undefined {
  const fromQuery: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(c.req.query())) {
    if (!isReservedQueryKey({ key })) fromQuery[key] = value;
  }
  if (Object.keys(fromQuery).length > 0) return fromQuery;

  // Props too large or too structured for a query string.
  const encoded = c.req.header("x-droplet-props");
  if (encoded) {
    let decoded: unknown;
    try {
      decoded = decodeBase64Json({ encoded });
    } catch {
      devLog?.malformedProps();
      return undefined;
    }
    const props = plainJson({ value: decoded });
    if (isObject(props)) return props;
    devLog?.malformedProps();
  }
  return undefined;
}

type SerializeBase64Input = { data: unknown };

/** Base64 of the JSON with `<` escaped, for inlining into HTML; `""` for `undefined`. */
function serializeBase64({ data }: SerializeBase64Input): string {
  if (data === undefined) return "";
  const json = JSON.stringify(data);
  if (json === undefined) return "";
  return encodeBase64({ text: json.replace(/</g, "\\u003c") });
}

type PublicLocationInput = { c: Context };

/**
 * Where the browser reaches this server: its origin and the path prefix it
 * is served under (`https://shop.example/mfe`). Resolved once per request
 * (see `resolveLocation`).
 */
function publicLocation({ c }: PublicLocationInput): string {
  return (c.get("location") as string | undefined) ?? new URL(c.req.url).origin;
}

/** The request headers a fragment's URLs and `host` come from: what a cacheable fragment varies on. */
const VARY_HEADERS = CONTEXT_HEADERS;

/** With a fixed `location`, only `host` comes from a header. */
const HOST_VARY_HEADERS = ["origin"];

type WithVaryInput = { vary: string | null; names: readonly string[] };

/**
 * `vary` with `names` added, each once (any case), after what it had;
 * `null` when there is nothing to send. `*` already varies on everything.
 */
export function withVary({ vary, names }: WithVaryInput): string | null {
  const listed = (vary ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (listed.includes("*")) return "*";
  const seen = new Set(listed.map((name) => name.toLowerCase()));
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    listed.push(name);
  }
  return listed.length > 0 ? listed.join(", ") : null;
}

type ApplyHeadersInput = { c: AppContext; headers: Iterable<[string, string]> };

/** Puts a droplet's `setHeaders` on its answer; the host headers join its `vary` on the way out. */
function applyHeaders({ c, headers }: ApplyHeadersInput): void {
  for (const [name, value] of headers) c.header(name, value);
}

type ResolveLocationInput = { c: Context; trusted: readonly string[]; devLog: DevLog | undefined };

/**
 * Where this request reaches the server. The first location the headers
 * name (see `headerLocations`) whose origin is trusted: the request's own,
 * or one in `trustedOrigins` (`"*"` trusts any). Anyone can send these
 * headers, and the location decides the URLs the server writes about
 * itself (stylesheet, `Link`, `droplet.url()`, action URLs) and the origins
 * it takes form posts from. Without one, the request's own origin.
 */
function resolveLocation({ c, trusted, devLog }: ResolveLocationInput): string {
  const requestUrl = new URL(c.req.url);
  const any = trusted.includes("*");
  const allowed = new Set([requestUrl.origin, ...trusted]);
  for (const { source, location } of headerLocations({ headers: c.req.raw.headers, requestUrl })) {
    if (any || allowed.has(new URL(location).origin)) return location;
    devLog?.untrustedLocation({ location, source });
  }
  return requestUrl.origin;
}

type PublicOriginInput = { c: Context };

function publicOrigin({ c }: PublicOriginInput): string {
  return new URL(publicLocation({ c })).origin;
}

/** Thrown when an action returns data that cannot travel as plain JSON; answered as a 500. */
class ActionDataError extends Error {}

export function isActionDataError(error: unknown): error is Error {
  return error instanceof ActionDataError;
}

type IsPlainJsonInput = { value: unknown; depth?: number };

/**
 * Plain JSON: `null`, booleans, finite numbers, strings, arrays and object
 * literals of them. Nothing a class, a function or a reference made: the
 * result reaches the browser as data only.
 */
function isPlainJson({ value, depth = 0 }: IsPlainJsonInput): boolean {
  if (depth > 64) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isPlainJson({ value: item, depth: depth + 1 }));
  if (typeof value !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every((item) => isPlainJson({ value: item, depth: depth + 1 }));
}

type ActionOutcomeInput = { droplet: string; name: string; result: unknown; host: URL };

/**
 * What an action's return value means: a redirect (its target resolved
 * against `host`, where the form was), a failure from `fail()`, or a
 * success. Data must be plain JSON, or nothing.
 */
function actionOutcome({ droplet, name, result, host }: ActionOutcomeInput): ActionResult {
  if (isRedirect(result)) {
    return { type: "redirect", status: result.status, location: new URL(result.location, host).href };
  }
  const failed = isActionFailure(result);
  const data: unknown = failed ? result.data : result;
  if (data !== undefined && !isPlainJson({ value: data })) {
    throw new ActionDataError(
      `${droplet}: action ${name} ${failed ? "failed with" : "returned"} data that is not plain JSON (object literals, arrays, strings, finite numbers, booleans, null)`,
    );
  }
  const shown = data === undefined ? {} : { data };
  return failed ? { type: "failure", status: result.status, ...shown } : { type: "success", status: 200, ...shown };
}

type PublicUrlInput = { c: Context };

/**
 * The request's URL as the browser reaches it: its path and query under
 * the location, prefix included (`https://shop.example/mfe/droplets/x`).
 * What `event.url` is and what a cookie's defaults are judged by.
 */
function publicUrl({ c }: PublicUrlInput): URL {
  const request = new URL(c.req.url);
  try {
    return new URL(`${publicLocation({ c }).replace(/\/+$/, "")}${request.pathname}${request.search}`);
  } catch {
    // A location a header named that no URL takes: the request's own URL stands.
    return request;
  }
}

type ExecutionContextOfInput = { c: Context };

/** `c.executionCtx` throws where the runtime has none (Node). */
function executionContextOf({ c }: ExecutionContextOfInput): ExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

type PlatformOfInput = { c: Context };

function platformOf({ c }: PlatformOfInput): RequestEvent["platform"] {
  const context = executionContextOf({ c });
  return { env: c.env, ...(context === undefined ? {} : { context }) };
}

/**
 * The origins the browser may reach this server at: the request's own, and
 * its location's. Positional: it is `originCheck`'s `ownOrigins` callback.
 */
function ownOrigins(c: Context): string[] {
  return [new URL(c.req.url).origin, publicOrigin({ c })];
}

type RedirectOriginsInput = { c: Context; trusted: readonly string[] };

/**
 * The origins a native form submit may be sent on to: this server's own
 * and the listed `trustedOrigins`, compared by exact origin. `"*"` never
 * counts here, although it trusts every origin for the `Origin` check: as a
 * redirect target it would make the server an open redirect.
 */
function redirectOrigins({ c, trusted }: RedirectOriginsInput): Set<string> {
  return new Set([...ownOrigins(c), ...trusted.filter((origin) => origin !== "*")]);
}

type RedirectTargetInput = { value: unknown; allowed: ReadonlySet<string> };

/**
 * `value` as a place to redirect to: an absolute `http:` or `https:` URL,
 * without credentials, whose exact origin is in `allowed` (never a prefix
 * or a substring: `https://shop.example.evil.example` is another origin).
 * `null` for anything else, `javascript:` included.
 */
export function redirectTarget({ value, allowed }: RedirectTargetInput): URL | null {
  if (typeof value !== "string" && !(value instanceof URL)) return null;
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    // Not an absolute URL: nowhere to redirect to.
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  return allowed.has(url.origin) ? url : null;
}

type ResolvedTargetInput = { location: unknown; base: URL };

/** `location` of a `redirect()` as an absolute URL against `base`; `null` when it is no string or URL, or does not parse. */
function resolvedTarget({ location, base }: ResolvedTargetInput): URL | null {
  if (typeof location !== "string" && !(location instanceof URL)) return null;
  try {
    return new URL(String(location), base);
  } catch {
    // Not a URL against any base: nowhere to redirect to.
    return null;
  }
}

type TrustedOriginsOfInput = { options: DropletsAppOptions };

/** `trustedOrigins` and `DROPLETS_TRUSTED_ORIGINS`, now: the env may change per request (Workers). */
function trustedOriginsOf({ options }: TrustedOriginsOfInput): readonly string[] {
  return trustedOriginsWith({
    configured: options.trustedOrigins ?? [],
    raw: readRuntimeEnv("DROPLETS_TRUSTED_ORIGINS"),
    devLog: options.devLog,
  });
}

/** The origins a form may post from and a redirect may lead to: `trustedOrigins`, plus `host`. */
function formOriginsOf({ options }: TrustedOriginsOfInput): readonly string[] {
  const trusted = trustedOriginsOf({ options });
  return options.host === undefined ? trusted : [...trusted, options.host];
}

type OffSiteRedirectInput = { c: Context; as: "text" | "json"; label: string; what: string; location: unknown; path?: string };

/**
 * The 400 for a `redirect()` whose target is not on this server or a
 * trusted origin, from an action, a load, `transform`, `handle` or a
 * `+server.ts` route alike: logged, with the target cut short, and answered
 * without a `location`.
 */
function offSiteRedirect({ c, as, label, what, location, path }: OffSiteRedirectInput): Response {
  console.error(
    `${label} redirects to ${JSON.stringify(String(location).slice(0, 200))}, which is not on this server or a trusted origin; answered 400${path === undefined ? "" : `: ${path}`}`,
  );
  const message = `Bad Request: ${what} redirects off this site`;
  return as === "json" ? c.json({ message }, 400) : c.text(message, 400);
}

type BackTargetInput = { value: unknown; allowed: ReadonlySet<string>; servers: readonly string[] };

/**
 * `value` as a page to send a form posted without JavaScript back to: a
 * redirect target (see `redirectTarget`) that is no page of the droplets
 * server itself, under `<location>/droplets/` of any location in `servers`
 * (a fragment or an action URL, never a page a host shows).
 */
export function backTarget({ value, allowed, servers }: BackTargetInput): URL | null {
  const url = redirectTarget({ value, allowed });
  if (!url) return null;
  for (const server of servers) {
    let base: URL;
    try {
      base = new URL(server);
    } catch {
      // A location that is no URL holds no droplets page.
      continue;
    }
    const droplets = `${base.pathname.replace(/\/+$/, "")}/droplets`;
    if (url.origin === base.origin && (url.pathname === droplets || url.pathname.startsWith(`${droplets}/`))) return null;
  }
  return url;
}

/** The longest `__droplet_return` read: a page's origin and path, never more. */
const RETURN_MAX_LENGTH = 2048;

type PageOfInput = { url: URL };

/** `origin + pathname` of a page: what `__droplet_return` names, and what a result is bound to. */
function pageOf({ url }: PageOfInput): string | undefined {
  const origin = url.origin;
  return typeof origin === "string" && origin !== "" && origin !== "null" ? `${origin}${url.pathname}` : undefined;
}

type WithFormResultInput = { page: URL; key: string; value: string };

/**
 * `page` with `value` under `key`, after any `__droplet_form_*` key it had
 * is dropped (an older result, another droplet's): the URL does not grow
 * with every submit. Any `?/name` and `__droplet_return` key goes too: the
 * GET that follows never lands on an action URL. The rest of its query
 * stays as written.
 */
function withFormResult({ page, key, value }: WithFormResultInput): string {
  const url = backUrl(page);
  // The value is base64url and one `.`: nothing to encode.
  const part = `${encodeURIComponent(key)}=${value}`;
  url.search = url.search.length > 1 ? `${url.search.slice(1)}&${part}` : part;
  return url.href;
}

type CreateRequestEventInput = { c: AppContext; host?: URL | undefined; cookies?: RequestEvent["cookies"] | undefined };

function createRequestEvent({ c, host, cookies }: CreateRequestEventInput): RequestEvent {
  const url = publicUrl({ c });
  return {
    request: c.req.raw,
    url,
    host: host ?? hostFromHeaders({ headers: c.req.raw.headers, location: url }),
    params: {},
    locals: {} as Locals,
    platform: platformOf({ c }),
    cookies: cookies ?? createCookies({ request: c.req.raw, url }).cookies,
    fetch: c.get("fetch"),
  };
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

/** Marks the build's answer for a render that read `host` without one: the build stops. */
const PRERENDER_ERROR_HEADER = "x-droplets-prerender-error";

type HostInPrerenderInput = { c: Context; error: unknown };

function hostInPrerender({ c, error }: HostInPrerenderInput): Response {
  const message = error instanceof Error ? error.message : String(error);
  const kind = isCookiesInPrerenderError(error) ? "cookies" : "host";
  return c.json({ message }, 500, { [PRERENDER_ERROR_HEADER]: kind });
}

const INTERNAL_ERROR = "Internal Server Error";

type UnexpectedMessageInput = { c: AppContext; options: DropletsAppOptions; error: unknown };

/**
 * The message an unexpected error is shown with: what `handleError` in
 * `hooks.server.ts` returns, else "Internal Server Error". The details
 * stay in the log.
 */
async function unexpectedMessage({ c, options, error }: UnexpectedMessageInput): Promise<string> {
  let handleError: HandleServerError | undefined;
  try {
    handleError = options.getHandleError ? await options.getHandleError() : undefined;
  } catch (hookError) {
    console.error("loading handleError from hooks.server.ts failed", hookError);
  }
  if (!handleError) return INTERNAL_ERROR;
  const event = (c.get("event") as RequestEvent | undefined) ?? createRequestEvent({ c });
  try {
    const result: unknown = await handleError({ error, event, status: 500, message: INTERNAL_ERROR });
    return isObject(result) && typeof result["message"] === "string" ? result["message"] : INTERNAL_ERROR;
  } catch (hookError) {
    console.error("handleError in hooks.server.ts failed", hookError);
    return INTERNAL_ERROR;
  }
}

type FailureInput = {
  c: AppContext;
  options: DropletsAppOptions;
  error: unknown;
  as: "text" | "json";
  where: string;
  /** What a `redirect()` resolves against: `host` for a droplet's code; else `event.url`, the request's URL on the location. */
  base?: URL | undefined;
};

/**
 * `error()`, `redirect()` and crashes, answered the same way everywhere:
 * `error()` with its status and message, `redirect()` as an absolute
 * location on this server or a trusted origin (else 400, as an action's),
 * anything else as 500 through `handleError` in `hooks.server.ts`.
 */
async function failure({ c, options, error, as, where, base }: FailureInput): Promise<Response> {
  if (isHttpError(error)) {
    const status = error.status as 400;
    if (as === "text") return c.text(error.body.message, status);
    return c.json(error.body, status);
  }
  if (isRedirect(error)) {
    const event = c.get("event") as RequestEvent | undefined;
    const resolved = resolvedTarget({ location: error.location, base: base ?? event?.url ?? new URL(c.req.url) });
    const target = redirectTarget({ value: resolved, allowed: redirectOrigins({ c, trusted: formOriginsOf({ options }) }) });
    if (!target) {
      const what = where === "droplet" || where === "_data" ? "the droplet" : where === "endpoint" ? "the endpoint" : where;
      return offSiteRedirect({ c, as, label: where, what, location: error.location, path: c.req.path });
    }
    return new Response(null, { status: error.status, headers: { location: target.href } });
  }
  // A droplet that could not show its error: what went wrong is the cause.
  const cause = isUnhandled(error) ? error.cause : error;
  console.error(`${where} failed: ${c.req.path}${isUnhandled(error) ? ` (${error.message})` : ""}`, cause);
  const message = await unexpectedMessage({ c, options, error: cause });
  if (as === "text") return c.text(message, 500);
  return c.json({ message }, 500);
}

type ImportMapInserterInput = { json: string };

/**
 * A classic script that puts the import map into the page right after
 * itself. It has to run before any module script: include it without
 * `type="module"`, `defer` or `async`, ahead of `/index.js`.
 */
function importMapInserter({ json }: ImportMapInserterInput): string {
  return `(function () {
  var script = document.createElement("script");
  script.type = "importmap";
  script.textContent = ${JSON.stringify(json)};
  var current = document.currentScript;
  if (current && current.parentNode) current.parentNode.insertBefore(script, current.nextSibling);
  else document.head.appendChild(script);
})();
`;
}

type RouteDropletInput = { path: string };

/** The droplet a render route names: `/droplets/<id>` or `/droplets/<id>/_data`. */
function routeDroplet({ path }: RouteDropletInput): string {
  try {
    return decodeURIComponent(path.split("/")[2] ?? "");
  } catch {
    // A malformed escape names no droplet.
    return "";
  }
}

type DropletMetaInput = { options: DropletsAppOptions; droplet: string };

async function dropletMeta({ options, droplet }: DropletMetaInput): Promise<DropletMeta> {
  return options.getDropletMeta ? await options.getDropletMeta(droplet) : { exists: true, ssr: true };
}

function createDropletMiddleware(options: DropletsAppOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const droplet = c.req.param("droplet") as string;
    const meta = await dropletMeta({ options, droplet });
    if (!meta.exists) return notFound({ c });

    const clientOnly = c.req.query("clientOnly") !== undefined;
    const noSSR = clientOnly || c.req.query("noSSR") !== undefined;
    const dropletLocation = publicLocation({ c });
    const fromBody = contextFromBody({ body: c.get("body") });
    // The host as `handle` left it: it travels with the context.
    const { request, locals, platform, host, cookies, fetch: eventFetch } = c.get("event");
    // Props come from whoever builds the request: the query (or
    // `x-droplet-props`) of a GET, the body `{ props }` of a POST, never the
    // query of a POST (a page's own query string is not the droplet's props).
    // A form action is a POST whose body is the form: its props are in the
    // action URL's query, as a GET's.
    const fromQuery = c.req.method !== "POST" || isActionRequest({ request: c.req.raw });
    const wire: WireContext = {
      host: String(host),
      props: (fromQuery ? propsFromRequest({ c, devLog: options.devLog }) : fromBody.props) ?? {},
    };
    // Read only in a droplet; at build they throw anyway, and stop it.
    const dropletCookies = options.building ? cookies : readonlyCookies({ cookies });
    const { setHeaders, headers } = createLoadHeaders({ droplet });
    const event: LoadEvent = {
      request,
      locals,
      platform,
      host,
      cookies: dropletCookies,
      setHeaders,
      droplet,
      props: wire.props,
      fetch: eventFetch,
    };

    c.set("droplet", { droplet, dropletLocation, event, wire, noSSR, clientOnly, meta, headers });
    // The page for the action URLs the render writes (`__droplet_return`):
    // `host` as `handle` left it, its tokens at build.
    const page = host instanceof URL ? pageOf({ url: host }) : undefined;
    const info = requestInfo();
    if (page === undefined || !info) {
      await next();
      return;
    }
    await withRequestInfo({ ...info, page }, next);
    return;
  };
}

/** The core Hono app over render and asset callbacks: `createServerApp`, `createNodeServerApp` and `createDevApp` build one for production, Node and `vite dev`. */
export function createDropletsApp(options: DropletsAppOptions): DropletsApp {
  const app = new Hono<AppEnv>();
  // What no handler caught leaves the same way as everything else: through `handleError`.
  app.onError((error, c) => failure({ c, options, error, as: wantsJson({ path: c.req.path }) ? "json" : "text", where: "request" }));
  app.notFound((c) => notFound({ c }));
  const dropletMiddleware = createDropletMiddleware(options);
  const element = options.element ?? "djs-droplet";
  const health = options.health === undefined ? "/health" : options.health;
  if (options.trustedOrigins?.includes("*")) options.devLog?.anyLocation({ option: "trustedOrigins" });
  if (options.cors?.origin === "*") options.devLog?.corsAny();
  // One per build: what host-agnostic renders hold for `host`, never sent.
  const tokens = options.tokens;
  const buildNonce = options.building && tokens ? (options.tokenNonce ?? tokens.tokenNonce()) : "";
  const buildTokens = options.building && tokens ? tokens.hostTokens({ nonce: buildNonce }) : undefined;
  const liveTokens =
    !options.building && tokens && options.tokenNonce !== undefined ? tokens.hostTokens({ nonce: options.tokenNonce }) : undefined;
  const importMapPaths = options.importMap ? [options.importMap.path, `${options.importMap.path}.js`] : [];
  const cacheControl = options.fragmentCacheControl === undefined ? DEFAULTS.fragmentCacheControl : options.fragmentCacheControl;

  type BoundedHostInput = { c: Context; host: URL };

  /**
   * `host` within `trustedOrigins` when the list is set: a host outside it,
   * and not this server, becomes this server's origin. Without a list, the
   * host stands as sent.
   */
  function boundedHost({ c, host }: BoundedHostInput): URL {
    return withinTrusted({ host, trusted: trustedOriginsOf({ options }), own: ownOrigins(c) }) ? host : new URL(publicOrigin({ c }));
  }

  type TakeFormResultsInput = { c: AppContext; event: RequestEvent };

  /**
   * A `host` that `handle` set (from `Referer`, say) with `__droplet_form_*`
   * keys in it: they come out too, and count as the request's own. So does
   * a `__droplet_return` key, which is no part of any page.
   */
  function takeFormResults({ c, event }: TakeFormResultsInput): void {
    if (options.building || !(event.host instanceof URL)) return;
    const split = splitFormResults(event.host);
    if (split.url.href === event.host.href) return;
    event.host = split.url;
    if (split.results.size === 0) return;
    c.set("formResults", new Map([...(c.get("formResults") ?? []), ...split.results]));
  }

  /** The build a no-JavaScript result is bound to. */
  const build = options.buildHash ?? "";

  type FormFromHostInput = { c: AppContext; ctx: DropletContext };

  /**
   * The result of a no-JavaScript action of this droplet that `host`
   * carried back: `{ form }`, or `null` when there is none, when it is not
   * genuine or has expired, or names an action the droplet does not export.
   * Never at build. The caller renders as if there were none.
   */
  async function formFromHost({ c, ctx }: FormFromHostInput): Promise<{ form: unknown } | null> {
    if (options.building || !options.findAction) return null;
    const value = c.get("formResults")?.get(formResultKey(ctx.droplet, build));
    if (value === undefined) return null;
    // Bound to the page it was sent back to: `event.host` must be that page.
    const page = ctx.event.host instanceof URL ? pageOf({ url: ctx.event.host }) : undefined;
    if (page === undefined) return null;
    const secret = formSecret({ raw: readRuntimeEnv("DROPLETS_SECRET"), devLog: options.devLog });
    if (!secret) return null;
    const result = await readFormResult({ secret, scope: { droplet: ctx.droplet, build, page }, value });
    if (!result) return null;
    let action: Action | "none" | "missing";
    try {
      action = await options.findAction(ctx.droplet, result.action);
    } catch {
      // A result whose action cannot be looked up is no result: the droplet renders without it.
      return null;
    }
    return typeof action === "function" ? { form: result.data } : null;
  }

  type CacheForeverInput = { c: AppContext };

  function cacheForever({ c }: CacheForeverInput): void {
    c.header("cache-control", `public, max-age=${ONE_MONTH_SECONDS}, immutable`);
  }

  // Where this server is reached: before anything that writes a URL or
  // checks an origin. `event.fetch` dispatches into this same app, with the
  // request's bindings and context, so an internal request runs through
  // everything below as one from outside does.
  app.use("*", (c, next) => {
    c.set("location", options.location ?? resolveLocation({ c, trusted: trustedOriginsOf({ options }), devLog: options.devLog }));
    c.set("referer", c.req.header("referer"));
    c.set(
      "fetch",
      createEventFetch({
        request: c.req.raw,
        location: publicLocation({ c }),
        dispatch: (request) => app.fetch(request, c.env, executionContextOf({ c })),
      }),
    );
    return next();
  });

  // Fragments and `_data` answer per request (host, props, cookies): kept
  // out of shared caches unless the droplet's load (`setHeaders`), `handle`
  // or the config says otherwise. Every answer varies on the headers that
  // decide its URLs and `host`: a cache keys answers by URL, and with these
  // in the key a spoofed header only ever reaches its own entry. Outermost,
  // so its `vary` is the last word: `cors()` appends `Origin` to it too.
  // The default `cache-control` is for what rendered: an error keeps none of it.
  // Every answer names the build, 404 and 405 included: the element reads
  // it before the status, so a page learns it is stale from a droplet a
  // redeploy removed. Every answer but a redirect and an action's JSON is
  // `no-transform` (see `compress.ts`), and gzipped here instead.
  const perRequest: MiddlewareHandler<AppEnv> = async (c, next) => {
    await next();
    const headers = new Headers(c.res.headers);
    const status = c.res.status;
    if (status >= 200 && status < 300 && !headers.has("cache-control") && cacheControl) headers.set("cache-control", cacheControl);
    if (options.buildHash) headers.set("x-droplets-build", options.buildHash);
    const isRedirectStatus = status >= 300 && status < 400;
    const type = (headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const isActionJson = c.get("isAction") === true && isJsonType({ type });
    const isFragment = !isRedirectStatus && !isActionJson;
    if (isFragment) headers.set("cache-control", withNoTransform({ cacheControl: headers.get("cache-control") }));
    const names = options.location === undefined ? VARY_HEADERS : HOST_VARY_HEADERS;
    const vary = withVary({ vary: headers.get("vary"), names: isFragment ? [...names, "accept-encoding"] : names });
    if (vary !== null) headers.set("vary", vary);
    const response = c.res;
    c.res = undefined;
    c.res =
      isFragment && !options.building
        ? await gzipAnswer({ request: c.req.raw, response, headers })
        : new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
  app.use("/droplets/:droplet", perRequest);
  app.use("/droplets/:droplet/_data", perRequest);

  // CORS first, so even a failing hook answers with the headers.
  if (options.cors) app.use("*", cors(withExposedHeaders({ options: options.cors })));

  // Before `handle`: an auth hook must not take the health check down.
  if (health) app.get(health, (c) => c.text("ok"));

  // What `$droplets/drop` and `actionUrl()` read on the server, for the
  // rest of the request. At build without `location` it is a token of this
  // build, replaced per request by the location the render is served from.
  app.use("*", (c, next) =>
    withRequestInfo(
      {
        origin: options.location ?? (buildTokens ? buildTokens.location : publicLocation({ c })),
        trustedOrigins: trustedOriginsOf({ options }),
        ownOrigins: ownOrigins(c),
      },
      next,
    ),
  );

  // Before `handle`, as SvelteKit does: a cross-site form post, or a body
  // too large, never reaches the app's code.
  if (options.csrf?.checkOrigin !== false) {
    app.use("*", originCheck({ trustedOrigins: () => formOriginsOf({ options }), ownOrigins, extraPaths: importMapPaths }));
  }
  app.use("*", sizeLimits({ limits: options.limits ?? DEFAULTS.limits, extraPaths: importMapPaths }));

  // Last on the way out, whatever answered: the cookies the request set, or,
  // at build, the answer that stops it when a render used what it cannot have.
  app.use("*", async (c, next) => {
    await next();
    if (options.building) {
      const violation = c.get("hostProbe")?.violation ?? c.get("prerenderViolation");
      if (violation && c.res.headers.get(PRERENDER_ERROR_HEADER) === null) {
        c.res = undefined;
        c.res = hostInPrerender({ c, error: violation });
      }
      return;
    }
    const setCookies = c.get("cookieJar")?.setCookies() ?? [];
    if (setCookies.length === 0) return;
    const response = c.res;
    const headers = new Headers(response.headers);
    for (const cookie of setCookies) headers.append("set-cookie", cookie);
    // A new response: the handler's may have immutable headers.
    c.res = undefined;
    c.res = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });

  app.use("*", async (c, next) => {
    // Static files are answered as files, as SvelteKit's adapters do:
    // nothing of the app's (no event, no cookies, no `handle`) runs for them.
    if (isStaticPath({ path: c.req.path })) return next();
    // A render request may say where it renders: `{ host, props }`. The
    // body is read only for a droplet that exists.
    const renderRoute = RENDER_ROUTE.test(c.req.path);
    const droplet = renderRoute ? routeDroplet({ path: c.req.path }) : "";
    const body = renderRoute && (await dropletMeta({ options, droplet })).exists ? await readBodyJson({ c }) : undefined;
    c.set("body", body);
    let host = parseHost({ value: contextFromBody({ body }).host });
    if (!host && options.building && renderRoute && options.host !== undefined) {
      host = fixedPrerenderHost({ fixed: options.host, tokens: buildTokens });
      c.set("configHost", host);
    } else if (!host && tokens && buildTokens && renderRoute) {
      // No host known at build: tokens, and a record of what else was read.
      const probe = tokens.prerenderHost({ droplet, entry: JSON.stringify(contextFromBody({ body }).props ?? {}), tokens: buildTokens });
      c.set("hostProbe", probe);
      host = probe.host;
    }
    let cookies: RequestEvent["cookies"] | undefined;
    if (options.building) {
      const where = renderRoute ? `${droplet} (entry ${JSON.stringify(contextFromBody({ body }).props ?? {})})` : c.req.path;
      cookies = prerenderCookies({
        where,
        record: (error) => {
          if (!c.get("prerenderViolation")) c.set("prerenderViolation", error);
        },
      });
    } else {
      // `secure` follows how the browser reaches this server.
      const jar = createCookies({ request: c.req.raw, url: publicUrl({ c }) });
      c.set("cookieJar", jar);
      cookies = jar.cookies;
      host =
        options.host === undefined
          ? boundedHost({ c, host: host ?? hostFromHeaders({ headers: c.req.raw.headers, location: new URL(publicOrigin({ c })) }) })
          : fixedHost({ fixed: options.host, reported: host });
      // A no-JavaScript action's result rides on the page's URL: taken out
      // here, before `handle`, so no code of the app ever sees it in `host`.
      const split = splitFormResults(host);
      host = split.url;
      c.set("formResults", split.results);
    }
    const event = createRequestEvent({ c, host: host ?? undefined, cookies });
    c.set("event", event);

    let handle: Handle | undefined;
    try {
      handle = options.getHandle ? await options.getHandle() : undefined;
    } catch (error) {
      return failure({ c, options, error, as: "text", where: "hooks.server" });
    }
    if (!handle) {
      await next();
      return;
    }

    let resolved = false;
    let response: unknown;
    try {
      response = await handle({
        event,
        resolve: async (nextEvent) => {
          resolved = true;
          takeFormResults({ c, event: nextEvent });
          c.set("event", nextEvent);
          await next();
          return c.res;
        },
      });
    } catch (error) {
      return failure({ c, options, error, as: wantsJson({ path: c.req.path }) ? "json" : "text", where: "handle", base: event.host });
    }
    if (!isResponse(response)) {
      return failure({ c, options, error: new Error("handle must return a Response"), as: "text", where: "handle" });
    }
    // Answered without resolving: that response is final.
    if (!resolved) return response;
    if (response !== c.res) {
      // Replace rather than merge: Hono would copy the old headers back.
      c.res = undefined;
      c.res = response;
    }
    return;
  });

  if (options.importMap) {
    const { path, auto } = options.importMap;

    type ResolveImportMapInput = { c: AppContext };

    /** The map for this request, or `null` when there is none to serve. */
    async function resolveImportMap({ c }: ResolveImportMapInput): Promise<ImportMap | null> {
      const externals = options.externals ? await options.externals() : [];
      if (auto && externals.length === 0) return null;
      const handler = options.getImportMap ? await options.getImportMap() : undefined;
      if (!handler) return null;
      const { request, url } = c.get("event");
      const map: unknown = await handler({ request, url, externals: [...externals] });
      if (!isObject(map)) throw new Error("importmap must return an import map, e.g. { imports: { ... } }");
      return map as ImportMap;
    }

    type ServeImportMapInput = { as: "html" | "js" };

    function serveImportMap({ as }: ServeImportMapInput): (c: AppContext) => Promise<Response> {
      return async (c) => {
        let map: ImportMap | null;
        try {
          map = await resolveImportMap({ c });
        } catch (error) {
          return failure({ c, options, error, as: "text", where: "importmap" });
        }
        if (!map) return c.text("Not Found", 404);
        // Built per request, so never cached; POST works for the same reason.
        c.header("cache-control", "no-store");
        const json = JSON.stringify(map).replace(/</g, "\\u003c");
        if (as === "html") return c.html(`<script type="importmap">${json}</script>`);
        c.header("content-type", "application/javascript; charset=utf-8");
        return c.body(importMapInserter({ json }));
      };
    }

    app.on(["GET", "POST"], path, serveImportMap({ as: "html" }));
    app.on(["GET", "POST"], `${path}.js`, serveImportMap({ as: "js" }));
  }

  app.get("/", async (c) => {
    const html = options.loadIndex ? await options.loadIndex() : null;
    return html === null ? c.text("Not Found", 404) : c.html(html);
  });

  // It names the build's entry, so it must never be cached; the entry
  // itself is under `/assets/`, cached for good.
  app.get("/index.js", async (c) => {
    if (!options.loadEntryClient) return c.text("Not Found", 404);
    try {
      const code = await options.loadEntryClient();
      if (!code) return c.text("Not Found", 404);
      c.header("content-type", "application/javascript; charset=utf-8");
      c.header("cache-control", "no-store");
      return c.body(code);
    } catch (error) {
      return failure({ c, options, error, as: "text", where: "/index.js" });
    }
  });

  // Values that change without a build: apart from `/index.js`, cached for
  // a while. It takes no input from the request.
  app.get("/env.js", async (c) => {
    if (!options.publicEnv) return c.text("Not Found", 404);
    try {
      const env = await options.publicEnv();
      if (Object.keys(env).length === 0) return c.text("Not Found", 404);
      c.header("content-type", "application/javascript; charset=utf-8");
      c.header("cache-control", envCacheControl({ raw: readRuntimeEnv("DROPLETS_ENV_MAX_AGE"), devLog: options.devLog }));
      return c.body(publicEnvScript(serverKey(element, options.buildHash ?? ""), env));
    } catch (error) {
      return failure({ c, options, error, as: "text", where: "/env.js" });
    }
  });

  // A fixed URL a page links itself: like `/index.js`, never cached. It
  // imports the shared stylesheet, which is under `/assets/`, cached for good.
  app.get("/index.css", async (c) => {
    if (!options.loadGlobalStyle) return c.text("Not Found", 404);
    try {
      const css = await options.loadGlobalStyle();
      if (!css) return c.text("Not Found", 404);
      c.header("content-type", "text/css; charset=utf-8");
      c.header("cache-control", "no-store");
      return c.body(css);
    } catch (error) {
      return failure({ c, options, error, as: "text", where: "/index.css" });
    }
  });

  app.get("/droplets/:droplet/style.css", async (c) => {
    const droplet = c.req.param("droplet");
    const meta = await dropletMeta({ options, droplet });
    if (!meta.exists || !options.dropletStyles) return c.text("Not Found", 404);
    try {
      const files = await options.dropletStyles(droplet);
      // An empty stylesheet is never generated: nothing links to it either.
      if (files.length === 0) return c.text("Not Found", 404);
      c.header("content-type", "text/css; charset=utf-8");
      cacheForever({ c });
      return c.body(styleImports({ files }));
    } catch (error) {
      return failure({ c, options, error, as: "text", where: "droplet style" });
    }
  });

  app.get("/droplets/:droplet/client.js", async (c) => {
    const droplet = c.req.param("droplet");
    const meta = await dropletMeta({ options, droplet });
    // No JavaScript unless the droplet hydrates; styles are still served.
    if (!meta.exists || meta.hydrate === false || !options.loadClientModule) {
      return c.text("Not Found", 404);
    }

    try {
      const code = await options.loadClientModule(droplet);
      if (!code) return c.text("Not Found", 404);
      c.header("content-type", "application/javascript; charset=utf-8");
      cacheForever({ c });
      return c.body(code);
    } catch (error) {
      return failure({ c, options, error, as: "text", where: "client module" });
    }
  });

  type PrepareInput = { ctx: DropletContext };

  /** Runs the props schema; the result replaces the props everywhere. */
  async function prepare({ ctx }: PrepareInput): Promise<void> {
    if (!options.validateProps || ctx.prepared) return;
    const props = await options.validateProps(ctx.droplet, ctx.wire.props);
    ctx.wire.props = props;
    ctx.event.props = props;
    ctx.prepared = true;
  }

  type PrerenderedInput = { ctx: DropletContext };

  /**
   * The build-time render for these props, when the droplet has them: the
   * one made for this host (origin and path), else the one made for `host`
   * of the config, else the host-agnostic one, with its tokens replaced by
   * this host. `null` means render live; props
   * `entries` did not list answer 404 when the droplet cannot render on the
   * server (`ssr = false`).
   */
  async function prerendered({ ctx }: PrerenderedInput): Promise<PrerenderedDroplet | null> {
    if (!ctx.meta.prerender || !options.loadPrerendered || options.building) return null;
    const key = propsKey(ctx.event.props);
    const host = ctx.event.host;
    const found =
      (await options.loadPrerendered(ctx.droplet, prerenderKey({ key, host }), ctx.event)) ??
      (options.host === undefined
        ? null
        : await options.loadPrerendered(ctx.droplet, prerenderKey({ key, host, isOriginOnly: true }), ctx.event)) ??
      (await options.loadPrerendered(ctx.droplet, key, ctx.event));
    if (!found && !ctx.meta.ssr) throw new HttpError(404);
    if (!found) return null;
    if (!tokens) return found;
    const stored = tokens.hostTokens({ nonce: typeof found.nonce === "string" ? found.nonce : "" });
    // Before `transform`: it sees the HTML as a live render would be.
    const values = { host, location: ctx.dropletLocation };
    return {
      ...found,
      html: tokens.replaceHostTokens({ html: found.html, values, tokens: stored }),
      ...(found.failed
        ? { error: tokens.replaceHostTokensInData({ data: found.error, values, tokens: stored }) }
        : { data: tokens.replaceHostTokensInData({ data: found.data, values, tokens: stored }) }),
    };
  }

  /**
   * A live answer with the SSR bundle's tokens replaced for this request,
   * so the files it imports and `droplet.url()` outside a request point at
   * the location. A stored render had its tokens replaced already: nothing
   * is left to replace in it.
   */
  function liveHtml({ ctx, html }: LiveHtmlInput): string {
    return tokens && liveTokens
      ? tokens.replaceHostTokens({ html, values: { host: ctx.event.host, location: ctx.dropletLocation }, tokens: liveTokens })
      : html;
  }
  function liveData<T>({ ctx, data }: LiveDataInput<T>): T {
    return tokens && liveTokens
      ? tokens.replaceHostTokensInData({ data, values: { host: ctx.event.host, location: ctx.dropletLocation }, tokens: liveTokens })
      : data;
  }

  type LoadPayloadInput = { ctx: DropletContext };

  /** The server load alone, or a payload without load: `{ data: undefined }`. */
  async function loadPayload({ ctx }: LoadPayloadInput): Promise<DropletPayload> {
    return options.loadDropletData ? await options.loadDropletData(ctx.droplet, ctx.event) : { data: undefined };
  }

  /**
   * Server data only: used by client-only droplets and by HMR refreshes.
   * `{ data }`, or `{ error }` with a 500 when a load failed; `error()`,
   * `redirect()` and unhandled failures answer as an endpoint does.
   */
  // The fragment and `_data` take GET and POST (the browser POSTs its
  // context; a GET with the query is for people and tools); HEAD is Hono's
  // GET without a body, OPTIONS is `cors()`'s. Any other method is 405 on a
  // droplet that exists, 404 on one that does not, before anything is read.
  const renderMethods: MiddlewareHandler<AppEnv> = async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === "GET" || method === "POST" || method === "HEAD" || method === "OPTIONS") return next();
    const meta = await dropletMeta({ options, droplet: c.req.param("droplet") as string });
    return meta.exists ? methodNotAllowed({ c, allow: "GET, POST" }) : notFound({ c });
  };
  app.use("/droplets/:droplet", renderMethods);
  app.use("/droplets/:droplet/_data", renderMethods);

  app.on(["GET", "POST"], "/droplets/:droplet/_data", dropletMiddleware, async (c) => {
    const ctx = dropletContext({ c });
    try {
      await prepare({ ctx });
      // A no-JavaScript action's result for this droplet: live, never stored.
      const carried = await formFromHost({ c, ctx });
      const found = carried ? null : await prerendered({ ctx });
      const payload: DropletPayload = found
        ? found.failed
          ? { failed: true, error: found.error }
          : { data: found.data }
        : await loadPayload({ ctx });
      if (payload.failed) return c.json(liveData({ ctx, data: { error: payload.error ?? null } }), 500);
      applyHeaders({ c, headers: found ? storedHeaders({ value: found.headers }) : ctx.headers });
      if (!carried) return c.json(liveData({ ctx, data: { data: payload.data } }));
      // One visitor's result: never kept by a shared cache.
      c.header("cache-control", "private, no-store");
      const answer = carried.form === undefined ? { data: payload.data } : { data: payload.data, form: carried.form };
      return c.json(liveData({ ctx, data: answer }));
    } catch (error) {
      return failure({ c, options, error, as: "json", where: "_data", base: ctx.event.host });
    }
  });

  type WithBuildInput = { url: string };

  /** `url` with the build hash as `?c=`, as the element asks for it. */
  function withBuild({ url }: WithBuildInput): string {
    return options.buildHash ? `${url}?c=${encodeURIComponent(options.buildHash)}` : url;
  }

  type FragmentAssetsInput = { ctx: DropletContext };

  /**
   * The droplet's stylesheet for the element, and the `Link` header: its
   * stylesheets as `preload`, the entry and, for a droplet that hydrates at
   * once, its bundle as `modulepreload`. A host that passes the header on
   * starts these downloads before its page reaches the element. Absolute,
   * on the public origin: the host's page is on another one.
   */
  async function fragmentAssets({ ctx }: FragmentAssetsInput): Promise<FragmentAssets> {
    const base = ctx.dropletLocation.replace(/\/$/, "");
    const path = `${base}/droplets/${encodeURIComponent(ctx.droplet)}`;
    const styles = options.dropletStyles ? await options.dropletStyles(ctx.droplet) : [];
    const stylesheet = styles.length ? withBuild({ url: `${path}/style.css` }) : undefined;
    if (options.linkHeader === false) return { stylesheet, link: "" };
    const links: string[] = [];
    if (stylesheet) links.push(`<${stylesheet}>; rel=preload; as=style`);
    for (const file of styles) links.push(`<${base}/${file}>; rel=preload; as=style`);
    const entry = options.entryModule ? await options.entryModule() : null;
    if (entry) links.push(`<${base}/${entry}>; rel=modulepreload`);
    // A lazy droplet's bundle waits for its moment; preloading it would not.
    if (ctx.meta.hydrate === true) links.push(`<${withBuild({ url: `${path}/client.js` })}>; rel=modulepreload`);
    return { stylesheet, link: links.join(", ") };
  }

  type ErrorHtmlInput = { ctx: DropletContext; error: unknown };

  /** The error page's HTML with its `head` (styles), or `""` when there is none. */
  async function errorHtml({ ctx, error }: ErrorHtmlInput): Promise<{ html: string; renderId?: string | undefined }> {
    const page = options.renderError ? await options.renderError(ctx.droplet, error, ctx.event.props) : null;
    return page ? { html: `${page.head ?? ""}${page.html ?? page.body ?? ""}`, renderId: page.renderId } : { html: "" };
  }

  // The fragment: the droplet without a page shell, for embedding. GET takes
  // props from the query string; POST takes them from a JSON body, for props
  // too large or too structured for a URL. Both answer the same HTML. After
  // a form action, `action` holds its result: the droplet renders live with
  // `form`, answered with the action's status.
  type FragmentInput = { c: AppContext; action?: { form: unknown; status: number } | undefined };

  async function fragment({ c, action }: FragmentInput): Promise<Response> {
    const ctx = dropletContext({ c });
    /** The result came back on `host`, after a no-JavaScript submit. */
    let carried = false;
    let html = "";
    let renderId: string | undefined;
    let payload: DropletPayload = { data: undefined };
    let assets: FragmentAssets;
    let contextData: string;
    // What the load set, or what a build-time render kept.
    let answerHeaders: Iterable<[string, string]> = ctx.headers;
    try {
      await prepare({ ctx });

      // At build: render both ways regardless of `ssr`, and hand it to the build.
      if (options.building) {
        const probe = c.get("hostProbe");
        let result: RenderResult | null;
        try {
          result = await options.renderDroplet(ctx.droplet, ctx.event);
        } catch (error) {
          const violation = probe?.violation ?? c.get("prerenderViolation");
          if (isHostUrlPropsErrorInPrerender(error) || isCookiesInPrerenderError(error) || violation) {
            return hostInPrerender({ c, error: violation ?? error });
          }
          throw error;
        }
        // Read and caught by the droplet's own code: still a render that needs a host.
        if (probe?.violation) return hostInPrerender({ c, error: probe.violation });
        if (!result) return c.text("Not Found", 404);
        // A render for a known host is stored for that host only.
        const key =
          probe?.host === ctx.event.host
            ? propsKey(ctx.event.props)
            : prerenderKey({ key: propsKey(ctx.event.props), host: ctx.event.host, isOriginOnly: c.get("configHost") === ctx.event.host });
        // The tokens' nonce goes to the build with the render, and stays on
        // the server. Every render with tokens has one: its location is a
        // token too, unless the build fixes it.
        const nonce = buildTokens ? { nonce: buildNonce } : {};
        if (result.failed) {
          const page = await errorHtml({ ctx, error: result.error });
          return c.json({ key, html: page.html, renderId: page.renderId, failed: true, error: result.error, ...nonce });
        }
        // What the load set travels with the render, to be served with it.
        const headers = [...ctx.headers].length > 0 ? { headers: Object.fromEntries(ctx.headers) } : {};
        return c.json({
          key,
          html: result.html ?? result.body ?? "",
          renderId: result.renderId,
          data: result.serverData,
          ...nonce,
          ...headers,
        });
      }

      // After a no-JavaScript submit, the page's URL carries the result
      // back: the droplet renders with it as `form`, as after any action
      // (live, never a stored render), answered `200`: the page is fine.
      if (!action && !ctx.clientOnly) {
        const found = await formFromHost({ c, ctx });
        if (found) {
          action = { form: found.form, status: 200 };
          carried = true;
        }
      }

      // +error.* is the droplet's error boundary: it follows the droplet's
      // flags, rendered on the server and hydrated as the droplet would be.
      let rendered = false;
      if (!ctx.clientOnly) {
        // An action's result is this request's alone: never a stored render.
        const found = action ? null : await prerendered({ ctx });
        if (found) {
          answerHeaders = storedHeaders({ value: found.headers });
          payload = found.failed ? { failed: true, error: found.error } : { data: found.data };
          html = ctx.noSSR ? "" : found.html;
          renderId = found.renderId;
          rendered = true;
        } else if (ctx.meta.ssr && !ctx.noSSR) {
          const result =
            action?.form === undefined
              ? await options.renderDroplet(ctx.droplet, ctx.event)
              : await options.renderDroplet(ctx.droplet, ctx.event, { form: action.form });
          if (!result) return c.text("Not Found", 404);
          if (result.failed) {
            payload = { failed: true, error: result.error };
          } else {
            payload = { data: result.serverData };
            html = result.html ?? result.body ?? "";
            renderId = result.renderId;
            rendered = true;
          }
        } else {
          // No markup, but the server load still runs so data arrives inline.
          payload = await loadPayload({ ctx });
        }
      }
      if (payload.failed && !rendered && !ctx.noSSR && ctx.meta.ssr) {
        const page = await errorHtml({ ctx, error: payload.error });
        html = page.html;
        renderId = page.renderId;
      }

      html = liveHtml({ ctx, html });
      if (html && options.transformDroplet) {
        // `setHeaders` belongs to the load; `transform` only rewrites HTML.
        const { setHeaders: _setHeaders, ...event } = ctx.event;
        html = await options.transformDroplet(ctx.droplet, { ...event, html });
      }
      assets = await fragmentAssets({ ctx });
      contextData = serializeBase64({ data: ctx.wire });
    } catch (error) {
      // `error()`, `redirect()`, props the schema refused, and failures the
      // droplet cannot show: answered as an endpoint does.
      return failure({ c, options, error, as: "text", where: "droplet", base: ctx.event.host });
    }

    // Always an envelope, even around `undefined`: its presence tells the
    // client the server ran and `_data` is not needed. Client-only fragments
    // carry none, nor do components that never run in the browser.
    const hydrates = ctx.meta.hydrate !== false;
    // With server markup (rendered live, or stored at build whatever `ssr`
    // says), the context rides in its script; without, on the attribute.
    // A droplet that never runs in the browser carries none: an enhanced
    // form takes its props from its action URL.
    const context = hydrates ? contextData : "";
    const inlineContext = html ? context : "";
    // The action's result goes with the data, so hydration sees the `form` the server rendered with.
    const form = action?.form === undefined ? {} : { form: action.form };
    const envelope = liveData({ ctx, data: payload.failed ? { error: payload.error ?? null } : { data: payload.data, ...form } });
    if (assets.link) c.header("link", assets.link);
    // An error page carries none: a cache-control meant for the droplet's
    // content must not keep its failure.
    if (!payload.failed) applyHeaders({ c, headers: answerHeaders });
    // One visitor's result: never kept by a shared cache.
    if (carried) c.header("cache-control", "private, no-store");
    return c.html(
      dropletElement({
        element,
        droplet: ctx.droplet,
        build: options.buildHash,
        html,
        // Only server markup has an id to hydrate with.
        renderId: html ? renderId : undefined,
        dropletData: hydrates && !ctx.clientOnly ? serializeBase64({ data: envelope }) : "",
        dropletContext: inlineContext,
        // Without an inline script the client reads the context off the attribute.
        contextAttr: inlineContext ? undefined : context || undefined,
        // The client hydrates the error page instead of the droplet.
        error: payload.failed === true,
        stylesheet: assets.stylesheet,
      }),
      payload.failed ? 500 : ((action?.status ?? 200) as 200),
    );
  }

  type BackPageInput = { c: AppContext; allowed: ReadonlySet<string> };

  /**
   * The page a form posted without JavaScript goes back to, each candidate
   * a `backTarget`. The `Referer` when it is the page `__droplet_return`
   * names (it keeps the page's query); else `__droplet_return`, which a
   * cross-origin `Referer` lacks (the origin alone, under
   * `strict-origin-when-cross-origin`); else a `Referer` on its own.
   * `null` when none is.
   */
  function backPage({ c, allowed }: BackPageInput): URL | null {
    const servers = [new URL(c.req.url).origin, publicLocation({ c })];
    const referer = backTarget({ value: c.get("referer"), allowed, servers });
    const named = new URL(c.req.url).searchParams.getAll(RETURN_KEY);
    // Once, and a page's origin and path only: its own query or hash is no part of it.
    const [name] = named;
    const target =
      name !== undefined && named.length === 1 && name.length <= RETURN_MAX_LENGTH ? backTarget({ value: name, allowed, servers }) : null;
    const page = target ? new URL(`${target.origin}${target.pathname}`) : null;
    if (referer && page && pageOf({ url: referer }) === pageOf({ url: page })) return referer;
    return page ?? referer;
  }

  type RunActionInput = { c: AppContext };

  /**
   * A form action: `POST /droplets/<id>` with a form body, `?/name` naming
   * the action (none is `default`). The droplet, its `actions` and the name
   * are resolved first; the body is read by the action alone, and only once
   * it was found. A request that accepts JSON gets the result as
   * `{ type, status, data | location }`. Any other is a native form post
   * (no JavaScript), answered Post/Redirect/Get: a `303` back to the page
   * it came from (its `Referer`, on this server or a trusted origin) with
   * the result signed in `__droplet_form_<droplet>_<build>`, or a `303` to
   * where `redirect()` points (on the same origins). Without
   * `DROPLETS_SECRET` the result cannot travel: the fragment is rendered
   * again with `form` instead.
   */
  async function runAction({ c }: RunActionInput): Promise<Response> {
    c.set("isAction", true);
    const ctx = dropletContext({ c });
    const named = [...new URL(c.req.url).searchParams.keys()].filter((key) => key.startsWith("/"));
    if (named.length > 1) return c.text("One action per request: ?/name once", 400);
    const name = named[0]?.slice(1) ?? "default";

    let action: Action | "none" | "missing";
    try {
      action = options.findAction ? await options.findAction(ctx.droplet, name) : "none";
    } catch (error) {
      return failure({ c, options, error, as: "text", where: "actions" });
    }
    if (action === "none") return c.text("Method Not Allowed: this droplet has no form actions", 405, { allow: "GET" });
    // The name is echoed only when it is one an action could have: anything else is not worth repeating.
    if (action === "missing")
      return c.text(ACTION_NAME.test(name) ? `No action named ${JSON.stringify(name.slice(0, 100))}` : "No such action", 404);

    // The request decides: one that prefers JSON (`enhanceDropletForm`, or
    // any script) gets the result; anything else is a native navigation.
    const wantsJson = prefersJson({ accept: c.req.header("accept") });
    const allowed = redirectOrigins({ c, trusted: formOriginsOf({ options }) });
    const secret = wantsJson ? null : formSecret({ raw: readRuntimeEnv("DROPLETS_SECRET"), devLog: options.devLog });
    // Where the answer goes back to, known before the action runs (from
    // the URL and the headers, never the body): a post that cannot be
    // answered changes nothing.
    const back = secret ? backPage({ c, allowed }) : null;
    if (secret && !back) {
      return c.text(
        "Bad Request: a form posted without JavaScript is sent back to its page, and neither the action URL's __droplet_return nor the Referer names one on this server or a trusted origin",
        400,
      );
    }

    let outcome: ActionResult;
    try {
      await prepare({ ctx });
      const event: ActionEvent = {
        request: ctx.event.request,
        host: ctx.event.host,
        locals: ctx.event.locals,
        platform: ctx.event.platform,
        // Unlike a load, an action may set cookies.
        cookies: c.get("event").cookies,
        // The load that runs next shares it: each header is set once per answer.
        setHeaders: ctx.event.setHeaders,
        droplet: ctx.droplet,
        props: ctx.event.props,
        fetch: ctx.event.fetch,
      };
      let result: unknown;
      try {
        result = await action(event);
      } catch (thrown) {
        // `redirect()` and a `fail()` may be thrown as well as returned.
        if (!isRedirect(thrown) && !isActionFailure(thrown)) throw thrown;
        result = thrown;
      }
      outcome = actionOutcome({ droplet: ctx.droplet, name, result, host: ctx.event.host });
    } catch (error) {
      if (error instanceof ActionDataError) {
        console.error(`form action failed: ${c.req.path}`, error);
        const message = await unexpectedMessage({ c, options, error });
        return wantsJson ? c.json({ message }, 500) : c.text(message, 500);
      }
      // `error()`, props the schema refused, and crashes: as a load's.
      return failure({ c, options, error, as: wantsJson ? "json" : "text", where: `action ${name}` });
    }

    if (outcome.type === "redirect") {
      // Followed at once, by the browser or by enhanceDropletForm: only to this server or a trusted origin.
      const target = redirectTarget({ value: outcome.location, allowed });
      if (!target) {
        return offSiteRedirect({
          c,
          as: wantsJson ? "json" : "text",
          label: `${ctx.droplet}: action ${name}`,
          what: "the action",
          location: outcome.location,
        });
      }
      applyHeaders({ c, headers: ctx.headers });
      if (wantsJson) return c.json(liveData({ ctx, data: { ...outcome, location: target.href } }), 200);
      return c.body(null, 303, { location: target.href });
    }
    if (wantsJson) {
      applyHeaders({ c, headers: ctx.headers });
      return c.json(liveData({ ctx, data: outcome }), outcome.type === "failure" ? (outcome.status as 400) : 200);
    }
    if (!secret || !back) {
      // The render that follows applies what the action and its load set.
      return fragment({ c, action: { form: outcome.data, status: outcome.status } });
    }
    const page = pageOf({ url: back });
    if (page === undefined) throw new Error("droplets: the page a form goes back to has no origin");
    const minted = await mintFormResult({
      secret,
      scope: { droplet: ctx.droplet, build, page },
      result: {
        action: name,
        status: outcome.status,
        ...(outcome.data === undefined ? {} : { data: liveData({ ctx, data: outcome.data }) }),
      },
    });
    if (minted.dropped) options.devLog?.resultTooLarge({ droplet: ctx.droplet, action: name });
    applyHeaders({ c, headers: ctx.headers });
    // Its location carries one visitor's result: never kept by a shared cache.
    c.header("cache-control", "private, no-store");
    return c.body(null, 303, { location: withFormResult({ page: back, key: formResultKey(ctx.droplet, build), value: minted.value }) });
  }

  type RenderWithFormInput = { c: AppContext };

  /**
   * A JSON render that carries `form` (`{ host, props, form }`): the result
   * of an action the page already ran, sent back by an element whose
   * droplet does not render in the browser (`hydrate = false`) after
   * `enhanceDropletForm`, so the server renders it with `form`. Plain JSON
   * by construction, display-only like any `form`, and for a droplet with
   * `actions` only; it renders live, never from a stored render.
   */
  async function renderWithForm({ c }: RenderWithFormInput): Promise<Response> {
    const body = c.get("body");
    const form = body && Object.hasOwn(body, "form") ? body["form"] : undefined;
    if (form === undefined || !options.findAction) return fragment({ c });
    let actions: Action | "none" | "missing";
    try {
      actions = await options.findAction(dropletContext({ c }).droplet, "default");
    } catch (error) {
      return failure({ c, options, error, as: "text", where: "actions" });
    }
    return actions === "none" ? fragment({ c }) : fragment({ c, action: { form, status: 200 } });
  }

  app.get("/droplets/:droplet", dropletMiddleware, (c) => fragment({ c }));
  app.post("/droplets/:droplet", dropletMiddleware, (c) => {
    // The body type decides: JSON renders, a form runs an action.
    const type = mediaType({ request: c.req.raw });
    if (FORM_TYPES.has(type)) return runAction({ c });
    if (type === "text/plain") return c.text("Unsupported Media Type: send a form, or JSON to render", 415);
    if ([...new URL(c.req.url).searchParams.keys()].some((key) => key.startsWith("/"))) {
      return c.text("Bad Request: form actions take a form body, not JSON", 400);
    }
    return renderWithForm({ c });
  });

  // `+server.ts` endpoints.
  const api = async (c: AppContext) => {
    const match = options.matchApi ? await options.matchApi(c.req.path) : null;
    if (!match) return notFound({ c });

    const module = match.route.module;
    const upper = c.req.method.toUpperCase();
    // Only the HTTP methods reach an export of their name: `CONFIG` is never
    // one. `fallback` takes every method the module does not export, any
    // other method included.
    const method = (API_METHODS as readonly string[]).includes(upper) ? (upper as ApiMethod) : undefined;
    const isHead = method === "HEAD" && typeof module.HEAD !== "function";
    const named = method ? (isHead ? module.GET : Object.hasOwn(module, method) ? module[method] : undefined) : undefined;
    const handler = named ?? module.fallback;
    if (typeof handler !== "function") {
      const allow = allowedMethods({ module }).join(", ");
      return c.json({ message: "Method Not Allowed" }, 405, allow ? { allow } : {});
    }

    const event: RequestEvent = { ...c.get("event"), params: match.params };
    try {
      const response: unknown = await handler(event);
      if (!isResponse(response)) {
        throw new Error(`${match.route.id} ${upper} must return a Response`);
      }
      return isHead ? new Response(null, response) : response;
    } catch (error) {
      return failure({ c, options, error, as: "json", where: "endpoint" });
    }
  };
  app.all("/api", api);
  app.all("/api/*", api);

  return app;
}
