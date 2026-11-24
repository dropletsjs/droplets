import type { cors } from "hono/cors";
import { isLocationPrefix } from "../runtime/web-url.ts";
import {
  CACHE_CONTROL_INVALID,
  DEV_STRATEGY_INVALID,
  ELEMENT_NAME_INVALID,
  ERROR_FORMAT_INVALID,
  FOLDER_OUTSIDE_PROJECT,
  HEALTH_IMPORT_MAP_SAME_PATH,
  HOST_INVALID,
  LIMIT_INVALID,
  LOCATION_INVALID,
  PATH_RESERVED,
  RENDER_NOT_OBJECT,
  RENDER_TIMEOUT_NEGATIVE,
  RENDER_TIMEOUT_NOT_NUMBER,
  RENDER_TIMEOUT_NOT_WHOLE,
  RENDER_TIMEOUT_TOO_LONG,
  TRUSTED_ORIGIN_INVALID,
  TRUSTED_ORIGINS_NOT_LIST,
} from "../errors/config.ts";
import { dropletsError, ERROR_FORMATS, type ErrorFormat } from "../errors/format.ts";

/** Options accepted by Hono's `cors()` middleware. */
export type DropletsCorsOptions = NonNullable<Parameters<typeof cors>[0]>;

/**
 * The shape of `droplets.config.ts`'s default export. Data only: request
 * handling lives in `src/hooks.server.ts`.
 */
