/**
 * `$droplets/server`: what server-side code imports. Request events, the
 * `handle` hook type, and the response helpers. Hono never shows up here:
 * everything is a web-standard `Request` in and `Response` out.
 *
 * Runtime-neutral, so the same module runs on Node, Workers, Deno and Bun.
 */
import { requestInfo } from "./request-store.ts";
import { webUrl, withinTrusted } from "./web-url.ts";

/**
 * Request-scoped data, filled in by `handle` in `src/hooks.server.ts`.
 * Augment it to type your own fields:
 *
 * ```ts
 * declare module "@dropletsjs/droplets/server" {
 *   interface Locals { user?: { id: string } }
 * }
 * ```
 */
export interface Locals {
  [key: string]: unknown;
}

/**
 * Whatever the runtime hands the server. On Cloudflare `env` holds the
 * bindings (KV, D1, R2…) and `context` the execution context; on Node `env`
 * holds the raw `incoming`/`outgoing` objects.
 */
export interface Platform {
  env?: unknown;
  context?: unknown;
}

/** Options of `cookies.get` and `cookies.getAll`. */
export type CookieParseOptions = {
  /** Turns the raw value into the one returned. Default: `decodeURIComponent`. */
  decode?: (value: string) => string;
};

/**
 * Options of `cookies.set`, `cookies.delete` and `cookies.serialize`.
 * `path` is required and absolute; `httpOnly`, `secure` and `sameSite: "lax"`
 * are on unless turned off (`secure` is off over plain HTTP to `localhost`
 * or a loopback address, such as the dev server).
 */
export type CookieSerializeOptions = {
  path: string;
  domain?: string;
  expires?: Date;
  /** Seconds. */
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  /** `true` is `"strict"`. */
  sameSite?: boolean | "lax" | "strict" | "none";
  partitioned?: boolean;
  priority?: "low" | "medium" | "high";
  /** Turns the value into what is sent. Default: `encodeURIComponent`. */
  encode?: (value: string) => string;
};

/**
 * `event.cookies`, as in SvelteKit: the request's cookies, and the ones to
 * send. What `set` and `delete` record goes out as `Set-Cookie` on the
 * response, whatever answers it; `get` and `getAll` see them at once. Not
 * available while prerendering: there is no request at build.
 */
export interface Cookies {
  /** The cookie's value, `undefined` when there is none. */
  get(name: string, options?: CookieParseOptions): string | undefined;
  getAll(options?: CookieParseOptions): Array<{ name: string; value: string }>;
  set(name: string, value: string, options: CookieSerializeOptions): void;
  /** Expires the cookie; `path` (and `domain`) must match the ones it was set with. */
  delete(name: string, options: CookieSerializeOptions): void;
  /** The `Set-Cookie` value, with the same defaults, for a response built by hand. */
  serialize(name: string, value: string, options: CookieSerializeOptions): string;
}

/**
 * The cookies a droplet's `load` and `transform` receive: read only. Set
 * cookies in `handle`, `+server.ts` (and form actions): a droplet's render
 * may be fetched by a host's server, which would have to pass them on.
 */
export type ReadonlyCookies = Pick<Cookies, "get" | "getAll">;

/**
 * `setHeaders` in a droplet's `load`, as in SvelteKit: headers for the
 * fragment and `_data` answers, such as `cache-control` (by default
 * `private, no-store`). Each header can be set once; `set-cookie` cannot be
 * set here. Applied when the droplet renders or loads; an error answer
 * carries none. A prerendered render keeps the headers its load set.
 */
export type SetHeaders = (headers: Record<string, string>) => void;

/** What `handle`, `+server.ts` handlers and droplet loads receive. */
export type RequestEvent<Params extends Record<string, string> = Record<string, string>> = {
  request: Request;
  /** The request URL, on the public origin a trusted proxy named (see `origin` in the config). */
  url: URL;
  /**
   * Where the droplet renders: the host page. Taken the classic way: the
   * `host` a render request sends in its JSON body, else `Forwarded`, else
   * `X-Forwarded-Proto` + `X-Forwarded-Host`, else `Origin`, else the
   * request's own origin. Headers carry no path, so it is `/` unless the
   * body gave one. Only `http:` and `https:` URLs count, without
   * credentials or hash. With `trustedOrigins` set, a host outside it (and
   * not this server) is replaced by this server's origin. `handle` may
   * replace it (`event.host = new URL(…)`); droplets see it as `handle` left
   * it. It is what the client says: data to render with, never a proof of
   * who is asking.
   */
  host: URL;
  /** Route parameters, from `[name]` and `[...rest]` folders under `src/api`. */
  params: Params;
  locals: Locals;
  platform: Platform;
  /** The request's cookies, and the ones the response sets. */
  cookies: Cookies;
};

