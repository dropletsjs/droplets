import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createDropletsApp, type DropletsAppOptions } from "../../src/runtime/app.ts";
import { createDevLog } from "../../src/runtime/dev-log.ts";
import { FETCH_DEPTH, internalPath } from "../../src/runtime/event-fetch.ts";
import { matchRoute, type ApiModule, type ApiRoute } from "../../src/runtime/routes.ts";
import {
  json,
  type Handle,
  type LoadEvent,
  type RequestEvent,
  type RequestHandler,
  type TransformEvent,
} from "../../src/runtime/server.ts";

const ORIGIN = "http://drops.test";

type ApiOfInput = { routes: Record<string, ApiModule> };

/** A route table for `matchApi`, from `{ "/api/x": module }`. */
function apiOf({ routes }: ApiOfInput): DropletsAppOptions["matchApi"] {
  const table: ApiRoute[] = Object.entries(routes).map(([id, module]) => ({
    id,
    segments: id
      .split("/")
      .filter(Boolean)
      .map((value) => ({ type: "static", value })),
    module,
  }));
  return (pathname) => matchRoute({ routes: table, pathname });
}

/** What an endpoint saw of its request, as JSON. */
const whoami: RequestHandler = ({ request, url, locals, cookies, platform }) =>
  json({
    url: url.href,
    method: request.method,
    cookie: request.headers.get("cookie"),
    authorization: request.headers.get("authorization"),
    proto: request.headers.get("__proto__"),
    hooked: locals["hooked"] === true,
    session: cookies.get("session") ?? null,
    env: platform.env ?? null,
  });

const handle: Handle = ({ event, resolve }) => {
  event.locals["hooked"] = true;
  return resolve(event);
};

type FakeAppInput = { routes?: Record<string, ApiModule>; overrides?: Partial<DropletsAppOptions> };

function fakeApp({ routes = {}, overrides = {} }: FakeAppInput = {}) {
  const renderDroplet = vi.fn(async (name: string, event: LoadEvent) => {
    const res = await event.fetch(String(event.props["url"] ?? "/api/whoami"), event.props["init"] as RequestInit | undefined);
    return { html: `<p>${name}</p>`, serverData: { status: res.status, body: await res.text() } };
  });
  const options: DropletsAppOptions = {
    devLog: createDevLog(),
    renderDroplet,
    getDropletMeta: (name) => ({ exists: name !== "missing", ssr: true, hydrate: true }),
    getHandle: () => handle,
    matchApi: apiOf({ routes: { "/api/whoami": { GET: whoami, POST: whoami }, ...routes } }),
    buildHash: "abc123",
    ...overrides,
  };
  return { app: createDropletsApp(options), renderDroplet };
}

/** The `serverData` of a fragment: what the load's `event.fetch` answered. */
function fetched(html: string): { status: number; body: string } {
  const match = html.match(/data-droplet-payload="data">([^<]+)</)?.[1];
  const envelope = match ? (JSON.parse(Buffer.from(match, "base64").toString()) as { data: { status: number; body: string } }) : undefined;
  if (!envelope) throw new Error("no data in the fragment");
  return envelope.data;
}

type RenderInput = {
  app: ReturnType<typeof fakeApp>["app"];
  url?: string;
  init?: RequestInit;
  headers?: Record<string, string>;
  env?: unknown;
};

/** Renders `hello`, whose load calls `event.fetch(url, init)`; the result is the answer it got. */
async function render({ app, url, init, headers = {}, env }: RenderInput): Promise<{ status: number; body: string; response: Response }> {
  const response = await app.request(
    `${ORIGIN}/droplets/hello`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session=ana", authorization: "Bearer t", ...headers },
      body: JSON.stringify({ props: { ...(url === undefined ? {} : { url }), ...(init === undefined ? {} : { init }) } }),
    },
    env,
  );
  return { ...fetched(await response.text()), response };
}

