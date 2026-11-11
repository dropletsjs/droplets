import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { logger } from "../../src/core/logger.ts";
import { createDropletsApp, resetLocationWarnings, type DropletsAppOptions } from "../../src/runtime/app.ts";
import { UnhandledDropletError } from "../../src/runtime/load.ts";
import type { ApiModule, ApiRoute } from "../../src/runtime/routes.ts";
import { matchRoute } from "../../src/runtime/routes.ts";
import { error, json, redirect, type Handle, type LoadEvent, type TransformEvent } from "../../src/runtime/server.ts";
import { locationScript } from "../../src/runtime/server-records.ts";

const decode = (b64: string) =>
  JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as unknown;

/** Pulls the inlined payload out of a `<script data-droplet-…>` tag. */
const payload = (html: string, attribute: string): unknown => {
  const match = html.match(
    new RegExp(`<script type="application/text" ${attribute}>([^<]*)</script>`),
  );
  return match?.[1] ? decode(match[1]) : undefined;
};

function fakeApp(overrides: Partial<DropletsAppOptions> = {}) {
  const renderDroplet = vi.fn(async (name: string, event: LoadEvent) => ({
    html: `<p>${name}:${JSON.stringify(event.props)}</p>`,
    head: `<title>${name}</title>`,
    serverData: { name, props: event.props },
  }));
  const loadDropletData = vi.fn(async (name: string, event: LoadEvent) => ({
    data: { name, props: event.props } as unknown,
  }));
  const options: DropletsAppOptions = {
    renderDroplet,
    loadDropletData,
    getDropletMeta: (name) =>
      name === "static"
        ? { exists: true, ssr: true, hydrate: false }
        : name === "spa"
        ? { exists: true, ssr: false, hydrate: true }
        : { exists: name !== "missing", ssr: true, hydrate: true },
    loadClientModule: (name) => (name === "hello" ? `console.log("${name}")` : null),
    loadEntryClient: () => "/* entry */",
    loadGlobalStyle: () => "body{}",
    dropletStyles: (name: string) =>
      name === "hello" || name === "static" ? ["assets/Badge-1.css", `assets/${name}-2.css`] : [],
    buildHash: "abc123",
    ...overrides,
  };
  return { app: createDropletsApp(options), renderDroplet, loadDropletData };
}

/** A route table for `matchApi`, from `[path, module]` pairs. */
function apiOf(routes: Array<[ApiRoute["segments"], ApiModule]>): DropletsAppOptions["matchApi"] {
  const table = routes.map(([segments, module], i) => ({ id: `route-${i}`, segments, module }));
  return (pathname) => matchRoute(table, pathname);
}

