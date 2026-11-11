import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/core/logger.ts";
import { backTarget, createDropletsApp, redirectTarget, type DropletsAppOptions, type FindAction, type RenderDroplet } from "../../src/runtime/app.ts";
import { mintFormResult, resetFormSecretWarnings } from "../../src/runtime/form-token.server.ts";
import { requestInfo } from "../../src/runtime/request-store.ts";
import {
  error,
  fail,
  hostFrom,
  redirect,
  type Action,
  type ActionEvent,
  type Handle,
  type LoadEvent,
} from "../../src/runtime/server.ts";
import { devHandleError } from "../../src/vite/dev.ts";

const ORIGIN = "http://drops.test";

const decode = (b64: string) => JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as unknown;
/** The inline `{ data, form }` envelope of a fragment. */
const envelope = (html: string): unknown => {
  const match = html.match(/<script type="application\/text" data-droplet-data>([^<]*)<\/script>/);
  return match?.[1] ? decode(match[1]) : undefined;
};

/** The default action of `guestbook`: a name, or a 422. */
const sign: Action = async ({ request }) => {
  const name = (await request.formData()).get("name");
  if (typeof name !== "string" || name === "") return fail(422, { message: "A name, please" });
  return { message: `Thanks, ${name}` };
};

function actionsApp(actions: Record<string, Action> | null, overrides: Partial<DropletsAppOptions> = {}) {
  const renderDroplet = vi.fn<RenderDroplet>(async (name: string, event: LoadEvent, options) => ({
    html: `<p>${name}:${JSON.stringify(event.props)}:${JSON.stringify(options?.form ?? null)}</p>`,
    serverData: { count: 1 },
  }));
  const findAction = vi.fn<FindAction>(async (_droplet, name) => {
    if (!actions) return "none";
    return Object.hasOwn(actions, name) ? actions[name]! : "missing";
  });
  const options: DropletsAppOptions = {
    renderDroplet,
    findAction,
    getDropletMeta: (name) => ({ exists: name !== "missing", ssr: true, hydrate: true }),
    buildHash: "abc123",
    ...overrides,
  };
  return { app: createDropletsApp(options), renderDroplet, findAction };
}

/** A same-origin form submit, as a browser sends it. */
function submit(path: string, body: string | FormData = "", headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      ...(typeof body === "string" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...headers,
    },
    body,
  });
}

describe("form actions: dispatch on the body type", () => {
  it("runs the default action for a form, with no ?/name", async () => {
    const { app, findAction } = actionsApp({ default: sign });
    const res = await app.request(submit("/droplets/guestbook", "name=Ana"));
    expect(res.status).toBe(200);
    expect(findAction).toHaveBeenCalledWith("guestbook", "default");
    const html = await res.text();
    expect(html).toContain('<p>guestbook:{}:{"message":"Thanks, Ana"}</p>');
    expect(envelope(html)).toEqual({ data: { count: 1 }, form: { message: "Thanks, Ana" } });
  });

  it("runs the action ?/name names, from a multipart body too", async () => {
    const leave = vi.fn<Action>(async ({ request }) => ({ left: (await request.formData()).get("why") }));
    const { app } = actionsApp({ default: sign, leave });
    const body = new FormData();
    body.set("why", "done");
    const res = await app.request(submit("/droplets/guestbook?/leave", body));
    expect(res.status).toBe(200);
    expect(envelope(await res.text())).toEqual({ data: { count: 1 }, form: { left: "done" } });
  });

  it("keeps a JSON POST a render, and refuses JSON aimed at an action", async () => {
    const { app, findAction } = actionsApp({ default: sign });
    const json = (path: string) =>
      app.request(`${ORIGIN}${path}`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ props: { page: 2 } }),
      });
    const render = await json("/droplets/guestbook");
    expect(render.status).toBe(200);
    expect(await render.text()).toContain('<p>guestbook:{"page":2}:null</p>');
    expect((await json("/droplets/guestbook?/sign")).status).toBe(400);
    expect(findAction).not.toHaveBeenCalled();
  });

  it("answers 415 for text/plain", async () => {
    const { app, findAction } = actionsApp({ default: sign });
    const res = await app.request(submit("/droplets/guestbook", "name=Ana", { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect(findAction).not.toHaveBeenCalled();
  });

  it("answers 405 for a droplet without actions, and never reads the body", async () => {
    const { app, renderDroplet } = actionsApp(null);
    const request = submit("/droplets/hello", "name=Ana", { "content-length": "8" });
    const res = await app.request(request);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    expect(request.bodyUsed).toBe(false);
    expect(renderDroplet).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown action, before the body is read", async () => {
    const { app } = actionsApp({ default: sign });
    const request = submit("/droplets/guestbook?/nope", "name=Ana", { "content-length": "8" });
    expect((await app.request(request)).status).toBe(404);
    expect(request.bodyUsed).toBe(false);
  });

  it("runs one action per request", async () => {
    const { app } = actionsApp({ default: sign, leave: sign });
    expect((await app.request(submit("/droplets/guestbook?/default&/leave", "name=Ana"))).status).toBe(400);
  });

  it("checks the origin and the body size first", async () => {
    const { app, findAction } = actionsApp({ default: sign });
    const crossSite = await app.request(submit("/droplets/guestbook", "name=Ana", { origin: "https://evil.example" }));
    expect(crossSite.status).toBe(403);
    const big = await app.request(submit("/droplets/guestbook", `name=${"a".repeat(2_000_000)}`));
    expect(big.status).toBe(413);
    expect(findAction).not.toHaveBeenCalled();
  });
});

describe("form actions: the names a request may reach", () => {
  it("404s __proto__, constructor and other names the pattern refuses, end to end", async () => {
    vi.resetModules();
    vi.doMock("virtual:droplets", async (original) => ({
      ...(await original<object>()),
      default: { guestbook: { component: {}, serverLoad: async () => ({ actions: { default: sign } }) } },
    }));
    const { findAction } = await import("../../src/runtime/entry-server.ts");
    const { app } = actionsApp(null, { findAction });
    for (const name of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "", "a.b", "../x"]) {
      const res = await app.request(submit(`/droplets/guestbook?/${encodeURIComponent(name)}`, "name=Ana"));
      expect(res.status, name).toBe(404);
    }
    expect((await app.request(submit("/droplets/guestbook", "name=Ana"))).status).toBe(200);
    vi.doUnmock("virtual:droplets");
  });

  it("answers with the error, not a stack, when actions is not a plain object", async () => {
    const { app } = actionsApp(null, {
      findAction: async () => {
        throw new Error("guestbook: actions in +droplet.server.ts must be a plain object of functions");
      },
    });
    const res = await app.request(submit("/droplets/guestbook", "name=Ana"));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("at ");
  });
});