export type DropletsConfig = {
  /** Folder scanned for `<name>/+droplet.<ext>`. Default: `src/droplets`. */
  dropletsFolder?: string;
  /** Folder scanned for `**\/+server.ts`, served under `/api/`. Default: `src/api`. */
  apiFolder?: string;
  /**
   * Path of the health check, answering `ok`. It runs before `handle`, so an
   * auth hook cannot break it. `false` turns it off. Default: `/health`.
   */
  health?: string | false;
  /**
   * What `/` serves in `vite preview` and production. A path to an HTML file,
   * relative to the project root; by default `index.html` in the root, and a
   * small placeholder page when there is none. `false` answers 404. The file
   * is served as written, not processed by Vite. In `vite dev`, `/` belongs
   * to the devtools when they are installed.
   */
  index?: string | false;
  /**
   * Where the import map for the client's externals is served. The map comes
   * from `importmap` in `src/importmap.server.ts`; this path answers it as a
   * `<script type="importmap">` block, and `<path>.js` as a script that inserts
   * that block itself. `false` turns both off. By default `/importmap`, and
   * only when the client build has externals.
   */
  importMap?: string | false;
  /**
   * Warn in dev about the import map: externals it does not map, keys that
   * are not external, versions that differ from the installed package.
   * Default: `true`.
   */
  warnImportMap?: boolean;
  /**
   * Tag name of the custom element that hosts every droplet. Must be a valid
   * custom element name (lowercase, with a hyphen). Give each droplets server
   * its own name so several of them can share a page without colliding.
   * Default: `djs-droplet`.
   */
  element?: string;
  /**
   * Cross-origin access to the server's routes. Pages served by another
   * process need this to fetch fragments, call `/droplets/<id>/_data`, post
   * actions and reach `/env.js` and `/api/*`. The build's files (`/index.js`,
   * `/index.css`, `/assets/*`, `client.js`, `style.css`) of a built server are
   * sent with `Access-Control-Allow-Origin: *` whatever this says, so any page
   * can import them; under `vite dev` this answers for them too. `true` allows any origin; pass Hono `cors()` options to restrict it.
   * With `credentials: true` and an `origin` other than `"*"`, the browser
   * runtime's own requests (an enhanced form's post, `_data`, a fragment
   * rendered again after a post) send `credentials: "include"`, so they
   * carry this server's cookies from a page on another origin; the client
   * build learns only that boolean.
   */
  cors?: boolean | DropletsCorsOptions;
  /**
   * Where browsers reach this server, fixed at build: its public origin, with
   * the path prefix a proxy serves it under when there is one
   * (`"https://droplets.example"`, `"https://shop.example/mfe"`). The URLs the
   * server writes about itself (stylesheet, `Link`, `droplet.url()`, action
   * URLs) are on it, and no request header changes it. Without it, the
   * location is computed per request: a location header whose origin is the
   * request's own or in `trustedOrigins`, else the request's own origin.
   * `vite dev` always computes it per request.
   */
  location?: string;
  /**
   * The origin of the page every droplet renders on, fixed at build
   * (`"https://shop.example"`, no path). `event.host` is this origin, with
   * the path and query the request reports when it reports this origin, and
   * this origin alone otherwise; it joins `trustedOrigins` for form posts and
   * redirects. Prerendering renders an entry without its own `host` here,
   * and one on another origin fails the build. Without it, `event.host`
   * comes from each request. `vite dev` always takes it from the request.
   */
  host?: string;
  /**
   * Origins, besides this server's own, allowed to send form submissions:
   * the hosts whose pages post to droplets (`https://shop.example`). `"*"`
   * trusts every origin. See `csrf`. `DROPLETS_TRUSTED_ORIGINS`, a
   * comma-separated list read at runtime, adds to it without a build. When
   * the list is set, it also bounds `event.host`, a host outside it becoming
   * this server's origin, and a prerender entry's `host`, failing the build.
   * A location header naming one of them is trusted too, without `location`.
   */
  trustedOrigins?: string[];
  /**
   * The `Cache-Control` of fragments and `_data`. What they answer depends on
   * the request (`host`, props, cookies), so by default no shared cache
   * keeps them: `private, no-store, no-transform`. A string replaces it,
   * `false` sends none; a `Cache-Control` that `handle` sets wins. Whatever
   * the value, the answer carries `no-transform`, added when it is missing,
   * so no proxy rewrites a fragment; the server gzips it instead. The
   * prerender files an entry's `file` writes get it too, with `no-transform`.
   */
  fragmentCacheControl?: string | false;
  /**
   * The `Cache-Control` of `public/`, served at `/assets/public/*` in a
   * build. Its files keep their names from build to build, so by default
   * the browser revalidates them each time: `no-cache`, with an `ETag` and
   * `304`. A string replaces it, `false` sends none. Hashed files,
   * `/index.js` and `/env.js` keep their own.
   */
  publicCacheControl?: string | false;
  csrf?: {
    /**
     * Answer `403` to a `POST`, `PUT`, `PATCH` or `DELETE` that a page on
     * another site could send without a CORS preflight (a form-urlencoded,
     * multipart or `text/plain` body) unless its `Origin` is this
     * server's or in `trustedOrigins`; one without an `Origin` is refused too.
     * Covers `/droplets/*` and `/api/*`. Default: `true`.
     */
    checkOrigin?: boolean;
  };
  /**
   * Largest request bodies accepted, in bytes; bigger ones answer `413`.
   * `Infinity` lifts a limit.
   */
  limits?: Partial<BodyLimits>;
  render?: {
    /**
     * How long a droplet's loads and render may take on the server, in
     * milliseconds, from when the fragment or `_data` request starts them
     * (after `handle`, the props schema and any form action). Past it the
     * answer is `504`: the fragment with the droplet's `+error.*` page,
     * `_data` with `{ error }`. The server load sees the deadline in
     * `event.request.signal` (on Node, Bun and Deno it also aborts when the
     * client goes away): pass it to `fetch` and your database client so
     * their work stops too.
     * `0` waits for no promise; `Infinity` sets no deadline. Renders
     * prerendered by `vite build` have none. Default: `5000`.
     */
    timeout?: number;
  };
  /**
   * How every error and warning of the framework reads: in `vite build`,
   * `vite dev`, the browser and the production server. `"agent"`: a block
   * of labelled lines (`droplets error <code>`, then the droplet, the file,
   * what happened, the fix and the link to its page). `"human"`: one line
   * that ends with the link. Every message has a code and a page at
   * `https://dropletsjs.dev/errors/<code>/` either way. Default: `"agent"`.
   */
  errorFormat?: ErrorFormat;
  dev?: {
    /** Dev server port. Vite's own `server.port` takes precedence. */
    server?: { port?: number };
    /**
     * What a droplet on a page does when its files change under `vite dev`.
     * `"hmr"` (default): the framework's own HMR updates the component in
     * place (React Fast Refresh, Prefresh, Vue, Svelte, Solid refresh), an
     * engine without one remounts the droplet in place, a load edit brings
     * new data to the live component, and a change of `ssr`, `hydrate` or
     * `prerender` leaves the droplet as it is and says so; the page never
     * reloads. `"remount"`: it loads again by its current flags, as a host
     * would insert it; `"reload"`: the page reloads, so a host that renders
     * on the server renders again; `"manual"`: nothing, a word in the
     * console. A page overrides it with `index.js?strategy=…`. No effect
     * outside `vite dev`.
     */
    strategy?: DevStrategy;
    /**
     * Show the Droplets dev tool on every page that loads `index.js`, a
     * host's included: one floating panel per page, whatever the number of
     * droplets servers on it. Needs `dropletsDevtools()` in the Vite config.
     * A page overrides it with `index.js?injectTool=true`; the devtools page
     * at `/` always has it. Default `false`. No effect outside `vite dev`.
     */
    injectTool?: boolean;
  };
  server?: {
    /** Production port for `node dist/server.js`. `PORT` overrides it. */
    port?: number;
  };
};