describe("createDropletsApp: health and index", () => {
  it("answers ok on /health by default", async () => {
    const { app } = fakeApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("moves or disables the health check", async () => {
    const moved = fakeApp({ health: "/healthz" });
    expect(await (await moved.app.request("/healthz")).text()).toBe("ok");
    expect((await moved.app.request("/health")).status).toBe(404);

    const off = fakeApp({ health: false });
    expect((await off.app.request("/health")).status).toBe(404);
  });

  it("serves the index page, or 404s without one", async () => {
    const { app } = fakeApp({ loadIndex: () => "<p>home</p>" });
    const res = await app.request("/");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe("<p>home</p>");

    expect((await fakeApp({ loadIndex: () => null }).app.request("/")).status).toBe(404);
    expect((await fakeApp().app.request("/")).status).toBe(404);
  });

  it("has no full-page route: only /droplets/:id renders", async () => {
    const { app, renderDroplet } = fakeApp();
    expect((await app.request("/hello")).status).toBe(404);
    expect(renderDroplet).not.toHaveBeenCalled();
  });
});

describe("createDropletsApp: assets", () => {
  it("serves the entry client uncached", async () => {
    const { app } = fakeApp();
    const res = await app.request("/index.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toBe(`${locationScript("djs-droplet:abc123")}/* entry */`);
  });

  it("starts /index.js with where it was loaded from: the browser's anchor for this server", async () => {
    const code = await (await fakeApp({ buildHash: "b1" }).app.request("/index.js")).text();
    const script = locationScript("djs-droplet:b1");
    expect(code.startsWith(script)).toBe(true);
    // A module script: `import.meta.url` is the URL the page loaded it from.
    const servers = Symbol.for("droplets.servers");
    const global = globalThis as unknown as Record<symbol, Record<string, { origin?: string }> | undefined>;
    for (const [url, location] of [
      ["https://drops.test/index.js", "https://drops.test"],
      ["https://shop.test/mfe/index.js?strategy=reload", "https://shop.test/mfe"],
    ] as const) {
      delete global[servers];
      new Function("meta", script.replace("import.meta", "meta"))({ url });
      expect(global[servers]?.["djs-droplet:b1"]?.origin).toBe(location);
    }
    delete global[servers];
  });

  it("ends /index.js with this server's public runtime variables, when there are any", async () => {
    const values: Record<string, string | undefined> = { PUBLIC_API: "https://api</script>", PUBLIC_UNSET: undefined };
    const { app } = fakeApp({ buildHash: "b1", publicEnv: () => values });
    const code = await (await app.request("/index.js")).text();
    // First, so the values are set before the entry (the dev route serves the entry itself).
    const env = '\n((globalThis[Symbol.for("droplets.servers")] ??= {})["djs-droplet:b1"] ??= {}).env = ' +
      '{"PUBLIC_API":"https://api\\u003c/script>"};\n';
    expect(code).toBe(`${locationScript("djs-droplet:b1")}${env}/* entry */`);
    const servers = Symbol.for("droplets.servers");
    new Function(env)();
    const global = globalThis as unknown as Record<symbol, Record<string, { env: Record<string, string> }>>;
    expect(global[servers]!["djs-droplet:b1"]!.env).toEqual({ PUBLIC_API: "https://api</script>" });
    delete global[servers];

    const none = fakeApp({ buildHash: "b1", publicEnv: () => ({}) });
    expect(await (await none.app.request("/index.js")).text()).toBe(`${locationScript("djs-droplet:b1")}/* entry */`);
  });

  it("knows the request's public origin in server code, through overlapping requests", async () => {
    const { requestInfo } = await import("../../src/runtime/request-store.ts");
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { app } = fakeApp({
      trustedOrigins: ["https://first.example", "https://second.example"],
      renderDroplet: async (name) => {
        const before = requestInfo()?.origin;
        if (before === "https://first.example") await gate;
        seen.push(`${before} ${requestInfo()?.origin}`);
        return { html: name, serverData: null };
      },
    });
    const first = app.request("/droplets/hello", { headers: { "x-droplet-location": "https://first.example" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await app.request("/droplets/hello", { headers: { "x-droplet-location": "https://second.example" } });
    release();
    await first;
    expect(seen).toEqual([
      "https://second.example https://second.example",
      "https://first.example https://first.example",
    ]);
    expect(requestInfo()).toBeUndefined();
  });

  it("serves droplet bundles as immutable and 404s unknown ones", async () => {
    const { app } = fakeApp();
    const ok = await app.request("/droplets/hello/client.js");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("immutable");

    expect((await app.request("/droplets/other/client.js")).status).toBe(404);
    expect((await app.request("/droplets/missing/client.js")).status).toBe(404);
  });

  it("serves no JavaScript for hydrate = false, only styles", async () => {
    const { app } = fakeApp({ loadClientModule: () => "console.log('never')" });
    expect((await app.request("/droplets/static/client.js")).status).toBe(404);
    expect((await app.request("/droplets/static/style.css")).status).toBe(200);
  });

  it("serves global and per-droplet styles", async () => {
    const { app } = fakeApp();
    const global = await app.request("/index.css");
    expect(global.headers.get("content-type")).toContain("text/css");
    expect(await global.text()).toBe("body{}");

    // An import per stylesheet, shared chunks included, relative to style.css.
    const hello = await app.request("/droplets/hello/style.css");
    expect(await hello.text()).toBe('@import url("../../assets/Badge-1.css");\n@import url("../../assets/hello-2.css");\n');
    expect(hello.headers.get("cache-control")).toContain("immutable");

    // No styles of its own is normal, not an error.
    const other = await app.request("/droplets/other/style.css");
    expect(other.status).toBe(200);
    expect(await other.text()).toBe("");

    expect((await app.request("/droplets/missing/style.css")).status).toBe(404);
  });

  it("serves a droplet with hydrate = false its style.css too", async () => {
    const { app } = fakeApp();
    const res = await app.request("/droplets/static/style.css");
    expect(await res.text()).toContain('@import url("../../assets/static-2.css");');
  });

  it("404s asset routes whose loaders are not configured", async () => {
    const { app } = fakeApp({
      loadEntryClient: undefined,
      loadGlobalStyle: undefined,
      loadClientModule: undefined,
    });
    expect((await app.request("/index.js")).status).toBe(404);
    expect((await app.request("/index.css")).status).toBe(404);
    expect((await app.request("/droplets/hello/client.js")).status).toBe(404);
  });

  it("answers 500 when a loader throws", async () => {
    const { app } = fakeApp({
      loadEntryClient: () => {
        throw new Error("boom");
      },
    });
    expect((await app.request("/index.js")).status).toBe(500);
  });
});

describe("createDropletsApp: props and the load event", () => {
  it("reads props from the query string, skipping reserved keys", async () => {
    const { app, renderDroplet } = fakeApp();
    const res = await app.request("/droplets/hello?who=Ana&c=1&t=2&__cb=3&noSSR_=x");
    expect(res.status).toBe(200);
    expect(renderDroplet.mock.calls[0]?.[1].props).toEqual({ who: "Ana", noSSR_: "x" });
  });

  it("reads props from the x-droplet-props header when the query is empty", async () => {
    const { app, renderDroplet } = fakeApp();
    const header = Buffer.from(JSON.stringify({ ids: [1, 2] })).toString("base64");
    await app.request("/droplets/hello", { headers: { "x-droplet-props": header } });
    expect(renderDroplet.mock.calls[0]?.[1].props).toEqual({ ids: [1, 2] });
  });

  it("ignores a malformed x-droplet-props header", async () => {
    const { app, renderDroplet } = fakeApp();
    const res = await app.request("/droplets/hello", { headers: { "x-droplet-props": "%%%" } });
    expect(res.status).toBe(200);
    expect(renderDroplet.mock.calls[0]?.[1].props).toEqual({});
  });

  it("prefers a POST body over the query string, and leaves the body readable", async () => {
    let bodyText = "";
    const { app, renderDroplet } = fakeApp({
      renderDroplet: async (_name, event) => {
        bodyText = await event.request.text();
        return { html: "" };
      },
    });
    const res = await app.request("/droplets/hello?who=Query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { who: "Body" } }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(bodyText)).toEqual({ props: { who: "Body" } });
  });

  it("builds the droplet event: request, host, locals, platform, droplet, props", async () => {
    const { app, renderDroplet } = fakeApp();
    await app.request("http://internal:8000/droplets/hello?who=E", {
      headers: { "x-droplet-location": "https://public.test" },
    });
    const event = renderDroplet.mock.calls[0]?.[1];
    expect(event?.droplet).toBe("hello");
    // Where it renders: nothing says, so the request's own origin. The location
    // is where the droplet lives, not where it renders.
    expect(event?.host.href).toBe("http://internal:8000/");
    expect(event).not.toHaveProperty("url");
    // The fragment's own URL stays on the request.
    expect(event?.request.url).toBe("http://internal:8000/droplets/hello?who=E");
    expect(event?.request).toBeInstanceOf(Request);
    // Route parameters belong to /api; a droplet only gets props.
    expect(event).not.toHaveProperty("params");
    expect(event?.locals).toEqual({});
    expect(event?.platform).toHaveProperty("env");
  });

  it("accepts a context wrapper that sets host and props", async () => {
    const { app, renderDroplet } = fakeApp();
    await app.request("/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context: { host: "https://public.test/shop?x=1", props: { a: 1 } } }),
    });
    const event = renderDroplet.mock.calls[0]?.[1];
    expect(event?.host.href).toBe("https://public.test/shop?x=1");
    expect(event?.props).toEqual({ a: 1 });
  });

  it("takes host without a body from Origin, else the location's origin; never from forwarded headers", async () => {
    const hostOf = async (headers: Record<string, string>, options: Partial<DropletsAppOptions> = {}) => {
      const { app, renderDroplet } = fakeApp(options);
      await app.request("http://drops.test/droplets/hello", { headers });
      return renderDroplet.mock.calls[0]?.[1].host.href;
    };
    expect(await hostOf({ forwarded: 'for=1.2.3.4;proto=https;host="shop.test:8443"' })).toBe("http://drops.test/");
    expect(await hostOf({ "x-forwarded-host": "shop.test, proxy.test", "x-forwarded-proto": "https" })).toBe("http://drops.test/");
    expect(await hostOf({ origin: "https://page.test" })).toBe("https://page.test/");
    expect(await hostOf({ origin: "null" })).toBe("http://drops.test/");
    expect(await hostOf({})).toBe("http://drops.test/");
    // A trusted location stands in for the host: its origin, not its prefix.
    const trusted = { origin: ["https://shop.test/mfe"] };
    expect(await hostOf({}, trusted)).toBe("https://shop.test/");
    expect(await hostOf({ "x-forwarded-host": "shop.test", "x-forwarded-proto": "https" }, { origin: ["https://shop.test", "https://two.test"] })).toBe("https://shop.test/");
    expect(await hostOf({ origin: "https://page.test" }, trusted)).toBe("https://page.test/");
  });

  it("lets handle replace host; loads and the context see its value", async () => {
    const handle: Handle = async ({ event, resolve }) => {
      event.host = new URL(event.request.headers.get("referer") ?? event.host);
      return resolve(event);
    };
    const { app, renderDroplet } = fakeApp({ getHandle: () => handle });
    const html = await (await app.request("http://drops.test/droplets/hello?who=H", {
      headers: { referer: "https://shop.test/product/mug?ref=x" },
    })).text();
    expect(renderDroplet.mock.calls[0]?.[1].host.href).toBe("https://shop.test/product/mug?ref=x");
    expect(payload(html, "data-droplet-context")).toEqual({ host: "https://shop.test/product/mug?ref=x", props: { who: "H" } });
  });

  it("treats a malformed JSON body as no body, and never reads a POST's query as props", async () => {
    const { app, renderDroplet } = fakeApp();
    const res = await app.request("/droplets/hello?who=Q", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{nope",
    });
    expect(res.status).toBe(200);
    expect(renderDroplet.mock.calls[0]?.[1].props).toEqual({});
  });

  it("answers _data for GET and POST only", async () => {
    const { app, loadDropletData } = fakeApp();
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const res = await app.request("/droplets/hello/_data", { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow"), method).toBe("GET, POST");
    }
    expect(loadDropletData).not.toHaveBeenCalled();
  });

  it("takes a POST's props from its body only, for the fragment and _data", async () => {
    const { app, renderDroplet, loadDropletData } = fakeApp();
    const body = JSON.stringify({ host: "https://shop.test/p?code=secret", props: { who: "Ana" } });
    const init = { method: "POST", headers: { "content-type": "application/json" }, body };
    await app.request("/droplets/hello?code=secret&who=Eve", init);
    expect(renderDroplet.mock.calls[0]?.[1].props).toEqual({ who: "Ana" });
    const data = await app.request("/droplets/hello/_data?code=secret&__cb=1", init);
    expect(((await data.json()) as { data: { props: unknown } }).data.props).toEqual({ who: "Ana" });
    expect(loadDropletData.mock.calls[0]?.[1].props).toEqual({ who: "Ana" });
  });
});

describe("createDropletsApp: fragment", () => {
  it("renders the bare element with inlined context and data", async () => {
    const { app } = fakeApp();
    const res = await app.request("http://drops.test/droplets/hello?who=Ana");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html.startsWith('<djs-droplet data-droplet="hello" data-build="abc123">')).toBe(true);
    expect(html).not.toContain("data-droplet-location");
    expect(html).not.toContain("<html");
    expect(html).toContain('<p>hello:{"who":"Ana"}</p>');
    expect(payload(html, "data-droplet-context")).toEqual({ host: "http://drops.test/", props: { who: "Ana" } });
    expect(payload(html, "data-droplet-data")).toEqual({ data: { name: "hello", props: { who: "Ana" } } });
  });

  it("stamps the fragment and _data with the build that served them", async () => {
    const { app } = fakeApp();
    expect(await (await app.request("/droplets/hello")).text()).toContain(' data-build="abc123"');
    const data = await app.request("/droplets/hello/_data");
    expect(data.headers.get("x-droplets-build")).toBe("abc123");
  });

  it("answers POST with the same fragment, taking props from the body", async () => {
    const { app } = fakeApp();
    const res = await app.request("http://drops.test/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { who: "Body" } }),
    });
    const html = await res.text();
    expect(html.startsWith("<djs-droplet ")).toBe(true);
    expect(html).toContain('<p>hello:{"who":"Body"}</p>');
  });

  it("uses a trusted x-droplet-location as the public location, prefix included, for the URLs it writes", async () => {
    const { app } = fakeApp({ trustedOrigins: ["https://public.test", "https://shop.test"] });
    for (const [sent, location] of [
      ["https://public.test", "https://public.test"],
      ["https://shop.test/mfe/", "https://shop.test/mfe"],
      ["https://user:pw@shop.test/mfe?x=1#y", "https://shop.test/mfe"],
    ] as const) {
      const res = await app.request("http://internal:8000/droplets/hello", { headers: { "x-droplet-location": sent } });
      expect(await res.text(), sent).toContain(`href="${location}/droplets/hello/style.css?c=abc123"`);
      expect(res.headers.get("link"), sent).toContain(`<${location}/droplets/hello/style.css?c=abc123>; rel=preload`);
    }
  });

  it("ignores an x-droplet-location that is not trusted: a request cannot point the server's URLs elsewhere", async () => {
    for (const trustedOrigins of [[], ["https://shop.test"]]) {
      const { app } = fakeApp({ trustedOrigins, fragmentCacheControl: "public, max-age=60" });
      const res = await app.request("http://internal:8000/droplets/hello", {
        headers: { "x-droplet-location": "https://evil.example/mfe" },
      });
      const html = await res.text();
      expect(html, String(trustedOrigins)).toContain('href="http://internal:8000/droplets/hello/style.css?c=abc123"');
      expect(html, String(trustedOrigins)).not.toContain("evil.example");
      expect(res.headers.get("link") ?? "", String(trustedOrigins)).not.toContain("evil.example");
      // Cacheable: it varies on what its URLs come from.
      expect(res.headers.get("vary")).toBe("x-droplet-location, forwarded, x-forwarded-host, x-forwarded-proto, x-forwarded-port, x-forwarded-prefix, origin");
    }
  });

  it("honours an x-droplet-location on the request's own origin without a list", async () => {
    const { app } = fakeApp();
    const res = await app.request("http://internal:8000/droplets/hello", {
      headers: { "x-droplet-location": "http://internal:8000/mfe" },
    });
    expect(await res.text()).toContain('href="http://internal:8000/mfe/droplets/hello/style.css?c=abc123"');
  });

  it("ignores an x-droplet-location that is not an http(s) URL: it never becomes a script or style URL", async () => {
    const { app } = fakeApp({ trustedOrigins: ["https://public.test"] });
    for (const sent of ["data:text/javascript,alert(1)//", "javascript:alert(1)", "not a url", "ftp://drops.test"]) {
      const res = await app.request("http://internal:8000/droplets/hello", { headers: { "x-droplet-location": sent } });
      const html = await res.text();
      expect(html, sent).toContain('href="http://internal:8000/droplets/hello/style.css?c=abc123"');
      expect(html, sent).not.toContain("javascript:");
      expect(html, sent).not.toContain("data:text");
      expect(res.headers.get("link"), sent).not.toMatch(/data:|javascript:|ftp:/);
    }
  });

  it("never inlines locals into the page", async () => {
    const { app } = fakeApp({
      getHandle: () => ({ event, resolve }) => {
        event.locals["secret"] = "session-token";
        return resolve(event);
      },
    });
    const html = await (await app.request("/droplets/hello")).text();
    expect(Buffer.from(html).toString()).not.toContain("session-token");
    expect(JSON.stringify(payload(html, "data-droplet-context"))).not.toContain("secret");
  });

  it("404s unknown droplets and when the renderer returns null", async () => {
    const { app } = fakeApp();
    expect((await app.request("/droplets/missing")).status).toBe(404);
    const nulls = fakeApp({ renderDroplet: async () => null });
    expect((await nulls.app.request("/droplets/hello")).status).toBe(404);
  });

  it("500s when rendering throws", async () => {
    const { app } = fakeApp({
      renderDroplet: async () => {
        throw new Error("render failed");
      },
    });
    expect((await app.request("/droplets/hello")).status).toBe(500);
  });

  it("skips inlining data for droplets that never hydrate", async () => {
    const { app } = fakeApp();
    const html = await (await app.request("/droplets/static")).text();
    expect(html).toContain("<p>static:{}</p>");
    expect(html).not.toContain("data-droplet-data");
    expect(html).toContain("data-droplet-context");
  });

  it("?noSSR runs the server load but renders nothing", async () => {
    const { app, renderDroplet, loadDropletData } = fakeApp();
    const html = await (await app.request("http://drops.test/droplets/hello?noSSR&who=X")).text();
    expect(renderDroplet).not.toHaveBeenCalled();
    expect(loadDropletData).toHaveBeenCalledOnce();
    expect(html).toContain('<div style="display: contents" data-droplet-entry></div>');
    expect(payload(html, "data-droplet-data")).toEqual({ data: { name: "hello", props: { who: "X" } } });
    // Without SSR the context travels on the attribute instead of a script.
    expect(html).not.toContain("data-droplet-context");
    const attr = html.match(/ data-context="([^"]+)"/)?.[1];
    expect(attr && decode(attr)).toEqual({ host: "http://drops.test/", props: { who: "X" } });
  });

  it("?clientOnly skips both render and server load", async () => {
    const { app, renderDroplet, loadDropletData } = fakeApp();
    const html = await (await app.request("/droplets/hello?clientOnly")).text();
    expect(renderDroplet).not.toHaveBeenCalled();
    expect(loadDropletData).not.toHaveBeenCalled();
    expect(html).not.toContain("data-droplet-data");
    expect(html).toContain(" data-context=");
  });

  it("honours ssr = false: data inline, no HTML", async () => {
    const { app, renderDroplet, loadDropletData } = fakeApp();
    const html = await (await app.request("/droplets/spa")).text();
    expect(renderDroplet).not.toHaveBeenCalled();
    expect(loadDropletData).toHaveBeenCalledOnce();
    expect(html).toContain("data-droplet-data");
  });

  it("answers error() from a droplet with its status and message", async () => {
    const { app } = fakeApp({
      renderDroplet: async () => error(404, "No such user"),
    });
    const res = await app.request("/droplets/hello");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("No such user");
  });

  it("renders +error.svelte inside the element when a load failed, with a 500", async () => {
    const renderError = vi.fn(async (_name: string, e: unknown) => ({
      head: "<style>.oops{}</style>",
      html: `<p class="oops">${(e as { message: string }).message}</p>`,
    }));
    const { app } = fakeApp({
      renderError,
      renderDroplet: async () => ({ failed: true as const, error: { message: "Sorry" } }),
    });
    const res = await app.request("http://drops.test/droplets/hello");
    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html.startsWith('<djs-droplet data-droplet="hello" data-build="abc123" data-droplet-error>')).toBe(true);
    expect(html).toContain('<style>.oops{}</style><p class="oops">Sorry</p>');
    // The error as it left the server: the browser hydrates +error.svelte with it.
    expect(payload(html, "data-droplet-data")).toEqual({ error: { message: "Sorry" } });
    // With the droplet's props, for its action URLs.
    expect(renderError).toHaveBeenCalledWith("hello", { message: "Sorry" }, {});
  });

  it("renders and hydrates +error.svelte as the droplet would, by the droplet's flags", async () => {
    const failed = async () => ({ failed: true as const, error: { message: "Sorry" } });
    const renderError = vi.fn(async () => ({ html: "<p>error page</p>" }));
    const flags = (ssr: boolean, hydrate: boolean) => () => ({ exists: true, ssr, hydrate });

    // ssr = false: no markup, the error inline for the browser to mount.
    const spa = fakeApp({
      renderDroplet: failed,
      renderError,
      loadDropletData: failed,
      getDropletMeta: flags(false, true),
    });
    const a = await (await spa.app.request("/droplets/hello")).text();
    expect(a).toContain("<div style=\"display: contents\" data-droplet-entry></div>");
    expect(a).toContain("data-droplet-error");
    expect(payload(a, "data-droplet-data")).toEqual({ error: { message: "Sorry" } });
    expect(renderError).not.toHaveBeenCalled();

    // hydrate = false: markup only, nothing for the browser.
    const static_ = fakeApp({ renderDroplet: failed, renderError, getDropletMeta: flags(true, false) });
    const b = await (await static_.app.request("/droplets/hello")).text();
    expect(b).toContain("<p>error page</p>");
    expect(b).not.toContain("data-droplet-data");

    // ?noSSR renders no markup; the error stays inline for the browser.
    const both = fakeApp({ renderDroplet: failed, renderError, loadDropletData: failed, getDropletMeta: flags(true, true) });
    const c = await (await both.app.request("/droplets/hello?noSSR")).text();
    expect(c).not.toContain("<p>error page</p>");
    expect(payload(c, "data-droplet-data")).toEqual({ error: { message: "Sorry" } });
  });


  it("answers a droplet that cannot show its error through hooks.server handleError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handleError = vi.fn(() => ({ message: "Try later" }));
    const cause = new Error("database password is hunter2");
    const { app } = fakeApp({
      renderDroplet: async () => {
        throw new UnhandledDropletError("hello", "load failed and there is no +error.svelte", cause);
      },
      getHandleError: () => handleError,
    });
    const res = await app.request("/droplets/hello");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Try later");
    expect((handleError.mock.calls[0] as unknown as [{ error: unknown }])[0].error).toBe(cause);
  });

  it("answers 500 when the error page itself fails, and error() without any page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = fakeApp({
      renderDroplet: async () => ({ failed: true as const, error: {} }),
      renderError: async () => {
        throw new Error("error page broke");
      },
    });
    const res = await failing.app.request("/droplets/hello");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Internal Server Error");

    const renderError = vi.fn();
    const none = fakeApp({ renderDroplet: async () => error(404, "gone"), renderError });
    const plain = await none.app.request("/droplets/hello");
    expect(plain.status).toBe(404);
    expect(await plain.text()).toBe("gone");
    expect(renderError).not.toHaveBeenCalled();
  });

  it("answers redirect() from a droplet with the redirect itself", async () => {
    const { app } = fakeApp({
      renderDroplet: async () => redirect(303, "/login"),
      loadDropletData: async () => redirect(307, "/elsewhere"),
    });
    const res = await app.request("/droplets/hello");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
    const data = await app.request("/droplets/hello/_data", { method: "POST" });
    expect(data.status).toBe(307);
    expect(data.headers.get("location")).toBe("/elsewhere");
  });

  it("renders the configured element name", async () => {
    const { app } = fakeApp({ element: "acme-widget" });
    const fragment = await (await app.request("/droplets/hello")).text();
    expect(fragment.startsWith("<acme-widget ")).toBe(true);
    expect(fragment).not.toContain("djs-droplet");
  });
});

