import { describe, expect, it, vi } from "vitest";
import { createDropletsApp, type DropletsAppOptions } from "../../src/runtime/app.ts";
import { type CookieJar, createCookies, parseCookies, serializeCookie } from "../../src/runtime/cookies.ts";
import { matchRoute } from "../../src/runtime/routes.ts";
import { json, redirect, type Cookies, type Handle, type LoadEvent } from "../../src/runtime/server.ts";

type JarInput = { cookie?: string; url?: string };

function jar({ cookie = "", url = "https://drops.example/droplets/x" }: JarInput = {}): CookieJar {
  return createCookies({ request: new Request(url, { headers: { cookie } }), url: new URL(url) });
}

describe("cookies: parse and serialize", () => {
  it("parses the Cookie header; the first of a name wins", () => {
    expect([...parseCookies({ header: 'a=1; b="two"; c=%F0%9F%8D%AA; a=3; junk; d=%E0' })]).toEqual([
      ["a", "1"],
      ["b", "two"],
      ["c", "🍪"],
      ["d", "%E0"],
    ]);
  });

  it("does not let a cookie named __proto__ reach any prototype", () => {
    const { cookies } = jar({ cookie: "__proto__=x; constructor=y" });
    expect(cookies.get("__proto__")).toBe("x");
    expect(cookies.getAll()).toEqual([
      { name: "__proto__", value: "x" },
      { name: "constructor", value: "y" },
    ]);
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });

  it("serializes with every attribute", () => {
    expect(
      serializeCookie({
        name: "s",
        value: "a b",
        options: {
          path: "/",
          domain: "shop.example",
          maxAge: 60.9,
          expires: new Date(0),
          httpOnly: true,
          secure: true,
          sameSite: true,
          partitioned: true,
          priority: "high",
        },
      }),
    ).toBe(
      "s=a%20b; Max-Age=60; Domain=shop.example; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; Partitioned; Priority=High; SameSite=Strict",
    );
  });

  it("refuses what a Set-Cookie header cannot carry", () => {
    const raw = (value: string) => value;
    expect(serializeCookie({ name: "__Host-shop_admin", value: "1", options: { path: "/" } })).toBe("__Host-shop_admin=1; Path=/");
    expect(() => serializeCookie({ name: "a b", value: "x", options: { path: "/" } })).toThrow("not a valid token");
    expect(() => serializeCookie({ name: "a=b", value: "x", options: { path: "/" } })).toThrow("not a valid token");
    expect(() => serializeCookie({ name: "a", value: "x", options: { path: "/;evil", encode: raw } })).toThrow("invalid path");
    expect(() => serializeCookie({ name: "a", value: "x;y", options: { path: "/", encode: raw } })).toThrow("cannot carry");
    expect(() => serializeCookie({ name: "a", value: "x", options: { path: "/", domain: "a\r\nb" } })).toThrow("invalid domain");
  });
});

