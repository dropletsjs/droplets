/**
 * Where a droplet's forms post: `actionUrl()`, the URL of a form action,
 * `${location}/droplets/<id>?/<name>`. Runtime-neutral: the server, the SSR
 * bundle and every browser bundle share it, and give the same string.
 *
 * The location is the droplets server's, never the host page's: on the
 * server the request's public location (a trusted location header,
 * else the request's origin), at build a token replaced per request, in the browser
 * the location `/index.js` was loaded from.
 */

/**
 * The query key of an action URL that names the page the form is on
 * (`origin + pathname`), where a form posted without JavaScript goes back
 * to: a cross-origin `Referer` carries the origin alone.
 */
export const RETURN_KEY = "__droplet_return";

/**
 * Query keys the framework owns; never forwarded as droplet props. Keys that
 * start with `/` name a form action (`?/add`), and keys that start with
 * `__droplet_form_` are kept for the result of a form posted without
 * JavaScript: neither is a prop either.
 */
export const RESERVED_QUERY_KEYS: ReadonlySet<string> = new Set(["__cb", "c", "t", "noSSR", "clientOnly", RETURN_KEY]);

/** The prefix of the query keys kept for a no-JavaScript action's result. */
export const FORM_RESULT_PREFIX = "__droplet_form_";

type IsReservedQueryKeyInput = { key: string };

/** A query key the framework owns: never a droplet prop. */
export function isReservedQueryKey({ key }: IsReservedQueryKeyInput): boolean {
  return RESERVED_QUERY_KEYS.has(key) || key.startsWith("/") || key.startsWith(FORM_RESULT_PREFIX);
}

/**
 * The query key a no-JavaScript action's result of `droplet` rides on, for
 * the build that minted it: `__droplet_form_<droplet>_<build>`. One per
 * droplet, so several droplets' forms on one page each get theirs.
 */
export function formResultKey(droplet: string, build: string): string {
  return `${FORM_RESULT_PREFIX}${droplet}_${build}`;
}

/**
 * The key of a raw `name=value` query part, decoded as `URLSearchParams`
 * (and so a server) reads it: a malformed escape (`%E0`) never hides a key.
 */
type QueryPartKeyInput = { part: string };

function queryPartKey({ part }: QueryPartKeyInput): string {
  const name = part.split("=", 1)[0] ?? "";
  try {
    return decodeURIComponent(name.replace(/\+/g, " "));
  } catch {
    // A malformed escape: `URLSearchParams` decodes what it can, as a server does.
    return new URLSearchParams(`${name}=`).keys().next().value ?? name;
  }
}

/**
 * `url` without the query parts whose (decoded) key `drop` names, and the
 * parts dropped, as `[key, raw part]`. Every other part stays as it was
 * written: no re-encoding. A new `URL`; `url` is left alone.
 */
type DropQueryKeysInput = { url: URL; drop: (key: string) => boolean };

type DroppedQueryKeys = { url: URL; dropped: Array<[string, string]> };

function dropQueryKeys({ url, drop }: DropQueryKeysInput): DroppedQueryKeys {
  const copy = new URL(url.href);
  const dropped: Array<[string, string]> = [];
  if (copy.search === "") return { url: copy, dropped };
  const kept: string[] = [];
  for (const part of copy.search.slice(1).split("&")) {
    const key = queryPartKey({ part });
    if (drop(key)) dropped.push([key, part]);
    else kept.push(part);
  }
  if (dropped.length > 0) copy.search = kept.filter((part) => part !== "").join("&");
  return { url: copy, dropped };
}

/**
 * `url` without any `__droplet_form_*` key, and those keys' values (the
 * last one of a key that came twice). A `__droplet_return` key goes too:
 * the framework's, never the page's. Every other part of the query stays
 * as it was written: no re-encoding. A new `URL`; `url` is left alone.
 */
export type SplitFormResults = { url: URL; results: Map<string, string> };

export function splitFormResults(url: URL): SplitFormResults {
  const results = new Map<string, string>();
  const split = dropQueryKeys({ url, drop: (key) => key.startsWith(FORM_RESULT_PREFIX) || key === RETURN_KEY });
  for (const [key, part] of split.dropped) {
    if (key === RETURN_KEY) continue;
    const raw = part.includes("=") ? part.slice(part.indexOf("=") + 1) : "";
    try {
      results.set(key, decodeURIComponent(raw.replace(/\+/g, " ")));
    } catch {
      // Not a value the server minted: dropped all the same.
    }
  }
  return { url: split.url, results };
}