/** See `DropletsConfig["limits"]`. */
export type BodyLimits = {
  /** JSON bodies: render requests and `+server.ts`. Default: 1 MB. */
  json: number;
  /** Form-urlencoded and `text/plain` bodies. Default: 1 MB. */
  form: number;
  /** Multipart bodies, and bodies of any other type. Default: 10 MB. */
  multipart: number;
  /** The `x-droplet-props` header, base64 as sent; bigger answers `431`. Default: 8 KB. */
  props: number;
};

/** The values `dev.strategy` takes. */
export const DEV_STRATEGIES = ["hmr", "remount", "reload", "manual"] as const;

/** See `DropletsConfig["dev"]["strategy"]`. */
export type DevStrategy = (typeof DEV_STRATEGIES)[number];

export type ResolvedDropletsConfig = {
  dropletsFolder: string;
  apiFolder: string;
  health: string | false;
  /** `undefined`: `index.html` in the root, or the placeholder page. */
  index?: string | false;
  element: string;
  buildHash?: string;
  /** `auto`: served only when the client build has externals. */
  importMap: { path: string; auto: boolean } | false;
  warnImportMap: boolean;
  cors?: DropletsCorsOptions;
  /** The fixed location (origin and optional prefix, see `normalizeLocation`); absent: per request. */
  location?: string;
  /** The fixed host origin; absent: per request. */
  host?: string;
  /** Origins, `"*"` for all; this server's own is always trusted. */
  trustedOrigins: string[];
  fragmentCacheControl: string | false;
  publicCacheControl: string | false;
  csrf: { checkOrigin: boolean };
  limits: BodyLimits;
  /** `timeout`: `Infinity` sets no deadline. */
  render: { timeout: number };
  errorFormat: ErrorFormat;
  server: { port: number };
};

/**
 * `dev` of the config, with defaults: what the Vite plugin reads under
 * `vite dev`, apart from `resolveConfig`, so a production server never
 * carries it.
 */
export type ResolvedDevConfig = { server: { port: number }; strategy: DevStrategy; injectTool: boolean };

export const DEFAULTS = {
  dropletsFolder: "src/droplets",
  apiFolder: "src/api",
  health: "/health",
  importMap: "/importmap",
  element: "djs-droplet",
  devPort: 5173,
  serverPort: 8000,
  limits: { json: 1024 * 1024, form: 1024 * 1024, multipart: 10 * 1024 * 1024, props: 8 * 1024 },
  fragmentCacheControl: "private, no-store, no-transform",
  publicCacheControl: "no-cache",
  render: { timeout: 5000 },
} as const;

