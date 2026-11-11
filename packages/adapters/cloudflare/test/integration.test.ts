import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fakeRenderer } from "@dropletsjs/droplets/testing";
import { droplets } from "@dropletsjs/droplets/vite";
import { createBuilder } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloudflare } from "../src/index.ts";

// The framework's own fixture (fake renderer, see @dropletsjs/droplets/testing), element "test-droplet".
const root = fileURLToPath(new URL("../../../droplets/test/fixtures/app/", import.meta.url));
const outDir = resolve(root, "dist-cloudflare");

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

/** A stand-in for the Workers Static Assets binding, backed by dist/client. */
function fakeAssets(clientRoot: string) {
  return {
    async fetch(input: Request | string | URL): Promise<Response> {
      const url = new URL(input instanceof Request ? input.url : String(input));
      try {
        const body = await readFile(resolve(clientRoot, `.${url.pathname}`));
        return new Response(body, {
          headers: {
            "content-type": TYPES[extname(url.pathname)] ?? "application/octet-stream",
            "x-served-by": "assets-binding",
          },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    },
  };
}

type Worker = {
  default: { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> | Response };
};

describe("cloudflare adapter", () => {
  let worker: Worker;
  const env = { ASSETS: fakeAssets(resolve(outDir, "client")), FIXTURE_SECRET: "from-binding" };
  const call = (path: string, init?: RequestInit) => worker.default.fetch(new Request(`http://drops.test${path}`, init), env, {});

  beforeAll(async () => {
    if (!existsSync(resolve(root, "../../../dist/vite.js"))) {
      throw new Error("Build @dropletsjs/droplets first (pnpm build at the root).");
    }
    await rm(outDir, { recursive: true, force: true });
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "silent",
      build: { outDir },
      plugins: [droplets({ adapter: cloudflare(), renderers: [fakeRenderer()], css: { tailwind: true } })],
    });
    await builder.buildApp();
    worker = (await import(pathToFileURL(resolve(outDir, "worker.js")).href)) as Worker;
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("emits one self-contained worker.js and no separate SSR bundle", async () => {
    expect(existsSync(resolve(outDir, "worker.js"))).toBe(true);
    expect(existsSync(resolve(outDir, "server.js"))).toBe(false);
    expect(existsSync(resolve(outDir, "server/entry-server.js"))).toBe(false);
    const source = await readFile(resolve(outDir, "worker.js"), "utf8");
    expect(source).not.toMatch(/^import /m);
    // Nothing from Node may be imported by core or the fake renderer. (An
    // engine may add some: Svelte's server renderer lazily imports
    // node:async_hooks, which Workers provide under nodejs_compat. Core asks
    // for it through process.getBuiltinModule, which is not an import.)
    const nodeModules = new Set(
      [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']node:([a-z_/]+)["']/g)].map((m) => m[1]),
    );
    expect([...nodeModules].sort()).toEqual([]);
    // The manifest and the config are baked in.
    expect(source).toContain("__entryClient");
    expect(source).toContain("test-droplet");
  });

  it("renders fragments, never the dev page", async () => {
    const hello = await call("/droplets/hello?who=Worker");
    expect(hello.status).toBe(200);
    const html = await hello.text();
    expect(html).toContain('data-testid="greeting">Hello Worker!</h1>');
    expect(html.startsWith('<test-droplet data-droplet="hello"')).toBe(true);
    expect((await call("/hello")).status).toBe(404);

    const fragment = await (await call("/droplets/static-note")).text();
    expect(fragment).toContain("Rendered on the server only.");

    expect((await call("/nope")).status).toBe(404);
    expect(await (await call("/health")).text()).toBe("ok");
    expect(await (await call("/")).text()).toContain("Powering Microfrontends");
  });

  it("runs hooks and API routes, with the bindings on platform.env", async () => {
    const echo = await call("/api/echo/9?q=w");
    expect(echo.headers.get("x-fixture-hook")).toBe("1");
    expect(await echo.json()).toEqual({ id: "9", hooked: true, q: "w" });
    expect(await (await call("/api/platform")).json()).toEqual({ env: ["ASSETS", "FIXTURE_SECRET"] });

    const missing = await call("/droplets/hello?who=nobody");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Nobody is here");
    const crash = await call("/droplets/hello?who=crash");
    expect(crash.status).toBe(500);
    expect(await crash.text()).toContain("[hello] Sorry, ref 42");
  });

  it("reads runtime secrets from the Worker's bindings", async () => {
    const html = await (await call("/droplets/hello")).text();
    const data = html.match(/data-droplet-data>([^<]+)</)?.[1];
    const decoded = data && JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    expect(decoded.data).toMatchObject({ secret: "from-binding", flag: "inlined-at-build" });
    const source = await readFile(resolve(outDir, "worker.js"), "utf8");
    expect(source).not.toContain("from-dotenv");
  });

  it("reads prerendered renders through the assets binding, never from the bundle", async () => {
    const docs = await (await call("/droplets/docs?page=2")).text();
    expect(docs).toContain("<h1>Page 2</h1>");
    const data = docs.match(/data-droplet-data>([^<]+)</)?.[1];
    expect(data && JSON.parse(Buffer.from(data, "base64").toString("utf8"))).toEqual({
      data: { page: 2, building: true, hooked: true, home: "http://drops.test/home" },
    });
    const source = await readFile(resolve(outDir, "worker.js"), "utf8");
    expect(source).not.toContain("<h1>Page 2</h1>");
  });

  it("keeps the prerendered renders at no URL one could guess, whatever the assets config", async () => {
    // The assets hold them (the Worker reads them through its binding), in a
    // directory named anew every build; only the inlined manifest has the name.
    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    expect(manifest.__prerendered).toMatch(/^_prerendered\/[0-9a-f]{32}$/);
    expect(existsSync(resolve(outDir, "client", manifest.__prerendered, "docs/index.json"))).toBe(true);
    expect(existsSync(resolve(outDir, "client/_prerendered/docs"))).toBe(false);
    expect(await readdir(resolve(outDir, "client/_prerendered"))).toEqual([manifest.__prerendered.split("/")[1]]);
    // The manifest, which holds the name, and Vite's are never uploaded: a
    // deploy that serves assets before the Worker cannot hand them out.
    expect(await readFile(resolve(outDir, "client/.assetsignore"), "utf8")).toBe("/droplets.json\n/.vite/\n");
    // With the Worker first, it serves none of them either.
    for (const path of [
      "/droplets.json",
      "/.vite/manifest.json",
      "/_prerendered/docs/index.json",
      `/${manifest.__prerendered}/docs/index.json`,
      `/assets/../${manifest.__prerendered}/docs/index.json`,
      `/assets/%2e%2e/${manifest.__prerendered}/docs/index.json`,
    ]) {
      expect((await call(path)).status, path).toBe(404);
    }
  });

  it("serves bundles and styles through the assets binding", async () => {
    const bundle = await call("/droplets/hello/client.js");
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("content-type")).toContain("javascript");
    expect(bundle.headers.get("cache-control")).toContain("immutable");

    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    // /index.js is the stub, never cached; the entry it imports is cached for good.
    const entry = await call("/index.js");
    expect(entry.headers.get("cache-control")).toBe("no-store");
    expect((await entry.text()).endsWith(`import("./${manifest.__entryModule}");\n`)).toBe(true);
    const module = await call(`/${manifest.__entryModule}`);
    expect(module.headers.get("cache-control")).toContain("immutable");
    expect(await module.text()).toContain("test-droplet");

    expect(await (await call("/index.css")).text()).toContain("test-droplet .p-4");
    const style = await (await call("/droplets/static-note/style.css")).text();
    expect(style).toBe(manifest.droplets["static-note"].css.map((file: string) => `@import url("../../${file}");\n`).join(""));
    const sheet = await call(`/${manifest.droplets["static-note"].css.at(-1)}`);
    expect(await sheet.text()).toContain("font-style");
    expect((await call("/droplets/static-note/client.js")).status).toBe(404);
    // The shared stylesheet first, even for a droplet with none of its own.
    expect(await (await call("/droplets/hello/style.css")).text()).toBe(`@import url("../../${manifest.__globalCss}");\n`);

    const asset = await call(`/assets/${manifest.__globalCss.replace(/^assets\//, "")}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("x-served-by")).toBe("assets-binding");
  });

  it("serves public/ at /assets/public/, revalidated: no-cache, an ETag, 304 when it matches", async () => {
    const res = await call("/assets/public/robots.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("User-agent: *\n");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const etag = res.headers.get("etag") ?? expect.unreachable("an etag");
    expect(etag).toMatch(/^"[\w-]+"$/);
    const again = await call("/assets/public/robots.txt", { headers: { "if-none-match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect((await call("/robots.txt")).status).toBe(404);

    // The binding's own ETag and 304 when it has them.
    const binding = {
      fetch: async (input: Request) =>
        input.headers.get("if-none-match") === '"cf"'
          ? new Response(null, { status: 304, headers: { etag: '"cf"' } })
          : new Response("file", { headers: { etag: '"cf"', "cache-control": "public, max-age=14400" } }),
    };
    const own = (init?: RequestInit) =>
      worker.default.fetch(new Request("http://drops.test/assets/public/a.txt", init), { ...env, ASSETS: binding }, {});
    const first = await own();
    expect(first.headers.get("etag")).toBe('"cf"');
    expect(first.headers.get("cache-control")).toBe("no-cache");
    const matched = await own({ headers: { "if-none-match": '"cf"' } });
    expect(matched.status).toBe(304);
    expect(matched.headers.get("cache-control")).toBe("no-cache");
  });

  it("never runs handle for /index.js or /assets/*, and runs it for /droplets/*", async () => {
    expect((await call("/index.js")).headers.get("x-fixture-hook")).toBeNull();
    expect((await call("/assets/public/robots.txt")).headers.get("x-fixture-hook")).toBeNull();
    expect((await call("/droplets/hello")).headers.get("x-fixture-hook")).toBe("1");
  });

  it("finds only droplets in the manifest, never prototype members", async () => {
    for (const id of ["__proto__", "constructor", "toString"]) {
      expect((await call(`/droplets/${id}/client.js`)).status, id).toBe(404);
      expect((await call(`/droplets/${id}`)).status, id).toBe(404);
    }
  });

  it("trusts the origins in a DROPLETS_TRUSTED_ORIGINS binding", async () => {
    const post = (origin: string, bindings: Record<string, unknown>) =>
      worker.default.fetch(
        new Request("http://drops.test/api/echo/1", {
          method: "POST",
          headers: { origin, "content-type": "application/x-www-form-urlencoded" },
          body: "a=1",
        }),
        { ...env, ...bindings },
        {},
      );
    expect((await post("https://shop.test", {})).status).toBe(403);
    // Past the check: the route has no POST.
    expect((await post("https://shop.test", { DROPLETS_TRUSTED_ORIGINS: "https://shop.test,https://two.test" })).status).toBe(405);
  });

  it("ignores a client's X-Forwarded-Host unless a DROPLETS_ORIGIN binding lists it", async () => {
    const render = async (bindings: Record<string, unknown>) =>
      (
        await worker.default.fetch(
          new Request("http://drops.test/droplets/hello?who=W", {
            headers: { "x-forwarded-host": "shop.test", "x-forwarded-proto": "https", "x-forwarded-prefix": "/mfe" },
          }),
          { ...env, ...bindings },
          {},
        )
      ).text();
    const forged = await render({});
    expect(forged).not.toContain("shop.test");
    expect(forged).toContain("http://drops.test/droplets/hello/");
    const listed = await render({ DROPLETS_ORIGIN: "https://shop.test" });
    expect(listed).toContain("https://shop.test/mfe/droplets/hello/");
    expect(listed).not.toContain("http://drops.test/droplets/hello/");
  });

  it("applies the bundled config", async () => {
    const res = await call("/", { headers: { origin: "http://other.test" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("fails clearly without the assets binding", async () => {
    await expect(Promise.resolve().then(() => worker.default.fetch(new Request("http://drops.test/"), {}, {}))).rejects.toThrow(
      /no "ASSETS" binding/,
    );
  });
});