describe("createDropletsApp: _data", () => {
  it("serves the server load alone, for any method, without rendering", async () => {
    const { app, renderDroplet } = fakeApp();
    const get = await app.request("/droplets/hello/_data?who=D");
    expect(await get.json()).toEqual({ data: { name: "hello", props: { who: "D" } } });

    const post = await app.request("/droplets/hello/_data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { who: "P" } }),
    });
    expect(await post.json()).toEqual({ data: { name: "hello", props: { who: "P" } } });
    expect((await app.request("/droplets/missing/_data")).status).toBe(404);
    expect(renderDroplet).not.toHaveBeenCalled();
  });

  it("returns undefined data when no server loader exists", async () => {
    const { app } = fakeApp({ loadDropletData: undefined });
    expect(await (await app.request("/droplets/hello/_data")).json()).toEqual({});
  });

  it("answers error() as an endpoint does: its status and message", async () => {
    const { app } = fakeApp({ loadDropletData: async () => error(403) });
    const res = await app.request("/droplets/hello/_data");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "Forbidden" });
  });

  it("answers a failed load as { error } with a 500", async () => {
    const { app } = fakeApp({
      loadDropletData: async () => ({ failed: true as const, error: { message: "Sorry" } }),
    });
    const res = await app.request("/droplets/hello/_data");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { message: "Sorry" } });
  });
});

describe("createDropletsApp: handle", () => {
  it("fills locals for droplet loads", async () => {
    const { app, renderDroplet } = fakeApp({
      getHandle: () => async ({ event, resolve }) => {
        event.locals["user"] = "ana";
        return resolve(event);
      },
    });
    await app.request("/droplets/hello");
    expect(renderDroplet.mock.calls[0]?.[1].locals).toEqual({ user: "ana" });
  });

  it("can change the response resolve returns", async () => {
    const { app } = fakeApp({
      getHandle: () => async ({ event, resolve }) => {
        const response = await resolve(event);
        response.headers.set("x-hooked", "yes");
        return response;
      },
    });
    const res = await app.request("/droplets/hello");
    expect(res.headers.get("x-hooked")).toBe("yes");
    expect(await res.text()).toContain("<djs-droplet");
  });

  it("can replace the response entirely", async () => {
    const { app } = fakeApp({
      getHandle: () => async ({ event, resolve }) => {
        await resolve(event);
        return new Response("replaced", { status: 202 });
      },
    });
    const res = await app.request("/droplets/hello");
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("replaced");
  });

  it("can answer without resolving", async () => {
    const { app, renderDroplet } = fakeApp({
      getHandle: () => () => new Response("nope", { status: 401 }),
    });
    const res = await app.request("/droplets/hello");
    expect(res.status).toBe(401);
    expect(renderDroplet).not.toHaveBeenCalled();
  });

  it("turns error() and redirect() in handle into responses", async () => {
    const denied = fakeApp({ getHandle: () => () => error(401, "Sign in first") });
    const res = await denied.app.request("/droplets/hello");
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Sign in first");

    const moved = fakeApp({ getHandle: () => () => redirect(307, "/elsewhere") });
    const redirected = await moved.app.request("/droplets/hello");
    expect(redirected.status).toBe(307);
    expect(redirected.headers.get("location")).toBe("/elsewhere");
  });

  it("500s when handle returns something that is not a Response", async () => {
    const { app } = fakeApp({ getHandle: () => (() => "text") as unknown as Handle });
    expect((await app.request("/droplets/hello")).status).toBe(500);
  });

  it("never runs before the health check", async () => {
    const handle = vi.fn(() => new Response("blocked", { status: 401 }));
    const { app } = fakeApp({ getHandle: () => handle });
    expect(await (await app.request("/health")).text()).toBe("ok");
    expect(handle).not.toHaveBeenCalled();
  });
});