describe("internalPath", () => {
  it("keeps a URL on the request's own origin as written", () => {
    expect(internalPath({ url: new URL("http://drops.test/api/x?q=1"), own: ORIGIN, location: ORIGIN })).toBe("/api/x?q=1");
    expect(internalPath({ url: new URL("http://drops.test/mfe/api/x"), own: ORIGIN, location: "https://shop.test/mfe" })).toBe(
      "/mfe/api/x",
    );
  });

  it("takes the prefix off a URL under the location, and refuses the location's origin outside it", () => {
    const location = "https://shop.test/mfe";
    expect(internalPath({ url: new URL("https://shop.test/mfe/api/x?q=1"), own: ORIGIN, location })).toBe("/api/x?q=1");
    expect(internalPath({ url: new URL("https://shop.test/mfe"), own: ORIGIN, location })).toBe("/");
    expect(internalPath({ url: new URL("https://shop.test/mfe/"), own: ORIGIN, location })).toBe("/");
    expect(internalPath({ url: new URL("https://shop.test/mfeld/api/x"), own: ORIGIN, location })).toBeNull();
    expect(internalPath({ url: new URL("https://shop.test/api/x"), own: ORIGIN, location })).toBeNull();
    expect(internalPath({ url: new URL("https://shop.test/api/x"), own: ORIGIN, location: "https://shop.test" })).toBe("/api/x");
  });

  it("refuses any other origin, a lookalike included", () => {
    expect(internalPath({ url: new URL("https://evil.test/api/x"), own: ORIGIN, location: "https://shop.test/mfe" })).toBeNull();
    expect(
      internalPath({ url: new URL("https://shop.test.evil.test/mfe/api/x"), own: ORIGIN, location: "https://shop.test/mfe" }),
    ).toBeNull();
    expect(internalPath({ url: new URL("http://drops.test:8080/api/x"), own: ORIGIN, location: ORIGIN })).toBeNull();
  });
});