describe("cookies: the jar", () => {
  it("reads the request's cookies, decoded or by a custom decode", () => {
    const { cookies } = jar({ cookie: "theme=dark%20blue" });
    expect(cookies.get("theme")).toBe("dark blue");
    expect(cookies.get("theme", { decode: (v) => v })).toBe("dark%20blue");
    expect(cookies.get("missing")).toBeUndefined();
  });

  it("sets with SvelteKit's defaults and sees what it set", () => {
    const { cookies, setCookies } = jar({ cookie: "theme=dark; cart=1" });
    cookies.set("cart", "2", { path: "/" });
    expect(cookies.get("cart")).toBe("2");
    cookies.delete("theme", { path: "/" });
    expect(cookies.get("theme")).toBeUndefined();
    expect(cookies.getAll()).toEqual([{ name: "cart", value: "2" }]);
    expect(setCookies()).toEqual([
      "cart=2; Path=/; HttpOnly; Secure; SameSite=Lax",
      "theme=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    ]);
  });

  it("is not Secure on http://localhost, and the defaults can be turned off", () => {
    const local = jar({ url: "http://localhost:5173/droplets/x" });
    local.cookies.set("a", "1", { path: "/" });
    expect(local.setCookies()).toEqual(["a=1; Path=/; HttpOnly; SameSite=Lax"]);
    for (const url of ["http://127.0.0.1:8000/", "http://[::1]:8000/", "http://app.localhost/"]) {
      const loopback = jar({ url });
      loopback.cookies.set("a", "1", { path: "/" });
      expect(loopback.setCookies(), url).toEqual(["a=1; Path=/; HttpOnly; SameSite=Lax"]);
    }
    const lan = jar({ url: "http://192.168.1.5/" });
    lan.cookies.set("a", "1", { path: "/" });
    expect(lan.setCookies()).toEqual(["a=1; Path=/; HttpOnly; Secure; SameSite=Lax"]);
    const { cookies, setCookies } = jar();
    cookies.set("a", "1", { path: "/admin", httpOnly: false, secure: false, sameSite: false });
    expect(setCookies()).toEqual(["a=1; Path=/admin"]);
  });

  it("keeps the last set of a name, domain and path", () => {
    const { cookies, setCookies } = jar();
    cookies.set("a", "1", { path: "/" });
    cookies.set("a", "2", { path: "/" });
    cookies.set("a", "3", { path: "/admin" });
    expect(setCookies()).toHaveLength(2);
    expect(cookies.get("a")).toBe("3");
  });

  it("needs an absolute path", () => {
    const { cookies } = jar();
    expect(() => cookies.set("a", "1", {} as never)).toThrow("You must specify a `path`");
    expect(() => cookies.set("a", "1", { path: "admin" })).toThrow("must be absolute");
    expect(() => cookies.delete("a", undefined as never)).toThrow("You must specify a `path`");
    expect(cookies.serialize("a", "1", { path: "/" })).toBe("a=1; Path=/; HttpOnly; Secure; SameSite=Lax");
  });
});

describe("cookies: on the response", () => {
  const routes = [
    {
      id: "login",
      segments: [
        { type: "static" as const, value: "api" },
        { type: "static" as const, value: "login" },
      ],
      module: {
        POST: ({ cookies }) => {
          cookies.set("session", "s1", { path: "/" });
          return json({ ok: true });
        },
        GET: ({ cookies }) => {
          cookies.set("seen", "1", { path: "/" });
          // A response whose headers cannot change.
          return Response.redirect("https://drops.example/done", 303);
        },
      } satisfies import("../../src/runtime/routes.ts").ApiModule,
    },
  ];

  type FakeAppInput = Partial<DropletsAppOptions>;

  function fakeApp(overrides: FakeAppInput = {}) {
    const renderDroplet = vi.fn(async (_name: string, event: LoadEvent) => {
      return { html: `<p>${event.cookies.get("cart") ?? "none"}</p>`, serverData: {} };
    });
    const options: DropletsAppOptions = {
      renderDroplet,
      loadDropletData: async (_name, event) => {
        return { data: { cart: event.cookies.get("cart") ?? null, all: event.cookies.getAll().length } };
      },
      getDropletMeta: () => ({ exists: true, ssr: true, hydrate: true }),
      matchApi: (pathname) => matchRoute({ routes, pathname }),
      ...overrides,
    };
    return { app: createDropletsApp(options), renderDroplet };
  }

  it("hands a droplet's load and render its cookies to read, never to set", async () => {
    const { app } = fakeApp();
    const fragment = await app.request("https://drops.example/droplets/cart", { headers: { cookie: "cart=3" } });
    expect(await fragment.text()).toContain("<p>3</p>");
    expect(fragment.headers.getSetCookie()).toEqual([]);
    const data = await app.request("https://drops.example/droplets/cart/_data", { headers: { cookie: "cart=3" } });
    expect(await data.json()).toEqual({ data: { cart: "3", all: 1 } });

    // Not in the type; at runtime each one throws with where cookies are set.
    const tried: string[] = [];
    const { app: setting } = fakeApp({
      loadDropletData: async (_name, event) => {
        const cookies = event.cookies as unknown as Cookies;
        for (const attempt of [
          () => cookies.set("x", "1", { path: "/" }),
          () => cookies.delete("x", { path: "/" }),
          () => cookies.serialize("x", "1", { path: "/" }),
        ]) {
          try {
            attempt();
          } catch (error) {
            tried.push((error as Error).message);
          }
        }
        return { data: {} };
      },
    });
    const res = await setting.request("https://drops.example/droplets/cart/_data");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(tried).toHaveLength(3);
    for (const message of tried) expect(message).toContain("set in form actions, handle or +server.ts");
  });

  it("refuses sameSite none without secure: browsers drop it", () => {
    const { cookies } = jar();
    expect(() => cookies.set("a", "1", { path: "/", sameSite: "none", secure: false })).toThrow('sameSite "none" needs secure');
    expect(cookies.serialize("a", "1", { path: "/", sameSite: "none" })).toBe("a=1; Path=/; HttpOnly; Secure; SameSite=None");
    // Over plain HTTP to localhost `secure` is off by default: say it.
    const local = jar({ url: "http://localhost:5173/droplets/x" }).cookies;
    expect(() => local.set("a", "1", { path: "/", sameSite: "none" })).toThrow('sameSite "none" needs secure');
  });

  it("sends what +server.ts set, also on a response it built with fixed headers", async () => {
    const { app } = fakeApp();
    const posted = await app.request("https://drops.example/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(posted.headers.getSetCookie()).toEqual(["session=s1; Path=/; HttpOnly; Secure; SameSite=Lax"]);
    const redirected = await app.request("https://drops.example/api/login");
    expect(redirected.status).toBe(303);
    expect(redirected.headers.get("location")).toBe("https://drops.example/done");
    expect(redirected.headers.getSetCookie()).toEqual(["seen=1; Path=/; HttpOnly; Secure; SameSite=Lax"]);
  });

  it("sends what handle set, when it answers itself or redirects", async () => {
    const early: Handle = ({ event }) => {
      event.cookies.set("hook", "1", { path: "/" });
      return new Response("early");
    };
    const res = await fakeApp({ getHandle: () => early }).app.request("https://drops.example/droplets/cart");
    expect(await res.text()).toBe("early");
    expect(res.headers.getSetCookie()).toEqual(["hook=1; Path=/; HttpOnly; Secure; SameSite=Lax"]);

    const login: Handle = ({ event }) => {
      event.cookies.set("session", "s2", { path: "/" });
      redirect(303, "/admin");
    };
    const moved = await fakeApp({ getHandle: () => login }).app.request("https://drops.example/droplets/cart");
    expect(moved.status).toBe(303);
    expect(moved.headers.getSetCookie()).toEqual(["session=s2; Path=/; HttpOnly; Secure; SameSite=Lax"]);
  });

  it("lets handle and the load share the same cookies", async () => {
    const handle: Handle = ({ event, resolve }) => {
      event.cookies.set("cart", "9", { path: "/" });
      return resolve(event);
    };
    const res = await fakeApp({ getHandle: () => handle }).app.request("https://drops.example/droplets/cart", {
      headers: { cookie: "cart=3" },
    });
    expect(await res.text()).toContain("<p>9</p>");
    expect(res.headers.getSetCookie()).toEqual(["cart=9; Path=/; HttpOnly; Secure; SameSite=Lax"]);
  });

  it("leaves a response alone when nothing was set", async () => {
    const { app } = fakeApp({ renderDroplet: async () => ({ html: "<p>x</p>" }) });
    const res = await app.request("https://drops.example/droplets/cart");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("stops the build when a render uses cookies, caught or not, also from handle", async () => {
    const build = (overrides: Partial<DropletsAppOptions>) =>
      fakeApp({ building: true, ...overrides }).app.request("http://droplets.build/droplets/cart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ props: { page: 1 } }),
      });

    const thrown = await build({});
    expect(thrown.headers.get("x-droplets-prerender-error")).toBe("cookies");
    const { message } = (await thrown.json()) as { message: string };
    expect(message).toContain('cart (entry {"page":1}): cookies.get() is not available while prerendering');
    expect(message).toContain("`building`");

    const caught = await build({
      renderDroplet: async (_name, event) => {
        try {
          event.cookies.get("x");
        } catch {
          // The droplet hides it; the build still sees it.
        }
        return { html: "<p>x</p>" };
      },
    });
    expect(caught.headers.get("x-droplets-prerender-error")).toBe("cookies");

    const fromHandle = await build({
      renderDroplet: async () => ({ html: "<p>x</p>" }),
      getHandle:
        () =>
        ({ event, resolve }) => {
          event.locals["user"] = event.cookies.get("session");
          return resolve(event);
        },
    });
    expect(fromHandle.headers.get("x-droplets-prerender-error")).toBe("cookies");
    expect(((await fromHandle.json()) as { message: string }).message).toContain("cookies.get()");
  });
});
