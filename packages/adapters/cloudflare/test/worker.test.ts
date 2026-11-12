import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixture, FIXTURE_ROOT } from "./build-fixture.ts";

const outDir = resolve(FIXTURE_ROOT, "dist-cloudflare-worker");

const TYPES = new Map([
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".json", "application/json"],
]);

type FakeAssetsInput = { clientRoot: string };

/** A stand-in for the Workers Static Assets binding, backed by dist/client. */
function fakeAssets({ clientRoot }: FakeAssetsInput) {
  return {
    async fetch(input: Request | string | URL): Promise<Response> {
      const url = new URL(input instanceof Request ? input.url : String(input));
      try {
        const body = await readFile(resolve(clientRoot, `.${url.pathname}`));
        return new Response(body, {
          headers: {
            "content-type": TYPES.get(extname(url.pathname)) ?? "application/octet-stream",
            "x-served-by": "assets-binding",
          },
        });
      } catch {
        // Missing or a directory: the binding's own 404 page.
        return new Response("<h1>binding 404</h1>", { status: 404, headers: { "content-type": "text/html" } });
      }
    },
  };
}

type Worker = {
  default: { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> | Response };
};

type CallInput = { path: string; init?: RequestInit };

type Bindings = Record<string, unknown>;

type PostInput = { origin: string; bindings: Bindings };

type RenderInput = { bindings: Bindings };

type OwnInput = { init?: RequestInit };

