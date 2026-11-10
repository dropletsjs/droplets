/**
 * The renderer conformance kit: one vitest suite that builds a small fixture
 * app with a renderer and checks every scenario of the contract, over HTTP
 * through the built SSR bundle and in the DOM (happy-dom) through the built
 * browser bundles and core's real custom element.
 *
 * ## Usage
 *
 * ```ts
 * // test/conformance.test.ts, in the renderer package
 * // @vitest-environment happy-dom
 * import { fileURLToPath } from "node:url";
 * import { rendererConformance } from "@dropletsjs/droplets/testing";
 * import { svelte } from "../src/index.ts";
 *
 * rendererConformance({
 *   renderer: svelte(),
 *   root: fileURLToPath(new URL("./fixtures/app/", import.meta.url)),
 * });
 * ```
 *
 * The suite checks the children contract as well: the host's `<div data-droplet-slot>`
 * container shows inside the component's `[data-droplet-children]` marker before
 * the bundle loads, is the same node after hydration, and stays hidden under
 * the element when the server HTML has no marker.
 *
 * The vitest config needs happy-dom (`environment: "happy-dom"` or the
 * pragma above) with stylesheet loading tolerated:
 * `environmentOptions: { happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } } }`.
 * The renderer package must be built first when its factory points at
 * `dist/` modules (as the first-party ones do).
 *
 * ## The fixture
 *
 * A droplets project at `root`, with `<ext>` the renderer's extension:
 *
 * ```
 * droplets.config.ts            export default { element: "test-droplet" }
 *                               (plus `cssPath: "./src/app.css"` when src/app.css exists)
 * src/hooks.client.ts           export function init(): pushes "defined" or "not defined"
 *                                 (customElements.get("test-droplet")) to globalThis.conformanceInit
 * src/droplets/hello/
 *   +droplet.<ext>              ssr and hydrate (the defaults). Renders:
 *                                 <h1 data-testid="greeting">{data.greeting}</h1>
 *                                 <button data-testid="count">{clicks}</button>  — starts at 0,
 *                                   +1 per click (only with `interactive`, the default)
 *                                 <div data-testid="children">{children}</div>
 *   +droplet.server.ts          load({ props }): who = props.who ?? "world";
 *                                 "nobody" → error(404, "Nobody is here");
 *                                 "crash" → throw; returns { who }
 *                               handleError → { error: { message: "Sorry, ref 42" } }
 *   +droplet.ts                 load({ data }) → { ...data, greeting: `Hello ${data.who}!` }
 *                               handleError({ error }) → { error: { message: `[hello] ${error.message}` } }
 *   +error.<ext>                Renders:
 *                                 <p data-testid="error">{error.message}</p>
 *                                 <div data-testid="error-children">{children}</div>
 * src/droplets/frame/
 *   +droplet.<ext>              ssr = false. Renders <div data-testid="frame">{children}</div>
 * src/droplets/docs/
 *   +droplet.<ext>              prerender = true. Renders
 *                                 <article data-testid="docs"><h1>Page {data.page}</h1><p>@HOST@</p></article>
 *   +droplet.ts                 export const props = { page: (v) => number or throw }  — a schema
 *                               that turns "2" into 2 and refuses "x"
 *   +droplet.server.ts          entries() → [{ props: { page: "1" } }, { props: { page: 2 } }, { props: { page: 1 } },
 *                                 { props: { page: 99 } }, { props: { page: 404 } },
 *                                 { props: { page: 5 }, host: "https://fixed.test/docs" }]
 *                               load({ props, host, setHeaders }): 404 → error(404, "No such page"); 99 → throw;
 *                                 2 → setHeaders({ "cache-control": "public, max-age=60" });
 *                                 else { page: props.page, building, home: `${host.origin}/home` }
 *                                 (building from $droplets/env), plus `ref: host.searchParams.get("ref")`
 *                                 for page 7 when it is set
 *                               handleError → { error: { message: "This page is unavailable" } }
 *                               transform({ html, host }) → html.replace("@HOST@", host.host)
 *   +error.<ext>                no flags of its own (it follows the droplet's). Renders
 *                                 <p data-testid="docs-error">{error.message}</p>
 * src/droplets/guestbook/
 *   +droplet.<ext>              prerender = true; ssr and hydrate (`hydrate = false` with
 *                               `enhance: "attribute"`). With `actionUrl` of `$droplets/form`
 *                               (`{{action}}` / `{{action "leave"}}` in a template), renders
 *                                 <form method="post" action={actionUrl()} data-testid="sign"><input name="name">
 *                                   <p data-testid="form">{form?.message ?? "none"}</p></form>
 *                                 <form method="post" action={actionUrl("leave")} data-testid="leave"></form>
 *                                 <form method="post" action={actionUrl("echo")} data-testid="plain"></form>
 *                               with `sign` and `leave` enhanced by the renderer's wrapper of
 *                               `enhanceDropletForm` (`data-droplets-enhance` with
 *                               `enhance: "attribute"`); `plain` never is
 *   +droplet.server.ts          load() → { count: 1 }
 *                               actions = {
 *                                 default: name from the form data, or fail(422, { message: "A name, please" });
 *                                   returns { message: `Thanks, ${name}` }
 *                                 leave: redirect(303, "/bye")
 *                                 echo: ({ request }) => ({ message: new URL(request.url).search })
 *                               } satisfies Actions
 * src/droplets/static-note/     (the folder may be `StaticNote`: the id is kebab-cased)
 *   +droplet.<ext>              hydrate = false. Renders <p class="note">Rendered on the server only.</p>
 *                               with a style giving `.note` `font-style: italic` (only with `css`,
 *                               the default: the renderer's CSS must reach the client build)
 * ```
 *
 * `packages/droplets/test/fixtures/app` (fake renderer) and
 * `packages/renderers/svelte/test/fixtures/app` are two complete fixtures.
 *
 * @module
 */
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createBuilder } from "vite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DropletsAdapter } from "../adapters.ts";
import { packageDist } from "../core/paths.ts";
import type { DropletRenderer } from "../renderer.ts";
import { createApp } from "../runtime/app.ts";
import { createServerApp, type SsrModule } from "../server/app.ts";
import type { DropletsManifest } from "../server/manifest.ts";
import { createPrerenderedLoader, PRERENDER_DIR } from "../server/prerendered.ts";
import { resolveConfig } from "../core/config.ts";
import { droplets } from "../vite/plugin.ts";

export type ConformanceOptions = {
  /** The renderer under test. */
  renderer: DropletRenderer;
  /** Absolute path of the fixture app (layout above). */
  root: string;
  /** The custom element name the fixture config sets. Default `test-droplet`. */
  element?: string;
  /**
   * Whether `hello`'s count button increments after hydration. `false` for
   * engines without client behaviour (templates). Default `true`.
   */
  interactive?: boolean;
  /** Whether `static-note` carries styles the client build extracts. Default `true`. */
  css?: boolean;
  /**
   * Whether hydration adopts the server's DOM nodes. `false` for engines
   * that render again in place of the server markup (`hono/jsx/dom`): the
   * checks then compare what shows instead of node identity. Default `true`.
   */
  adopts?: boolean;
  /**
   * How the guestbook's forms opt in to progressive enhancement: the
   * renderer's wrapper of `enhanceDropletForm` (`"wrapper"`, the default),
   * or the `data-droplets-enhance` attribute `/index.js` binds
   * (`"attribute"`, for templates; the guestbook then has
   * `hydrate = false`, and its fragment is replaced after an action).
   */
  enhance?: "wrapper" | "attribute";
  /** Where the build goes. Default `<root>/dist-conformance`. */
  outDir?: string;
};