describe("event.fetch: a URL on this server", () => {
  let network: MockInstance<typeof fetch>;

  beforeEach(() => {
    network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("from the network"));
  });

  afterEach(() => {
    network.mockRestore();
  });

  it("dispatches a relative URL in-process, through handle, with the request's cookies and authorization", async () => {
    const { app } = fakeApp();
    const answer = await render({ app, url: "/api/whoami?q=1", env: { KV: 1 } });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({
      url: `${ORIGIN}/api/whoami?q=1`,
      method: "GET",
      cookie: "session=ana",
      authorization: "Bearer t",
      proto: null,
      hooked: true,
      session: "ana",
      env: { KV: 1 },
    });
    expect(network).not.toHaveBeenCalled();
  });

  it("takes an absolute URL on the request's own origin, and one under the location with its prefix", async () => {
    const { app } = fakeApp({ overrides: { trustedOrigins: ["https://shop.test"] } });
    const own = await render({ app, url: `${ORIGIN}/api/whoami` });
    expect(JSON.parse(own.body)).toMatchObject({ url: `${ORIGIN}/api/whoami` });

    const location = { "x-droplet-location": "https://shop.test/mfe" };
    const under = await render({ app, url: "https://shop.test/mfe/api/whoami?q=2", headers: location });
    // The inner request resolved the same location: its `event.url` is under the prefix too.
    expect(JSON.parse(under.body)).toMatchObject({ url: "https://shop.test/mfe/api/whoami?q=2", hooked: true });
    expect(network).not.toHaveBeenCalled();

    const outside = await render({ app, url: "https://shop.test/other", headers: location });
    expect(outside.body).toBe("from the network");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("hands back a fragment decoded, as fetch does, whatever Accept-Encoding init asks for", async () => {
    const big = `<p>${"inner ".repeat(400)}</p>`;
    const { app } = fakeApp({
      overrides: {
        renderDroplet: async (name, event) => {
          if (name === "inner") return { html: big, serverData: null };
          const res = await event.fetch("/droplets/inner", { headers: { "accept-encoding": "gzip" } });
          return { html: "<p>outer</p>", serverData: { status: res.status, body: await res.text() } };
        },
      },
    });
    const answer = await render({ app });
    expect(answer.status).toBe(200);
    expect(answer.body).toContain(big);
  });

  it("answers 404 in-process for a path no route matches, never the network", async () => {
    const { app } = fakeApp();
    const answer = await render({ app, url: "/nothing/here" });
    expect(answer).toMatchObject({ status: 404, body: "Not Found" });
    expect(network).not.toHaveBeenCalled();
  });

  it("takes a Request as input, and init over what it carries", async () => {
    const renderDroplet = async (_name: string, event: LoadEvent) => {
      const res = await event.fetch(
        new Request(`${ORIGIN}/api/whoami`, { method: "POST", body: "x", headers: { "content-type": "text/plain" } }),
        {
          headers: { authorization: "Basic u" },
        },
      );
      return { html: "", serverData: { status: res.status, body: await res.text() } };
    };
    const { app } = fakeApp({ overrides: { renderDroplet } });
    const answer = await render({ app, headers: { origin: ORIGIN } });
    expect(JSON.parse(answer.body)).toMatchObject({ method: "POST", authorization: "Basic u", cookie: "session=ana" });
  });

  it("leaves cookies and authorization out with credentials: omit, and lets init set them", async () => {
    const { app } = fakeApp();
    const omitted = await render({ app, init: { credentials: "omit" } });
    expect(JSON.parse(omitted.body)).toMatchObject({ cookie: null, authorization: null, session: null });
    const set = await render({ app, init: { headers: { cookie: "session=bob", authorization: "Bearer other" } } });
    expect(JSON.parse(set.body)).toMatchObject({ cookie: "session=bob", authorization: "Bearer other", session: "bob" });
  });

  it("gives the internal request a handle run and locals of its own", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const counting: Handle = ({ event, resolve }) => {
      seen.push(event.locals);
      event.locals["n"] = seen.length;
      return resolve(event);
    };
    const { app } = fakeApp({ overrides: { getHandle: () => counting } });
    await render({ app });
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("keeps a Set-Cookie the internal answer carries on that answer, off the outer one", async () => {
    const setter: RequestHandler = ({ cookies }) => {
      cookies.set("inner", "1", { path: "/" });
      return json({ ok: true });
    };
    const renderDroplet = async (_name: string, event: LoadEvent) => {
      const res = await event.fetch("/api/set");
      return { html: "", serverData: { status: res.status, body: res.headers.get("set-cookie") ?? "" } };
    };
    const { app } = fakeApp({ routes: { "/api/set": { GET: setter } }, overrides: { renderDroplet } });
    const answer = await render({ app });
    expect(answer.body).toContain("inner=1");
    expect(answer.response.headers.get("set-cookie")).toBeNull();
  });

  it("runs the same Origin check: a form post needs a trusted Origin, carried from the outer request or set", async () => {
    const { app } = fakeApp();
    const form = { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=1" };
    const bare = await render({ app, init: form });
    expect(bare.status).toBe(403);
    const carried = await render({ app, init: form, headers: { origin: ORIGIN } });
    expect(carried.status).toBe(200);
    const foreign = await render({ app, init: form, headers: { origin: "https://evil.test" } });
    expect(foreign.status).toBe(403);
    const set = await render({ app, init: { ...form, headers: { ...form.headers, origin: ORIGIN } } });
    expect(set.status).toBe(200);
  });

  it("works while prerendering, with no cookies to carry; an endpoint that reads them answers the build's 500", async () => {
    const plain: RequestHandler = ({ request, url, locals }) =>
      json({ url: url.href, cookie: request.headers.get("cookie"), hooked: locals["hooked"] === true });
    const { app } = fakeApp({ routes: { "/api/plain": { GET: plain } }, overrides: { building: true } });
    const build = async (url: string) => {
      const res = await app.request(`${ORIGIN}/droplets/hello`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ props: { url } }),
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { data: { status: number; body: string } }).data;
    };
    const stored = await build("/api/plain");
    expect(stored.status).toBe(200);
    expect(JSON.parse(stored.body)).toEqual({ url: `${ORIGIN}/api/plain`, cookie: null, hooked: true });
    const cookies = await build("/api/whoami");
    expect(cookies.status).toBe(500);
    expect(JSON.parse(cookies.body).message).toContain("cookies.get() is not available while prerendering");
    expect(network).not.toHaveBeenCalled();
  });

  it("is on the events of handle, an endpoint, a load, transform and an action", async () => {
    const kinds: string[] = [];
    const noting: Handle = ({ event, resolve }) => {
      kinds.push(`handle:${typeof event.fetch}`);
      return resolve(event);
    };
    const endpoint: RequestHandler = (event: RequestEvent) => json({ fetch: typeof event.fetch });
    const { app } = fakeApp({
      routes: { "/api/kind": { GET: endpoint } },
      overrides: {
        getHandle: () => noting,
        transformDroplet: (_name, event: TransformEvent) => `${event.html}<i>${typeof event.fetch}</i>`,
      },
    });
    const html = await (await app.request(`${ORIGIN}/droplets/hello?url=/api/kind`)).text();
    expect(html).toContain("<i>function</i>");
    expect(fetched(html).body).toBe('{"fetch":"function"}');
    expect(kinds).toEqual(["handle:function", "handle:function"]);
  });
});

describe("event.fetch: any other URL", () => {
  let network: MockInstance<typeof fetch>;

  beforeEach(() => {
    network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("from the network"));
  });

  afterEach(() => {
    network.mockRestore();
  });

  it("goes to the global fetch with init alone: no cookies, no authorization, no location header", async () => {
    const { app } = fakeApp();
    const answer = await render({
      app,
      url: "https://api.example/users",
      init: { headers: { accept: "application/json" } },
      headers: { "x-forwarded-host": "shop.test" },
    });
    expect(answer).toMatchObject({ status: 200, body: "from the network" });
    expect(network).toHaveBeenCalledTimes(1);
    const [input, init] = network.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://api.example/users");
    expect(init).toEqual({ headers: { accept: "application/json" } });
    const sent = new Headers(init?.headers);
    for (const name of ["cookie", "authorization", "x-forwarded-host", "origin"]) expect(sent.get(name), name).toBeNull();
  });
});