describe("form actions: results", () => {
  it("re-renders with the fail() data and its status", async () => {
    const { app } = actionsApp({ default: sign });
    const res = await app.request(submit("/droplets/guestbook", "name="));
    expect(res.status).toBe(422);
    expect(envelope(await res.text())).toEqual({ data: { count: 1 }, form: { message: "A name, please" } });
  });

  it("accepts a thrown fail() and a thrown or returned redirect()", async () => {
    const { app } = actionsApp({
      thrown: () => {
        throw fail(409, { taken: true });
      },
      away: () => redirect(303, "/bye"),
      relative: () => {
        redirect(302, "thanks?x=1");
      },
    });
    expect((await app.request(submit("/droplets/guestbook?/thrown"))).status).toBe(409);
    const away = await app.request(submit("/droplets/guestbook?/away"));
    expect(away.status).toBe(303);
    expect(away.headers.get("location")).toBe(`${ORIGIN}/bye`);
    expect(await away.text()).toBe("");
    // Against where the droplet renders: for a plain form, the page's origin.
    const relative = await app.request(submit("/droplets/guestbook?/relative"));
    expect(relative.headers.get("location")).toBe(`${ORIGIN}/thanks?x=1`);
  });

  it("refuses a redirect the validator refuses", async () => {
    const { app } = actionsApp({ bad: () => redirect(303, "javascript:alert(1)") });
    const res = await app.request(submit("/droplets/guestbook?/bad"));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.headers.get("location")).toBeNull();
  });

  it("answers error() as a load's error", async () => {
    const { app } = actionsApp({ default: () => error(403, "Sign in first") });
    const res = await app.request(submit("/droplets/guestbook"));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Sign in first");
  });

  it("throws on a fail() status outside 400-599, as a crash", async () => {
    const { app } = actionsApp({ default: () => fail(200, { ok: true }) });
    const res = await app.request(submit("/droplets/guestbook"));
    expect(res.status).toBe(500);
  });

  it("refuses data that is not plain JSON: the reason in dev, a generic message in production", async () => {
    const actions = {
      date: () => ({ at: new Date(0) }),
      klass: () => fail(400, new (class Thing {})()),
      big: () => ({ n: 10n }),
      nan: () => ({ n: Number.NaN }),
      fn: () => ({ f: () => 1 }),
    };
    const dev = actionsApp(actions, { getHandleError: () => devHandleError(undefined) });
    const prod = actionsApp(actions);
    for (const name of Object.keys(actions)) {
      const inDev = await dev.app.request(submit(`/droplets/guestbook?/${name}`));
      expect(inDev.status, name).toBe(500);
      expect(await inDev.text(), name).toContain("not plain JSON");
      const inProd = await prod.app.request(submit(`/droplets/guestbook?/${name}`, "", { accept: "application/json" }));
      expect(inProd.status, name).toBe(500);
      expect(JSON.stringify(await inProd.json()), name).not.toContain("plain JSON");
    }
  });

  it("answers JSON to a request that accepts it", async () => {
    const { app, renderDroplet } = actionsApp({
      default: sign,
      leave: () => redirect(303, "/bye"),
      quiet: () => {},
    });
    const json = { accept: "application/json" };
    const ok = await app.request(submit("/droplets/guestbook", "name=Ana", json));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ type: "success", status: 200, data: { message: "Thanks, Ana" } });
    const failed = await app.request(submit("/droplets/guestbook", "", json));
    expect(failed.status).toBe(422);
    expect(await failed.json()).toEqual({ type: "failure", status: 422, data: { message: "A name, please" } });
    const left = await app.request(submit("/droplets/guestbook?/leave", "", json));
    expect(left.status).toBe(200);
    expect(await left.json()).toEqual({ type: "redirect", status: 303, location: `${ORIGIN}/bye` });
    expect(await (await app.request(submit("/droplets/guestbook?/quiet", "", json))).json()).toEqual({
      type: "success",
      status: 200,
    });
    // JSON is the action's answer alone: no render, no load.
    expect(renderDroplet).not.toHaveBeenCalled();
  });

  it("gives a void action an undefined form", async () => {
    const { app, renderDroplet } = actionsApp({ default: () => {} });
    const res = await app.request(submit("/droplets/guestbook"));
    expect(res.status).toBe(200);
    expect(renderDroplet.mock.calls[0]?.[2]).toBeUndefined();
    expect(envelope(await res.text())).toEqual({ data: { count: 1 } });
  });
});