/**
 * What `load` in `+droplet.server.ts` receives. A droplet has no route
 * parameters, only the props its caller passed.
 */
export type LoadEvent = Omit<RequestEvent, "params" | "url" | "cookies"> & {
  /** The request's cookies, read only: see `ReadonlyCookies`. */
  cookies: ReadonlyCookies;
  /** Headers for this droplet's answer: see `SetHeaders`. */
  setHeaders: SetHeaders;
  /**
   * Where the droplet renders, as `RequestEvent.host`. The fragment's own
   * URL is `request.url`. While prerendering it is the entry's `host`,
   * `prerender.host`, `PUBLIC_URL`, or else a stand-in: `host.origin`,
   * `host.pathname` and `host.href` give tokens the server replaces per
   * request, any other field throws `HostUrlPropsErrorInPrerender` and stops
   * the build.
   */
  host: URL;
  /** The droplet id. */
  droplet: string;
  /**
   * Caller-supplied props (query string, `x-droplet-props` or POST body),
   * after the `props` schema in `+droplet.ts` when there is one. Anyone can
   * send any props: the schema checks their shape, not who may see what.
   * Decide that from `cookies` and `locals`.
   */
  props: Record<string, unknown>;
};

/**
 * What a form action in `+droplet.server.ts` receives. The body is unread:
 * the action reads it (`await request.formData()`) and checks what it got.
 * Unlike a load, it may set cookies.
 */
export type ActionEvent = Omit<RequestEvent, "params" | "url"> & {
  /** Headers for this answer, with the load's rules: see `SetHeaders`. */
  setHeaders: SetHeaders;
  /** The droplet id. */
  droplet: string;
  /**
   * The droplet's props, from the action URL's query string (or
   * `x-droplet-props`), after the `props` schema: never from the form body.
   */
  props: Record<string, unknown>;
};

/**
 * One export of `actions` in `+droplet.server.ts`. It returns plain JSON
 * data (or nothing) for a success, `fail(status, data)` for a failure, or
 * throws (or returns) `redirect()`; `error()` answers as in a load.
 */
export type Action<Out = unknown> = (event: ActionEvent) => Out | Promise<Out>;

/** `actions` in `+droplet.server.ts`, for `satisfies Actions`. */
export type Actions = Record<string, Action>;

/**
 * What a form action answers as JSON, to a request that accepts
 * `application/json`: plain data, never a reference.
 */
export type ActionResult =
  | { type: "success"; status: 200; data?: unknown }
  | { type: "failure"; status: number; data?: unknown }
  | { type: "redirect"; status: number; location: string };

/**
 * What `load` in `+droplet.ts` receives, on the server and in the browser.
 * Its result is the component's `data`.
 */
export type DropletLoadEvent = {
  /**
   * As `LoadEvent.host` on the server; in the browser, the page itself
   * (`window.location`), read when the droplet mounts.
   */
  host: URL;
  /** The props, after the `props` schema. */
  props: Record<string, unknown>;
  /** What `load` in `+droplet.server.ts` returned; `undefined` without one. */
  data: unknown;
};

/** What `handleError` in `src/hooks.server.ts` receives. */
export type HandleServerErrorInput = {
  error: unknown;
  event: RequestEvent;
  /** 500 for an unexpected error. */
  status: number;
  /** "Internal Server Error". */
  message: string;
};

/**
 * `handleError` in `src/hooks.server.ts`: the last stop before an
 * unexpected error leaves the server (`handle`, `+server.ts`, `importmap`,
 * a droplet that cannot show its error). Log it and choose the message the
 * answer carries; returning nothing keeps "Internal Server Error".
 */
export type HandleServerError = (
  input: HandleServerErrorInput,
) => { message: string } | void | Promise<{ message: string } | void>;

/**
 * `handleError` in `+droplet.server.ts` or `+droplet.ts`: turns what a load
 * threw into what `+error.*` receives as `error`. The server one runs
 * first, on the server only: put it there to keep internals off the page.
 * Throwing renders nothing.
 */
export type HandleDropletError = (input: {
  error: unknown;
}) => { error: unknown } | Promise<{ error: unknown }>;

/** An import map, as the browser reads it. */
export type ImportMap = {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
  integrity?: Record<string, string>;
};

/** What `importmap` in `src/importmap.server.ts` receives. */
export type ImportMapEvent = {
  request: Request;
  /** The request URL, on the public origin a trusted proxy named (see `origin` in the config). */
  url: URL;
  /**
   * The bare imports the client build leaves external, from the Vite config
   * (`environments.client.build.rolldownOptions.external`). Map them, or not.
   */
  externals: string[];
};

/** The `importmap` export of `src/importmap.server.ts`. */
export type ImportMapHandler = (event: ImportMapEvent) => ImportMap | Promise<ImportMap>;

