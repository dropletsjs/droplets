import { describe, expect, it, vi } from "vitest";
import { createDropletsApp, type DropletsAppOptions } from "../../src/runtime/app.ts";
import { encodeBase64 } from "../../src/runtime/base64.ts";
import type { ApiModule } from "../../src/runtime/routes.ts";
import { matchRoute } from "../../src/runtime/routes.ts";
import { json, type LoadEvent } from "../../src/runtime/server.ts";
import { setRuntimeEnv } from "../../src/runtime/env-store.ts";
import { isCrossSiteCapable } from "../../src/runtime/security.ts";

const echo: ApiModule = {
  POST: async ({ request }) => json({ body: await request.text() }),
  PUT: () => json({ ok: true }),
  DELETE: () => json({ ok: true }),
};

type FakeAppInput = Partial<DropletsAppOptions>;

function fakeApp(overrides: FakeAppInput = {}) {
  const renderDroplet = vi.fn(async (name: string, event: LoadEvent) => ({
    html: `<p>${name}:${JSON.stringify(event.props)}</p>`,
    serverData: { props: event.props },
  }));
  const handled = vi.fn();
  const options: DropletsAppOptions = {
    renderDroplet,
    loadDropletData: async (_name, event) => ({ data: { props: event.props } }),
    getDropletMeta: (name) => ({ exists: name !== "missing", ssr: true, hydrate: true }),
    getHandle:
      () =>
      ({ event, resolve }) => {
        handled();
        return resolve(event);
      },
    matchApi: (pathname) =>
      matchRoute({
        routes: [
          {
            id: "echo",
            segments: [
              { type: "static", value: "api" },
              { type: "static", value: "echo" },
            ],
            module: echo,
          },
        ],
        pathname,
      }),
    ...overrides,
  };
  return { app: createDropletsApp(options), renderDroplet, handled };
}

type FormInput = { origin?: string; type?: string; method?: string };

type FormInit = { method: string; headers: Record<string, string>; body: string };

function form({ origin, type = "application/x-www-form-urlencoded", method = "POST" }: FormInput = {}): FormInit {
  return {
    method,
    headers: { "content-type": type, ...(origin ? { origin } : {}) },
    body: "sku=mug",
  };
}

type RequestInput = { method: string; type?: string };