// The longest delay a timer takes: Node fires a larger one after 1 ms.
const TIMER_MAX_MS = 2147483647;

/**
 * Identity helper that gives `droplets.config.ts` authors type checking and
 * completion without importing the type by hand.
 */
export function config(options: DropletsConfig): DropletsConfig {
  return options;
}

export type NormalizeDropletsFolderInput = { folder: string; fallback?: string; option?: "dropletsFolder" | "apiFolder" };

type ValidateOwnPathInput = { option: string; path: string; example: string };

export type NormalizeTrustedOriginsInput = { origins: unknown };

type LocationOfInput = { value: unknown };

type NormalizeLocationInput = { value: unknown };

type NormalizeHostInput = { value: unknown };

type ResolveCacheControlInput = { option: "fragmentCacheControl" | "publicCacheControl"; value: unknown; fallback: string };

type ResolveLimitsInput = { limits: Partial<BodyLimits> | undefined };

type ResolveRenderInput = { value: unknown };

export type ResolveDevConfigInput = { user: DropletsConfig };

/**
 * Trims `./`, `..`, repeated and trailing slashes down to a clean folder
 * name; a `..` that would leave the project throws. Written out rather than
 * taken from `node:path` so this module runs on any runtime.
 */
export function normalizeDropletsFolder({
  folder,
  fallback = DEFAULTS.dropletsFolder,
  option = "dropletsFolder",
}: NormalizeDropletsFolderInput): string {
  const segments: string[] = [];
  for (const segment of folder.replace(/\\/g, "/").trim().split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) {
        throw dropletsError({ message: FOLDER_OUTSIDE_PROJECT, params: { option, folder: JSON.stringify(folder) } });
      }
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/") || fallback;
}

/** Paths the framework answers itself; the health check may not take them. */
const RESERVED_EXACT = new Set(["/", "/index.js", "/env.js", "/index.css"]);
const RESERVED_PREFIXES = ["/droplets", "/assets", "/api"];