/**
 * What `transform` in `+droplet.server.ts` receives: the droplet's own HTML,
 * per request, whether it was rendered now or at build.
 */
export type TransformEvent = Omit<LoadEvent, "setHeaders"> & {
  /** The droplet's rendered HTML, without the element around it. */
  html: string;
};

/**
 * `transform` in `+droplet.server.ts`: rewrites the droplet's HTML before it
 * is served, prerendered or rendered live. A list runs in order.
 */
export type Transform = (event: TransformEvent) => string | Promise<string>;
export type TransformInput = Transform | Transform[];

/**
 * One render `entries` asks for: the event its loads run with. `props` are
 * the droplet's props (`{}` without them); `host` is where it renders. Without
 * `host`, `prerender.host` from `droplets()` applies, then `PUBLIC_URL`, then
 * a stand-in that keeps the render host-agnostic (see `LoadEvent.host`).
 */
export type PrerenderEntry = {
  props?: Record<string, unknown>;
  host?: string | URL;
};

/** `entries` in `+droplet.server.ts`: the renders to make at build. */
export type Entries = () => PrerenderEntry[] | Promise<PrerenderEntry[]>;

/** An export of `+server.ts`: `GET`, `POST`, … or `fallback`. */
export type RequestHandler<Params extends Record<string, string> = Record<string, string>> = (
  event: RequestEvent<Params>,
) => Response | Promise<Response>;

export type ResolveFunction = (event: RequestEvent) => Promise<Response>;

/**
 * The `handle` export of `src/hooks.server.ts`. Runs for every request
 * except the health check: fill `event.locals`, answer early without calling
 * `resolve`, or change the response `resolve` returns.
 */
export type Handle = (input: {
  event: RequestEvent;
  resolve: ResolveFunction;
}) => Response | Promise<Response>;

const HTTP_ERROR = Symbol.for("droplets.http-error");
const REDIRECT = Symbol.for("droplets.redirect");
const HOST_IN_PRERENDER = Symbol.for("droplets.host-in-prerender");

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  410: "Gone",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

/** Thrown by `error()`. Answered with its status, never logged as a crash. */
export class HttpError {
  readonly [HTTP_ERROR] = true;
  readonly status: number;
  readonly body: { message: string };

  constructor(status: number, message?: string) {
    this.status = status;
    this.body = { message: message ?? STATUS_TEXT[status] ?? `Error ${status}` };
  }

  toString(): string {
    return `HttpError ${this.status}: ${this.body.message}`;
  }
}

/** Thrown by `redirect()`. */
export class Redirect {
  readonly [REDIRECT] = true;
  readonly status: number;
  readonly location: string;

  constructor(status: number, location: string) {
    this.status = status;
    this.location = location;
  }
}

/**
 * Stops the request and answers with `status` and `message`, as an endpoint
 * does. Works in `handle`, in `+server.ts` and in a droplet's server load,
 * where it skips `handleError` and `+error.*`: the fragment and `_data`
 * answer the status and message as they are.
 */
export function error(status: number, message?: string): never {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new Error(`error() needs a status between 400 and 599, got ${status}`);
  }
  throw new HttpError(status, message);
}

/**
 * Stops the request and redirects. Works in `handle`, in `+server.ts` and in
 * a droplet's server load, where the fragment and `_data` answer the redirect
 * itself; what the embedding page does with it is up to the page.
 */
export function redirect(status: 300 | 301 | 302 | 303 | 307 | 308, location: string | URL): never {
  if (!Number.isInteger(status) || status < 300 || status > 308) {
    throw new Error(`redirect() needs a status between 300 and 308, got ${status}`);
  }
  const target = String(location);
  if (!isRedirectTarget(target)) {
    throw new Error(
      `redirect() needs an http(s) URL or a path on this site, got ${JSON.stringify(target.slice(0, 200))}`,
    );
  }
  throw new Redirect(status, target);
}

/**
 * An `http:`/`https:` URL, or a relative reference that stays on the site
 * (`/path`, `./x`, `?q`). Not `javascript:` or another scheme, not
 * protocol-relative (`//evil.example`, `/\evil.example`), no control
 * characters: a value a client influenced cannot become a script or a
 * header break.
 */
function isRedirectTarget(target: string): boolean {
  if (target === "" || target !== target.trim() || /[\u0000-\u001f\u007f]/.test(target)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return webUrl(target) !== null;
  return !/^[\\/]{2}/.test(target);
}

const ACTION_FAILURE = Symbol.for("droplets.action-failure");

/** What `fail()` returns: a form action that did not go through, with its data. */
export class ActionFailure<Data = undefined> {
  readonly [ACTION_FAILURE] = true;
  readonly status: number;
  readonly data: Data;

  constructor(status: number, data: Data) {
    this.status = status;
    this.data = data;
  }
}

/**
 * A form action's failure, as in SvelteKit: the droplet renders again with
 * `form` set to `data` (field names and messages, plain JSON), answered with
 * `status`. Return it from the action.
 */
export function fail(status: number): ActionFailure<undefined>;
export function fail<Data>(status: number, data: Data): ActionFailure<Data>;
export function fail(status: number, data?: unknown): ActionFailure<unknown> {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new Error(`fail() needs a status between 400 and 599, got ${status}`);
  }
  return new ActionFailure(status, data);
}