describe("form actions: what the action gets", () => {
  it("gets props from the query, never from the form body, and reads the body itself", async () => {
    let seen: ActionEvent | undefined;
    const { app } = actionsApp({
      default: async (event) => {
        seen = event;
        return { fields: Object.fromEntries(await event.request.formData()) as Record<string, unknown> };
      },
    });
    const res = await app.request(submit("/droplets/guestbook?page=2", "page=9&name=Ana"));
    expect(res.status).toBe(200);
    expect(seen?.props).toEqual({ page: "2" });
    expect(seen?.droplet).toBe("guestbook");
    expect(seen?.host.href).toBe(`${ORIGIN}/`);
    expect(Object.keys(seen ?? {}).sort()).toEqual(
      ["cookies", "droplet", "host", "locals", "platform", "props", "request", "setHeaders"].sort(),
    );
  });

  it("takes props from x-droplet-props too, and never ?/name", async () => {
    let props: unknown;
    const { app } = actionsApp({
      add: (event) => {
        props = event.props;
      },
    });
    await app.request(
      submit("/droplets/guestbook?/add", "", {
        "x-droplet-props": Buffer.from(JSON.stringify({ page: 3 })).toString("base64"),
      }),
    );
    expect(props).toEqual({ page: 3 });
  });

  it("lets __proto__ form fields and query keys pollute nothing", async () => {
    let fields: Record<string, unknown> = {};
    let props: Record<string, unknown> = {};
    const { app } = actionsApp({
      default: async (event) => {
        props = event.props;
        fields = Object.fromEntries(await event.request.formData());
        return { ok: true };
      },
    });
    const res = await app.request(
      submit(
        "/droplets/guestbook?__proto__[polluted]=1&constructor[prototype][polluted]=1",
        "__proto__[polluted]=1&constructor[prototype][polluted]=1&__proto__=x",
      ),
    );
    expect(res.status).toBe(200);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf(props)).toBe(Object.prototype);
    expect((props as { polluted?: unknown }).polluted).toBeUndefined();
    expect(Object.hasOwn(fields, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype);
  });

  it("sets cookies and headers, on the re-render, the JSON and the redirect", async () => {
    const remember: Action = ({ cookies, setHeaders }) => {
      cookies.set("signed", "1", { path: "/" });
      setHeaders({ "x-signed": "yes" });
      return { ok: true };
    };
    const { app } = actionsApp({
      default: remember,
      away: (event) => {
        remember(event);
        redirect(303, "/bye");
      },
    });
    for (const [path, headers, status] of [
      ["/droplets/guestbook", {}, 200],
      ["/droplets/guestbook", { accept: "application/json" }, 200],
      ["/droplets/guestbook?/away", {}, 303],
    ] as const) {
      const res = await app.request(submit(path, "", headers));
      expect(res.status, path).toBe(status);
      expect(res.headers.get("set-cookie"), path).toContain("signed=1");
      expect(res.headers.get("x-signed"), path).toBe("yes");
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
    }
  });

  it("shares setHeaders with the load that follows: a header set twice throws", async () => {
    const { app } = actionsApp(
      { default: ({ setHeaders }) => void setHeaders({ "cache-control": "no-cache" }) },
      {
        renderDroplet: async (_name, event) => {
          event.setHeaders({ "cache-control": "public, max-age=60" });
          return { html: "<p>x</p>", serverData: {} };
        },
      },
    );
    const res = await app.request(submit("/droplets/guestbook"));
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).not.toBe("public, max-age=60");
  });
});

describe("form actions: a prerendered droplet", () => {
  it("answers an action with a live render and form, never the stored render", async () => {
    const loadPrerendered = vi.fn(async () => ({ html: "<p>stored</p>", data: { stored: true } }));
    const { app, renderDroplet } = actionsApp(
      { default: sign },
      { getDropletMeta: () => ({ exists: true, ssr: true, hydrate: true, prerender: true }), loadPrerendered },
    );
    expect(await (await app.request(`${ORIGIN}/droplets/guestbook`)).text()).toContain("<p>stored</p>");
    const res = await app.request(submit("/droplets/guestbook", "name=Ana"));
    const html = await res.text();
    expect(html).not.toContain("<p>stored</p>");
    expect(html).toContain('{"message":"Thanks, Ana"}');
    expect(renderDroplet).toHaveBeenCalledTimes(1);
    expect(loadPrerendered).toHaveBeenCalledTimes(1);
  });
});