type App = ReturnType<typeof createServerApp>;

const decode = (b64: string): unknown =>
  JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));

/** The inline payload of a fragment, decoded; `undefined` when absent. */
function payload(html: string, attribute: "data-droplet-data" | "data-droplet-context"): unknown {
  const match = html.match(new RegExp(`${attribute}>([^<]+)<`))?.[1];
  return match ? decode(match) : undefined;
}

/** The `action` of the form with `data-testid` `testid`, its entities decoded; `undefined` without one. */
function actionOf(html: string, testid: string): string | undefined {
  const tag = html.match(new RegExp(`<form[^>]*data-testid="${testid}"[^>]*>`))?.[0];
  const action = tag?.match(/\saction="([^"]*)"/)?.[1];
  return action
    ?.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, "&");
}

/** Polls until `check` stops throwing, for the element's async rendering. */
async function until(check: () => void | Promise<void>, timeout = 5000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() - started > timeout) throw error;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

const tick = () => new Promise((r) => setTimeout(r, 20));

/** The children marker as the engines print it: `data-droplet-children` may get `=""`, the style may be normalized. */
const MARKER = /<div data-droplet-children(?:="")? style="display:\s*contents;?"><\/div>/;
/** The host's children, where the component rendered them. */
const IN_MARKER = "[data-droplet-children] > [data-droplet-slot]";

/**
 * Clicks the count button until it answers: hydration is asynchronous and
 * has no DOM signature of its own, so a click that increments is the proof
 * it happened. Resolves with the count reached.
 */
async function clickUntilLive(el: HTMLElement): Promise<number> {
  const button = () => el.querySelector("[data-testid=count]") as HTMLElement | null;
  let count = 0;
  await until(async () => {
    button()?.click();
    await tick();
    count = Number(button()?.textContent?.trim());
    expect(count).toBeGreaterThan(0);
  });
  return count;
}

/** For engines without client behaviour: give the hydration a moment. */
const settle = () => new Promise((r) => setTimeout(r, 300));