/** `url` without any `__droplet_form_*` or `__droplet_return` key (see `splitFormResults`). */
export function withoutFormResults(url: URL): URL {
  return splitFormResults(url).url;
}

/**
 * Where a form posted without JavaScript goes back to: `page` without the
 * framework's keys (`__droplet_form_*`, `__droplet_return`), without any
 * `?/name` key (a GET never lands on an action URL) and without its hash.
 */
export function backUrl(page: URL): URL {
  const { url } = dropQueryKeys({
    url: page,
    drop: (key) => key.startsWith("/") || key.startsWith(FORM_RESULT_PREFIX) || key === RETURN_KEY,
  });
  url.hash = "";
  return url;
}

/**
 * The page in the browser as `__droplet_return` names it: `origin +
 * pathname` of `window.location`, the same string the server writes from
 * `event.host` for that page. `undefined` outside a web page (`about:`,
 * `file:`, a worker without a location).
 */
export function browserPage(): string | undefined {
  const where = (globalThis as { location?: { protocol?: string; origin?: string; pathname?: string } }).location;
  if (!where || (where.protocol !== "http:" && where.protocol !== "https:")) return undefined;
  return `${where.origin}${where.pathname}`;
}

/** What an action may be called: a name `actions` can export (`add`, `sign-up`, `_reset`). */
export const ACTION_NAME = /^[A-Za-z_][\w-]*$/;

/** `actionUrl` of a render: the URL of the action `name` (`default` without one). */
export type ActionUrl = (name?: string) => string;

/**
 * The URL of action `name` of `droplet` on the server at `location`. The
 * props that are strings, numbers or booleans go in the query, as a GET
 * fragment's do, so the action and the render after it see them; reserved
 * keys never do. No name is the `default` action. An empty `location`
 * gives a URL relative to the page's origin. `page`, the page the form is
 * on (`origin + pathname`), goes last as `__droplet_return`: where a form
 * posted without JavaScript is sent back to.
 */
export function actionHref(
  location: string,
  droplet: string,
  props: Record<string, unknown> | undefined,
  name?: string,
  page?: string,
): string {
  if (name !== undefined && !ACTION_NAME.test(name)) {
    throw new Error(`${droplet}: ${JSON.stringify(String(name).slice(0, 100))} is not an action name; actionUrl("add") names one`);
  }
  const query: string[] = [];
  if (name !== undefined && name !== "default") query.push(`/${name}`);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (isReservedQueryKey({ key })) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    query.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  if (page) query.push(`${RETURN_KEY}=${encodeURIComponent(page)}`);
  const base = `${location.replace(/\/+$/, "")}/droplets/${encodeURIComponent(droplet)}`;
  return query.length > 0 ? `${base}?${query.join("&")}` : base;
}

/** The `actionUrl` of one render: `droplet` at `location`, with its props, on `page`. */
export function actionUrlFor(location: string, droplet: string, props: Record<string, unknown> | undefined, page?: string): ActionUrl {
  return (name) => actionHref(location, droplet, props, name, page);
}

/** What `actionUrl()` of `$droplets/form` reads: the render in progress. */
export type RenderInfo = { droplet: string; location: string; props?: Record<string, unknown> | undefined };

const RENDER = Symbol.for("droplets.render");

/**
 * Runs `callback` with `info` as the browser's render in progress, for
 * `actionUrl()` of `$droplets/form` called while a component renders
 * synchronously. On `globalThis`: each droplet bundle has its own copy of
 * this module.
 */
export function withRender<T>(info: RenderInfo, callback: () => T): T {
  const global = globalThis as { [RENDER]?: RenderInfo | undefined };
  const previous = global[RENDER];
  global[RENDER] = info;
  try {
    return callback();
  } finally {
    global[RENDER] = previous;
  }
}

/** The browser's render in progress, `undefined` outside one. */
export function currentRender(): RenderInfo | undefined {
  return (globalThis as { [RENDER]?: RenderInfo | undefined })[RENDER];
}