describe("CSRF: the Origin check", () => {
  it("knows which requests a page on another site can send without a preflight", () => {
    function request({ method, type }: RequestInput): Request {
      return new Request("http://x/", { method, ...(type ? { headers: { "content-type": type } } : {}), body: "x" });
    }
    expect(isCrossSiteCapable({ request: request({ method: "POST", type: "application/x-www-form-urlencoded" }) })).toBe(true);
    expect(isCrossSiteCapable({ request: request({ method: "PUT", type: "multipart/form-data; boundary=x" }) })).toBe(true);
    expect(isCrossSiteCapable({ request: request({ method: "PATCH", type: "Text/Plain;charset=UTF-8" }) })).toBe(true);
    expect(isCrossSiteCapable({ request: request({ method: "DELETE", type: "text/plain" }) })).toBe(true);
    expect(isCrossSiteCapable({ request: request({ method: "POST", type: "application/json" }) })).toBe(false);
    expect(isCrossSiteCapable({ request: new Request("http://x/", { method: "GET" }) })).toBe(false);
  });

  it("refuses a cross-site form post to droplets and /api, before handle", async () => {
    const { app, handled, renderDroplet } = fakeApp();
    for (const path of ["/droplets/hello", "/droplets/hello/_data", "/api/echo"]) {
      const res = await app.request(`http://drops.example${path}`, form({ origin: "https://evil.example" }));
      expect(res.status, path).toBe(403);
    }
    const fragment = await app.request("http://drops.example/droplets/hello", form({ origin: "https://evil.example" }));
    expect(await fragment.text()).toBe("Cross-site POST form submissions are forbidden");
    const api = await app.request("http://drops.example/api/echo", form({ origin: "https://evil.example", type: "text/plain" }));
    expect(await api.json()).toEqual({ message: "Cross-site POST form submissions are forbidden" });
    expect(handled).not.toHaveBeenCalled();
    expect(renderDroplet).not.toHaveBeenCalled();
  });

  it("refuses PUT, PATCH and DELETE forms too, and a form without an Origin", async () => {
    const { app } = fakeApp();
    for (const method of ["PUT", "DELETE"]) {
      expect(
        (
          await app.request(
            "http://drops.example/api/echo",
            form({ origin: "https://evil.example", type: "multipart/form-data; boundary=x", method }),
          )
        ).status,
      ).toBe(403);
    }
    expect((await app.request("http://drops.example/api/echo", form())).status).toBe(403);
  });

  it("lets the same origin, a trusted x-droplet-location's origin and trusted origins through", async () => {
    const { app } = fakeApp({ trustedOrigins: ["https://shop.example", "https://public.example"] });
    const same = await app.request("http://drops.example/api/echo", form({ origin: "http://drops.example" }));
    expect(await same.json()).toEqual({ body: "sku=mug" });
    const trusted = await app.request("http://drops.example/api/echo", form({ origin: "https://shop.example" }));
    expect(trusted.status).toBe(200);
    const proxied = await app.request("http://internal:8000/api/echo", {
      ...form({ origin: "https://public.example" }),
      headers: { ...form({ origin: "https://public.example" }).headers, "x-droplet-location": "https://public.example/" },
    });
    expect(proxied.status).toBe(200);
    expect((await app.request("http://drops.example/api/echo", form({ origin: "https://other.example" }))).status).toBe(403);
  });

  it("does not let an untrusted x-droplet-location vouch for its own origin", async () => {
    const { app, handled } = fakeApp({ trustedOrigins: ["https://shop.example"] });
    const spoofed = await app.request("http://drops.example/api/echo", {
      ...form({ origin: "https://evil.example" }),
      headers: { ...form({ origin: "https://evil.example" }).headers, "x-droplet-location": "https://evil.example/" },
    });
    expect(spoofed.status).toBe(403);
    const unlisted = fakeApp();
    expect(
      (
        await unlisted.app.request("http://drops.example/api/echo", {
          ...form({ origin: "https://evil.example" }),
          headers: { ...form({ origin: "https://evil.example" }).headers, "x-droplet-location": "https://evil.example/" },
        })
      ).status,
    ).toBe(403);
    // Nor a forged forwarded header.
    expect(
      (
        await app.request("http://drops.example/api/echo", {
          ...form({ origin: "https://evil.example" }),
          headers: {
            ...form({ origin: "https://evil.example" }).headers,
            "x-forwarded-host": "evil.example",
            "x-forwarded-proto": "https",
          },
        })
      ).status,
    ).toBe(403);
    expect(handled).not.toHaveBeenCalled();
  });

  it('trusts every origin with "*", or none of this with checkOrigin off', async () => {
    expect(
      (await fakeApp({ trustedOrigins: ["*"] }).app.request("http://drops.example/api/echo", form({ origin: "https://evil.example" })))
        .status,
    ).toBe(200);
    expect((await fakeApp({ csrf: { checkOrigin: false } }).app.request("http://drops.example/api/echo", form())).status).toBe(200);
  });

  it("leaves JSON posts and GETs alone: CORS answers those", async () => {
    const { app } = fakeApp();
    const res = await app.request("http://drops.example/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ props: { a: 1 } }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<p>hello:{"a":1}</p>');
    expect((await app.request("http://drops.example/droplets/hello?a=1", { headers: { origin: "https://evil.example" } })).status).toBe(
      200,
    );
  });

  type UntypedInput = { method: string; origin?: string };

  it("refuses an untyped unsafe request from an untrusted Origin, and lets one without an Origin through", async () => {
    const { app, handled } = fakeApp();
    // No body, or bytes: no content type at all, which a page may send cross-site.
    function untyped({ method, origin }: UntypedInput): RequestInit {
      return {
        method,
        ...(origin ? { headers: { origin } } : {}),
        body: method === "DELETE" ? null : new Uint8Array([1, 2, 3]),
      };
    }
    for (const method of ["POST", "PUT", "DELETE"]) {
      expect((await app.request("http://drops.example/api/echo", untyped({ method, origin: "https://evil.example" }))).status, method).toBe(
        403,
      );
      expect(
        (await app.request("http://drops.example/droplets/hello", untyped({ method, origin: "https://evil.example" }))).status,
        method,
      ).toBe(403);
    }
    expect(handled).not.toHaveBeenCalled();
    // Server to server: no Origin, no browser behind it.
    expect((await app.request("http://drops.example/api/echo", untyped({ method: "POST" }))).status).toBe(200);
    expect((await app.request("http://drops.example/api/echo", untyped({ method: "POST", origin: "http://drops.example" }))).status).toBe(
      200,
    );
  });

  it("trusts DROPLETS_TRUSTED_ORIGINS at runtime, with the configured list, and skips bad entries", async () => {
    const { app } = fakeApp({ trustedOrigins: ["https://config.example"] });
    try {
      setRuntimeEnv({ DROPLETS_TRUSTED_ORIGINS: " https://env.example/ , not a url, javascript:alert(1),https://two.example" });
      expect((await app.request("http://drops.example/api/echo", form({ origin: "https://env.example" }))).status).toBe(200);
      expect((await app.request("http://drops.example/api/echo", form({ origin: "https://two.example" }))).status).toBe(200);
      expect((await app.request("http://drops.example/api/echo", form({ origin: "https://config.example" }))).status).toBe(200);
      expect((await app.request("http://drops.example/api/echo", form({ origin: "https://evil.example" }))).status).toBe(403);
      // Read per request: a new value counts without a new app.
      setRuntimeEnv({ DROPLETS_TRUSTED_ORIGINS: "https://later.example" });
      expect((await app.request("http://drops.example/api/echo", form({ origin: "https://env.example" }))).status).toBe(403);
      expect((await app.request("http://drops.example/api/echo", form({ origin: "https://later.example" }))).status).toBe(200);
    } finally {
      setRuntimeEnv(undefined);
    }
  });

  it("does not guard other paths", async () => {
    const { app } = fakeApp({ loadIndex: () => "<p>home</p>" });
    expect((await app.request("http://drops.example/health", form({ origin: "https://evil.example" }))).status).not.toBe(403);
  });
});

describe("body limits", () => {
  const limits = { json: 64, form: 32, multipart: 128, props: 40 };

  it("answers 413 for a body over its type's limit, by content-length", async () => {
    const { app, handled } = fakeApp({ limits });
    const big = await app.request("http://drops.example/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "65" },
      body: JSON.stringify({ props: { a: "x".repeat(50) } }),
    });
    expect(big.status).toBe(413);
    expect(await big.text()).toBe("Payload Too Large");
    expect(handled).not.toHaveBeenCalled();

    const api = await app.request("http://drops.example/api/echo", {
      ...form({ origin: "http://drops.example" }),
      body: `sku=${"x".repeat(40)}`,
    });
    expect(api.status).toBe(413);
    expect(await api.json()).toEqual({ message: "Payload Too Large" });
  });

  it("counts a streamed body without a content-length", async () => {
    const { app } = fakeApp({ limits });
    const stream = (size: number) =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(size)));
          controller.close();
        },
      });
    const over = await app.request("http://drops.example/api/echo", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", origin: "http://drops.example" },
      body: stream(200),
      duplex: "half",
    } as RequestInit);
    expect(over.status).toBe(413);
    const under = await app.request("http://drops.example/api/echo", {
      method: "POST",
      headers: { "content-type": "application/octet-stream", origin: "http://drops.example" },
      body: stream(100),
      duplex: "half",
    } as RequestInit);
    expect(await under.json()).toEqual({ body: "x".repeat(100) });
  });

  it("answers 413 for a streamed JSON body over the limit on a render route", async () => {
    const { app, renderDroplet, handled } = fakeApp({ limits });
    const res = await app.request("http://drops.example/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ props: { a: "x".repeat(200) } })));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(handled).not.toHaveBeenCalled();
    expect(renderDroplet).not.toHaveBeenCalled();
  });

  it("takes bodies within the limits", async () => {
    const { app } = fakeApp({ limits });
    const res = await app.request("http://drops.example/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { a: 1 } }),
    });
    expect(res.status).toBe(200);
  });

  it("answers 431 for an x-droplet-props header over its limit", async () => {
    const { app } = fakeApp({ limits });
    const header = (props: unknown) => ({ headers: { "x-droplet-props": encodeBase64({ text: JSON.stringify(props) }) } });
    expect((await app.request("http://drops.example/droplets/hello", header({ a: "x".repeat(40) }))).status).toBe(431);
    expect((await app.request("http://drops.example/droplets/hello", header({ a: 1 }))).status).toBe(200);
  });

  it("has defaults large enough for ordinary bodies", async () => {
    const { app } = fakeApp();
    const res = await app.request("http://drops.example/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { text: "x".repeat(100_000) } }),
    });
    expect(res.status).toBe(200);
  });
});