/**
 * Checked by brand rather than `instanceof`: in dev the user's code and the
 * framework may load separate copies of this module.
 */
export function isActionFailure(value: unknown): value is ActionFailure<unknown> {
  return typeof value === "object" && value !== null && ACTION_FAILURE in value;
}

/**
 * Checked by brand rather than `instanceof`: in dev the user's code and the
 * framework may load separate copies of this module.
 */
export function isHttpError(value: unknown): value is HttpError {
  return typeof value === "object" && value !== null && HTTP_ERROR in value;
}

export function isRedirect(value: unknown): value is Redirect {
  return typeof value === "object" && value !== null && REDIRECT in value;
}

/**
 * Thrown while prerendering when a droplet reads a field of `host` other
 * than `origin`, `pathname` and `href`, and no host was known for the entry.
 * It stops the build: it skips `handleError` and is never stored as the
 * `+error.*` render.
 */
export class HostUrlPropsErrorInPrerender extends Error {
  readonly [HOST_IN_PRERENDER] = true;
  readonly droplet: string;
  readonly entry: string;
  readonly property: string;

  constructor(droplet: string, entry: string, property: string) {
    super(
      `${droplet}: host.${property} is not known while prerendering entry ${entry}; only host.origin, host.pathname and host.href are. Give \`host\` in the entry, set \`prerender.host\` in droplets() or PUBLIC_URL, or render it live`,
    );
    this.name = "HostUrlPropsErrorInPrerender";
    this.droplet = droplet;
    this.entry = entry;
    this.property = property;
  }
}

export function isHostUrlPropsErrorInPrerender(value: unknown): value is HostUrlPropsErrorInPrerender {
  return typeof value === "object" && value !== null && HOST_IN_PRERENDER in value;
}

const COOKIES_IN_PRERENDER = Symbol.for("droplets.cookies-in-prerender");

/**
 * Thrown while prerendering when anything uses `event.cookies`: a build-time
 * render has no request, so no cookies to read and no response to set them
 * on. Like `HostUrlPropsErrorInPrerender` it stops the build, caught or not.
 */
export class CookiesInPrerenderError extends Error {
  readonly [COOKIES_IN_PRERENDER] = true;
  readonly method: string;

  constructor(where: string, method: string) {
    super(
      `${where}: cookies.${method}() is not available while prerendering: there is no request at build. In handle, skip it when \`building\` from $droplets/env is true; in a droplet, render it live`,
    );
    this.name = "CookiesInPrerenderError";
    this.method = method;
  }
}

export function isCookiesInPrerenderError(value: unknown): value is CookiesInPrerenderError {
  return typeof value === "object" && value !== null && COOKIES_IN_PRERENDER in value;
}

function withHeader(init: ResponseInit | undefined, name: string, value: string): ResponseInit {
  const headers = new Headers(init?.headers);
  if (!headers.has(name)) headers.set(name, value);
  return { ...init, headers };
}

/** A JSON response. */
export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), withHeader(init, "content-type", "application/json"));
}

/** A plain-text response. */
export function text(body: string, init?: ResponseInit): Response {
  return new Response(body, withHeader(init, "content-type", "text/plain; charset=utf-8"));
}

/** Chains several `handle` functions; each one's `resolve` calls the next. */
export function sequence(...handlers: Handle[]): Handle {
  return ({ event, resolve }) => {
    const apply = (index: number, current: RequestEvent): Promise<Response> => {
      const handle = handlers[index];
      if (!handle) return resolve(current);
      return Promise.resolve(
        handle({ event: current, resolve: (next) => apply(index + 1, next) }),
      );
    };
    return apply(0, event);
  };
}

/**
 * A `host` for `handle` to set, checked the way the default one is: a web
 * URL (`http:` or `https:`, without credentials or hash), and, when
 * `trustedOrigins` is set, one of them or this server. `null` for anything
 * else, so a header that is missing, malformed or foreign keeps the default:
 *
 * ```ts
 * event.host = hostFrom(event.request.headers.get("referer")) ?? event.host;
 * ```
 */
export function hostFrom(value: unknown): URL | null {
  const url = webUrl(value);
  if (!url) return null;
  const info = requestInfo();
  return withinTrusted(url, info?.trustedOrigins ?? [], info?.ownOrigins ?? []) ? url : null;
}
