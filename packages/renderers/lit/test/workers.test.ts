/**
 * The fixture built with the Cloudflare adapter, its `dist/worker.js` run
 * in this process, which has no DOM globals (`document`, `HTMLElement`), as
 * a Worker has none. The adapter resolves without the `node` condition, so
 * Lit's browser build would be bundled and fail as it is evaluated; the
 * renderer's plugin swaps in Lit's server build, which runs on its own DOM
 * shim. `wrangler dev` (workerd) serves the same build; this test needs no
 * workerd binary.
 */
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloudflare } from "@dropletsjs/adapter-cloudflare";
import { droplets } from "@dropletsjs/droplets/vite";
import { lit } from "../src/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/app");
const outDir = resolve(root, "dist-workers");
const origin = "http://worker.test";

type Worker = { fetch(request: Request, env: Record<string, unknown>, ctx: unknown): Promise<Response> };
let worker: Worker;

/** Workers Static Assets, from the client build. */
const ASSETS = {
  async fetch(input: Request | string | URL): Promise<Response> {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    try {
      return new Response(await readFile(resolve(outDir, "client", `.${path}`)));
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  },
};

const get = (path: string, init?: RequestInit) => worker.fetch(new Request(`${origin}${path}`, init), { ASSETS }, {});

describe("on Cloudflare Workers", () => {
  beforeAll(async () => {
    await rm(outDir, { recursive: true, force: true });
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "silent",
      build: { outDir },
      plugins: [droplets({ adapter: cloudflare(), renderers: [lit()] })],
    });
    await builder.buildApp();
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
    expect(typeof (globalThis as { HTMLElement?: unknown }).HTMLElement).toBe("undefined");
    worker = ((await import(pathToFileURL(resolve(outDir, "worker.js")).href)) as { default: Worker }).default;
  }, 180_000);

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("bundles Lit's server build, not the browser one", async () => {
    const code = await readFile(resolve(outDir, "worker.js"), "utf8");
    // Under vitest Vite builds with the `development` condition: `node/development/`.
    expect(code).toMatch(/lit-html\/node\/(?:development\/)?lit-html\.js/);
    expect(code).not.toMatch(/lit-html\/(?:development\/)?lit-html\.js/);
    expect(code).toMatch(/@lit\/reactive-element\/node\/(?:development\/)?reactive-element\.js/);
  });

  it("renders a droplet into a declarative shadow root, deferred, its children marker in light DOM", async () => {
    const response = await get("/droplets/hello?who=Ana");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toMatch(
      /<test-lit-hello\s+defer-hydration><template shadowroot="open" shadowrootmode="open"><style>h1 \{ color: rgb\(1, 2, 3\); \}<\/style>/,
    );
    expect(html.replace(/<!--[^>]*-->/g, "")).toContain('<h1 data-testid="greeting">Hello Ana!</h1>');
    expect(html).toMatch(/<\/template><div data-droplet-children style="display: contents"><\/div><\/test-lit-hello>/);
    // `actionUrl`, as the renderer handed it to the element.
    expect(html).toMatch(
      /<form method="post" action="http:\/\/worker\.test\/droplets\/hello\?who=Ana&amp;__droplet_return=[^"]+" data-testid="sign">/,
    );
  });

  it("renders the error page in its own element, with its styles", async () => {
    const response = await get("/droplets/hello?who=crash");
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("data-droplet-error");
    expect(html).toMatch(
      /<test-lit-hello--error\s+defer-hydration><template shadowroot="open" shadowrootmode="open"><style>p \{ color: rgb\(4, 5, 6\); \}<\/style>/,
    );
    expect(html.replace(/<!--[^>]*-->/g, "")).toContain('<p data-testid="error">Sorry, ref 42</p>');
  });

  it("leaves a client-only droplet empty on the server", async () => {
    const html = await (await get("/droplets/frame")).text();
    expect(html).not.toContain("test-lit-frame");
    expect(html).toContain('<div style="display: contents" data-droplet-entry></div>');
  });

  it("runs a form action posted without JavaScript and renders its result", async () => {
    const response = await get("/droplets/hello?who=Bo", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", origin },
      body: "name=Bo",
    });
    expect(response.status).toBe(200);
    expect((await response.text()).replace(/<!--[^>]*-->/g, "")).toContain('<p data-testid="form">Thanks, Bo</p>');
  });
});
