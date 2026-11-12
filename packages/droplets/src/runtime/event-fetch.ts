/**
 * `event.fetch`: a `fetch` for server code. A URL on this server (relative,
 * on the request's own origin, or under the droplet location) is dispatched
 * into the app in-process, with no network hop, as a request of its own:
 * the same middleware, `handle` and checks as one from outside. Any other
 * URL goes to the global `fetch` with what the caller passed and nothing of
 * the incoming request.
 */

/**
 * The request headers that decide an answer's URLs and `host`: what a
 * fragment varies on, and what an internal request carries, so it resolves
 * the same location and host as the request it serves. Nothing here is
 * trusted for being internal: the inner request checks them again.
 */
export const CONTEXT_HEADERS = [
  "x-droplet-location",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-forwarded-prefix",
  "origin",
] as const;

/** Carried into this server only, and not with `credentials: "omit"`. */
const CREDENTIAL_HEADERS = ["cookie", "authorization"] as const;

/** How many internal requests may nest: the one that would go deeper fails instead. */
export const FETCH_DEPTH = 4;

/** How many internal requests led to a request; absent for one from outside. */
const depths = new WeakMap<Request, number>();

export type InternalPathInput = { url: URL; own: string; location: string };

/**
 * The path and query of `url` on this server: as written on the request's
 * own origin, and with the prefix taken off under the droplet location
 * (`https://shop.example/mfe/api/x` is `/api/x`). `null` when `url` is on
 * neither, the location's origin outside its prefix included: that is
 * another site.
 */
export function internalPath({ url, own, location }: InternalPathInput): string | null {
  if (url.origin === own) return `${url.pathname}${url.search}`;
  const base = new URL(location);
  if (url.origin !== base.origin) return null;
  const prefix = base.pathname.replace(/\/+$/, "");
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;
  return `${url.pathname.slice(prefix.length) || "/"}${url.search}`;
}

type CopyHeadersInput = { from: Headers; into: Headers; names: readonly string[] };

/** Each of `names` that `from` has and `into` does not: what the caller set stands. */
function copyHeaders({ from, into, names }: CopyHeadersInput): void {
  for (const name of names) {
    const value = from.get(name);
    if (value !== null && !into.has(name)) into.set(name, value);
  }
}

type InternalRequestInput = { input: RequestInfo | URL; init: RequestInit | undefined; href: string; incoming: Headers };

/**
 * The request to dispatch, at `href`: what `init` says, else what a
 * `Request` input carried, else a GET. A `Request` input's body is read
 * here: the dispatched request has a URL of its own.
 */
async function internalRequest({ input, init, href, incoming }: InternalRequestInput): Promise<Request> {
  const given = input instanceof Request ? input : undefined;
  const headers = new Headers(init?.headers ?? given?.headers);
  copyHeaders({ from: incoming, into: headers, names: CONTEXT_HEADERS });
  if ((init?.credentials ?? given?.credentials) !== "omit") copyHeaders({ from: incoming, into: headers, names: CREDENTIAL_HEADERS });
  const method = init?.method ?? given?.method ?? "GET";
  const body = init?.body !== undefined ? init.body : given && given.body !== null ? await given.arrayBuffer() : null;
  return new Request(href, { ...init, method, headers, body });
}

export type CreateEventFetchInput = {
  /** The request the event is for: a relative URL resolves against its URL, and an internal request carries its context and credential headers. */
  request: Request;
  /** The droplet location of that request, prefix included: a URL under it is this server's. */
  location: string;
  /** Runs an internal request through the app. */
  dispatch: (request: Request) => Response | Promise<Response>;
};

/** `event.fetch` for one request. */
export function createEventFetch({ request, location, dispatch }: CreateEventFetchInput): typeof fetch {
  const depth = depths.get(request) ?? 0;
  const own = new URL(request.url).origin;
  return async (input, init) => {
    const url = input instanceof Request ? new URL(input.url) : new URL(input, request.url);
    const path = internalPath({ url, own, location });
    if (path === null) return fetch(input, init);
    if (depth >= FETCH_DEPTH) {
      throw new Error(
        `droplets: event.fetch(${JSON.stringify(url.href.slice(0, 200))}) would be ${depth + 1} internal requests deep (the limit is ${FETCH_DEPTH}): a request is fetching itself; call the code the route runs instead of the route`,
      );
    }
    const internal = await internalRequest({ input, init, href: `${own}${path}`, incoming: request.headers });
    depths.set(internal, depth + 1);
    return dispatch(internal);
  };
}