describe("form actions: the request decides the answer", () => {
  it("gets the fragment rendered with form for a native form navigation without DROPLETS_SECRET", async () => {
    // With it: Post/Redirect/Get, below.
    const { app } = actionsApp({ default: sign });
    const res = await app.request(submit("/droplets/guestbook", "name=Ana", { accept: "text/html,*/*;q=0.8" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<p>guestbook:{}:{"message":"Thanks, Ana"}</p>');
  });

  it("has no noJS: the key is a prop like any other, and the URL reaches the action as it came", async () => {
    const seen: unknown[] = [];
    const { app } = actionsApp({
      add: async ({ request, props }) => {
        seen.push(request.url, props);
        return { ok: true };
      },
    });
    const res = await app.request(submit("/droplets/guestbook?/add&page=2&noJS", "", { accept: "application/json" }));
    expect(await res.json()).toEqual({ type: "success", status: 200, data: { ok: true } });
    expect(seen).toEqual([`${ORIGIN}/droplets/guestbook?/add&page=2&noJS`, { page: "2", noJS: "" }]);
  });
});

describe("form actions: a JSON render with form", () => {
  const render = (app: ReturnType<typeof actionsApp>["app"], body: unknown) =>
    app.request(`${ORIGIN}/droplets/guestbook`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("renders live with the form the page sends back, for a droplet with actions", async () => {
    const loadPrerendered = vi.fn(async () => ({ html: "<p>stored</p>", data: { stored: true } }));
    const { app, renderDroplet } = actionsApp(
      { default: sign },
      { getDropletMeta: () => ({ exists: true, ssr: true, hydrate: true, prerender: true }), loadPrerendered },
    );
    const res = await render(app, { host: "https://shop.test/p", props: { page: 2 }, form: { message: "Thanks, Ana" } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<p>guestbook:{"page":2}:{"message":"Thanks, Ana"}</p>');
    expect(envelope(html)).toEqual({ data: { count: 1 }, form: { message: "Thanks, Ana" } });
    // Never a stored render.
    expect(loadPrerendered).not.toHaveBeenCalled();
    expect(renderDroplet).toHaveBeenCalledTimes(1);
  });

  it("ignores form for a droplet without actions, and pollutes nothing", async () => {
    const { app } = actionsApp(null);
    const res = await render(app, { props: {}, form: { message: "forged" } });
    expect(await res.text()).toContain("<p>guestbook:{}:null</p>");
    const polluted = await render(actionsApp({ default: sign }).app, JSON.parse('{"form":{"__proto__":{"polluted":1}}}'));
    expect(polluted.status).toBe(200);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("form actions: Post/Redirect/Get without JavaScript", () => {
  const SECRET = "test-secret-0123456789abcdef-0123456789";
  const KEY = "__droplet_form_guestbook_abc123";
  const PAGE = "http://drops.test/book?a=1&b=x%20y";
  const native = { accept: "text/html,*/*;q=0.8", referer: PAGE };

  beforeEach(() => {
    vi.stubEnv("DROPLETS_SECRET", SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetFormSecretWarnings();
  });

  /** The result's value in a redirect's location. */
  const tokenOf = (location: string | null) => new URL(location ?? "http://x").searchParams.get(KEY);

  /** The page again, as a host renders it: `host` is the URL the redirect went to. */
  const renderOn = (app: ReturnType<typeof actionsApp>["app"], host: string, path = "/droplets/guestbook") =>
    app.request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ host, props: {} }),
    });

  const SCOPE = { droplet: "guestbook", build: "abc123", page: "http://drops.test/book" };
  const mint = async (result: { action: string; status: number; data?: unknown }, scope = SCOPE, now?: number) =>
    (await mintFormResult(SECRET, scope, result, now)).value;

  it("answers success and fail() with a 303 back to the page, the result signed in its query", async () => {
    const { app, renderDroplet } = actionsApp({ default: sign });
    const ok = await app.request(submit("/droplets/guestbook", "name=Ana", native));
    expect(ok.status).toBe(303);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    const location = ok.headers.get("location")!;
    // The page's own query as it was written, then the result.
    expect(location).toMatch(/^http:\/\/drops\.test\/book\?a=1&b=x%20y&__droplet_form_guestbook_abc123=[\w-]+\.[\w-]{43}$/);
    // Nothing rendered: the page's GET does.
    expect(renderDroplet).not.toHaveBeenCalled();

    const failed = await app.request(submit("/droplets/guestbook", "name=", native));
    expect(failed.status).toBe(303);
    const back = failed.headers.get("location")!;
    const page = await renderOn(app, back);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    const html = await page.text();
    expect(html).toContain('<p>guestbook:{}:{"message":"A name, please"}</p>');
    expect(envelope(html)).toEqual({ data: { count: 1 }, form: { message: "A name, please" } });
  });

  it("replaces older results in the page's URL, and drops its hash", async () => {
    const { app } = actionsApp({ default: sign });
    const res = await app.request(submit("/droplets/guestbook", "name=Ana", {
      ...native,
      referer: `http://drops.test/book?${KEY}=old&__droplet_form_cart_abc123=other&q=1#top`,
    }));
    const location = res.headers.get("location")!;
    expect(location).toMatch(/^http:\/\/drops\.test\/book\?q=1&__droplet_form_guestbook_abc123=[\w-]+\.[\w-]{43}$/);
  });

  it("answers redirect() with a 303 to its target, on this server or a trusted origin only", async () => {
    const actions = {
      leave: () => redirect(303, "/bye"),
      shop: () => redirect(302, "https://shop.test/thanks#done"),
      away: () => redirect(303, "https://evil.example/x"),
      lookalike: () => redirect(303, "http://drops.test.evil.example/x"),
    };
    const { app } = actionsApp(actions, { trustedOrigins: ["https://shop.test"] });
    const left = await app.request(submit("/droplets/guestbook?/leave", "", native));
    expect(left.status).toBe(303);
    expect(left.headers.get("location")).toBe(`${ORIGIN}/bye`);
    const shop = await app.request(submit("/droplets/guestbook?/shop", "", native));
    expect(shop.status).toBe(303);
    expect(shop.headers.get("location")).toBe("https://shop.test/thanks#done");
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect((await app.request(submit("/droplets/guestbook?/away", "", native))).status).toBe(400);
    expect((await app.request(submit("/droplets/guestbook?/lookalike", "", native))).status).toBe(400);

    // "*" trusts every Origin for the CSRF check, never a redirect target.
    const star = actionsApp(actions, { trustedOrigins: ["*"] }).app;
    expect((await star.request(submit("/droplets/guestbook?/away", "", native))).status).toBe(400);
    expect((await star.request(submit("/droplets/guestbook?/leave", "", native))).status).toBe(303);
  });

  it("goes back only to a Referer on this server or a trusted origin, and runs nothing otherwise", async () => {
    const ran = vi.fn<Action>(() => ({ ok: true }));
    const { app } = actionsApp({ default: ran }, { trustedOrigins: ["https://shop.test"] });
    const refused = async (referer: string | undefined) => {
      const headers: Record<string, string> = { accept: "text/html" };
      if (referer !== undefined) headers["referer"] = referer;
      const res = await app.request(submit("/droplets/guestbook", "", headers));
      expect(res.status, referer).toBe(400);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.text()).toContain("Referer");
    };
    await refused(undefined);
    await refused("https://evil.example/page");
    // A look-alike: the exact origin counts, never a prefix.
    await refused("http://drops.test.evil.example/page");
    await refused("http://drops.test:8080/page");
    await refused("javascript:alert(1)");
    await refused("http://user:pw@drops.test/page");
    await refused("/relative");
    expect(ran).not.toHaveBeenCalled();

    // A listed origin is a page to go back to.
    const trusted = await app.request(submit("/droplets/guestbook", "", { origin: "https://shop.test", accept: "text/html", referer: "https://shop.test/p/1" }));
    expect(trusted.status).toBe(303);
    expect(trusted.headers.get("location")).toMatch(/^https:\/\/shop\.test\/p\/1\?__droplet_form_guestbook_abc123=/);

    // "*" trusts every Origin for the CSRF check, never a page to go back to.
    const star = actionsApp({ default: ran }, { trustedOrigins: ["*"] }).app;
    const res = await star.request(submit("/droplets/guestbook", "", { origin: "https://evil.example", accept: "text/html", referer: "https://evil.example/p" }));
    expect(res.status).toBe(400);
  });

  it("checks a redirect target by exact origin, web URLs only", () => {
    const allowed = new Set([ORIGIN, "https://shop.test"]);
    expect(redirectTarget(`${ORIGIN}/x?y=1#z`, allowed)?.href).toBe(`${ORIGIN}/x?y=1#z`);
    expect(redirectTarget("https://shop.test/", allowed)?.href).toBe("https://shop.test/");
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "https://shop.test.evil.example/",
      "https://evil.example/https://shop.test",
      "http://shop.test/",
      "https://user@shop.test/",
      "//shop.test/x",
      "/x",
      "",
      undefined,
    ]) {
      expect(redirectTarget(bad, allowed), String(bad)).toBeNull();
    }
    expect(redirectTarget("https://evil.example/", new Set(["*"]))).toBeNull();
  });

  it("keeps the JSON answer of an enhanced form as it was", async () => {
    const { app } = actionsApp({ default: sign });
    const res = await app.request(submit("/droplets/guestbook", "name=", { accept: "application/json", referer: PAGE }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ type: "failure", status: 422, data: { message: "A name, please" } });
  });

  it("falls back to the fragment without a usable DROPLETS_SECRET, with one warning naming it", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.stubEnv("DROPLETS_SECRET", "too-short");
    const { app } = actionsApp({ default: sign });
    for (let i = 0; i < 2; i += 1) {
      const res = await app.request(submit("/droplets/guestbook", "name=Ana", native));
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('{"message":"Thanks, Ana"}');
    }
    vi.stubEnv("DROPLETS_SECRET", "");
    expect((await app.request(submit("/droplets/guestbook", "name=Ana", native))).status).toBe(200);
    const messages = warn.mock.calls.map((call) => String(call[1]));
    expect(messages.filter((m) => m.includes("DROPLETS_SECRET"))).toHaveLength(2);
    // A result is never read without it either.
    const token = await mint({ action: "default", status: 200, data: { message: "Thanks, Ana" } });
    expect(await (await renderOn(app, `${PAGE}&${KEY}=${token}`)).text()).toContain("<p>guestbook:{}:null</p>");
  });

  it("renders with the result live, never the stored render, and hides it from the app's code", async () => {
    const loadPrerendered = vi.fn(async () => ({ html: "<p>stored</p>", data: { stored: true } }));
    const seen: string[] = [];
    const handle: Handle = ({ event, resolve }) => {
      seen.push(`handle ${event.host.href}`);
      return resolve(event);
    };
    const { app, renderDroplet } = actionsApp(
      { default: sign },
      {
        getDropletMeta: () => ({ exists: true, ssr: true, hydrate: true, prerender: true }),
        loadPrerendered,
        getHandle: () => handle,
        loadDropletData: (_name, event) => {
          seen.push(`load ${event.host.href}`);
          return { data: { count: 2 } };
        },
      },
    );
    const back = (await app.request(submit("/droplets/guestbook", "name=Ana", native))).headers.get("location")!;
    const html = await (await renderOn(app, back)).text();
    expect(html).toContain('{"message":"Thanks, Ana"}');
    expect(loadPrerendered).not.toHaveBeenCalled();
    const event = renderDroplet.mock.calls.at(-1)![1];
    expect(event.host.href).toBe(PAGE);

    // `_data`, as the browser asks for a client-only droplet: the result with the data.
    const data = await renderOn(app, back, "/droplets/guestbook/_data");
    expect(data.headers.get("cache-control")).toBe("private, no-store");
    expect(await data.json()).toEqual({ data: { count: 2 }, form: { message: "Thanks, Ana" } });
    // The post (host from Origin), the page, `_data`: never the result in host.
    expect(seen).toEqual([`handle ${ORIGIN}/`, `handle ${PAGE}`, `handle ${PAGE}`, `load ${PAGE}`]);

    // Without a result, the stored render.
    expect(await (await renderOn(app, PAGE)).text()).toContain("<p>stored</p>");
  });

  it("reads a result handle puts in host from Referer, and hides it there too", async () => {
    const seen: string[] = [];
    const handle: Handle = ({ event, resolve }) => {
      event.host = hostFrom(event.request.headers.get("referer")) ?? event.host;
      return resolve(event);
    };
    const { app } = actionsApp({ default: sign }, {
      getHandle: () => handle,
      renderDroplet: async (_name, event, options) => {
        seen.push(event.host.href);
        return { html: `<p>${JSON.stringify(options?.form ?? null)}</p>`, serverData: {} };
      },
    });
    const back = (await app.request(submit("/droplets/guestbook", "name=Ana", native))).headers.get("location")!;
    const res = await app.request(`${ORIGIN}/droplets/guestbook`, { headers: { referer: back } });
    expect(await res.text()).toContain('<p>{"message":"Thanks, Ana"}</p>');
    expect(seen).toEqual([PAGE]);
  });

  it("ignores a result that is not genuine, current and this droplet's, and renders as without one", async () => {
    const loadPrerendered = vi.fn(async () => ({ html: "<p>stored</p>", data: { stored: true } }));
    const { app } = actionsApp(
      { default: sign, leave: sign },
      { getDropletMeta: () => ({ exists: true, ssr: true, hydrate: true, prerender: true }), loadPrerendered },
    );
    const good = await mint({ action: "default", status: 200, data: { message: "Thanks, Ana" } });
    expect(await (await renderOn(app, `${PAGE}&${KEY}=${good}`)).text()).toContain('{"message":"Thanks, Ana"}');

    const [payload, mac] = good.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ status: 200, data: { message: "Call 555" }, exp: Date.now() + 60_000, action: "default" })).toString("base64url");
    const cases: Record<string, string> = {
      "tampered payload": `${forged}.${mac}`,
      "tampered MAC": `${payload}.${mac.slice(0, -2)}AA`,
      "another droplet": await mint({ action: "default", status: 200, data: { message: "x" } }, { ...SCOPE, droplet: "cart" }),
      "another build": await mint({ action: "default", status: 200, data: { message: "x" } }, { ...SCOPE, build: "old999" }),
      "another page": await mint({ action: "default", status: 200, data: { message: "x" } }, { ...SCOPE, page: "http://drops.test/other" }),
      "an action it does not export": await mint({ action: "nope", status: 200, data: { message: "x" } }),
      expired: await mint({ action: "default", status: 200, data: { message: "x" } }, undefined, Date.now() - 5 * 60 * 1000 - 1),
      oversize: `${payload}${"A".repeat(2048)}.${mac}`,
    };
    for (const [name, value] of Object.entries(cases)) {
      const html = await (await renderOn(app, `${PAGE}&${KEY}=${encodeURIComponent(value)}`)).text();
      expect(html, name).toContain("<p>stored</p>");
    }
    // Under another droplet's key: not this droplet's.
    expect(await (await renderOn(app, `${PAGE}&__droplet_form_cart_abc123=${good}`)).text()).toContain("<p>stored</p>");
  });

  it("takes __proto__ in a result as data, never as a prototype", async () => {
    const { app, renderDroplet } = actionsApp({ default: sign });
    const data = JSON.parse('{"message":"hi","__proto__":{"polluted":1}}') as unknown;
    const token = await mint({ action: "default", status: 422, data });
    const res = await renderOn(app, `${PAGE}&${KEY}=${token}`);
    expect(await res.text()).toContain('{"message":"hi"}');
    const form = renderDroplet.mock.calls.at(-1)![2]!.form as Record<string, unknown>;
    expect(Object.getPrototypeOf(form)).toBeNull();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("sends a result over 2 KB without its data, with a warning", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { app, renderDroplet } = actionsApp({ default: () => fail(409, { message: "x".repeat(3000) }) });
    const res = await app.request(submit("/droplets/guestbook", "", native));
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(tokenOf(location)!.length).toBeLessThanOrEqual(2048);
    expect(warn.mock.calls.some((call) => String(call[1]).includes("over 2 KB"))).toBe(true);
    // Status and action only: the droplet renders, without form.
    await renderOn(app, location);
    expect(renderDroplet).toHaveBeenCalledTimes(1);
    expect(renderDroplet.mock.calls[0]![2]).toBeUndefined();
  });

  it("sets the action's cookies and headers on the redirect", async () => {
    const { app } = actionsApp({
      default: ({ cookies, setHeaders }) => {
        cookies.set("signed", "1", { path: "/" });
        setHeaders({ "x-done": "yes" });
        return { ok: true };
      },
    });
    const res = await app.request(submit("/droplets/guestbook", "", native));
    expect(res.status).toBe(303);
    expect(res.headers.getSetCookie()[0]).toMatch(/^signed=1;/);
    expect(res.headers.get("x-done")).toBe("yes");
  });

  describe("the page it goes back to: __droplet_return", () => {
    const SHOP = "https://shop.test/p/caf%C3%A9";
    /** The action URL a page on `page` posts to. */
    const on = (page: string, path = "/droplets/guestbook") =>
      `${path}${path.includes("?") ? "&" : "?"}__droplet_return=${encodeURIComponent(page)}`;
    /** A native post from a page on `https://shop.test`, its Referer the origin alone. */
    const crossOrigin = (referer: string | null = "https://shop.test/") => {
      const headers: Record<string, string> = { origin: "https://shop.test", accept: "text/html" };
      if (referer !== null) headers["referer"] = referer;
      return headers;
    };
    const shopApp = (actions: Record<string, Action> = { default: sign }, overrides: Partial<DropletsAppOptions> = {}) =>
      actionsApp(actions, { trustedOrigins: ["https://shop.test"], ...overrides });

    it("lands a cross-origin page whose Referer is its origin alone back on its path", async () => {
      const { app } = shopApp();
      const res = await app.request(submit(on(SHOP), "name=Ana", crossOrigin()));
      expect(res.status).toBe(303);
      const location = res.headers.get("location")!;
      expect(location).toMatch(/^https:\/\/shop\.test\/p\/caf%C3%A9\?__droplet_form_guestbook_abc123=[\w-]+\.[\w-]{43}$/);
      // The page renders it there, and only there.
      const html = await (await renderOn(app, location)).text();
      expect(html).toContain('{"message":"Thanks, Ana"}');
      // No Referer at all (`no-referrer` sends `Origin: null`, refused before this): the return URL alone.
      const noReferer = await app.request(submit(on(SHOP), "name=Ana", crossOrigin(null)));
      expect(noReferer.headers.get("location")).toMatch(/^https:\/\/shop\.test\/p\/caf%C3%A9\?__droplet_form_/);
    });

    it("prefers the Referer when it is the same page, for its query; else the return URL", async () => {
      const { app } = shopApp();
      const same = await app.request(submit(on(SHOP), "name=Ana", crossOrigin(`${SHOP}?sort=new&/add&__droplet_return=x#c`)));
      expect(same.headers.get("location")).toMatch(/^https:\/\/shop\.test\/p\/caf%C3%A9\?sort=new&__droplet_form_guestbook_abc123=/);
      // Another page of the same origin in the Referer: the return URL names the form's page.
      const other = await app.request(submit(on(SHOP), "name=Ana", crossOrigin("https://shop.test/elsewhere?x=1")));
      expect(other.headers.get("location")).toMatch(/^https:\/\/shop\.test\/p\/caf%C3%A9\?__droplet_form_/);
      // The return URL's own query or hash is never part of it.
      const queried = await app.request(submit(on("https://shop.test/p?/add&__droplet_form_guestbook_abc123=forged#x"), "name=Ana", crossOrigin()));
      expect(queried.headers.get("location")).toMatch(/^https:\/\/shop\.test\/p\?__droplet_form_guestbook_abc123=[\w-]+\.[\w-]{43}$/);
    });

    it("falls back to a Referer valid on its own when the return URL is not, and answers 400 when neither is", async () => {
      const ran = vi.fn<Action>(() => ({ ok: true }));
      const { app } = shopApp({ default: ran });
      const bad = [
        "https://evil.example/p",
        // A look-alike: the exact origin counts, never a prefix.
        "https://shop.test.evil.example/p",
        "https://shop.testevil.example/p",
        "http://shop.test/p",
        "javascript:alert(1)//https://shop.test/p",
        "data:text/html,<script>alert(1)</script>",
        "https://user:pw@shop.test/p",
        "//shop.test/p",
        "/p",
        // A page of the droplets server itself: a fragment or an action URL.
        "http://drops.test/droplets/guestbook",
        "http://drops.test/droplets/guestbook?/leave",
        "http://drops.test/droplets/x/../guestbook",
        "http://drops.test/droplets",
        `https://shop.test/p/${"a".repeat(2100)}`,
      ];
      for (const value of bad) {
        // With a Referer that is a page by itself: that page.
        const fallback = await app.request(submit(on(value), "", crossOrigin("https://shop.test/q")));
        expect(fallback.status, value).toBe(303);
        expect(fallback.headers.get("location"), value).toMatch(/^https:\/\/shop\.test\/q\?__droplet_form_/);
        // With none: 400, and the action never ran.
        const refused = await app.request(submit(on(value), "", crossOrigin(null)));
        expect(refused.status, value).toBe(400);
        expect(refused.headers.get("location"), value).toBeNull();
      }
      // Twice is no page at all.
      const twice = `/droplets/guestbook?__droplet_return=${encodeURIComponent(SHOP)}&__droplet_return=${encodeURIComponent(SHOP)}`;
      expect((await app.request(submit(twice, "", crossOrigin(null)))).status).toBe(400);
      // "*" trusts every Origin for the CSRF check, never a page to go back to.
      const star = actionsApp({ default: ran }, { trustedOrigins: ["*"] }).app;
      const starred = await star.request(submit(on("https://evil.example/p"), "", { origin: "https://evil.example", accept: "text/html" }));
      expect(starred.status).toBe(400);
      expect(ran).toHaveBeenCalledTimes(bad.length);
    });

    it("never goes back to an action URL or a fragment of this server, from a Referer either", async () => {
      const ran = vi.fn<Action>(() => ({ ok: true }));
      const { app } = actionsApp({ default: ran });
      for (const referer of [`${ORIGIN}/droplets/guestbook?/default`, `${ORIGIN}/droplets/guestbook`, `${ORIGIN}/droplets/guestbook/_data`]) {
        const request = submit("/droplets/guestbook", "name=Ana", { accept: "text/html", referer, "content-length": "8" });
        const res = await app.request(request);
        expect(res.status, referer).toBe(400);
        // Answered before the body is read.
        expect(request.bodyUsed, referer).toBe(false);
      }
      // Under the prefix a trusted x-droplet-location serves this server at, too.
      const proxied = await app.request(
        submit("/droplets/guestbook", "", { accept: "text/html", "x-droplet-location": `${ORIGIN}/mfe`, referer: `${ORIGIN}/mfe/droplets/guestbook?/default` }),
      );
      expect(proxied.status).toBe(400);
      expect(ran).not.toHaveBeenCalled();
      // A page of the same origin that is not one of them is a page.
      const page = await app.request(submit("/droplets/guestbook", "", { accept: "text/html", referer: `${ORIGIN}/dropletsfan?/default` }));
      expect(page.headers.get("location")).toMatch(/^http:\/\/drops\.test\/dropletsfan\?__droplet_form_/);
    });

    it("checks a page to go back to as a redirect target, never one of the droplets server's", () => {
      const allowed = new Set([ORIGIN, "https://shop.test"]);
      const servers = [ORIGIN, "https://shop.test/mfe"];
      expect(backTarget("https://shop.test/p?x=1", allowed, servers)?.href).toBe("https://shop.test/p?x=1");
      expect(backTarget("https://shop.test/droplets/x", allowed, servers)?.href).toBe("https://shop.test/droplets/x");
      for (const bad of [`${ORIGIN}/droplets/x`, `${ORIGIN}/droplets`, "https://shop.test/mfe/droplets/x?/add", "https://evil.example/", "javascript:alert(1)"]) {
        expect(backTarget(bad, allowed, servers), bad).toBeNull();
      }
    });

    it("refuses a result minted for page A on page B of a trusted origin", async () => {
      const { app } = shopApp();
      const res = await app.request(submit(on("https://shop.test/a"), "name=Ana", crossOrigin()));
      const token = tokenOf(res.headers.get("location"))!;
      expect(await (await renderOn(app, `https://shop.test/a?${KEY}=${token}`)).text()).toContain('{"message":"Thanks, Ana"}');
      for (const page of ["https://shop.test/b", "https://shop.test/a/", `${ORIGIN}/a`]) {
        const html = await (await renderOn(app, `${page}?${KEY}=${token}`)).text();
        expect(html, page).toContain("<p>guestbook:{}:null</p>");
      }
    });

    it("keeps __droplet_return out of the props, event.host and the render's page", async () => {
      const seen: { props: unknown; host: string; page: string | undefined }[] = [];
      const handle: Handle = ({ event, resolve }) => {
        // A host from Referer that carries the key: it comes out.
        event.host = hostFrom(event.request.headers.get("referer")) ?? event.host;
        return resolve(event);
      };
      const { app } = actionsApp(
        {
          default: (event) => {
            seen.push({ props: event.props, host: event.host.href, page: requestInfo()?.page });
            return { ok: true };
          },
        },
        {
          getHandle: () => handle,
          renderDroplet: async (_name, event) => {
            seen.push({ props: event.props, host: event.host.href, page: requestInfo()?.page });
            return { html: "<p></p>", serverData: {} };
          },
        },
      );
      const referer = `${ORIGIN}/book?__droplet_return=${encodeURIComponent("https://evil.example/")}&q=1`;
      await app.request(submit(on(`${ORIGIN}/book`, "/droplets/guestbook?page=2"), "", { accept: "text/html", referer }));
      await app.request(`${ORIGIN}/droplets/guestbook?__droplet_return=x&page=3`, { headers: { referer } });
      expect(seen).toEqual([
        { props: { page: "2" }, host: `${ORIGIN}/book?q=1`, page: `${ORIGIN}/book` },
        { props: { page: "3" }, host: `${ORIGIN}/book?q=1`, page: `${ORIGIN}/book` },
      ]);
    });

    it("gives the render the page of event.host, which its action URLs name", async () => {
      const pages: (string | undefined)[] = [];
      const { app } = actionsApp({ default: sign }, {
        renderDroplet: async () => {
          pages.push(requestInfo()?.page);
          return { html: "<p></p>", serverData: {} };
        },
      });
      await renderOn(app, "http://drops.test/p/caf%C3%A9?x=1#h");
      await app.request(`${ORIGIN}/droplets/guestbook`);
      expect(pages).toEqual(["http://drops.test/p/caf%C3%A9", `${ORIGIN}/`]);
    });
  });
});