describe("event.fetch: what being internal does not grant", () => {
  let network: MockInstance<typeof fetch>;
  let errors: MockInstance<typeof console.error>;

  beforeEach(() => {
    network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("from the network"));
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    network.mockRestore();
    errors.mockRestore();
  });

  it(`stops a request that fetches itself after ${FETCH_DEPTH} internal requests, with an error through handleError`, async () => {
    let calls = 0;
    const loop: RequestHandler = (event) => {
      calls++;
      return event.fetch("/api/loop");
    };
    const { app } = fakeApp({ routes: { "/api/loop": { GET: loop } } });
    const res = await app.request(`${ORIGIN}/api/loop`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Internal Server Error" });
    expect(calls).toBe(FETCH_DEPTH + 1);
    expect(errors).toHaveBeenCalledTimes(1);
    const [, error] = errors.mock.calls[0] ?? [];
    expect(String((error as Error).message)).toMatch(
      `droplets: event.fetch("${ORIGIN}/api/loop") would be ${FETCH_DEPTH + 1} internal requests deep (the limit is ${FETCH_DEPTH}): a request is fetching itself`,
    );
  });

  it("answers 413 to an internal request over the body limit", async () => {
    const renderDroplet = async (_name: string, event: LoadEvent) => {
      const body = JSON.stringify({ pad: "x".repeat(100) });
      const res = await event.fetch("/api/whoami", { method: "POST", headers: { "content-type": "application/json" }, body });
      return { html: "", serverData: { status: res.status, body: await res.text() } };
    };
    const { app } = fakeApp({ overrides: { renderDroplet, limits: { json: 64, form: 64, multipart: 64, props: 8192 } } });
    const answer = fetched(await (await app.request(`${ORIGIN}/droplets/hello`)).text());
    expect(answer.status).toBe(413);
    expect(JSON.parse(answer.body)).toEqual({ message: "Payload Too Large" });
  });

  it("carries a __proto__ header as a header and nothing else", async () => {
    const { app } = fakeApp();
    const answer = await render({ app, init: { headers: [["__proto__", "polluted"]] } });
    expect(JSON.parse(answer.body)).toMatchObject({ proto: "polluted" });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it("trusts a location header on the internal request no more than on any other", async () => {
    const { app } = fakeApp();
    const spoofed = await render({ app, init: { headers: { "x-droplet-location": "https://evil.test/mfe" } } });
    expect(JSON.parse(spoofed.body)).toMatchObject({ url: `${ORIGIN}/api/whoami` });
  });
});