/** A path the framework does not own, for `health` and `importMap`. */
function validateOwnPath({ option, path, example }: ValidateOwnPathInput): string {
  const reserved = RESERVED_EXACT.has(path) || RESERVED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  if (!path.startsWith("/") || /[?#\s]/.test(path) || reserved) {
    throw dropletsError({ message: PATH_RESERVED, params: { option, example, path } });
  }
  return path;
}

/**
 * The custom element name rules that matter in practice: lowercase, starts
 * with a letter, contains a hyphen. (The spec also reserves a handful of
 * hyphenated names such as `font-face`; those are not worth checking here.)
 */
const CUSTOM_ELEMENT_NAME = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;

export function isValidElementName(name: string): boolean {
  return CUSTOM_ELEMENT_NAME.test(name);
}

type OriginOfInput = { value: unknown };

/** `value` as `scheme://host[:port]`; `null` unless it is exactly that. */
function originOf({ value }: OriginOfInput): string | null {
  let url: URL | undefined;
  try {
    url = typeof value === "string" ? new URL(value) : undefined;
  } catch {
    // Not a URL: no origin.
    url = undefined;
  }
  if (!url || url.origin === "null" || url.href.replace(/\/$/, "") !== url.origin) return null;
  return url.origin;
}

/** Each origin as `scheme://host[:port]`, `"*"` kept; throws for anything else. */
export function normalizeTrustedOrigins({ origins }: NormalizeTrustedOriginsInput): string[] {
  if (origins === undefined) return [];
  if (!Array.isArray(origins)) {
    throw dropletsError({ message: TRUSTED_ORIGINS_NOT_LIST });
  }
  return origins.map((origin) => {
    if (origin === "*") return origin;
    const normalized = originOf({ value: origin });
    if (normalized === null) {
      throw dropletsError({ message: TRUSTED_ORIGIN_INVALID, params: { origin: String(JSON.stringify(origin)) } });
    }
    return normalized;
  });
}

/** `value` as a location, `scheme://host[:port][/prefix]`; `null` unless it is exactly that. */
function locationOf({ value }: LocationOfInput): string | null {
  if (typeof value !== "string" || /[\\#?]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // No wildcards: `https://*.example` parses, as a host named `*.example`.
  if (url.username !== "" || url.password !== "" || url.hostname.includes("*")) return null;
  if (url.pathname === "/") return url.origin;
  return isLocationPrefix({ prefix: url.pathname }) ? `${url.origin}${url.pathname.replace(/\/+$/, "")}` : null;
}

/** `location` as `scheme://host[:port][/prefix]`, or `undefined` when it is not set; throws for anything else. */
function normalizeLocation({ value }: NormalizeLocationInput): string | undefined {
  if (value === undefined) return undefined;
  const location = locationOf({ value });
  if (location === null) {
    throw dropletsError({ message: LOCATION_INVALID, params: { value: String(JSON.stringify(value)) } });
  }
  return location;
}

/** `host` as `scheme://host[:port]`, or `undefined` when it is not set; throws for anything else. */
function normalizeHost({ value }: NormalizeHostInput): string | undefined {
  if (value === undefined) return undefined;
  const origin = originOf({ value });
  if (origin === null) {
    throw dropletsError({ message: HOST_INVALID, params: { value: String(JSON.stringify(value)) } });
  }
  return origin;
}

function resolveCacheControl({ option, value, fallback }: ResolveCacheControlInput): string | false {
  if (value === undefined) return fallback;
  if (value === false) return false;
  if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) {
    throw dropletsError({ message: CACHE_CONTROL_INVALID, params: { option, fallback, value: String(JSON.stringify(value)) } });
  }
  return value.trim();
}

function resolveLimits({ limits }: ResolveLimitsInput): BodyLimits {
  const resolved: BodyLimits = { ...DEFAULTS.limits, ...limits };
  for (const [name, value] of Object.entries(resolved)) {
    if (typeof value !== "number" || !(value > 0)) {
      throw dropletsError({ message: LIMIT_INVALID, params: { name, value: String(value) } });
    }
  }
  return resolved;
}

type ShownValueInput = { value: unknown };

function shownValue({ value }: ShownValueInput): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function resolveRender({ value }: ResolveRenderInput): ResolvedDropletsConfig["render"] {
  if (value === undefined) return { ...DEFAULTS.render };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw dropletsError({ message: RENDER_NOT_OBJECT, params: { value: shownValue({ value }) } });
  }
  const timeout = "timeout" in value ? value.timeout : undefined;
  if (timeout === undefined) return { ...DEFAULTS.render };
  if (timeout === Number.POSITIVE_INFINITY) return { timeout };
  const got = shownValue({ value: timeout });
  if (typeof timeout !== "number" || Number.isNaN(timeout)) {
    throw dropletsError({ message: RENDER_TIMEOUT_NOT_NUMBER, params: { value: got } });
  }
  if (timeout < 0) throw dropletsError({ message: RENDER_TIMEOUT_NEGATIVE, params: { value: got } });
  if (!Number.isInteger(timeout)) {
    throw dropletsError({ message: RENDER_TIMEOUT_NOT_WHOLE, params: { value: got } });
  }
  if (timeout > TIMER_MAX_MS) throw dropletsError({ message: RENDER_TIMEOUT_TOO_LONG, params: { value: got } });
  return { timeout };
}

type ResolveErrorFormatInput = { value: unknown };

function resolveErrorFormat({ value }: ResolveErrorFormatInput): ErrorFormat {
  if (value === undefined) return "agent";
  const format = ERROR_FORMATS.find((f) => f === value);
  if (format === undefined) throw dropletsError({ message: ERROR_FORMAT_INVALID, params: { value: shownValue({ value }) } });
  return format;
}

export type ResolveConfigEnv = {
  /** The `PORT` environment variable, read by the production server's entry: it wins over `server.port`. */
  port?: string | undefined;
};

export type PortOfInput = { value: string | undefined };

/** `PORT` as a number: an integer from 0 to 65535, else `undefined`. */
export function portOf({ value }: PortOfInput): number | undefined {
  if (value === undefined || !/^\s*\d{1,5}\s*$/.test(value)) return undefined;
  const port = Number(value);
  return port <= 65535 ? port : undefined;
}

/** Fills in defaults. Pure, so the same code runs at build time and at runtime. */
export function resolveConfig(user: DropletsConfig, env: ResolveConfigEnv = {}): ResolvedDropletsConfig {
  const errorFormat = resolveErrorFormat({ value: user.errorFormat });
  const dropletsFolder = normalizeDropletsFolder({ folder: user.dropletsFolder ?? DEFAULTS.dropletsFolder });

  const element = user.element ?? DEFAULTS.element;
  if (!isValidElementName(element)) {
    throw dropletsError({ message: ELEMENT_NAME_INVALID, params: { element } });
  }

  const envPort = portOf({ value: env.port }) ?? 0;
  const cors = user.cors === true ? { origin: "*" } : user.cors && typeof user.cors === "object" ? user.cors : undefined;

  const health =
    user.health === false ? false : validateOwnPath({ option: "health", path: user.health ?? DEFAULTS.health, example: "/health" });
  const importMap =
    user.importMap === false
      ? false
      : {
          path: validateOwnPath({ option: "importMap", path: user.importMap ?? DEFAULTS.importMap, example: "/importmap" }),
          auto: user.importMap === undefined,
        };
  if (importMap && health && (health === importMap.path || health === `${importMap.path}.js`)) {
    throw dropletsError({ message: HEALTH_IMPORT_MAP_SAME_PATH, params: { health, importMap: importMap.path } });
  }

  const location = normalizeLocation({ value: user.location });
  const host = normalizeHost({ value: user.host });

  return {
    dropletsFolder,
    apiFolder: normalizeDropletsFolder({ folder: user.apiFolder ?? DEFAULTS.apiFolder, fallback: DEFAULTS.apiFolder, option: "apiFolder" }),
    health,
    ...(user.index === undefined ? {} : { index: user.index }),
    element,
    importMap,
    warnImportMap: user.warnImportMap ?? true,
    ...(cors ? { cors } : {}),
    ...(location === undefined ? {} : { location }),
    ...(host === undefined ? {} : { host }),
    trustedOrigins: normalizeTrustedOrigins({ origins: user.trustedOrigins }),
    fragmentCacheControl: resolveCacheControl({
      option: "fragmentCacheControl",
      value: user.fragmentCacheControl,
      fallback: DEFAULTS.fragmentCacheControl,
    }),
    publicCacheControl: resolveCacheControl({
      option: "publicCacheControl",
      value: user.publicCacheControl,
      fallback: DEFAULTS.publicCacheControl,
    }),
    csrf: { checkOrigin: user.csrf?.checkOrigin ?? true },
    limits: resolveLimits({ limits: user.limits }),
    render: resolveRender({ value: user.render }),
    errorFormat,
    server: { port: envPort || user.server?.port || DEFAULTS.serverPort },
  };
}

/** `dev` of the config, with defaults. `PORT` is the production server's: it never moves `vite dev`. */
export function resolveDevConfig({ user }: ResolveDevConfigInput): ResolvedDevConfig {
  const strategy = user.dev?.strategy ?? "hmr";
  if (!DEV_STRATEGIES.includes(strategy)) {
    throw dropletsError({
      message: DEV_STRATEGY_INVALID,
      params: { value: String(strategy), strategies: DEV_STRATEGIES.map((s) => `"${s}"`).join(", ") },
    });
  }
  return {
    server: { port: user.dev?.server?.port || DEFAULTS.devPort },
    strategy,
    injectTool: user.dev?.injectTool ?? false,
  };
}