describe("createDropletsApp: /api", () => {
  const users: ApiModule = {
    GET: ({ params, locals }) => json({ id: params["id"], user: locals["user"] ?? null }),
    POST: async ({ request }) => json(await request.json(), { status: 201 }),
  };
  const matchApi = apiOf([
    [[{ type: "static", value: "api" }, { type: "static", value: "users" }, { type: "param", name: "id" }], users],
    [[{ type: "static", value: "api" }, { type: "static", value: "any" }], { fallback: ({ request }) => json({ method: request.method }) }],
    [[{ type: "static", value: "api" }, { type: "static", value: "fail" }], {
      GET: () => error(422, "Bad input"),
      POST: () => redirect(303, "/done"),
      PUT: () => "oops" as unknown as Response,
      DELETE: () => {
        throw new Error("crash");
      },
    }],
  ]);

  it("dispatches by method with params and locals", async () => {
    const { app } = fakeApp({
      matchApi,
      getHandle: () => ({ event, resolve }) => {
        event.locals["user"] = "ana";
        return resolve(event);
      },
    });
    expect(await (await app.request("/api/users/7")).json()).toEqual({ id: "7", user: "ana" });

    const created = await app.request("/api/users/7", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ name: "x" });
  });

  it("answers HEAD from GET without a body", async () => {
    const { app } = fakeApp({ matchApi });
    const res = await app.request("/api/users/7", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("answers 405 with Allow for a method the route does not export", async () => {
    const { app } = fakeApp({ matchApi });
    const res = await app.request("/api/users/7", { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, POST, HEAD");
  });

  it("calls only HTTP method exports: CONFIG, constructor and the like answer 405", async () => {
    const odd = apiOf([[[{ type: "static", value: "api" }, { type: "static", value: "odd" }], {
      GET: () => json({ ok: true }),
      CONFIG: () => json({ leaked: true }),
      fallback: () => json({ fallback: true }),
    } as ApiModule]]);
    const { app } = fakeApp({ matchApi: odd });
    for (const method of ["CONFIG", "config", "CONSTRUCTOR", "TOSTRING", "PROPFIND"]) {
      const res = await app.request("/api/odd", { method });
      expect(res.status, method).toBe(405);
      expect(await res.text(), method).not.toContain("leaked");
    }
    // A real method still finds fallback.
    expect(await (await app.request("/api/odd", { method: "PATCH" })).json()).toEqual({ fallback: true });
    // Prototype members are not exports either.
    const bare = apiOf([[[{ type: "static", value: "api" }, { type: "static", value: "bare" }], Object.create({ POST: () => json({ inherited: true }) }) as ApiModule]]);
    expect((await fakeApp({ matchApi: bare }).app.request("/api/bare", { method: "POST" })).status).toBe(405);
  });

  it("falls back to `fallback` for any other method", async () => {
    const { app } = fakeApp({ matchApi });
    const res = await app.request("/api/any", { method: "PATCH" });
    expect(await res.json()).toEqual({ method: "PATCH" });
  });

  it("404s unknown routes and when there is no API", async () => {
    expect((await fakeApp({ matchApi }).app.request("/api/nope")).status).toBe(404);
    expect((await fakeApp().app.request("/api/users/1")).status).toBe(404);
  });

  it("turns error(), redirect(), bad returns and crashes into responses", async () => {
    const { app } = fakeApp({ matchApi });
    const failed = await app.request("/api/fail");
    expect(failed.status).toBe(422);
    expect(await failed.json()).toEqual({ message: "Bad input" });

    const moved = await app.request("/api/fail", { method: "POST" });
    expect(moved.status).toBe(303);
    expect(moved.headers.get("location")).toBe("/done");

    expect((await app.request("/api/fail", { method: "PUT" })).status).toBe(500);
    const crashed = await app.request("/api/fail", { method: "DELETE" });
    expect(crashed.status).toBe(500);
    expect(await crashed.json()).toEqual({ message: "Internal Server Error" });
  });
});

describe("createDropletsApp: import map", () => {
  const importmap = vi.fn(({ externals }: { externals: string[] }) => ({
    imports: Object.fromEntries(externals.map((name) => [name, `https://cdn.test/${name}.js`])),
  }));
  const withMap = (over: Partial<DropletsAppOptions> = {}) =>
    fakeApp({
      importMap: { path: "/importmap", auto: true },
      getImportMap: () => importmap,
      externals: () => ["ag-grid"],
      ...over,
    });

  it("serves the map as a <script type=\"importmap\"> block, uncached, for GET and POST", async () => {
    const { app } = withMap();
    for (const method of ["GET", "POST"]) {
      const res = await app.request("http://drops.test/importmap", { method });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toBe('<script type="importmap">{"imports":{"ag-grid":"https://cdn.test/ag-grid.js"}}</script>');
    }
    const event = importmap.mock.calls[0]?.[0] as unknown as { url: URL; request: Request; externals: string[] };
    expect(event.url.href).toBe("http://drops.test/importmap");
    expect(event.request).toBeInstanceOf(Request);
    expect(event.externals).toEqual(["ag-grid"]);
  });

  it("checks the Origin and the body size of a POST to the map, like other routes", async () => {
    const { app } = withMap({ limits: { json: 16, form: 16, multipart: 16, props: 8192 } });
    for (const path of ["/importmap", "/importmap.js"]) {
      const crossSite = await app.request(`http://drops.test${path}`, {
        method: "POST",
        headers: { "content-type": "text/plain", origin: "https://evil.example" },
        body: "x",
      });
      expect(crossSite.status, path).toBe(403);
      const large = await app.request(`http://drops.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ big: "x".repeat(100) }),
      });
      expect(large.status, path).toBe(413);
    }
  });

  it("serves <path>.js, a script that inserts the block itself", async () => {
    const { app } = withMap();
    const res = await app.request("/importmap.js");
    expect(res.headers.get("content-type")).toContain("javascript");
    const code = await res.text();
    expect(code).toContain('script.type = "importmap"');
    expect(code).toContain("document.currentScript");
    expect(code).toContain("https://cdn.test/ag-grid.js");
  });

  it("is off when there are no externals, unless a path was set", async () => {
    const auto = withMap({ externals: () => [] });
    expect((await auto.app.request("/importmap")).status).toBe(404);
    expect((await auto.app.request("/importmap.js")).status).toBe(404);

    const explicit = withMap({ externals: () => [], importMap: { path: "/vendor-map", auto: false } });
    expect((await explicit.app.request("/vendor-map")).status).toBe(200);
    expect((await explicit.app.request("/importmap")).status).toBe(404);
  });

  it("404s without importmap.server.ts, and when turned off", async () => {
    expect((await withMap({ getImportMap: () => undefined }).app.request("/importmap")).status).toBe(404);
    expect((await withMap({ importMap: false }).app.request("/importmap")).status).toBe(404);
  });

  it("500s when the handler throws or returns something else", async () => {
    const throwing = withMap({
      getImportMap: () => () => {
        throw new Error("no cdn");
      },
    });
    expect((await throwing.app.request("/importmap")).status).toBe(500);
    const wrong = withMap({ getImportMap: () => () => "nope" as never });
    expect((await wrong.app.request("/importmap")).status).toBe(500);
  });

  it("escapes the map so it cannot close its script tag", async () => {
    const { app } = withMap({ getImportMap: () => () => ({ imports: { x: "https://cdn.test/</script>.js" } }) });
    expect(await (await app.request("/importmap")).text()).not.toContain("</script>.js");
  });
});

describe("createDropletsApp: fragment styles and preloads", () => {
  const withEntry = (overrides: Partial<DropletsAppOptions> = {}) =>
    fakeApp({ entryModule: () => "assets/index.abc123.js", ...overrides });

  it("links the droplet's style.css inside the element, before the markup", async () => {
    const { app } = withEntry();
    const html = await (await app.request("http://drops.test/droplets/hello")).text();
    expect(html).toContain(
      '<link rel="stylesheet" href="http://drops.test/droplets/hello/style.css?c=abc123" data-droplet-style><div style="display: contents" data-droplet-entry>',
    );
    // Nothing to link for a droplet without styles.
    expect(await (await app.request("/droplets/other")).text()).not.toContain("<link");
  });

  it("announces the stylesheets, the entry and an eager bundle in a Link header", async () => {
    const { app } = withEntry();
    const res = await app.request("http://drops.test/droplets/hello");
    expect(res.headers.get("link")).toBe([
      "<http://drops.test/droplets/hello/style.css?c=abc123>; rel=preload; as=style",
      "<http://drops.test/assets/Badge-1.css>; rel=preload; as=style",
      "<http://drops.test/assets/hello-2.css>; rel=preload; as=style",
      "<http://drops.test/assets/index.abc123.js>; rel=modulepreload",
      "<http://drops.test/droplets/hello/client.js?c=abc123>; rel=modulepreload",
    ].join(", "));
  });

  it("uses the public origin from a trusted x-droplet-location for the link and the header", async () => {
    const { app } = withEntry({ trustedOrigins: ["https://public.test"] });
    const res = await app.request("http://internal:8000/droplets/hello", {
      headers: { "x-droplet-location": "https://public.test" },
    });
    const link = res.headers.get("link") ?? "";
    expect(link).toContain("<https://public.test/droplets/hello/style.css?c=abc123>; rel=preload; as=style");
    expect(link).toContain("<https://public.test/assets/index.abc123.js>; rel=modulepreload");
    expect(link).not.toContain("internal");
    expect(await res.text()).toContain('href="https://public.test/droplets/hello/style.css?c=abc123"');
  });

  it("preloads no bundle for a droplet that never hydrates or hydrates later", async () => {
    const lazy = withEntry({
      getDropletMeta: (name) => ({ exists: true, ssr: true, hydrate: name === "static" ? false : "visible" }),
    });
    for (const name of ["static", "hello"]) {
      const link = (await lazy.app.request(`http://drops.test/droplets/${name}`)).headers.get("link") ?? "";
      expect(link, name).toContain("rel=preload; as=style");
      expect(link, name).toContain("index.abc123.js>; rel=modulepreload");
      expect(link, name).not.toContain("client.js");
    }
  });

  it("links and announces the same for the error page, POST and prerendered fragments", async () => {
    const { app } = withEntry({
      loadDropletData: async () => ({ failed: true, error: { message: "Sorry" } }),
      renderDroplet: async () => ({ failed: true, error: { message: "Sorry" } }),
      renderError: async () => ({ html: "<p>Sorry</p>" }),
    });
    const failed = await app.request("http://drops.test/droplets/hello");
    expect(failed.status).toBe(500);
    expect(failed.headers.get("link")).toContain("hello/client.js?c=abc123>; rel=modulepreload");
    expect(await failed.text()).toContain("data-droplet-style");

    const posted = await withEntry().app.request("http://drops.test/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { who: "Body" } }),
    });
    expect(posted.headers.get("link")).toContain("style.css?c=abc123>; rel=preload; as=style");
    expect(await posted.text()).toContain("data-droplet-style");

    const prerendered = withEntry({
      getDropletMeta: () => ({ exists: true, ssr: true, hydrate: true, prerender: true }),
      loadPrerendered: async () => ({ html: "<p>built</p>", data: {} }),
    });
    const built = await prerendered.app.request("http://drops.test/droplets/hello");
    const html = await built.text();
    expect(html).toContain('data-droplet-style><div style="display: contents" data-droplet-entry><p>built</p>');
    expect(built.headers.get("link")).toContain("style.css?c=abc123>; rel=preload; as=style");
  });

  it("sends no Link header with linkHeader: false, and no cache bust without a build hash", async () => {
    const off = withEntry({ linkHeader: false });
    const res = await off.app.request("http://drops.test/droplets/hello");
    expect(res.headers.get("link")).toBeNull();
    expect(await res.text()).toContain("data-droplet-style");

    const unhashed = fakeApp({ buildHash: undefined });
    const html = await (await unhashed.app.request("http://drops.test/droplets/hello")).text();
    expect(html).toContain('href="http://drops.test/droplets/hello/style.css" data-droplet-style');
  });
});

describe("createDropletsApp: Cache-Control of fragments and _data", () => {
  it("keeps them out of shared caches by default", async () => {
    const { app } = fakeApp();
    for (const path of ["/droplets/hello", "/droplets/hello/_data"]) {
      expect((await app.request(path)).headers.get("cache-control"), path).toBe("private, no-store");
    }
    // Error answers too: they are per request as well.
    expect((await app.request("/droplets/missing")).headers.get("cache-control")).toBe("private, no-store");
    // Not the assets: those have their own.
    expect((await app.request("/droplets/hello/client.js?c=abc123")).headers.get("cache-control")).toContain("immutable");
  });

  it("takes another value, or none, from fragmentCacheControl", async () => {
    const shared = fakeApp({ fragmentCacheControl: "public, max-age=60" }).app;
    expect((await shared.request("/droplets/hello")).headers.get("cache-control")).toBe("public, max-age=60");
    const none = fakeApp({ fragmentCacheControl: false }).app;
    expect((await none.request("/droplets/hello")).headers.get("cache-control")).toBeNull();
  });

  it("leaves a Cache-Control that handle set", async () => {
    const handle: Handle = async ({ event, resolve }) => {
      const response = await resolve(event);
      response.headers.set("cache-control", "public, max-age=5");
      return response;
    };
    const { app } = fakeApp({ getHandle: () => handle });
    expect((await app.request("/droplets/hello")).headers.get("cache-control")).toBe("public, max-age=5");
  });
});

describe("createDropletsApp: setHeaders in a droplet's load", () => {
  const HOST_VARY = "x-droplet-location, forwarded, x-forwarded-host, x-forwarded-proto, x-forwarded-port, x-forwarded-prefix, origin";
  const publicLoad = (event: LoadEvent) => {
    event.setHeaders({ "Cache-Control": "public, max-age=60", vary: "Accept-Language" });
    return { name: "hello", props: event.props };
  };

  it("sets the fragment's and _data's headers; its Cache-Control replaces the default", async () => {
    const { app } = fakeApp({
      renderDroplet: async (_name, event) => ({ html: "<p>x</p>", serverData: publicLoad(event) }),
      loadDropletData: async (_name, event) => ({ data: publicLoad(event) }),
    });
    for (const path of ["/droplets/hello", "/droplets/hello/_data?who=Ana"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe("public, max-age=60");
      // The load's vary first, then the host headers, each once.
      expect(res.headers.get("vary"), path).toBe(`Accept-Language, ${HOST_VARY}`);
    }
  });

  it("keeps the default and varies on the host headers when the load sets nothing", async () => {
    const { app } = fakeApp();
    for (const path of ["/droplets/hello", "/droplets/hello/_data"]) {
      const res = await app.request(path);
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
      expect(res.headers.get("vary"), path).toBe(HOST_VARY);
    }
  });

  it("does not repeat a host header the load already varies on", async () => {
    const { app } = fakeApp({
      loadDropletData: async (_name, event) => {
        event.setHeaders({ vary: "Origin, cookie" });
        return { data: null };
      },
    });
    const res = await app.request("/droplets/hello/_data");
    expect(res.headers.get("vary")).toBe("Origin, cookie, x-droplet-location, forwarded, x-forwarded-host, x-forwarded-proto, x-forwarded-port, x-forwarded-prefix");
  });

  it("puts none of them on an error answer or a failed load", async () => {
    const failing = fakeApp({
      renderDroplet: async (_name, event) => {
        publicLoad(event);
        return { failed: true as const, error: { message: "Sorry" } };
      },
      loadDropletData: async (_name, event) => {
        publicLoad(event);
        return { failed: true as const, error: { message: "Sorry" } };
      },
    }).app;
    for (const path of ["/droplets/hello", "/droplets/hello/_data"]) {
      const res = await failing.request(path);
      expect(res.status, path).toBe(500);
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
    }
    const refused = fakeApp({
      loadDropletData: async (_name, event) => {
        publicLoad(event);
        return error(403);
      },
    }).app;
    const res = await refused.request("/droplets/hello/_data");
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("leaves the last word to handle", async () => {
    const handle: Handle = async ({ event, resolve }) => {
      const response = await resolve(event);
      response.headers.set("cache-control", "no-cache");
      return response;
    };
    const { app } = fakeApp({ getHandle: () => handle, loadDropletData: async (_n, event) => ({ data: publicLoad(event) }) });
    expect((await app.request("/droplets/hello/_data")).headers.get("cache-control")).toBe("no-cache");
  });

  it("serves a prerendered render with the headers its load set, never a set-cookie", async () => {
    const { app } = fakeApp({
      getDropletMeta: () => ({ exists: true, ssr: true, hydrate: true, prerender: true }),
      loadPrerendered: () => ({
        html: "<p>stored</p>",
        data: { stored: true },
        headers: { "cache-control": "public, max-age=600", "set-cookie": "a=1", "x-bad": "a\r\nb" },
      }),
    });
    for (const path of ["/droplets/docs", "/droplets/docs/_data"]) {
      const res = await app.request(path);
      expect(res.headers.get("cache-control"), path).toBe("public, max-age=600");
      expect(res.headers.get("set-cookie"), path).toBeNull();
      expect(res.headers.get("x-bad"), path).toBeNull();
      expect(res.headers.get("vary"), path).toBe(HOST_VARY);
    }
  });

  it("hands the build what the load set, to store with the render", async () => {
    const { app } = fakeApp({
      building: true,
      renderDroplet: async (_name, event) => ({ html: "<p>x</p>", serverData: publicLoad(event) }),
    });
    const res = await app.request("http://droplets.build/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: {} }),
    });
    expect((await res.json()).headers).toEqual({ "cache-control": "public, max-age=60", vary: "Accept-Language" });
  });

  it("does not give transform a setHeaders: it rewrites HTML only", async () => {
    let seen: unknown = "unset";
    const { app } = fakeApp({
      transformDroplet: async (_name, event) => {
        seen = (event as unknown as Record<string, unknown>)["setHeaders"];
        return event.html;
      },
    });
    await app.request("/droplets/hello");
    expect(seen).toBeUndefined();
  });
});

describe("createDropletsApp: where props come from", () => {
  it("takes a GET's props from the query, a POST's from the body only", async () => {
    const { app } = fakeApp();
    const get = await app.request("/droplets/hello/_data?who=Query");
    expect(await get.json()).toEqual({ data: { name: "hello", props: { who: "Query" } } });
    for (const path of ["/droplets/hello/_data?who=Query", "/droplets/hello?who=Query"]) {
      const post = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ props: { who: "Body" } }),
      });
      const text = await post.text();
      expect(text, path).toContain("Body");
      expect(text, path).not.toContain("Query");
    }
  });
});

describe("createDropletsApp: the query as it came", () => {
  it("hands every event the request as it came, the query untouched", async () => {
    const seen: string[] = [];
    let request: Request | undefined;
    const raw = new Request("http://drops.test/droplets/hello?who=Ana&compact&x=a%20b");
    const handle: Handle = ({ event, resolve }) => {
      seen.push(`handle ${event.url.search}`);
      return resolve(event);
    };
    const { app } = fakeApp({
      getHandle: () => handle,
      renderDroplet: async (name: string, event: LoadEvent) => {
        request = event.request;
        seen.push(`load ${JSON.stringify(event.props)}`);
        return { html: name, serverData: null };
      },
    });
    const res = await app.fetch(raw);
    expect(res.status).toBe(200);
    expect(request).toBe(raw);
    expect(seen).toEqual(["handle ?who=Ana&compact&x=a%20b", 'load {"who":"Ana","compact":"","x":"a b"}']);
  });

  it("never makes a no-JS result key a prop", async () => {
    const { app } = fakeApp();
    const res = await app.request("/droplets/hello/_data?who=Ana&__droplet_form_hello_b1=forged");
    expect(await res.json()).toEqual({ data: { name: "hello", props: { who: "Ana" } } });
  });
});

describe("createDropletsApp: CORS", () => {
  it("exposes the Link header and the build header to cross-origin hosts", async () => {
    const { app } = fakeApp({ cors: { origin: "*", exposeHeaders: ["x-custom"] } });
    const res = await app.request("/droplets/hello", { headers: { origin: "http://other.test" } });
    const exposed = (res.headers.get("access-control-expose-headers") ?? "").split(/,\s*/);
    expect(exposed).toEqual(expect.arrayContaining(["x-custom", "Link", "x-droplets-build"]));
  });

  it("adds CORS headers when configured", async () => {
    const { app } = fakeApp({ cors: { origin: "*" } });
    const res = await app.request("/droplets/hello/_data", { headers: { origin: "http://other.test" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const preflight = await app.request("/droplets/hello/_data", {
      method: "OPTIONS",
      headers: {
        origin: "http://other.test",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-droplet-props",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("x-droplet-props");
  });

  it("sends no CORS headers by default", async () => {
    const { app } = fakeApp();
    const res = await app.request("/health", { headers: { origin: "http://other.test" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("createDropletsApp: props schema", () => {
  const validateProps: DropletsAppOptions["validateProps"] = (_name, props) => {
    if (typeof props["page"] !== "string" || !/^\d+$/.test(props["page"])) {
      error(400, "Invalid props: page: Expected number");
    }
    return { page: Number(props["page"]) };
  };
  const renderError = vi.fn(() => ({ html: "<p>error page</p>" }));

  it("hands every load the validated props, and inlines them in the context", async () => {
    const { app, renderDroplet } = fakeApp({ validateProps });
    const html = await (await app.request("/droplets/hello?page=2")).text();
    expect(renderDroplet.mock.calls[0]?.[1].props).toEqual({ page: 2 });
    expect(payload(html, "data-droplet-context")).toMatchObject({ props: { page: 2 } });
  });

  it("answers 400 as an endpoint does when the props do not match, before any load", async () => {
    const { app, renderDroplet } = fakeApp({ validateProps, renderError });
    const res = await app.request("/droplets/hello?page=x");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid props: page: Expected number");
    expect(renderDroplet).not.toHaveBeenCalled();
    expect(renderError).not.toHaveBeenCalled();
  });

  it("validates before _data too", async () => {
    const { app, loadDropletData } = fakeApp({ validateProps });
    const res = await app.request("/droplets/hello/_data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { page: "x" } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "Invalid props: page: Expected number" });
    expect(loadDropletData).not.toHaveBeenCalled();
  });
});

describe("createDropletsApp: inline data", () => {
  it("inlines an envelope even when there is no server data", async () => {
    const { app } = fakeApp({
      renderDroplet: async () => ({ html: "<p>x</p>", serverData: undefined }),
    });
    const html = await (await app.request("/droplets/hello")).text();
    // Present, so the client knows not to ask _data.
    expect(payload(html, "data-droplet-data")).toEqual({});
  });
});

describe("createDropletsApp: prerendered droplets", () => {
  const meta: DropletsAppOptions["getDropletMeta"] = (name) =>
    name === "docs"
      ? { exists: true, ssr: true, prerender: true }
      : name === "spa-docs"
      ? { exists: true, ssr: false, prerender: true }
      : { exists: true, ssr: true };
  const loadPrerendered = vi.fn(async (_name: string, key: string) =>
    key === '{"page":1}'
      ? { html: "<p>page one</p>", data: { page: 1 } }
      : key === '{"page":99}'
      ? { html: "<p>unavailable</p>", failed: true as const, error: { message: "Unavailable" } }
      : null
  );

  it("serves the stored render for listed props, without rendering", async () => {
    const { app, renderDroplet, loadDropletData } = fakeApp({ getDropletMeta: meta, loadPrerendered });
    const html = await (await app.request("/droplets/docs?page=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: "https://host.test/docs", props: { page: 1 } }),
    })).text();
    expect(html).toContain("<p>page one</p>");
    expect(payload(html, "data-droplet-data")).toEqual({ data: { page: 1 } });
    // The context is this request's, not the build's.
    expect(payload(html, "data-droplet-context")).toEqual({ host: "https://host.test/docs", props: { page: 1 } });
    expect(renderDroplet).not.toHaveBeenCalled();
    expect(loadDropletData).not.toHaveBeenCalled();
  });

  it("renders unlisted props live when the droplet can render on the server", async () => {
    const { app, renderDroplet } = fakeApp({ getDropletMeta: meta, loadPrerendered });
    const res = await app.request("/droplets/docs?page=7");
    expect(res.status).toBe(200);
    expect(renderDroplet).toHaveBeenCalledOnce();
  });

  it("answers 404 for unlisted props with ssr = false, and ignores ssr for listed ones", async () => {
    const { app, renderDroplet } = fakeApp({ getDropletMeta: meta, loadPrerendered });
    expect((await app.request("/droplets/spa-docs?page=7")).status).toBe(404);
    const listed = await app.request("/droplets/spa-docs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { page: 1 } }),
    });
    expect(await listed.text()).toContain("<p>page one</p>");
    expect(renderDroplet).not.toHaveBeenCalled();
  });

  it("answers _data from the stored render", async () => {
    const { app, loadDropletData } = fakeApp({ getDropletMeta: meta, loadPrerendered });
    const res = await app.request("/droplets/docs/_data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { page: 1 } }),
    });
    expect(await res.json()).toEqual({ data: { page: 1 } });
    expect(loadDropletData).not.toHaveBeenCalled();
  });

  it("serves a stored error render as the error branch, fragment and _data", async () => {
    const { app, renderDroplet, loadDropletData } = fakeApp({ getDropletMeta: meta, loadPrerendered });
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { page: 99 } }),
    };
    const res = await app.request("/droplets/docs", init);
    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).toContain("data-droplet-error");
    expect(html).toContain("<p>unavailable</p>");
    expect(payload(html, "data-droplet-data")).toEqual({ error: { message: "Unavailable" } });
    const data = await app.request("/droplets/docs/_data", init);
    expect(data.status).toBe(500);
    expect(await data.json()).toEqual({ error: { message: "Unavailable" } });
    expect(renderDroplet).not.toHaveBeenCalled();
    expect(loadDropletData).not.toHaveBeenCalled();
  });

  it("serves the render made for this host first, else the host-agnostic one with its tokens replaced", async () => {
    const stored = vi.fn(async (_name: string, key: string) =>
      key === '{"page":1} https://fixed.test/docs'
        ? { html: "<p>fixed</p>", data: { page: 1 } }
        : key === '{"page":1}'
        ? {
          html: '<a href="__$DROPLET_HOST$__/x?to=__%24DROPLET_PATH%24__">__$DROPLET_PATH$__</a>',
          data: { home: "__$DROPLET_HOST$__/home", path: "__$DROPLET_PATH$__" },
        }
        : null
    );
    const transformDroplet = vi.fn(async (_name: string, event: TransformEvent) => event.html);
    const { app } = fakeApp({ getDropletMeta: meta, loadPrerendered: stored, transformDroplet });
    const request = (host: string) =>
      app.request("/droplets/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host, props: { page: 1 } }),
      });

    expect(await (await request("https://fixed.test/docs?ref=1")).text()).toContain("<p>fixed</p>");
    const html = await (await request("https://shop.test/a&b")).text();
    expect(html).toContain('<a href="https://shop.test/x?to=%2Fa%26b">/a&amp;b</a>');
    expect(payload(html, "data-droplet-data")).toEqual({ data: { home: "https://shop.test/home", path: "/a&b" } });
    // transform sees the HTML with the tokens already replaced.
    expect(transformDroplet.mock.calls[1]?.[1].html).not.toContain("DROPLET_");
  });

  it("replaces only its build's tokens: the same text without the nonce is content, left alone", async () => {
    const stored = vi.fn(async () => ({
      html: "<p>__$DROPLET_HOST_n0nce$__ and __$DROPLET_HOST$__</p>",
      data: { home: "__$DROPLET_HOST_n0nce$__/home", text: "__$DROPLET_PATH$__" },
      nonce: "n0nce",
    }));
    const { app } = fakeApp({ getDropletMeta: meta, loadPrerendered: stored });
    const html = await (await app.request("/droplets/docs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: "https://shop.test/p", props: { page: 1 } }),
    })).text();
    expect(html).toContain("<p>https://shop.test and __$DROPLET_HOST$__</p>");
    expect(payload(html, "data-droplet-data")).toEqual({ data: { home: "https://shop.test/home", text: "__$DROPLET_PATH$__" } });
  });

  it("replaces the location token with where this request reaches the server, never an untrusted x-droplet-location", async () => {
    const stored = vi.fn(async () => ({
      html: '<form action="__$DROPLET_LOCATION_n0nce$__/droplets/docs?/add"></form>',
      data: { api: "__$DROPLET_LOCATION_n0nce$__/api" },
      nonce: "n0nce",
    }));
    const transformDroplet = vi.fn(async (_name: string, event: TransformEvent) => event.html);
    const { app } = fakeApp({
      getDropletMeta: meta,
      loadPrerendered: stored,
      transformDroplet,
      trustedOrigins: ["https://shop.test"],
    });
    const request = async (headers: Record<string, string>) =>
      (await app.request("http://drops.test/droplets/docs?page=1", { headers })).text();

    const own = await request({});
    expect(own).toContain('<form action="http://drops.test/droplets/docs?/add">');
    expect(payload(own, "data-droplet-data")).toEqual({ data: { api: "http://drops.test/api" } });
    // Before transform, as for the host tokens.
    expect(transformDroplet.mock.calls[0]?.[1].html).toContain("http://drops.test/droplets/docs");

    const proxied = await request({ "x-droplet-location": "https://shop.test/mfe/" });
    expect(proxied).toContain('<form action="https://shop.test/mfe/droplets/docs?/add">');

    const forwarded = await request({ "x-forwarded-host": "shop.test", "x-forwarded-proto": "https", "x-forwarded-prefix": "/fw" });
    expect(forwarded).toContain('<form action="https://shop.test/fw/droplets/docs?/add">');
    expect(payload(forwarded, "data-droplet-data")).toEqual({ data: { api: "https://shop.test/fw/api" } });

    for (const headers of <Record<string, string>[]>[
      { "x-droplet-location": "https://evil.example/x" },
      { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
      { forwarded: "proto=https;host=evil.example" },
      { "x-forwarded-host": "shop.test", "x-forwarded-proto": "https", "x-forwarded-prefix": "/x/../../evil" },
    ]) {
      const poisoned = await request(headers);
      expect(poisoned, JSON.stringify(headers)).toMatch(/<form action="(http:\/\/drops\.test|https:\/\/shop\.test)\/droplets\/docs\?\/add">/);
      expect(poisoned, JSON.stringify(headers)).not.toContain("evil");
      expect(JSON.stringify(payload(poisoned, "data-droplet-data"))).not.toContain("evil");
    }
  });

  it("runs transform per request, over stored and live HTML", async () => {
    const transformDroplet = vi.fn(async (_name: string, event: TransformEvent) =>
      event.html.replace("page one", `page one for ${event.host.host}`)
    );
    const { app } = fakeApp({ getDropletMeta: meta, loadPrerendered, transformDroplet });
    const html = await (await app.request("/droplets/docs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: "https://host.test", props: { page: 1 } }),
    })).text();
    expect(html).toContain("<p>page one for host.test</p>");
    await app.request("/droplets/hello?who=T");
    expect(transformDroplet).toHaveBeenCalledTimes(2);
    expect(transformDroplet.mock.calls[1]?.[1].html).toBe('<p>hello:{"who":"T"}</p>');
  });
});

describe("createDropletsApp: building", () => {
  it("answers the render as JSON for the build, keyed by the props", async () => {
    const { app } = fakeApp({ building: true });
    const res = await app.request("http://droplets.build/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { b: 2, a: 1 } }),
    });
    expect(await res.json()).toEqual({
      key: '{"a":1,"b":2}',
      html: '<p>hello:{"b":2,"a":1}</p>',
      data: { name: "hello", props: { b: 2, a: 1 } },
      // Host-agnostic: the nonce of its tokens, for the build to store with it.
      nonce: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
  });

  it("renders on a location token of the build: where it is served from is known per request", async () => {
    const { requestInfo } = await import("../../src/runtime/request-store.ts");
    let seen: string | undefined;
    const { app } = fakeApp({
      building: true,
      renderDroplet: async () => {
        seen = requestInfo()?.origin;
        return { html: "x", serverData: null };
      },
    });
    const res = await app.request("http://droplets.build/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json", "x-droplet-location": "http://droplets.build/prefix" },
      body: JSON.stringify({ props: {} }),
    });
    const { nonce } = (await res.json()) as { nonce: string };
    expect(seen).toBe(`__$DROPLET_LOCATION_${nonce}$__`);
  });

  it("answers a failed load with the error and its +error.svelte markup", async () => {
    const { app } = fakeApp({
      building: true,
      renderDroplet: async () => ({ failed: true as const, error: { message: "Sorry" } }),
      renderError: async () => ({ html: "<p>sorry</p>" }),
    });
    const res = await app.request("http://droplets.build/droplets/hello", { method: "POST" });
    expect(await res.json()).toEqual({
      key: "{}",
      html: "<p>sorry</p>",
      failed: true,
      error: { message: "Sorry" },
      nonce: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
  });

  it("renders for the body's host, keyed by props and that host", async () => {
    const { app } = fakeApp({
      building: true,
      renderDroplet: async (_name, event) => ({ html: event.host.searchParams.get("q") ?? "", serverData: event.host.href }),
    });
    const res = await app.request("http://droplets.build/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { a: 1 }, host: "https://shop.test/docs?q=x" }),
    });
    expect(await res.json()).toEqual({
      key: '{"a":1} https://shop.test/docs',
      html: "x",
      data: "https://shop.test/docs?q=x",
      // Its location is a token even with a host known.
      nonce: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
  });

  it("gives a host-agnostic render tokens for origin, pathname and href", async () => {
    const { app } = fakeApp({
      building: true,
      renderDroplet: async (_name, { host }) => ({
        html: `<a href="${host.origin}/x">${host.pathname}</a>`,
        serverData: { href: host.href, string: `${host}`, json: JSON.parse(JSON.stringify({ host })) },
      }),
    });
    const res = await app.request("http://droplets.build/droplets/hello", { method: "POST" });
    const body = (await res.json()) as { nonce: string };
    // Tokens of this build only: content cannot guess them.
    const host = `__$DROPLET_HOST_${body.nonce}$__`;
    const path = `__$DROPLET_PATH_${body.nonce}$__`;
    expect(body).toEqual({
      key: "{}",
      html: `<a href="${host}/x">${path}</a>`,
      data: { href: `${host}${path}`, string: `${host}${path}`, json: { host: `${host}${path}` } },
      nonce: body.nonce,
    });
    // Another build, other tokens.
    const again = (await (await fakeApp({ building: true }).app.request("http://droplets.build/droplets/hello", { method: "POST" })).json()) as { nonce: string };
    expect(again.nonce).not.toBe(body.nonce);
  });

  it("stops the build when a host-agnostic render reads more of host, caught or not", async () => {
    const thrown = fakeApp({
      building: true,
      renderDroplet: async (_name, { host }) => ({ html: host.searchParams.get("q") ?? "" }),
    });
    const res = await thrown.app.request("http://droplets.build/droplets/hello", { method: "POST" });
    expect(res.status).toBe(500);
    expect(res.headers.get("x-droplets-prerender-error")).toBe("host");
    expect((await res.json()).message).toContain("hello: host.searchParams is not known while prerendering");

    const caught = fakeApp({
      building: true,
      renderDroplet: async (_name, { host }) => {
        let q = "";
        try {
          q = host.hostname;
        } catch {
          // The droplet's own code swallowed it: the build still stops.
        }
        return { html: q };
      },
    });
    const res2 = await caught.app.request("http://droplets.build/droplets/hello", { method: "POST" });
    expect(res2.headers.get("x-droplets-prerender-error")).toBe("host");
    expect((await res2.json()).message).toContain("host.hostname");
  });

  it("still goes through handle", async () => {
    const handle: Handle = async ({ event, resolve }) => {
      event.locals["seen"] = true;
      return resolve(event);
    };
    const { app, renderDroplet } = fakeApp({ building: true, getHandle: () => handle });
    await app.request("http://droplets.build/droplets/hello", { method: "POST" });
    expect(renderDroplet.mock.calls[0]?.[1].locals).toEqual({ seen: true });
  });
});

describe("createDropletsApp: handleError", () => {
  it("chooses the message of unexpected errors", async () => {
    const handleError = vi.fn(() => ({ message: "Oops, ref 7" }));
    const { app } = fakeApp({
      renderDroplet: async () => {
        throw new Error("db down");
      },
      getHandleError: () => handleError,
    });
    const res = await app.request("/droplets/hello");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Oops, ref 7");
    const input = (handleError.mock.calls[0] as unknown as [{ status: number; message: string; error: Error }])[0];
    expect(input.status).toBe(500);
    expect(input.message).toBe("Internal Server Error");
    expect(input.error.message).toBe("db down");
  });

  it("is not called for a load that failed into +error.svelte", async () => {
    const handleError = vi.fn();
    const { app } = fakeApp({
      renderDroplet: async () => ({ failed: true as const, error: { message: "Sorry" } }),
      renderError: async () => ({ html: "<p>sorry</p>" }),
      getHandleError: () => handleError,
    });
    expect((await app.request("/droplets/hello")).status).toBe(500);
    expect(handleError).not.toHaveBeenCalled();
  });

  it("is not called for error()", async () => {
    const handleError = vi.fn();
    const { app } = fakeApp({
      loadDropletData: async () => error(403, "No"),
      getHandleError: () => handleError,
    });
    const res = await app.request("/droplets/hello/_data", { method: "POST" });
    expect(res.status).toBe(403);
    expect(handleError).not.toHaveBeenCalled();
  });

  it("answers JSON with its message for /api crashes", async () => {
    const { app } = fakeApp({
      matchApi: apiOf([[[{ type: "static", value: "api" }, { type: "static", value: "boom" }], {
        GET: () => {
          throw new Error("x");
        },
      }]]),
      getHandleError: () => () => ({ message: "Try later" }),
    });
    const res = await app.request("/api/boom");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Try later" });
  });

  it("falls back to Internal Server Error when it throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = fakeApp({
      loadDropletData: async () => {
        throw new Error("x");
      },
      getHandleError: () => () => {
        throw new Error("hook broke");
      },
    });
    const res = await app.request("/droplets/hello/_data", { method: "POST" });
    expect(await res.json()).toEqual({ message: "Internal Server Error" });
  });
});

describe("createDropletsApp: the droplet location", () => {
  let warn: MockInstance<typeof logger.warn>;
  beforeEach(() => {
    resetLocationWarnings();
    warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  const warnings = () => warn.mock.calls.map((call) => String(call[1]));

  /** Where the fragment's stylesheet points: the location the request resolved to. */
  const locationOf = async (headers: Record<string, string>, options: Partial<DropletsAppOptions> = {}, app = fakeApp(options).app) => {
    const html = await (await app.request("http://internal:8000/droplets/hello", { headers })).text();
    return html.match(/<link rel="stylesheet" href="([^"]*)\/droplets\/hello\/style\.css/)?.[1];
  };
  const SHOP = { origin: ["https://shop.test", "https://two.test"] };
  const viaShop = { "x-forwarded-host": "shop.test", "x-forwarded-proto": "https" };

  it("ignores a forged X-Forwarded-Host without a list", async () => {
    expect(await locationOf({ "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" })).toBe("http://internal:8000");
    expect(await locationOf({ forwarded: "proto=https;host=evil.example" })).toBe("http://internal:8000");
    // Unless it names the request's own origin.
    expect(await locationOf({ "x-forwarded-host": "internal:8000", "x-forwarded-prefix": "/mfe" })).toBe("http://internal:8000/mfe");
  });

  it("ignores a forwarded location not in the list, with one warning per header", async () => {
    const { app } = fakeApp(SHOP);
    const evil = { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" };
    expect(await locationOf(evil, {}, app)).toBe("http://internal:8000");
    expect(await locationOf(evil, {}, app)).toBe("http://internal:8000");
    expect(warnings().filter((text) => text.includes("x-forwarded-host"))).toHaveLength(1);
    expect(warnings()[0]).toContain("https://evil.example");
    expect(await locationOf({ forwarded: "host=evil.example" }, {}, app)).toBe("http://internal:8000");
    expect(warnings().filter((text) => text.includes("from forwarded"))).toHaveLength(1);
  });

  it("uses a forwarded location whose origin is listed in origin or trustedOrigins, with its prefix and port", async () => {
    expect(await locationOf({ ...viaShop, "x-forwarded-prefix": "/mfe/" }, SHOP)).toBe("https://shop.test/mfe");
    expect(await locationOf({ ...viaShop, "x-forwarded-prefix": "/mfe" }, { trustedOrigins: ["https://shop.test"] })).toBe("https://shop.test/mfe");
    expect(await locationOf({ ...viaShop, "x-forwarded-port": "8443" }, { origin: ["https://shop.test:8443"] })).toBe("https://shop.test:8443");
    // A default port is no port; a host with a port keeps its own.
    expect(await locationOf({ ...viaShop, "x-forwarded-port": "443" }, SHOP)).toBe("https://shop.test");
    expect(await locationOf({ "x-forwarded-host": "shop.test:9000", "x-forwarded-proto": "https", "x-forwarded-port": "443" }, { origin: ["https://shop.test:9000"] })).toBe("https://shop.test:9000");
    expect(await locationOf({ forwarded: 'for=1.2.3.4;proto=https;host="shop.test"', "x-forwarded-prefix": "/fw" }, SHOP)).toBe("https://shop.test/fw");
  });

  it("reads the first hop of a forwarded header, never a later one", async () => {
    expect(await locationOf({ "x-forwarded-host": "shop.test, evil.example", "x-forwarded-proto": "https, http" }, SHOP)).toBe("https://shop.test");
    expect(await locationOf({ "x-forwarded-host": "evil.example, shop.test", "x-forwarded-proto": "https" }, SHOP)).toBe("http://internal:8000");
    expect(await locationOf({ forwarded: "proto=https;host=shop.test, proto=https;host=evil.example" }, SHOP)).toBe("https://shop.test");
    expect(await locationOf({ forwarded: "proto=https;host=evil.example, proto=https;host=shop.test" }, SHOP)).toBe("http://internal:8000");
    expect(await locationOf({ ...viaShop, "x-forwarded-prefix": "/one, /two" }, SHOP)).toBe("https://shop.test/one");
  });

  it("drops a prefix that is no clean path, keeping the trusted origin", async () => {
    for (const prefix of ["@evil.example", "evil", "/a/../../b", "/..", "//evil.example/x", "/a\\b", "/a\tb", "/a?x=1", "/a#x", `/${"a".repeat(300)}`]) {
      expect(await locationOf({ ...viaShop, "x-forwarded-prefix": prefix }, SHOP), prefix).toBe("https://shop.test");
    }
    for (const sent of ["https://shop.test//evil.example/x", "https://shop.test/a/..%2f..%2fb/%09", "https://shop.test/a\\b"]) {
      expect(await locationOf({ "x-droplet-location": sent }, SHOP), sent).toMatch(/^https:\/\/shop\.test(\/[a-z%0-9.]*)*$/i);
      expect(await locationOf({ "x-droplet-location": sent }, SHOP), sent).not.toContain("//evil");
    }
    expect(await locationOf({ "x-droplet-location": "https://shop.test//evil.example/x" }, SHOP)).toBe("https://shop.test");
    // A host that is more than a host: refused, never read as a URL.
    for (const host of ["evil.example@shop.test", "shop.test/evil", "shop.test?x", "shop.test#x"]) {
      expect(await locationOf({ "x-forwarded-host": host, "x-forwarded-proto": "https" }, SHOP), host).toBe("http://internal:8000");
    }
    // Two values in a single-valued header: refused.
    expect(await locationOf({ "x-droplet-location": "https://shop.test/a, https://evil.example" }, SHOP)).toBe("http://internal:8000");
  });

  it("tries x-droplet-location, then Forwarded, then X-Forwarded-*, skipping the untrusted ones", async () => {
    const all = { "x-droplet-location": "https://two.test/named", forwarded: "proto=https;host=two.test", ...viaShop };
    expect(await locationOf(all, SHOP)).toBe("https://two.test/named");
    expect(await locationOf({ forwarded: "proto=https;host=two.test", ...viaShop }, SHOP)).toBe("https://two.test");
    expect(await locationOf({ ...all, "x-droplet-location": "https://evil.example", forwarded: "host=evil.example" }, SHOP)).toBe("https://shop.test");
  });

  it("uses the single origin entry when no header names a location, and the request's origin with several", async () => {
    expect(await locationOf({}, { origin: ["https://shop.test/mfe"] })).toBe("https://shop.test/mfe");
    expect(await locationOf({ "x-forwarded-host": "evil.example" }, { origin: ["https://shop.test/mfe"] })).toBe("https://shop.test/mfe");
    expect(await locationOf({}, SHOP)).toBe("http://internal:8000");
    expect(await locationOf({}, { origin: ["*"] })).toBe("http://internal:8000");
  });

  it("reads DROPLETS_ORIGIN per request, adding to origin", async () => {
    const { app } = fakeApp();
    expect(await locationOf({}, {}, app)).toBe("http://internal:8000");
    vi.stubEnv("DROPLETS_ORIGIN", "https://shop.test/mfe");
    expect(await locationOf({}, {}, app)).toBe("https://shop.test/mfe");
    vi.stubEnv("DROPLETS_ORIGIN", "https://shop.test, https://two.test, not a url");
    expect(await locationOf({ forwarded: "proto=https;host=two.test" }, {}, app)).toBe("https://two.test");
    expect(await locationOf({}, {}, app)).toBe("http://internal:8000");
    expect(warnings().some((text) => text.includes('DROPLETS_ORIGIN: ignoring "not a url"'))).toBe(true);
    vi.stubEnv("DROPLETS_ORIGIN", "");
    expect(await locationOf({ forwarded: "proto=https;host=two.test" }, {}, app)).toBe("http://internal:8000");
  });

  it("puts the origin check and redirect targets on the resolved location", async () => {
    const { app } = fakeApp(SHOP);
    const post = (headers: Record<string, string>) =>
      app.request("http://internal:8000/droplets/hello", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://shop.test", ...headers },
        body: "a=1",
      });
    expect((await post({})).status).toBe(403);
    expect((await post(viaShop)).status).not.toBe(403);
    expect((await post({ "x-forwarded-host": "evil.example", "x-forwarded-proto": "https", origin: "https://evil.example" })).status).toBe(403);
  });

  describe('"*"', () => {
    const anyLocation = (text: string) => text.includes('"*" trusts any forwarded location') && text.includes("/guides/security/#trusting-any-location");

    it("in origin or trustedOrigins, accepts any forwarded location", async () => {
      const evil = { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https", "x-forwarded-prefix": "/x" };
      expect(await locationOf(evil, { origin: ["*"] })).toBe("https://evil.example/x");
      expect(await locationOf(evil, { trustedOrigins: ["*"] })).toBe("https://evil.example/x");
      expect(await locationOf({ "x-droplet-location": "https://any.example/p" }, { origin: ["*"] })).toBe("https://any.example/p");
      vi.stubEnv("DROPLETS_ORIGIN", "*");
      expect(await locationOf(evil)).toBe("https://evil.example/x");
    });

    it("still drops a prefix that is no clean path", async () => {
      for (const prefix of ["@evil.example", "/a/../b", "//evil.example", "/a\tb", `/${"a".repeat(300)}`]) {
        expect(await locationOf({ ...viaShop, "x-forwarded-prefix": prefix }, { origin: ["*"] }), prefix).toBe("https://shop.test");
      }
      expect(await locationOf({ "x-forwarded-host": "evil.example@shop.test" }, { origin: ["*"] })).toBe("http://internal:8000");
    });

    it("warns once, when the app starts, not per request", async () => {
      const { app } = fakeApp({ origin: ["*"] });
      expect(warnings().filter(anyLocation)).toEqual(['origin: "*" trusts any forwarded location; see https://dropletsjs.dev/guides/security/#trusting-any-location']);
      await locationOf(viaShop, {}, app);
      await locationOf(viaShop, {}, app);
      expect(warnings().filter(anyLocation)).toHaveLength(1);
      fakeApp({ trustedOrigins: ["*"] });
      expect(warnings().filter((text) => anyLocation(text) && text.startsWith("trustedOrigins"))).toHaveLength(1);
      fakeApp();
      expect(warnings().filter(anyLocation)).toHaveLength(2);
    });

    it("in DROPLETS_ORIGIN, warns once", async () => {
      const { app } = fakeApp();
      vi.stubEnv("DROPLETS_ORIGIN", "https://shop.test,*");
      await locationOf({}, {}, app);
      await locationOf({}, {}, app);
      expect(warnings().filter((text) => anyLocation(text) && text.startsWith("DROPLETS_ORIGIN"))).toHaveLength(1);
    });
  });
});