describe("worker", () => {
  let worker: Worker;
  const env = { ASSETS: fakeAssets({ clientRoot: resolve(outDir, "client") }), FIXTURE_SECRET: "from-binding" };
  const call = ({ path, init }: CallInput) => worker.default.fetch(new Request(`http://drops.test${path}`, init), env, {});

  beforeAll(async () => {
    await buildFixture({ outDir });
    worker = (await import(pathToFileURL(resolve(outDir, "worker.js")).href)) as Worker;
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("renders fragments, never the dev page", async () => {
    const hello = await call({ path: "/droplets/hello?who=Worker" });
    expect(hello.status).toBe(200);
    const html = await hello.text();
    expect(html).toContain('data-testid="greeting">Hello Worker!</h1>');
    expect(html.startsWith('<test-droplet data-droplet="hello"')).toBe(true);
    expect((await call({ path: "/hello" })).status).toBe(404);

    const fragment = await (await call({ path: "/droplets/static-note" })).text();
    expect(fragment).toContain("Rendered on the server only.");

    expect((await call({ path: "/nope" })).status).toBe(404);
    expect(await (await call({ path: "/health" })).text()).toBe("ok");
    expect(await (await call({ path: "/" })).text()).toContain("Powering Microfrontends");
  });

  it("runs hooks and API routes, with the bindings on platform.env", async () => {
    const echo = await call({ path: "/api/echo/9?q=w" });
    expect(echo.headers.get("x-fixture-hook")).toBe("1");
    expect(await echo.json()).toEqual({ id: "9", hooked: true, q: "w" });
    expect(await (await call({ path: "/api/platform" })).json()).toEqual({ env: ["ASSETS", "FIXTURE_SECRET"] });

    const missing = await call({ path: "/droplets/hello?who=nobody" });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Nobody is here");
    const crash = await call({ path: "/droplets/hello?who=crash" });
    expect(crash.status).toBe(500);
    expect(await crash.text()).toContain("[hello] Sorry, ref 42");
  });

  it("reads runtime secrets from the Worker's bindings", async () => {
    const html = await (await call({ path: "/droplets/hello" })).text();
    const data = html.match(/data-droplet-payload="data">([^<]+)</)?.[1];
    const decoded = data && JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    expect(decoded.data).toMatchObject({ secret: "from-binding", flag: "inlined-at-build" });
    const source = await readFile(resolve(outDir, "worker.js"), "utf8");
    expect(source).not.toContain("from-dotenv");
  });

  it("answers /env.js with the public runtime variables of the bindings, never a secret", async () => {
    const bindings = { ...env, PUBLIC_FIXTURE_RUNTIME: "from-binding-public", DROPLETS_ENV_MAX_AGE: "60" };
    const res = await worker.default.fetch(new Request("http://drops.test/env.js"), bindings, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const code = await res.text();
    expect(code).toContain('.env = {"PUBLIC_FIXTURE_RUNTIME":"from-binding-public"};');
    expect(code).not.toContain('from-binding"');
  });

  it("reads prerendered renders through the assets binding, never from the bundle", async () => {
    const docs = await (await call({ path: "/droplets/docs?page=2" })).text();
    expect(docs).toContain("<h1>Page 2</h1>");
    const data = docs.match(/data-droplet-payload="data">([^<]+)</)?.[1];
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
    // With the Worker first, it serves none of them either.
    for (const path of [
      "/droplets.json",
      "/.vite/manifest.json",
      "/_prerendered/docs/index.json",
      `/${manifest.__prerendered}/docs/index.json`,
      `/assets/../${manifest.__prerendered}/docs/index.json`,
      `/assets/%2e%2e/${manifest.__prerendered}/docs/index.json`,
    ]) {
      expect((await call({ path })).status, path).toBe(404);
    }
  });

  it("serves bundles and styles through the assets binding", async () => {
    const bundle = await call({ path: "/droplets/hello/client.js" });
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("content-type")).toContain("javascript");
    expect(bundle.headers.get("cache-control")).toContain("immutable");

    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    // /index.js is the stub, never cached; the entry it imports is cached for good.
    const entry = await call({ path: "/index.js" });
    expect(entry.headers.get("cache-control")).toBe("no-store");
    expect(await entry.text()).toContain(`import "./${manifest.__entryModule}";\n`);
    const module = await call({ path: `/${manifest.__entryModule}` });
    expect(module.headers.get("cache-control")).toContain("immutable");
    expect(module.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await module.text()).toContain("test-droplet");

    const globalCss = await call({ path: "/index.css" });
    expect(globalCss.headers.get("cache-control")).toBe("no-store");
    expect(await globalCss.text()).toBe(`@import url("./${manifest.__globalCss}");\n`);
    const style = await (await call({ path: "/droplets/static-note/style.css" })).text();
    expect(style).toBe(manifest.droplets["static-note"].css.map((file: string) => `@import url("../../${file}");\n`).join(""));
    const sheet = await call({ path: `/${manifest.droplets["static-note"].css.at(-1)}` });
    expect(await sheet.text()).toContain("font-style");
    expect((await call({ path: "/droplets/static-note/client.js" })).status).toBe(404);
    // The shared stylesheet first, even for a droplet with none of its own.
    expect(await (await call({ path: "/droplets/hello/style.css" })).text()).toBe(`@import url("../../${manifest.__globalCss}");\n`);

    const asset = await call({ path: `/assets/${manifest.__globalCss.replace(/^assets\//, "")}` });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("x-served-by")).toBe("assets-binding");
  });

  it("answers a missing file with a text Not Found and no-store, never the binding's own 404", async () => {
    for (const path of ["/assets/missing.js", "/assets/public/missing.txt"]) {
      const res = await call({ path });
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toBe("Not Found");
      expect(res.headers.get("content-type"), path).toContain("text/plain");
      expect(res.headers.get("cache-control"), path).toBe("no-store");
    }
    // Any other failure of the binding passes through, with no-store.
    const failing = { fetch: async () => new Response("binding down", { status: 503, headers: { "retry-after": "5" } }) };
    const res = await worker.default.fetch(new Request("http://drops.test/assets/x.js"), { ...env, ASSETS: failing }, {});
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("binding down");
    expect(res.headers.get("retry-after")).toBe("5");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("serves public/ at /assets/public/, revalidated: no-cache, an ETag, 304 when it matches", async () => {
    const res = await call({ path: "/assets/public/robots.txt" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("User-agent: *\n");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const etag = res.headers.get("etag") ?? expect.unreachable("an etag");
    expect(etag).toMatch(/^"[\w-]+"$/);
    const again = await call({ path: "/assets/public/robots.txt", init: { headers: { "if-none-match": etag } } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect((await call({ path: "/robots.txt" })).status).toBe(404);

    // The binding's own ETag and 304 when it has them.
    const binding = {
      fetch: async (input: Request) =>
        input.headers.get("if-none-match") === '"cf"'
          ? new Response(null, { status: 304, headers: { etag: '"cf"' } })
          : new Response("file", { headers: { etag: '"cf"', "cache-control": "public, max-age=14400" } }),
    };
    const own = ({ init }: OwnInput = {}) =>
      worker.default.fetch(new Request("http://drops.test/assets/public/a.txt", init), { ...env, ASSETS: binding }, {});
    const first = await own();
    expect(first.headers.get("etag")).toBe('"cf"');
    expect(first.headers.get("cache-control")).toBe("no-cache");
    const matched = await own({ init: { headers: { "if-none-match": '"cf"' } } });
    expect(matched.status).toBe(304);
    expect(matched.headers.get("cache-control")).toBe("no-cache");
  });

  it("never runs handle for /index.js or /assets/*, and runs it for /droplets/*", async () => {
    expect((await call({ path: "/index.js" })).headers.get("x-fixture-hook")).toBeNull();
    expect((await call({ path: "/assets/public/robots.txt" })).headers.get("x-fixture-hook")).toBeNull();
    expect((await call({ path: "/droplets/hello" })).headers.get("x-fixture-hook")).toBe("1");
  });

  it("finds only droplets in the manifest, never prototype members", async () => {
    for (const id of ["__proto__", "constructor", "toString"]) {
      expect((await call({ path: `/droplets/${id}/client.js` })).status, id).toBe(404);
      expect((await call({ path: `/droplets/${id}` })).status, id).toBe(404);
    }
  });

  it("trusts the origins in a DROPLETS_TRUSTED_ORIGINS binding", async () => {
    const post = ({ origin, bindings }: PostInput) =>
      worker.default.fetch(
        new Request("http://drops.test/api/echo/1", {
          method: "POST",
          headers: { origin, "content-type": "application/x-www-form-urlencoded" },
          body: "a=1",
        }),
        { ...env, ...bindings },
        {},
      );
    expect((await post({ origin: "https://shop.test", bindings: {} })).status).toBe(403);
    // Past the check: the route has no POST.
    expect(
      (await post({ origin: "https://shop.test", bindings: { DROPLETS_TRUSTED_ORIGINS: "https://shop.test,https://two.test" } })).status,
    ).toBe(405);
  });

  it("ignores a client's X-Forwarded-Host unless a DROPLETS_TRUSTED_ORIGINS binding lists it", async () => {
    const render = async ({ bindings }: RenderInput) =>
      (
        await worker.default.fetch(
          new Request("http://drops.test/droplets/hello?who=W", {
            headers: { "x-forwarded-host": "shop.test", "x-forwarded-proto": "https", "x-forwarded-prefix": "/mfe" },
          }),
          { ...env, ...bindings },
          {},
        )
      ).text();
    const forged = await render({ bindings: {} });
    expect(forged).not.toContain("shop.test");
    expect(forged).toContain("http://drops.test/droplets/hello/");
    const listed = await render({ bindings: { DROPLETS_TRUSTED_ORIGINS: "https://shop.test" } });
    expect(listed).toContain("https://shop.test/mfe/droplets/hello/");
    expect(listed).not.toContain("http://drops.test/droplets/hello/");
  });

  it("applies the bundled config", async () => {
    const res = await call({ path: "/", init: { headers: { origin: "http://other.test" } } });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("fails clearly without the assets binding", async () => {
    await expect(Promise.resolve().then(() => worker.default.fetch(new Request("http://drops.test/"), {}, {}))).rejects.toThrow(
      /no "ASSETS" binding/,
    );
  });
});

describe("worker without a shared stylesheet", () => {
  const plainDir = resolve(FIXTURE_ROOT, "dist-cloudflare-worker-no-css");
  let worker: Worker;
  const env = { ASSETS: fakeAssets({ clientRoot: resolve(plainDir, "client") }) };
  const call = ({ path }: CallInput) => worker.default.fetch(new Request(`http://drops.test${path}`), env, {});

  beforeAll(async () => {
    await buildFixture({ outDir: plainDir, css: { path: false } });
    worker = (await import(pathToFileURL(resolve(plainDir, "worker.js")).href)) as Worker;
  });

  afterAll(async () => {
    await rm(plainDir, { recursive: true, force: true });
  });

  it("serves no stylesheet that has nothing in it, and links none", async () => {
    expect((await call({ path: "/index.css" })).status).toBe(404);
    expect((await call({ path: "/droplets/hello/style.css" })).status).toBe(404);
    expect((await call({ path: "/droplets/static-note/style.css" })).status).toBe(200);
    expect((await call({ path: "/droplets-css.js" })).status).toBe(404);
    const fragment = await call({ path: "/droplets/hello?who=Worker" });
    expect(await fragment.text()).not.toContain("data-droplet-style");
    expect(fragment.headers.get("link") ?? "").not.toContain(".css");
    expect(await (await call({ path: "/droplets/docs?page=2" })).text()).not.toContain("style.css");
  });
});

describe("worker with publicCacheControl", () => {
  for (const [name, value, expected] of [
    ["an hour", '"public, max-age=3600"', "public, max-age=3600"],
    ["false", "false", null],
  ] as const) {
    describe(name, () => {
      const dir = resolve(FIXTURE_ROOT, `dist-cloudflare-worker-public-${name.replace(/\W/g, "")}`);
      const configFile = resolve(FIXTURE_ROOT, `droplets.public-${name.replace(/\W/g, "")}.config.ts`);
      let worker: Worker;
      const env = { ASSETS: fakeAssets({ clientRoot: resolve(dir, "client") }) };
      const call = ({ path, init }: CallInput) => worker.default.fetch(new Request(`http://drops.test${path}`, init), env, {});

      beforeAll(async () => {
        await writeFile(configFile, `export default { element: "test-droplet", publicCacheControl: ${value} };\n`);
        try {
          await buildFixture({ outDir: dir, configFile });
        } finally {
          await rm(configFile, { force: true });
        }
        worker = (await import(pathToFileURL(resolve(dir, "worker.js")).href)) as Worker;
      });

      afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
      });

      it("sends it for /assets/public/* when the Worker answers, keeping the ETag and 304", async () => {
        const res = await call({ path: "/assets/public/robots.txt" });
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe(expected);
        const etag = res.headers.get("etag") ?? expect.unreachable("an etag");
        expect((await call({ path: "/assets/public/robots.txt", init: { headers: { "if-none-match": etag } } })).status).toBe(304);
        const manifest = JSON.parse(await readFile(resolve(dir, "client/droplets.json"), "utf8"));
        expect((await call({ path: `/${manifest.__entryModule}` })).headers.get("cache-control")).toBe(
          "public, max-age=2592000, immutable",
        );
      });
    });
  }
});

describe("worker with a function-form droplets.config.ts", () => {
  const configs = {
    sync: `export default ({ command, mode, isPreview }) => ({
  element: command === "build" && mode === "production" && !isPreview ? "test-droplet" : "wrong-env",
  cors: { origin: (origin) => origin },
});
`,
    async: `export default async ({ command, mode, isPreview }) => {
  await new Promise((wake) => setTimeout(wake, 5));
  return {
    element: command === "build" && mode === "production" && !isPreview ? "test-droplet" : "wrong-env",
    cors: { origin: (origin) => origin },
  };
};
`,
  } as const;

  for (const [form, source] of Object.entries(configs)) {
    describe(form, () => {
      const dir = resolve(FIXTURE_ROOT, `dist-cloudflare-worker-config-${form}`);
      const configFile = resolve(FIXTURE_ROOT, `droplets.worker-${form}.config.ts`);
      let worker: Worker;
      const env = { ASSETS: fakeAssets({ clientRoot: resolve(dir, "client") }) };
      const call = ({ path, init }: CallInput) => worker.default.fetch(new Request(`http://drops.test${path}`, init), env, {});

      beforeAll(async () => {
        await writeFile(configFile, source);
        try {
          await buildFixture({ outDir: dir, configFile });
        } finally {
          await rm(configFile, { force: true });
        }
        worker = (await import(pathToFileURL(resolve(dir, "worker.js")).href)) as Worker;
      });

      afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
      });

      it("calls it in the Worker with the build's config env and keeps the functions inside the config", async () => {
        const bundle = await readFile(resolve(dir, "worker.js"), "utf8");
        expect(bundle).toMatch(/"command":\s*"build"/);
        expect(bundle).toMatch(/"mode":\s*"production"/);
        expect(bundle).not.toMatch(/^await /m);
        const fragment = await call({ path: "/droplets/hello?who=Config", init: { headers: { origin: "http://other.test" } } });
        expect(fragment.status).toBe(200);
        expect((await fragment.text()).startsWith('<test-droplet data-droplet="hello"')).toBe(true);
        expect(fragment.headers.get("access-control-allow-origin")).toBe("http://other.test");
      });
    });
  }
});