/** The whole suite. Call it at the top level of a test file. */
export function rendererConformance(options: ConformanceOptions): void {
  const { renderer, root } = options;
  const element = options.element ?? "test-droplet";
  const interactive = options.interactive ?? true;
  const css = options.css ?? true;
  const adopts = options.adopts ?? true;
  const byAttribute = options.enhance === "attribute";
  const outDir = options.outDir ?? resolve(root, "dist-conformance");
  const clientRoot = resolve(outDir, "client");
  const origin = "http://drops.test";

  const adapter: DropletsAdapter = {
    name: "conformance",
    serverEntry: resolve(packageDist, "testing/conformance-entry.js"),
    serverFile: "server.js",
    separateSsrBundle: true,
  };

  const readFrom = (dir: string) => async (path: string): Promise<string | null> => {
    try {
      return await readFile(resolve(dir, path), "utf8");
    } catch {
      return null;
    }
  };
  const read = readFrom(clientRoot);
  /** The prerendered renders: server-only, next to the SSR bundle. */
  const readRendered = readFrom(resolve(outDir, "server", PRERENDER_DIR));

  let app: App;
  let manifest: DropletsManifest;
  let ssr: SsrModule;

  const get = (path: string, init?: RequestInit) => app.request(`${origin}${path}`, init);
  const post = (path: string, body: unknown) =>
    get(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  /** A same-origin form submit, as a browser sends it. */
  const submit = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => {
    const { origin: from = origin, referer, ...rest } = headers;
    const request = new Request(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...rest },
      body: new URLSearchParams(fields).toString(),
    });
    // Set after: happy-dom's Request, as a page's, drops `Origin` and `Referer` from its init.
    request.headers.set("origin", from);
    if (referer !== undefined) request.headers.set("referer", referer);
    return app.fetch(request);
  };
  /** What a no-JavaScript submit sends besides its form: an HTML accept and the page it was on. */
  const PAGE = `${origin}/book?ref=1`;
  const nativeSubmit = { accept: "text/html,*/*;q=0.8", referer: PAGE };
  /** A secret for Post/Redirect/Get, as `DROPLETS_SECRET` gives it at runtime. */
  const SECRET = "conformance-secret-0123456789abcdef-0123";
  /** The page a host renders after the redirect: `host` is where the redirect went, query included. */
  const renderOn = (host: string, path = "/droplets/guestbook") => post(path, { host, props: {} });
  /** The page a fragment renders on when the request names none: this server's origin, from the request. */
  const HOME = `${origin}/`;
  /** An action URL as a form on `page` has it: `path` with the page as `__droplet_return`, last. */
  const actionOn = (path: string, page = HOME) =>
    `${origin}${path}${path.includes("?") ? "&" : "?"}__droplet_return=${encodeURIComponent(page)}`;

  describe(`renderer conformance: ${renderer.name}`, () => {
    beforeAll(async () => {
      await rm(outDir, { recursive: true, force: true });
      const builder = await createBuilder({
        root,
        configFile: false,
        logLevel: "silent",
        build: { outDir },
        plugins: [droplets({ adapter, renderers: [renderer] })],
      });
      await builder.buildApp();

      manifest = JSON.parse((await read("droplets.json")) ?? "null") as DropletsManifest;
      expect(manifest, "dist/client/droplets.json").toBeTruthy();
      ssr = (await import(pathToFileURL(resolve(outDir, "server/entry-server.js")).href)) as SsrModule;
      app = createServerApp({
        ssr,
        config: resolveConfig({ element }),
        assets: {
          buildHash: manifest.__hash,
          loadClientModule: async (id) => {
            const file = manifest.droplets[id]?.client;
            return file ? read(file) : null;
          },
          loadEntryClient: () => read(manifest.__entryClient),
          entryModule: async () => manifest.__entryModule ?? null,
          loadGlobalStyle: () => read(manifest.__globalCss),
          dropletStyles: async (id) => manifest.droplets[id]?.css ?? [],
          loadIndex: async () => manifest.__index,
          externals: manifest.__externals,
          assetHandler: async (c) => {
            const body = await read(c.req.path.slice(1));
            return body === null ? c.text("Not Found", 404) : c.body(body);
          },
          loadPrerendered: createPrerenderedLoader(readRendered),
        },
      });
    }, 180_000);

    afterAll(async () => {
      await rm(outDir, { recursive: true, force: true });
    });

    describe("over HTTP", () => {
      it("renders SSR HTML inside the element, with the children marker", async () => {
        const res = await get("/droplets/hello?who=Ana");
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html.startsWith(`<${element} data-droplet="hello" data-build="${manifest.__hash}"`)).toBe(true);
        // Where to load from comes from /index.js, never from the markup.
        expect(html).not.toContain("data-droplet-location");
        expect(html).toMatch(/data-render-id="[a-z0-9]+"/);
        expect(html).toMatch(/<h1 data-testid="greeting">Hello Ana!<\/h1>/);
        // One empty marker, where the element puts the host's container.
        expect(html.match(/data-droplet-children/g)).toHaveLength(1);
        expect(html).toMatch(new RegExp(`data-testid="children"[^>]*>(\\s|<!--[^>]*-->)*${MARKER.source}`));
        expect(html.endsWith(`</div></${element}>`)).toBe(true);

        // POST with a JSON body answers the same fragment.
        const posted = await (await post("/droplets/hello", { props: { who: "Posted" } })).text();
        expect(posted).toContain("Hello Posted!");
      });

      it("inlines the server data and the context for the browser", async () => {
        const html = await (await get("/droplets/hello?who=Ana")).text();
        expect(payload(html, "data-droplet-data")).toMatchObject({ data: { who: "Ana" } });
        expect(payload(html, "data-droplet-context")).toEqual({ host: `${origin}/`, props: { who: "Ana" } });
        // `_data` answers the server load alone.
        const data = await post("/droplets/hello/_data", { props: { who: "Ana" } });
        expect(await data.json()).toMatchObject({ data: { who: "Ana" } });
      });

      it("renders the error page for a load that fails, through both handleError", async () => {
        const res = await get("/droplets/hello?who=crash");
        expect(res.status).toBe(500);
        const html = await res.text();
        expect(html).toContain("data-droplet-error");
        expect(html).toMatch(/data-testid="error"[^>]*>\[hello\] Sorry, ref 42</);
        expect(html).toMatch(new RegExp(`data-testid="error-children"[^>]*>(\\s|<!--[^>]*-->)*${MARKER.source}`));
        // What left the server, before the handleError of +droplet.ts.
        expect(payload(html, "data-droplet-data")).toEqual({ error: { message: "Sorry, ref 42" } });

        // error() is an answer, not a failure: no error page.
        const missing = await get("/droplets/hello?who=nobody");
        expect(missing.status).toBe(404);
        expect(await missing.text()).toBe("Nobody is here");
      });

      it("leaves a client-only droplet empty on the server", async () => {
        const html = await (await get("/droplets/frame")).text();
        expect(html).not.toContain("data-droplet-children");
        expect(html).not.toContain("data-render-id");
        expect(html).toContain('<div style="display: contents" data-droplet-entry></div>');
        // The context travels as an attribute when nothing was rendered.
        expect(html).toMatch(/ data-context="/);
      });

      it("prerenders the entries at build and serves them per request", async () => {
        const index = JSON.parse((await readRendered("docs/index.json")) ?? "{}") as Record<string, string>;
        // Never in the public client build.
        expect(existsSync(resolve(clientRoot, PRERENDER_DIR))).toBe(false);
        // "1" and 1 are one page after the schema; 99 is stored as its error
        // page; 404 answered error() and is not stored; 5 is stored for its host.
        expect(Object.keys(index).sort()).toEqual([
          '{"page":1}',
          '{"page":2}',
          '{"page":5} https://fixed.test/docs',
          '{"page":99}',
        ]);
        const stored = JSON.parse((await readRendered(index['{"page":1}']!)) ?? "null") as { html: string; data: unknown; nonce: string };
        expect(stored.html).toContain("<h1>Page 1</h1>");
        // transform runs per request, never at build.
        expect(stored.html).toContain("@HOST@");
        // No host at build: a token of this build in place of host.origin.
        expect(stored.nonce).toMatch(/^[0-9a-f]{16}$/);
        expect(stored.data).toMatchObject({ page: 1, building: true, home: `__$DROPLET_HOST_${stored.nonce}$__/home` });

        const stored2 = JSON.parse((await readRendered(index['{"page":2}']!)) ?? "null") as { headers?: unknown };
        // What its load set with setHeaders, kept with the render.
        expect(stored2.headers).toEqual({ "cache-control": "public, max-age=60" });
        const answer = await post("/droplets/docs", { host: "https://host.test/docs", props: { page: "2" } });
        expect(answer.headers.get("cache-control")).toBe("public, max-age=60");
        expect(answer.headers.get("vary")).toContain("x-host");
        const html = await answer.text();
        expect(html).toContain("<h1>Page 2</h1>");
        expect(html).toContain("<p>host.test</p>");
        // The token, replaced by this request's host.
        expect(payload(html, "data-droplet-data")).toMatchObject({
          data: { page: 2, building: true, home: "https://host.test/home" },
        });
        expect(html).not.toContain("DROPLET_");

        // Live, host the classic way: the forwarded headers.
        const liveAnswer = await get("/droplets/docs?page=3", {
          headers: { "x-forwarded-host": "shop.test", "x-forwarded-proto": "https" },
        });
        // A load that sets nothing: kept out of shared caches.
        expect(liveAnswer.headers.get("cache-control")).toBe("private, no-store");
        const live = await liveAnswer.text();
        expect(live).toContain("<h1>Page 3</h1>");
        expect(live).toContain("<p>shop.test</p>");
        expect(payload(live, "data-droplet-data")).toMatchObject({
          data: { page: 3, building: false, home: "https://shop.test/home" },
        });

        // A render for one host serves that host only.
        const fixed = await (await post("/droplets/docs", { host: "https://fixed.test/docs", props: { page: 5 } })).text();
        expect(payload(fixed, "data-droplet-data")).toMatchObject({ data: { page: 5, building: true } });
        const other = await (await post("/droplets/docs", { host: "https://other.test/docs", props: { page: 5 } })).text();
        expect(payload(other, "data-droplet-data")).toMatchObject({ data: { page: 5, building: false } });

        // Live, the whole of host is there.
        const ref = await (await post("/droplets/docs", { host: "https://host.test/docs?ref=r1", props: { page: 7 } })).text();
        expect(payload(ref, "data-droplet-data")).toMatchObject({ data: { page: 7, ref: "r1" } });

        expect((await get("/droplets/docs?page=x")).status).toBe(400);

        // The error page follows the droplet's flags: prerendered, and
        // hydrated with the error inline.
        const broken = await get("/droplets/docs?page=99");
        expect(broken.status).toBe(500);
        const brokenHtml = await broken.text();
        expect(brokenHtml).toContain("data-droplet-error");
        expect(brokenHtml).toMatch(/data-testid="docs-error"[^>]*>This page is unavailable</);
        expect(payload(brokenHtml, "data-droplet-data")).toEqual({ error: { message: "This page is unavailable" } });
      });

      it("stops prerendering a render that reads more of host than the build knows", async () => {
        const renderDroplet = ssr.renderDroplet ?? ssr.default;
        if (!renderDroplet) throw new Error("the SSR bundle exports no renderDroplet");
        const building = createApp({
          element,
          health: false,
          renderDroplet,
          ...(ssr.getDropletMeta ? { getDropletMeta: ssr.getDropletMeta } : {}),
          ...(ssr.validateDropletProps ? { validateProps: ssr.validateDropletProps } : {}),
          ...(ssr.renderError ? { renderError: ssr.renderError } : {}),
          building: true,
        });
        const res = await building.request("http://droplets.build/droplets/docs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ props: { page: 7 } }),
        });
        // The answer the build stops on.
        expect(res.headers.get("x-droplets-prerender-error")).toBe("host");
        expect(((await res.json()) as { message: string }).message).toContain("docs: host.searchParams is not known");
      });

      it("runs form actions and renders their result as form, for a native submit without DROPLETS_SECRET", async () => {
        const plain = await (await get("/droplets/guestbook")).text();
        expect(plain).toMatch(/data-testid="form"[^>]*>none</);
        // Where the forms post: the neutral action URLs, the same before and after any JavaScript.
        expect(actionOf(plain, "sign")).toBe(actionOn("/droplets/guestbook"));
        expect(actionOf(plain, "leave")).toBe(actionOn("/droplets/guestbook?/leave"));
        expect(actionOf(plain, "plain")).toBe(actionOn("/droplets/guestbook?/echo"));
        expect(plain).not.toContain("noJS");

        // A native submit (no JavaScript, no `accept: application/json`) with
        // no secret to sign the result with: the fragment again, with `form`.
        const signed = await submit("/droplets/guestbook", { name: "Ana" }, { accept: "text/html,*/*;q=0.8" });
        expect(signed.status).toBe(200);
        expect(signed.headers.get("cache-control")).toBe("private, no-store");
        const html = await signed.text();
        expect(html).toMatch(/data-testid="form"[^>]*>Thanks, Ana</);
        // The load ran again; the result goes with its data, for hydration.
        if (!byAttribute) {
          expect(payload(html, "data-droplet-data")).toEqual({ data: { count: 1 }, form: { message: "Thanks, Ana" } });
        }
        expect(actionOf(html, "sign")).toBe(actionOn("/droplets/guestbook"));
        expect(html).not.toContain("noJS");

        const refused = await submit("/droplets/guestbook", { name: "" });
        expect(refused.status).toBe(422);
        expect(await refused.text()).toMatch(/data-testid="form"[^>]*>A name, please</);

        const left = await submit("/droplets/guestbook?/leave", {});
        expect(left.status).toBe(303);
        expect(left.headers.get("location")).toBe(`${origin}/bye`);
      });

      describe("Post/Redirect/Get, with DROPLETS_SECRET", () => {
        beforeEach(() => {
          vi.stubEnv("DROPLETS_SECRET", SECRET);
        });
        afterEach(() => {
          vi.unstubAllEnvs();
        });

        const key = () => `__droplet_form_guestbook_${manifest.__hash}`;

        it("sends a native submit back to its page with the result, and renders it there", async () => {
          const signed = await submit("/droplets/guestbook", { name: "Ana" }, nativeSubmit);
          expect(signed.status).toBe(303);
          const back = signed.headers.get("location") ?? "";
          expect(back.startsWith(`${PAGE}&${key()}=`)).toBe(true);
          expect(new URL(back).searchParams.get(key())).toMatch(/^[\w-]+\.[\w-]{43}$/);

          // The page again: the droplet renders live (it is prerendered) with `form`.
          const page = await renderOn(back);
          expect(page.status).toBe(200);
          expect(page.headers.get("cache-control")).toBe("private, no-store");
          const html = await page.text();
          expect(html).toMatch(/data-testid="form"[^>]*>Thanks, Ana</);
          if (!byAttribute) {
            expect(payload(html, "data-droplet-data")).toEqual({ data: { count: 1 }, form: { message: "Thanks, Ana" } });
          }
          // The app's code never sees it: the context the browser gets has the page without it.
          expect((payload(html, "data-droplet-context") as { host?: string } | undefined)?.host ?? PAGE).toBe(PAGE);
          expect(html).not.toContain(key());

          // `_data` answers it too, for a droplet the browser renders.
          expect(await (await renderOn(back, "/droplets/guestbook/_data")).json()).toEqual({
            data: { count: 1 },
            form: { message: "Thanks, Ana" },
          });

          const refused = await submit("/droplets/guestbook", { name: "" }, nativeSubmit);
          expect(refused.status).toBe(303);
          expect(await (await renderOn(refused.headers.get("location") ?? "")).text()).toMatch(/data-testid="form"[^>]*>A name, please</);

          const left = await submit("/droplets/guestbook?/leave", {}, nativeSubmit);
          expect(left.status).toBe(303);
          expect(left.headers.get("location")).toBe(`${origin}/bye`);
        });

        it("ignores a result that is not genuine, and renders as without one", async () => {
          const back = (await submit("/droplets/guestbook", { name: "Ana" }, nativeSubmit)).headers.get("location") ?? "";
          const value = new URL(back).searchParams.get(key()) ?? "";
          const [body, mac] = value.split(".") as [string, string];
          const forged = btoa(JSON.stringify({ status: 200, data: { message: "Call 555" }, exp: Date.now() + 60_000, action: "default" }))
            .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
          for (const bad of [`${forged}.${mac}`, `${body}.${"A".repeat(43)}`, `${body}${"A".repeat(2048)}.${mac}`]) {
            const html = await (await renderOn(`${PAGE}&${key()}=${bad}`)).text();
            expect(html).toMatch(/data-testid="form"[^>]*>none</);
          }
          // Another build's key is not this one's.
          const other = await (await renderOn(`${PAGE}&__droplet_form_guestbook_other1=${value}`)).text();
          expect(other).toMatch(/data-testid="form"[^>]*>none</);
        });

        it("goes back only to a page on this server or a trusted origin", async () => {
          for (const referer of ["https://evil.example/book", `${origin}.evil.example/book`, "javascript:alert(1)"]) {
            const res = await submit("/droplets/guestbook", { name: "Ana" }, { ...nativeSubmit, referer });
            expect(res.status, referer).toBe(400);
            expect(res.headers.get("location")).toBeNull();
          }
          // Without a Referer there is no page to go back to.
          const { referer: _referer, ...noReferer } = nativeSubmit;
          expect((await submit("/droplets/guestbook", { name: "Ana" }, noReferer)).status).toBe(400);
        });

        it("lands a cross-origin page whose Referer is its origin alone back on its path", async () => {
          vi.stubEnv("DROPLETS_TRUSTED_ORIGINS", "https://shop.test");
          const page = "https://shop.test/products/7?tab=reviews";
          // The form's action URL names the page it renders on, prerendered or live.
          const html = await (await renderOn(page)).text();
          const action = actionOf(html, "sign") ?? "";
          expect(action).toBe(actionOn("/droplets/guestbook", "https://shop.test/products/7"));
          // A native submit from there: `strict-origin-when-cross-origin` sends the origin alone.
          const res = await submit(action.slice(origin.length), { name: "Ana" }, {
            origin: "https://shop.test",
            accept: "text/html,*/*;q=0.8",
            referer: "https://shop.test/",
          });
          expect(res.status).toBe(303);
          const back = res.headers.get("location") ?? "";
          expect(back.startsWith(`https://shop.test/products/7?${key()}=`)).toBe(true);
          expect(await (await renderOn(back)).text()).toMatch(/data-testid="form"[^>]*>Thanks, Ana</);
          // Minted for that page: worthless on another page of the same origin.
          const elsewhere = `https://shop.test/products/8?${key()}=${new URL(back).searchParams.get(key())}`;
          expect(await (await renderOn(elsewhere)).text()).toMatch(/data-testid="form"[^>]*>none</);
        });

        it("keeps the JSON answer for an enhanced form", async () => {
          const json = await submit("/droplets/guestbook", { name: "Ana" }, { accept: "application/json", referer: PAGE });
          expect(await json.json()).toEqual({ type: "success", status: 200, data: { message: "Thanks, Ana" } });
        });
      });

      it("ships neither DROPLETS_SECRET nor the result's signing code to the browser", async () => {
        const files = await readdir(resolve(clientRoot, "assets"));
        for (const file of files.filter((name) => name.endsWith(".js"))) {
          const code = (await read(`assets/${file}`)) ?? "";
          expect(code, file).not.toContain("DROPLETS_SECRET");
          expect(code, file).not.toContain("droplets-form-v");
        }
      });

      it("puts action URLs on the droplets server's location, never on an untrusted x-host", async () => {
        // Prerendered: the build's location token, replaced per request before transform.
        const index = JSON.parse((await readRendered("guestbook/index.json")) ?? "{}") as Record<string, string>;
        const stored = JSON.parse((await readRendered(index["{}"] ?? "")) ?? "null") as { html: string; nonce: string } | null;
        expect(stored, "guestbook is prerendered").toBeTruthy();
        const tokens = `__$DROPLET_HOST_${stored!.nonce}$____$DROPLET_PATH_${stored!.nonce}$__`;
        expect(actionOf(stored!.html, "sign")).toBe(
          `__$DROPLET_LOCATION_${stored!.nonce}$__/droplets/guestbook?__droplet_return=${encodeURIComponent(tokens)}`,
        );

        // A trusted x-host (this server's own origin, under a prefix) moves them.
        const proxied = await (await get("/droplets/guestbook", { headers: { "x-host": `${origin}/mfe` } })).text();
        expect(actionOf(proxied, "sign")).toBe(`${origin}/mfe/droplets/guestbook?__droplet_return=${encodeURIComponent(HOME)}`);
        expect(proxied).not.toContain("DROPLET_");

        // An untrusted one never reaches them: prerendered, live, or after an action.
        const evil = { "x-host": "https://evil.example/x" };
        const served = await (await get("/droplets/guestbook", { headers: evil })).text();
        expect(actionOf(served, "sign")).toBe(actionOn("/droplets/guestbook"));
        const live = await (await submit("/droplets/guestbook", { name: "Ana" }, evil)).text();
        expect(live).toMatch(/data-testid="form"[^>]*>Thanks, Ana</);
        expect(actionOf(live, "leave")).toBe(actionOn("/droplets/guestbook?/leave"));
        for (const html of [served, live]) expect(html).not.toContain("evil.example");
      });

      it("hands the action its URL as it came: no key is stripped, noJS is a prop like any other", async () => {
        const json = { accept: "application/json" };
        const echoed = await submit("/droplets/guestbook?/echo", {}, json);
        expect(await echoed.json()).toEqual({ type: "success", status: 200, data: { message: "?/echo" } });
        const kept = await submit("/droplets/guestbook?/echo&noJS&x=1", {}, json);
        expect(await kept.json()).toMatchObject({ data: { message: "?/echo&noJS&x=1" } });
      });

      it("renders a JSON render that carries form with it, live", async () => {
        const res = await post("/droplets/guestbook", { props: {}, form: { message: "Thanks, Bo" } });
        expect(res.status).toBe(200);
        expect(await res.text()).toMatch(/data-testid="form"[^>]*>Thanks, Bo</);
        // Without form, the stored render.
        expect(await (await post("/droplets/guestbook", { props: {} })).text()).toMatch(/data-testid="form"[^>]*>none</);
      });

      it("answers an action in JSON to a request that accepts it", async () => {
        const json = { accept: "application/json" };
        const signed = await submit("/droplets/guestbook", { name: "Ana" }, json);
        expect(await signed.json()).toEqual({ type: "success", status: 200, data: { message: "Thanks, Ana" } });
        const refused = await submit("/droplets/guestbook", {}, json);
        expect(refused.status).toBe(422);
        expect(await refused.json()).toEqual({ type: "failure", status: 422, data: { message: "A name, please" } });
        const left = await submit("/droplets/guestbook?/leave", {}, json);
        expect(await left.json()).toEqual({ type: "redirect", status: 303, location: `${origin}/bye` });
      });

      it("reaches only the actions a droplet exports", async () => {
        for (const name of ["__proto__", "constructor", "toString", "nope"]) {
          expect((await submit(`/droplets/guestbook?/${name}`, { name: "Ana" })).status, name).toBe(404);
        }
        // hello has no actions.
        const none = await submit("/droplets/hello", { who: "Ana" });
        expect(none.status).toBe(405);
        expect(none.headers.get("allow")).toBe("GET");
        // A cross-site form is refused before any of it runs.
        expect((await submit("/droplets/guestbook", { name: "Ana" }, { origin: "https://evil.example" })).status).toBe(403);
      });

      it("ships no JavaScript for a droplet that never hydrates, but still its styles", async () => {
        expect((await get("/droplets/static-note/client.js")).status).toBe(404);
        expect(manifest.droplets["static-note"]?.client).toBeUndefined();
        const res = await get("/droplets/static-note");
        const html = await res.text();
        expect(html).toContain("Rendered on the server only.");
        if (css) {
          const files = manifest.droplets["static-note"]?.css ?? [];
          expect(files.length).toBeGreaterThan(0);
          for (const file of files) expect(file).toMatch(/^assets\/.+\.css$/);
          // style.css imports every stylesheet, relative to itself.
          const style = await (await get("/droplets/static-note/style.css")).text();
          expect(style).toBe(files.map((file) => `@import url("../../${file}");\n`).join(""));
          const sheets = await Promise.all(files.map(async (file) => (await get(`/${file}`)).text()));
          expect(sheets.join("")).toContain("italic");
          // Linked inside the element, ahead of the markup, and announced.
          const href = `${origin}/droplets/static-note/style.css?c=${manifest.__hash}`;
          expect(html).toContain(`<link rel="stylesheet" href="${href}" data-droplet-style><div style="display: contents" data-droplet-entry>`);
          expect(res.headers.get("link")).toContain(`<${href}>; rel=preload; as=style`);
          // It never hydrates: no bundle to preload.
          expect(res.headers.get("link")).not.toContain("client.js");
        }
        // The hydrating one does ship.
        expect((await get("/droplets/hello/client.js")).status).toBe(200);
      });

      it("serves /index.js as a stub of the hashed entry", async () => {
        const stub = await get("/index.js");
        expect(stub.headers.get("cache-control")).toBe("no-store");
        expect(manifest.__entryModule).toMatch(/^assets\/index\.[\w-]+\.js$/);
        // After where it was loaded from and the public runtime variables.
        const code = await stub.text();
        expect(code).toContain('.origin = new URL(/* @vite-ignore */ ".", import.meta.url).href');
        expect(code.endsWith(`import("./${manifest.__entryModule}");\n`)).toBe(true);
        // A fragment announces the entry and, as hello hydrates at once, its bundle.
        const link = (await get("/droplets/hello?who=Ana")).headers.get("link") ?? "";
        expect(link).toContain(`<${origin}/${manifest.__entryModule}>; rel=modulepreload`);
        expect(link).toContain(`<${origin}/droplets/hello/client.js?c=${manifest.__hash}>; rel=modulepreload`);
      });
    });

    describe("in the browser", () => {
      type Element = HTMLElement & { update(payload: { droplet: string }): Promise<void> };
      let fetches: string[] = [];
      /** Every request, as the browser sent it. */
      let requests: { url: string; method: string; type: string; accept: string }[] = [];
      /** While set, a form action's answer waits for it. */
      let holdActions: Promise<void> | null = null;
      /** The forms whose submit reached the document un-prevented: the browser's, not enhanced. */
      let native: string[] = [];
      // Prevented here, once nothing else did: happy-dom would navigate the test's window.
      const onDocumentSubmit = (event: Event) => {
        if (!event.defaultPrevented) native.push((event.target as HTMLElement).dataset["testid"] ?? "?");
        event.preventDefault();
      };
      let realFetch: typeof fetch;
      /** Resolved before any bundle loads; a test replaces it to hold the bundles back. */
      let bundles: Promise<void> = Promise.resolve();
      /** The droplets whose bundles were imported. */
      const imported: string[] = [];

      const mount = (html: string): Element => {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper);
        return wrapper.firstElementChild as Element;
      };

      /** The fragment with the host's children in their container, appended as a host would. */
      const withChildren = async (path: string, kid: string) =>
        (await (await get(path)).text()).replace(
          new RegExp(`</${element}>$`),
          `<div data-droplet-slot><p id="${kid}">from host</p></div></${element}>`,
        );

      /** Moves the test's window to `url`, as a page there would be: what `actionUrl()` reads in the browser. */
      const visit = (url: string) => (globalThis as { happyDOM?: { setURL(url: string): void } }).happyDOM?.setURL(url);

      beforeAll(async () => {
        expect(typeof document, "run this suite under happy-dom").toBe("object");
        // The page a fragment fetched without a host renders for: this server's origin.
        visit(HOME);
        expect(globalThis.location.href).toBe(HOME);
        realFetch = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          fetches.push(url);
          const headers = new Headers(init?.headers);
          const body = init?.body;
          const type = headers.get("content-type") ??
            (body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : body instanceof FormData ? "multipart/form-data" : "");
          requests.push({ url, method: init?.method ?? "GET", type, accept: headers.get("accept") ?? "" });
          if (holdActions && type.includes("form")) await holdActions;
          if ((init?.method ?? "GET") === "GET") return app.request(url, init);
          // As a browser does on a POST: the page's origin, here the droplets server's own.
          // Set after: happy-dom's Request, as a page's, drops `Origin` from its init.
          const request = new Request(url, init);
          if (!request.headers.has("origin")) request.headers.set("origin", origin);
          return app.request(request);
        }) as typeof fetch;
        document.addEventListener("submit", onDocumentSubmit);
        // What /index.js records before the entry: where it was loaded from.
        const servers = ((globalThis as unknown as Record<symbol, Record<string, { origin?: string }>>)[
          Symbol.for("droplets.servers")
        ] ??= {});
        (servers[`${element}:${manifest.__hash}`] ??= {}).origin = origin;
        // The real loader, from the build; it defines the element.
        const entry = (await import(pathToFileURL(resolve(clientRoot, manifest.__entryModule ?? "")).href)) as {
          DjsDropletElement: { importModule: (url: string) => Promise<unknown> };
        };
        entry.DjsDropletElement.importModule = async (url) => {
          const id = new URL(url).pathname.match(/\/droplets\/([^/]+)\/client\.js$/)?.[1];
          const file = manifest.droplets[id ?? ""]?.client;
          if (!file) throw new Error(`no client bundle for ${url}`);
          imported.push(id ?? "");
          await bundles;
          return import(pathToFileURL(resolve(clientRoot, file)).href);
        };
        expect(customElements.get(element)).toBeDefined();
      });

      it("calls init of src/hooks.client.ts once, before it defines the element", () => {
        const steps = (globalThis as { conformanceInit?: string[] }).conformanceInit;
        expect(steps, "the fixture's src/hooks.client.ts did not run").toEqual(["not defined"]);
        expect(customElements.get(element)).toBeDefined();
      });

      afterAll(() => {
        globalThis.fetch = realFetch;
        document.removeEventListener("submit", onDocumentSubmit);
      });

      it("hydrates the server markup in place, keeping the DOM and the host's children", async () => {
        fetches = [];
        const el = mount(await withChildren("/droplets/hello?who=Ana", "kid-hydrate"));
        const greeting = el.querySelector("[data-testid=greeting]");
        expect(greeting?.textContent).toBe("Hello Ana!");
        expect(el.querySelector("[data-testid=count]")?.textContent?.trim()).toBe("0");
        if (interactive) await clickUntilLive(el);
        else await settle();
        // The same node: adopted, not re-created (or the same content, rendered again).
        if (adopts) expect(el.querySelector("[data-testid=greeting]")).toBe(greeting);
        else expect(el.querySelector("[data-testid=greeting]")?.textContent).toBe("Hello Ana!");
        expect(el.querySelector(`[data-testid=children] ${IN_MARKER} > #kid-hydrate`)?.textContent).toBe("from host");
        expect(document.querySelectorAll("#kid-hydrate")).toHaveLength(1);
        // Inline data: nothing fetched.
        expect(fetches.filter((u) => u.includes("/_data"))).toEqual([]);
      });

      it("shows the host's children in the marker before the bundle loads, and keeps the container through hydration", async () => {
        let release!: () => void;
        bundles = new Promise((r) => (release = r));
        try {
          const el = mount(await withChildren("/droplets/hello?who=Ana", "kid-early"));
          // Right at connect, nothing loaded yet: the container sits in the server's marker, shown.
          const container = el.querySelector<HTMLElement>(`[data-testid=children] ${IN_MARKER}`);
          expect(container).not.toBeNull();
          expect(container?.hidden).toBe(false);
          expect(container?.querySelector("#kid-early")?.textContent).toBe("from host");
          await tick();
          expect(el.querySelector(`[data-testid=children] ${IN_MARKER}`)).toBe(container);

          release();
          bundles = Promise.resolve();
          if (interactive) await clickUntilLive(el);
          else await settle();
          // Hydrated: the same container node, in the adopted marker, shown.
          expect(el.querySelector(`[data-testid=children] ${IN_MARKER}`)).toBe(container);
          expect(container?.hidden).toBe(false);
          expect(document.querySelectorAll("#kid-early")).toHaveLength(1);
        } finally {
          release();
          bundles = Promise.resolve();
        }
      });

      it("keeps the container hidden under the element when the server HTML has no marker", async () => {
        // docs hydrates, static-note never does; neither renders its children.
        for (const [path, kid] of [["/droplets/docs?page=3", "kid-docs"], ["/droplets/static-note", "kid-note"]]) {
          const el = mount(await withChildren(path!, kid!));
          const container = el.querySelector<HTMLElement>(":scope > [data-droplet-slot]");
          expect(container, path).not.toBeNull();
          expect(container?.hidden, path).toBe(true);
          await settle();
          expect(el.querySelector(":scope > [data-droplet-slot]"), path).toBe(container);
          expect(container?.hidden, path).toBe(true);
          expect(document.querySelectorAll(`#${kid}`), path).toHaveLength(1);
        }
      });

      it("mounts a client-only droplet and moves the host's children into its marker", async () => {
        const el = mount(
          `<${element} data-droplet="frame"><div data-droplet-slot><p id="kid-frame">from host</p></div></${element}>`,
        );
        // Nothing rendered yet: the container waits under the element, hidden.
        expect(el.querySelector<HTMLElement>(":scope > [data-droplet-slot]")?.hidden).toBe(true);
        await until(() => expect(el.querySelector(`[data-droplet-entry] [data-testid=frame] ${IN_MARKER} > #kid-frame`)).not.toBeNull());
        expect(el.querySelector<HTMLElement>("[data-droplet-slot]")?.hidden).toBe(false);
        expect(document.querySelectorAll("#kid-frame")).toHaveLength(1);
        // Light DOM: no shadow root anywhere.
        expect(el.shadowRoot).toBeNull();
      });

      it("hydrates the error page with the host's children in its marker", async () => {
        const el = mount(await withChildren("/droplets/hello?who=crash", "kid-error"));
        const message = el.querySelector("[data-testid=error]");
        expect(message?.textContent).toBe("[hello] Sorry, ref 42");
        expect(el.querySelector(`[data-testid=error-children] ${IN_MARKER} > #kid-error`)).not.toBeNull();
        await tick();
        await tick();
        if (adopts) expect(el.querySelector("[data-testid=error]")).toBe(message);
        else expect(el.querySelector("[data-testid=error]")?.textContent).toBe("[hello] Sorry, ref 42");
        expect(el.querySelector(`[data-testid=error-children] ${IN_MARKER} > #kid-error`)).not.toBeNull();
        expect(document.querySelectorAll("#kid-error")).toHaveLength(1);
      });

      it("keeps the neutral action URLs the server rendered once the droplet is live", async () => {
        const logged: unknown[][] = [];
        const { error, warn } = console;
        console.error = (...args: unknown[]) => void logged.push(args);
        console.warn = (...args: unknown[]) => void logged.push(args);
        try {
          const el = mount(await (await get("/droplets/guestbook")).text());
          const action = (testid: string) => el.querySelector(`[data-testid=${testid}]`)?.getAttribute("action");
          expect(action("sign")).toBe(actionOn("/droplets/guestbook"));
          if (!byAttribute) await until(() => expect(imported).toContain("guestbook"));
          await settle();
          // The page in the browser's `location` is the one the server rendered for.
          expect(action("sign")).toBe(actionOn("/droplets/guestbook"));
          expect(action("leave")).toBe(actionOn("/droplets/guestbook?/leave"));
          expect(action("plain")).toBe(actionOn("/droplets/guestbook?/echo"));
          expect(el.innerHTML).not.toContain("noJS");
          // Hydration found what the server rendered.
          expect(logged).toEqual([]);
        } finally {
          console.error = error;
          console.warn = warn;
        }
      });

      it("hydrates an action's render with the same form it was rendered with", async () => {
        fetches = [];
        const res = await submit("/droplets/guestbook", { name: "" });
        const el = mount(await res.text());
        const message = el.querySelector("[data-testid=form]");
        expect(message?.textContent).toBe("A name, please");
        if (!byAttribute) await until(() => expect(imported).toContain("guestbook"));
        await settle();
        if (adopts) expect(el.querySelector("[data-testid=form]")).toBe(message);
        expect(el.querySelector("[data-testid=form]")?.textContent).toBe("A name, please");
        // Inline data: nothing fetched.
        expect(fetches.filter((u) => u.includes("/droplets/guestbook"))).toEqual([]);
      });

      it("hydrates the page a no-JavaScript submit came back to with the same form", async () => {
        vi.stubEnv("DROPLETS_SECRET", SECRET);
        try {
          const res = await submit("/droplets/guestbook", { name: "" }, nativeSubmit);
          const back = res.headers.get("location") ?? "";
          fetches = [];
          visit(back);
          const el = mount(await (await renderOn(back)).text());
          const message = el.querySelector("[data-testid=form]");
          expect(message?.textContent).toBe("A name, please");
          if (!byAttribute) await until(() => expect(imported).toContain("guestbook"));
          await settle();
          if (adopts) expect(el.querySelector("[data-testid=form]")).toBe(message);
          expect(el.querySelector("[data-testid=form]")?.textContent).toBe("A name, please");
          expect(el.querySelector("[data-testid=sign]")?.getAttribute("action")).toBe(actionOn("/droplets/guestbook", `${origin}/book`));
          expect(fetches.filter((u) => u.includes("/droplets/guestbook"))).toEqual([]);
        } finally {
          vi.unstubAllEnvs();
          visit(HOME);
        }
      });

      describe("an enhanced form", () => {
        let events: unknown[] = [];
        const onAction = (event: Event) => void events.push((event as CustomEvent).detail);
        let assign: ReturnType<typeof vi.spyOn>;
        let el: Element;

        beforeAll(() => globalThis.addEventListener("droplets:action", onAction));
        afterAll(() => globalThis.removeEventListener("droplets:action", onAction));

        /**
         * A submit, as the browser fires it. Dispatched here rather than
         * through `requestSubmit()`, whose event happy-dom marks untrusted:
         * `hono/jsx/dom` reads `detail` off an untrusted submit (its
         * `formAction` buttons send one), so it gets an empty one.
         */
        const submitForm = (target: HTMLFormElement) => {
          const event = new SubmitEvent("submit", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "detail", { value: {} });
          target.dispatchEvent(event);
        };
        const field = () => el.querySelector<HTMLInputElement>("[data-testid=sign] input[name=name]");
        const form = (testid: string) => el.querySelector<HTMLFormElement>(`[data-testid=${testid}]`);
        const message = () => el.querySelector("[data-testid=form]")?.textContent;
        /** The form posts to the guestbook's actions so far. */
        const actionPosts = () => requests.filter((r) => r.method === "POST" && r.type.includes("form") && r.url.startsWith(`${origin}/droplets/guestbook`));
        /**
         * Submits `testid` until it is enhanced: a submit before the droplet
         * is live (and its forms bound) is the browser's, prevented here.
         */
        const submitEnhanced = async (testid: string, name?: string) => {
          await until(() => {
            const before = actionPosts().length;
            if (name !== undefined) field()!.value = name;
            submitForm(form(testid)!);
            expect(actionPosts().length).toBe(before + 1);
          });
        };

        const fresh = async () => {
          events = [];
          native = [];
          requests = [];
          assign = vi.spyOn(globalThis.location, "assign").mockImplementation(() => {});
          el = mount(await (await get("/droplets/guestbook")).text());
          if (!byAttribute) await until(() => expect(imported).toContain("guestbook"));
        };

        it("updates form in place on success and failure, without navigating, and tells the page", async () => {
          await fresh();
          const href = globalThis.location.href;
          try {
            const before = el.querySelector("[data-testid=form]");
            await submitEnhanced("sign", "Ana");
            await until(() => expect(message()).toBe("Thanks, Ana"));
            const sent = actionPosts().at(-1)!;
            expect(sent.url).toBe(actionOn("/droplets/guestbook"));
            expect(sent.accept).toBe("application/json");
            if (byAttribute) {
              // The server rendered the fragment again with `form`, in place of the old one.
              expect(requests.some((r) => r.method === "POST" && r.type === "application/json" && /\/droplets\/guestbook$/.test(r.url))).toBe(true);
              expect(el.querySelector("[data-testid=form]")).not.toBe(before);
              expect(imported).not.toContain("guestbook");
            } else {
              // Rendered again in the browser, with its loads run again.
              expect(requests.some((r) => r.url.includes("/droplets/guestbook/_data"))).toBe(true);
            }
            expect(events).toEqual([{ droplet: "guestbook", action: "default", type: "success", status: 200, data: { message: "Thanks, Ana" } }]);

            await submitEnhanced("sign", "");
            await until(() => expect(message()).toBe("A name, please"));
            // Rendered again in the browser: the same action URL, the page from its `location`.
            expect(actionPosts().at(-1)!.url).toBe(actionOn("/droplets/guestbook"));
            expect(events.at(-1)).toEqual({ droplet: "guestbook", action: "default", type: "failure", status: 422, data: { message: "A name, please" } });

            expect(assign).not.toHaveBeenCalled();
            expect(globalThis.location.href).toBe(href);
          } finally {
            assign.mockRestore();
          }
        });

        it("follows a redirect with a navigation", async () => {
          await fresh();
          try {
            await submitEnhanced("leave");
            await until(() => expect(assign).toHaveBeenCalledWith(`${origin}/bye`));
            expect(events.at(-1)).toEqual({ droplet: "guestbook", action: "leave", type: "redirect", status: 303, data: undefined });
          } finally {
            assign.mockRestore();
          }
        });

        it("ignores a second submit while one is in flight", async () => {
          await fresh();
          let release!: () => void;
          holdActions = new Promise((resolve) => (release = resolve));
          try {
            await submitEnhanced("sign", "Ana");
            const posts = actionPosts().length;
            native = [];
            submitForm(form("sign")!);
            submitForm(form("sign")!);
            // Prevented, and not sent.
            expect(native).toEqual([]);
            expect(actionPosts()).toHaveLength(posts);
            release();
            await until(() => expect(message()).toBe("Thanks, Ana"));
            await settle();
            expect(actionPosts()).toHaveLength(posts);
            expect(events).toHaveLength(1);
          } finally {
            holdActions = null;
            release();
            assign.mockRestore();
          }
        });

        it("leaves a form it was not applied to to the browser", async () => {
          await fresh();
          try {
            // Live first: `sign` is enhanced by then.
            await submitEnhanced("sign", "Ana");
            await until(() => expect(message()).toBe("Thanks, Ana"));
            native = [];
            const posts = actionPosts().length;
            submitForm(form("plain")!);
            expect(native).toEqual(["plain"]);
            await settle();
            expect(actionPosts()).toHaveLength(posts);
            expect(requests.some((r) => r.url.includes("?/echo"))).toBe(false);
          } finally {
            assign.mockRestore();
          }
        });
      });

      it("shows the error page for a load that fails in the browser", async () => {
        const el = mount(
          `<${element} data-droplet="hello" data-params='{"who":"crash"}'></${element}>`,
        );
        await until(() => expect(el.querySelector("[data-testid=error]")?.textContent).toBe("[hello] Sorry, ref 42"));
      });

      it("remounts from the fragment asked for again (dev.strategy remount, and hmr's fallback), with the host's children carried over", async () => {
        const el = mount(await withChildren("/droplets/hello?who=Ana", "kid-hmr"));
        if (interactive) await clickUntilLive(el);
        else await settle();
        fetches = [];
        await el.update({ droplet: "hello" });
        // A remount is a fresh instance: the count starts over. That is
        // `dev.strategy: "remount"`, and under `"hmr"` an engine without HMR
        // of its own (or an edit its HMR did not take); with HMR the
        // framework swaps the component and keeps what it can.
        await until(() => expect(el.querySelector("[data-testid=count]")?.textContent?.trim()).toBe("0"));
        expect(el.querySelector("[data-testid=greeting]")?.textContent).toBe("Hello Ana!");
        if (interactive) await clickUntilLive(el);
        // A server fragment is asked for again, as the host's server would; its data comes inline.
        expect(fetches.filter((u) => /\/droplets\/hello$/.test(u))).toHaveLength(1);
        expect(fetches.filter((u) => u.includes("/_data"))).toHaveLength(0);
        expect(el.querySelector(`[data-testid=children] ${IN_MARKER} > #kid-hmr`)).not.toBeNull();
        expect(document.querySelectorAll("#kid-hmr")).toHaveLength(1);
      });

      it("gives a live instance new data in place, its state kept, through the renderer's update (a load edit under hmr)", async () => {
        const file = manifest.droplets["hello"]?.client;
        expect(file).toBeDefined();
        const bundle = (await import(pathToFileURL(resolve(clientRoot, file ?? "")).href)) as {
          default: (target: HTMLElement, data: unknown, host: unknown, info: unknown) => Promise<unknown>;
          update: (handle: unknown, data: unknown) => Promise<boolean>;
          unmount: (handle: unknown) => unknown;
        };
        const target = document.createElement("div");
        document.body.append(target);
        const host = { fill: () => {}, empty: () => {} };
        const handle = await bundle.default(target, { who: "Ana", greeting: "Hello Ana!" }, host, { location: origin, props: {} });
        try {
          await until(() => expect(target.querySelector("[data-testid=greeting]")?.textContent).toBe("Hello Ana!"));
          const clicks = interactive ? await clickUntilLive(target) : 0;
          const kept = await bundle.update(handle, { who: "Bo", greeting: "Hello Bo!" });
          // A renderer without `update` remounts instead: nothing to check here.
          if (!kept) return;
          await until(() => expect(target.querySelector("[data-testid=greeting]")?.textContent).toBe("Hello Bo!"));
          if (interactive) expect(Number(target.querySelector("[data-testid=count]")?.textContent?.trim())).toBe(clicks);
        } finally {
          await bundle.unmount(handle);
          target.remove();
        }
      });
    });
  });
}