describe("client input stays data", () => {
  it("leaves Object.prototype alone for __proto__ in the body, the query and x-droplet-props", async () => {
    const { app, renderDroplet } = fakeApp();
    const polluting = { props: JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}}}') };
    await app.request("http://drops.example/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(polluting).replace('"props":{', '"props":{"__proto__":{"polluted":1},'),
    });
    await app.request("http://drops.example/droplets/hello?__proto__[polluted]=1&__proto__=x&constructor=y");
    await app.request("http://drops.example/droplets/hello", {
      headers: { "x-droplet-props": encodeBase64({ text: '{"__proto__":{"polluted":1}}' }) },
    });
    await app.request("http://drops.example/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"context":{"host":"https://shop.example/","props":{"__proto__":{"polluted":1}}}}',
    });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(renderDroplet).toHaveBeenCalledTimes(4);
  });

  it("hands user code plain copies of client JSON: no own __proto__ key, prototypes kept", async () => {
    const { app, renderDroplet } = fakeApp({ findAction: async () => async () => ({ ok: true }) });
    await app.request("http://drops.example/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"props":{"__proto__":{"polluted":1},"a":1,"nested":{"__proto__":{"polluted":2},"b":[{"__proto__":3}]}},"form":{"__proto__":{"polluted":4},"msg":"hi"}}',
    });
    await app.request("http://drops.example/droplets/hello", {
      headers: { "x-droplet-props": encodeBase64({ text: '{"__proto__":{"polluted":5},"a":1}' }) },
    });
    expect(renderDroplet).toHaveBeenCalledTimes(2);
    const [fromBody, fromHeader] = renderDroplet.mock.calls as unknown as Array<[string, LoadEvent, { form?: unknown }]>;
    if (!fromBody || !fromHeader) expect.unreachable("two renders");
    const props = fromBody[1].props as { nested: { b: Array<Record<string, unknown>> } };
    expect(props).toEqual({ a: 1, nested: { b: [{}] } });
    for (const object of [props, props.nested, props.nested.b[0], fromBody[2].form, fromHeader[1].props]) {
      expect(Object.hasOwn(object as object, "__proto__")).toBe(false);
      expect(Object.getPrototypeOf(object)).toBe(Object.prototype);
    }
    expect(fromBody[2].form).toEqual({ msg: "hi" });
    expect(fromHeader[1].props).toEqual({ a: 1 });
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("answers 404 for droplet ids that name prototype members", async () => {
    const { app } = fakeApp({
      getDropletMeta: (name) => ({ exists: Object.hasOwn({ hello: 1 }, name), ssr: true, hydrate: true }),
    });
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect((await app.request(`http://drops.example/droplets/${id}`)).status, id).toBe(404);
    }
  });

  it("finds the droplet before it reads a body: an unknown one never has its JSON parsed", async () => {
    const { app } = fakeApp({
      getDropletMeta: (name) => ({ exists: Object.hasOwn({ hello: 1 }, name), ssr: true, hydrate: true }),
    });
    const json = vi.spyOn(Request.prototype, "json");
    try {
      for (const path of ["/droplets/__proto__", "/droplets/constructor/_data", "/droplets/missing"]) {
        const res = await app.request(`http://drops.example${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"props":{"__proto__":{"polluted":1}}}',
        });
        expect(res.status, path).toBe(404);
      }
      expect(json).not.toHaveBeenCalled();
      // A known one does.
      await app.request("http://drops.example/droplets/hello", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"props":{"a":1}}',
      });
      expect(json).toHaveBeenCalled();
    } finally {
      json.mockRestore();
    }
  });

  it("never lets a host that is not a web URL through, from the body or Origin; forwarded headers never set it", async () => {
    const hostOf = async (init: RequestInit) => {
      const { app, renderDroplet } = fakeApp();
      const res = await app.request("http://drops.example/droplets/hello", init);
      expect(res.status).toBe(200);
      return renderDroplet.mock.calls[0]?.[1].host.href;
    };
    const body = (host: unknown) => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host, props: {} }),
    });
    for (const host of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", 42, { href: "x" }]) {
      expect(await hostOf(body(host)), String(host)).toBe("http://drops.example/");
    }
    expect(await hostOf(body("https://user:pw@shop.example/p?q=1#frag"))).toBe("https://shop.example/p?q=1");
    expect(await hostOf({ headers: { forwarded: 'proto=javascript;host="shop.example"' } })).toBe("http://drops.example/");
    expect(await hostOf({ headers: { forwarded: 'proto=https;host="shop.example"', origin: "https://page.example" } })).toBe(
      "https://page.example/",
    );
    expect(await hostOf({ headers: { "x-forwarded-host": "shop.example", "x-forwarded-proto": "https" } })).toBe("http://drops.example/");
    expect(await hostOf({ headers: { "x-forwarded-host": "shop.example/<x>", "x-forwarded-proto": "https" } })).not.toContain("<");
    expect(await hostOf({ headers: { origin: "javascript:alert(1)" } })).toBe("http://drops.example/");
  });

  type HostOfInput = { host: string; trustedOrigins?: string[] };

  it("keeps host within trustedOrigins and our own origin, when the list is set", async () => {
    async function hostOf({ host, trustedOrigins }: HostOfInput): Promise<string | undefined> {
      const { app, renderDroplet } = fakeApp(trustedOrigins ? { trustedOrigins } : {});
      await app.request("http://drops.example/droplets/hello", {
        method: "POST",
        headers: { "content-type": "application/json", "x-droplet-location": "https://public.example/mfe" },
        body: JSON.stringify({ host, props: {} }),
      });
      return renderDroplet.mock.calls[0]?.[1].host.href;
    }
    expect(await hostOf({ host: "https://shop.example/cart", trustedOrigins: ["https://shop.example"] })).toBe("https://shop.example/cart");
    // An x-droplet-location that is not trusted is not this server's origin either.
    expect(await hostOf({ host: "https://evil.example/cart", trustedOrigins: ["https://shop.example"] })).toBe("http://drops.example/");
    expect(await hostOf({ host: "https://public.example/x", trustedOrigins: ["https://shop.example"] })).toBe("http://drops.example/");
    expect(await hostOf({ host: "https://evil.example/cart", trustedOrigins: ["https://shop.example", "https://public.example"] })).toBe(
      "https://public.example/",
    );
    expect(await hostOf({ host: "http://drops.example/x", trustedOrigins: ["https://shop.example"] })).toBe("http://drops.example/x");
    // No list, or "*": any web URL.
    expect(await hostOf({ host: "https://evil.example/cart" })).toBe("https://evil.example/cart");
    expect(await hostOf({ host: "https://evil.example/cart", trustedOrigins: ["*"] })).toBe("https://evil.example/cart");
  });
});
