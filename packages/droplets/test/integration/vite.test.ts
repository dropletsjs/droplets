import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder, createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { entryClientPath } from "../../src/core/paths.ts";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const root = fileURLToPath(new URL("../fixtures/app/", import.meta.url));
const outDir = resolve(root, "dist");

/** A minimal adapter: the real ones live in packages/adapters and have their own tests. */
/** The user's own Vite option, as the docs recommend: client only. */
const clientExternal = {
  client: { build: { rolldownOptions: { external: ["case-anything"] } } },
};

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(root, "fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

beforeAll(() => {
  if (!existsSync(entryClientPath)) {
    throw new Error(`Run \`pnpm build\` in packages/droplets first: ${entryClientPath} is missing.`);
  }
});

describe("vite build", () => {
  beforeAll(async () => {
    await rm(outDir, { recursive: true, force: true });
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()], css: { tailwind: true } })],
      environments: clientExternal,
    });
    await builder.buildApp();
  }, 90_000);

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("emits client bundles, the SSR renderer, the server and the manifest", async () => {
    for (const file of [
      "client/droplets.json",
      "client/droplets/hello/client.js",
      "client/index.js",
      "server/entry-server.js",
      "server.js",
    ]) {
      expect(existsSync(resolve(outDir, file)), file).toBe(true);
    }

    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    expect(manifest.__hash).toMatch(/^[0-9a-f]{6}$/);
    // /index.js is a stub of the entry; the entry got the stylesheets.
    expect(manifest.__entryModule).toMatch(/^assets\/index\.[\w-]+\.js$/);
    expect(await readFile(resolve(outDir, "client/index.js"), "utf8")).toBe(`import("./${manifest.__entryModule}");\n`);
    const entry = await readFile(resolve(outDir, "client", manifest.__entryModule), "utf8");
    expect(entry).not.toContain("__DROPLETS_STYLES__");
    const styles = Object.fromEntries(
      Object.entries(manifest.droplets as Record<string, { css?: string[] }>).map(([id, droplet]) => [id, droplet.css]),
    );
    expect(entry).toContain(JSON.stringify(JSON.stringify(styles)).slice(1, -1));
    expect(Object.keys(manifest.droplets).sort()).toEqual(["bare", "docs", "frame", "guestbook", "hello", "static-note"]);
    // The shared stylesheet first, in every droplet's list. Scoped <style>
    // blocks are extracted per droplet, hydrating or not; a droplet with
    // hydrate = false ships no JavaScript at all.
    expect(manifest.droplets["hello"].css).toEqual([manifest.__globalCss]);
    expect(manifest.droplets["static-note"].css).toEqual([manifest.__globalCss, expect.stringMatching(/^assets\/.+\.css$/)]);
    expect(manifest.droplets["static-note"].client).toBeUndefined();
    expect(existsSync(resolve(outDir, "client/droplets/static-note"))).toBe(false);
    // Bundles sit as deep as their URLs, so relative imports resolve when served:
    // /droplets/hello/client.js -> /assets/chunks/…, /assets/index.<hash>.js -> /assets/chunks/….
    const relative = (code: string) =>
      [...code.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)].map((m) => m[1] ?? expect.unreachable("an import path"));
    const helloImports = relative(await readFile(resolve(outDir, "client/droplets/hello/client.js"), "utf8"));
    expect(helloImports.length).toBeGreaterThan(0);
    for (const path of helloImports) expect(new URL(path, "http://x/droplets/hello/client.js").pathname).toMatch(/^\/assets\//);
    for (const path of relative(entry)) expect(new URL(path, `http://x/${manifest.__entryModule}`).pathname).toMatch(/^\/assets\//);
  });

  it("prerenders entries after the schema, through handle, with building on", async () => {
    const index = JSON.parse(await readFile(resolve(outDir, "server/_prerendered/docs/index.json"), "utf8")) as Record<string, string>;
    // Two distinct pages once "1" became 1, and page 99 as its error page;
    // page 404 answered error() and is not stored. Page 5 is stored for its
    // host only.
    expect(Object.keys(index).sort()).toEqual(['{"page":1}', '{"page":2}', '{"page":5} https://fixed.test/docs', '{"page":99}']);
    const render = JSON.parse(await readFile(resolve(outDir, `server/_prerendered/${index['{"page":1}']}`), "utf8"));
    expect(render.html).toContain("<h1>Page 1</h1>");
    // transform runs per request, never at build.
    expect(render.html).toContain("@HOST@");
    // No host at build: tokens of this build, in the data and in the markup.
    expect(render.nonce).toMatch(/^[0-9a-f]{16}$/);
    expect(render.data).toEqual({ page: 1, building: true, hooked: true, home: `__$DROPLET_HOST_${render.nonce}$__/home` });
    expect(render.html).toContain(`<a href="__$DROPLET_HOST_${render.nonce}$__/home">`);
    const fixed = JSON.parse(await readFile(resolve(outDir, `server/_prerendered/${index['{"page":5} https://fixed.test/docs']}`), "utf8"));
    expect(fixed.data).toEqual({ page: 5, building: true, hooked: true, home: "https://fixed.test/home" });
    expect(render.renderId).toMatch(/^[a-z0-9]+$/);
    // Only droplets with prerender = true.
    expect(existsSync(resolve(outDir, "server/_prerendered/hello"))).toBe(false);
    // Server-only: nothing of it in the public client build, nor its directory's name.
    expect(existsSync(resolve(outDir, "client/_prerendered"))).toBe(false);
    expect(JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8")).__prerendered).toBeUndefined();

    const failed = JSON.parse(await readFile(resolve(outDir, `server/_prerendered/${index['{"page":99}']}`), "utf8"));
    expect(failed).toMatchObject({ failed: true, error: { message: "This page is unavailable" } });
    expect(failed.html).toContain('<p data-testid="docs-error">This page is unavailable</p>');
  });

  it("ships the error page with the droplet's bundle", async () => {
    const hello = await readFile(resolve(outDir, "client/droplets/hello/client.js"), "utf8");
    expect(hello).toContain("retry");
    // The renderer's client module, with its children marker, is bundled
    // in: inline or in a shared chunk the droplet imports.
    const { readdir } = await import("node:fs/promises");
    const chunks = await Promise.all(
      (await readdir(resolve(outDir, "client/assets/chunks"))).map((f) => readFile(resolve(outDir, "client/assets/chunks", f), "utf8")),
    );
    expect([hello, ...chunks].some((code) => code.includes('<div data-droplet-children style="display: contents"></div>'))).toBe(true);
    // The error page hydrates with its droplet: in the same bundle.
    const docs = await readFile(resolve(outDir, "client/droplets/docs/client.js"), "utf8");
    expect(docs).toContain("docs-error");
  });

  it("serves stored renders per request and renders other props live", async () => {
    const { createServerApp, createPrerenderedLoader, resolveConfig } = await import("../../src/index.ts");
    const rendersRoot = resolve(outDir, "server/_prerendered");
    const read = async (path: string) => {
      try {
        return await readFile(resolve(rendersRoot, path), "utf8");
      } catch {
        return null;
      }
    };
    const ssr = await import(pathToFileURL(resolve(outDir, "server/entry-server.js")).href);
    const app = createServerApp({
      ssr,
      config: resolveConfig({}),
      assets: {
        buildHash: "x",
        loadClientModule: async () => null,
        loadEntryClient: async () => null,
        entryModule: async () => null,
        loadGlobalStyle: async () => null,
        dropletStyles: async () => [],
        loadIndex: async () => null,
        externals: [],
        assetHandler: (c) => c.text("Not Found", 404),
        loadPrerendered: createPrerenderedLoader(read),
      },
    });
    type PostInput = { props: Record<string, unknown>; host?: string };

    const post = ({ props, host = "https://host.test/docs" }: PostInput) =>
      app.request("http://drops.test/droplets/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host, props }),
      });
    const dataOf = (html: string) => {
      const match = html.match(/data-droplet-data>([^<]+)</)?.[1];
      return match ? JSON.parse(Buffer.from(match, "base64").toString()) : undefined;
    };

    const stored = await (await post({ props: { page: "2" } })).text();
    expect(stored).toContain("<h1>Page 2</h1>");
    expect(stored).toContain("<p>host.test</p>");
    // The tokens, replaced by this request's host before transform ran.
    expect(stored).toContain('<a href="https://host.test/home">');
    expect(stored).not.toContain("DROPLET_");
    expect(dataOf(stored)).toEqual({ data: { page: 2, building: true, hooked: true, home: "https://host.test/home" } });

    const live = await (await post({ props: { page: 3 } })).text();
    expect(live).toContain("<h1>Page 3</h1>");
    expect(dataOf(live)).toEqual({ data: { page: 3, building: false, hooked: true, home: "https://host.test/home" } });

    // A render made for one host is served to that host (origin and path),
    // and rendered live for any other.
    const forHost = await (await post({ props: { page: 5 }, host: "https://fixed.test/docs?ref=x" })).text();
    expect(dataOf(forHost)).toEqual({ data: { page: 5, building: true, hooked: true, home: "https://fixed.test/home" } });
    const elsewhere = await (await post({ props: { page: 5 }, host: "https://fixed.test/other" })).text();
    expect(dataOf(elsewhere)).toEqual({ data: { page: 5, building: false, hooked: true, home: "https://fixed.test/home" } });
    // Without a body host: Origin, then the location; forwarded headers no trusted list names are not one.
    const fromOrigin = await app.request("http://drops.test/droplets/docs?page=2", { headers: { origin: "https://shop.test" } });
    expect(dataOf(await fromOrigin.text())).toMatchObject({ data: { page: 2, home: "https://shop.test/home" } });
    const forwarded = await app.request("http://drops.test/droplets/docs?page=2", {
      headers: { "x-forwarded-host": "shop.test", "x-forwarded-proto": "https" },
    });
    expect(dataOf(await forwarded.text())).toMatchObject({ data: { page: 2, home: "http://drops.test/home" } });

    const refused = await post({ props: { page: "x" } });
    expect(refused.status).toBe(400);

    const broken = await post({ props: { page: 99 } });
    expect(broken.status).toBe(500);
    const brokenHtml = await broken.text();
    expect(brokenHtml).toContain("data-droplet-error");
    expect(brokenHtml).toContain("This page is unavailable");
    // The error page hydrates as docs does: the error inline for the browser.
    expect(dataOf(brokenHtml)).toEqual({ error: { message: "This page is unavailable" } });

    // error() at build was not stored: it answers live, as an endpoint.
    const missing = await post({ props: { page: 404 } });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("No such page");
  });

  it("bundles the adapter entry with the config and manifest baked in", async () => {
    const server = await readFile(resolve(outDir, "server.js"), "utf8");
    // The fake entry imports the three virtual modules; all must be inlined.
    expect(server).toContain("8123");
    expect(server).toContain("__entryClient");
    expect(server).toContain("fake-entry-marker");
    // Nothing virtual is left to resolve at runtime.
    expect(server).not.toMatch(/from "virtual:/);
  });

  it("bundles API routes, hooks and the index page", async () => {
    const ssr = await readFile(resolve(outDir, "server/entry-server.js"), "utf8");
    expect(ssr).toContain("/api/echo/[id]");
    expect(ssr).toContain("x-fixture-hook");
    // Resolved and bundled, not left as an import.
    expect(ssr).not.toMatch(/from ["']\$droplets\/server["']/);

    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    expect(manifest.__index).toContain("Powering Microfrontends");

    // Nothing from the server helpers leaks into browser bundles.
    const client = await readFile(resolve(outDir, "client/droplets/hello/client.js"), "utf8");
    expect(client).not.toContain("droplets.http-error");
  });

  it("leaves the client's externals as imports, and bundles them for the server", async () => {
    const client = await readFile(resolve(outDir, "client/droplets/hello/client.js"), "utf8");
    expect(client).toMatch(/from\s*["']case-anything["']/);
    // The manifest lists what the client left external, for importmap().
    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    expect(manifest.__externals).toEqual(["case-anything"]);
    // The external option is the client's; the server bundle is untouched.
    const ssr = await readFile(resolve(outDir, "server/entry-server.js"), "utf8");
    expect(ssr).toContain('kebabCase("Shared Dep")');
  });

  it("inlines public and static variables, and never writes runtime secrets into a bundle", async () => {
    const ssr = await readFile(resolve(outDir, "server/entry-server.js"), "utf8");
    expect(ssr).toContain("inlined-at-build");
    expect(ssr).not.toContain("from-dotenv");

    const { readdir } = await import("node:fs/promises");
    const clientFiles = await readdir(resolve(outDir, "client"), { recursive: true });
    const clientCode = (
      await Promise.all(clientFiles.filter((f) => f.endsWith(".js")).map((f) => readFile(resolve(outDir, "client", f), "utf8")))
    ).join("\n");
    expect(clientCode).toContain("Fixture");
    // Public but read at runtime: /index.js hands it over, the bundle never has it.
    expect(clientCode).not.toContain("public-at-runtime");
    expect(ssr).not.toContain("public-at-runtime");
    expect(ssr).toContain('"PUBLIC_FIXTURE_RUNTIME"');
    expect(clientCode).not.toContain("inlined-at-build");
    expect(clientCode).not.toContain("from-dotenv");
    expect(clientCode).not.toContain("FIXTURE_SECRET");
  });

  it("refuses to build when a static variable has no value", async () => {
    // A folder without .env files, rather than moving the fixture's: other
    // suites build the same fixture at the same time.
    await expect(
      createBuilder({
        root,
        configFile: false,
        logLevel: "silent",
        envDir: "src/droplets",
        build: { outDir: resolve(root, "dist-missing-env") },
        plugins: [droplets({ adapter: fakeAdapter })],
      }),
    ).rejects.toThrow(/static environment variables without a value: FIXTURE_STATIC, PUBLIC_FIXTURE_NAME/);
  });

  it("refuses to build without an adapter", async () => {
    await expect(
      createBuilder({
        root,
        configFile: false,
        logLevel: "silent",
        build: { outDir: resolve(root, "dist-no-adapter") },
        plugins: [droplets({ renderers: [fakeRenderer()] })],
      }),
    ).rejects.toThrow(/needs an adapter/);
  });

  it("names the renderer to install when none handles a droplet", async () => {
    await expect(
      createBuilder({
        root,
        configFile: false,
        logLevel: "silent",
        build: { outDir: resolve(root, "dist-no-renderer") },
        plugins: [droplets({ adapter: fakeAdapter })],
      }),
    ).rejects.toThrow(/[a-z-]+\/\+droplet\.fake\.js: no renderer for \.fake\.js; add a renderer that handles it to renderers/);
  });
});

describe("vite dev", () => {
  let server: ViteDevServer;
  let origin: string;

  beforeAll(async () => {
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [droplets({ renderers: [fakeRenderer()], css: { tailwind: true } })],
      environments: clientExternal,
      server: { port: 5901, strictPort: false, host: "127.0.0.1" },
    });
    await server.listen();
    origin = server.resolvedUrls?.local[0]?.replace(/\/$/, "") ?? "";
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  it("answers the health check and the index page; there is no page route", async () => {
    const health = await fetch(`${origin}/health`);
    expect(await health.text()).toBe("ok");
    expect(health.headers.get("x-fixture-hook")).toBeNull();

    // No devtools in this server: `/` is the index page, as in production.
    expect(await (await fetch(`${origin}/`)).text()).toContain("Powering Microfrontends");
    expect((await fetch(`${origin}/hello`)).status).toBe(404);
  });

  it("runs hooks.server.ts and passes locals to droplet loads", async () => {
    const res = await fetch(`${origin}/droplets/hello?who=Dev`);
    expect(res.headers.get("x-fixture-hook")).toBe("1");
    const html = await res.text();
    expect(html).toContain("Hello Dev!");
    expect(html).not.toContain("data-droplet-location");
    const data = html.match(/data-droplet-data>([^<]+)</)?.[1];
    expect(data && JSON.parse(Buffer.from(data, "base64").toString())).toEqual({
      data: {
        who: "Dev",
        hooked: true,
        // In dev, runtime variables come from .env, like Vite's own.
        secret: "from-dotenv",
        flag: "inlined-at-build",
      },
    });
    expect(html).toContain('<p data-testid="site">Fixture</p>');
    expect(html).toContain('<p data-testid="dep">shared-dep</p>');
  });

  it("renders the error page, with its head, for a load that throws, through both handleError", async () => {
    const crash = await fetch(`${origin}/droplets/hello?who=crash`);
    expect(crash.status).toBe(500);
    const html = await crash.text();
    expect(html).toContain("data-droplet-error");
    // Server handleError, then the one in +droplet.ts.
    expect(html).toMatch(/<p class="oops" data-testid="error">\[hello\] Sorry, ref 42<\/p>/);
    // What the renderer returned as `head` sits before the markup, in the element.
    expect(html).toMatch(/data-droplet-entry><style>\.oops \{ color: crimson; \}<\/style><p class="oops"/);
    expect(html).toMatch(/data-render-id="[a-z0-9]+"/);
    expect(html).not.toContain("hunter2");
    // Inline: what left the server, before the handleError of +droplet.ts.
    const data = html.match(/data-droplet-data>([^<]+)</)?.[1];
    expect(data && JSON.parse(Buffer.from(data, "base64").toString())).toEqual({
      error: { message: "Sorry, ref 42" },
    });

    const fromData = await fetch(`${origin}/droplets/hello/_data`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { who: "crash" } }),
    });
    expect(fromData.status).toBe(500);
    expect(await fromData.json()).toEqual({ error: { message: "Sorry, ref 42" } });
  });

  it("answers error() and redirect() from a load as an endpoint does", async () => {
    const res = await fetch(`${origin}/droplets/hello?who=nobody`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Nobody is here");
    const data = await fetch(`${origin}/droplets/hello/_data?who=nobody`);
    expect(data.status).toBe(404);
    expect(await data.json()).toEqual({ message: "Nobody is here" });

    const away = await fetch(`${origin}/droplets/hello?who=away`, { redirect: "manual" });
    expect(away.status).toBe(303);
    expect(away.headers.get("location")).toBe("/elsewhere");
  });

  it("renders an empty children marker, in the droplet and its error page", async () => {
    const marker = '<div data-droplet-children style="display: contents"></div>';
    const html = await (await fetch(`${origin}/droplets/hello?who=Dev`)).text();
    expect(html).toContain(`<div data-testid="children">${marker}</div>`);

    const crash = await (await fetch(`${origin}/droplets/hello?who=crash`)).text();
    expect(crash).toContain(`<div data-testid="error-children">${marker}</div>`);

    // Client-only: no markup, the marker appears when the browser mounts.
    const frame = await (await fetch(`${origin}/droplets/frame`)).text();
    expect(frame).not.toContain("data-droplet-children");
    expect(frame).not.toContain("data-render-id");
    expect(frame).toContain('<div style="display: contents" data-droplet-entry></div>');
    // The renderer's client module is served through the droplet's entry.
    const client = await (await fetch(`${origin}/droplets/frame/client.js`)).text();
    expect(client).toContain("fake-renderer/client.js");
  });

  it("renders nothing for a failing droplet without an error page", async () => {
    // The load's promise field is settled before the render and the inline data.
    const bare = await (await fetch(`${origin}/droplets/bare`)).text();
    expect(bare).toContain("bare ok");
    const inline = bare.match(/data-droplet-data>([^<]+)</)?.[1];
    expect(inline && JSON.parse(Buffer.from(inline, "base64").toString())).toEqual({ data: { ok: true } });
    expect(
      await (
        await fetch(`${origin}/droplets/bare/_data`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).json(),
    ).toEqual({ data: { ok: true } });
    // A field that rejects fails the load, as a throw does.
    for (const query of ["crash", "late"]) {
      const res = await fetch(`${origin}/droplets/bare?${query}`);
      expect(res.status).toBe(500);
      expect(await res.text()).toBe("Internal Server Error");
    }
  });

  it("serves +server.ts routes with params, locals and the request URL", async () => {
    const res = await fetch(`${origin}/api/echo/7?q=x`);
    expect(res.headers.get("x-fixture-hook")).toBe("1");
    expect(await res.json()).toEqual({ id: "7", hooked: true, q: "x" });
    const wrong = await fetch(`${origin}/api/echo/7`, { method: "POST" });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET, HEAD");
  });

  it("refuses cross-site form posts and sets cookies from +server.ts", async () => {
    const post = (headers: Record<string, string>) =>
      fetch(`${origin}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
        body: "user=ana",
      });
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    expect((await post({})).status).toBe(403);
    const signedIn = await post({ origin });
    expect(await signedIn.json()).toEqual({ user: "ana" });
    // Plain HTTP to a loopback address: not Secure, so the dev server's cookies work.
    expect(signedIn.headers.getSetCookie()).toEqual(["session=ana; Path=/; HttpOnly; SameSite=Lax"]);
    const read = await fetch(`${origin}/api/session`, { headers: { cookie: "session=ana" } });
    expect(await read.json()).toEqual({ session: "ana" });
  });

  it("renders fragments with props from GET and POST alike", async () => {
    const get = await (await fetch(`${origin}/droplets/hello?who=Dev`)).text();
    expect(get).toContain("Hello Dev!");
    const post = await (
      await fetch(`${origin}/droplets/hello`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ props: { who: "Posted" } }),
      })
    ).text();
    expect(post).toContain("Hello Posted!");
    expect(post.startsWith("<test-droplet ")).toBe(true);
  });

  it("transforms the client module and the entry client", async () => {
    const client = await (await fetch(`${origin}/droplets/hello/client.js`)).text();
    expect(client).toContain("/src/droplets/hello/+droplet.fake.js");
    expect(client).toContain("hydrate");

    // In dev, Vite serves app.css itself; the scoping plugin runs there too.
    const appCss = await (await fetch(`${origin}/src/app.css?direct`)).text();
    expect(appCss).toContain("test-droplet .p-4");
    expect(appCss).not.toMatch(/(^|[}\s,])(:root|html|body)\s*[,{]/);

    // The external is not pre-bundled into the droplet in dev either.
    const component = await (await fetch(`${origin}/src/droplets/hello/+droplet.fake.js`)).text();
    expect(component).toMatch(/from\s*["'](\/@id\/)?case-anything["']/);
    expect(component).not.toContain(".vite/deps/case-anything");

    const entry = await (await fetch(`${origin}/index.js`)).text();
    expect(entry).toContain("/@fs/");
    expect(entry).toContain("entry-client.js");

    const style = await (await fetch(`${origin}/index.css`)).text();
    expect(style).toBe('@import "/src/app.css";\n');

    // Component styles come with the JavaScript in dev: nothing to link or preload.
    const fragment = await fetch(`${origin}/droplets/static-note`);
    expect(fragment.headers.get("link")).toBeNull();
    expect(await fragment.text()).not.toContain("data-droplet-style");
    expect((await fetch(`${origin}/droplets/static-note/style.css`)).status).toBe(404);
  });

  it("records where the dev /index.js came from, so a host page on another origin loads from the dev server", async () => {
    const code = await (await fetch(`${origin}/index.js`)).text();
    // A module script on https://host.example/page: `import.meta.url` is the dev server's /index.js.
    const servers = Symbol.for("droplets.servers");
    const global = globalThis as unknown as Record<symbol, Record<string, { origin?: string }> | undefined>;
    const imported: string[] = [];
    delete global[servers];
    try {
      vi.stubGlobal("location", new URL("https://host.example/page"));
      const meta = { url: `${origin}/index.js` };
      new Function("meta", "load", code.replaceAll("import.meta", "meta").replace(/\bimport\(/g, "load("))(meta, (specifier: string) =>
        imported.push(new URL(specifier, meta.url).href),
      );
      const records = Object.values(global[servers] ?? {});
      expect(records.map((record) => record.origin)).toEqual([origin]);
      expect(imported.map((url) => new URL(url).origin)).toEqual([origin]);
      // Where the element then loads the droplet's JavaScript and data from: the dev server.
      const location = records[0]?.origin ?? expect.unreachable("the dev server's record");
      expect((await fetch(`${location}/droplets/hello/client.js`)).status).toBe(200);
      expect((await fetch(`${location}/droplets/hello/_data?who=Host`)).status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
      delete global[servers];
    }
  });

  it("serves the import map from importmap.server.ts, with Vite's /@id/ spelling in dev", async () => {
    // Externals are known once a droplet that imports one has been served.
    await fetch(`${origin}/src/droplets/hello/+droplet.fake.js`);
    const block = await (await fetch(`${origin}/importmap`, { method: "POST" })).text();
    const json = block.match(/^<script type="importmap">(.*)<\/script>$/)?.[1];
    expect(json && JSON.parse(json)).toEqual({
      imports: {
        "case-anything": "https://cdn.test/npm/case-anything@0.0.1/+esm",
        "/@id/case-anything": "https://cdn.test/npm/case-anything@0.0.1/+esm",
      },
    });
    expect(await (await fetch(`${origin}/importmap.js`)).text()).toContain('script.type = "importmap"');
  });

  it("validates props with the schema in +droplet.ts and runs transform", async () => {
    const res = await fetch(`${origin}/droplets/docs?page=2`);
    const html = await res.text();
    expect(html).toContain("<h1>Page 2</h1>");
    expect(html).toContain(`<p>${new URL(origin).host}</p>`);
    const context = html.match(/data-droplet-context>([^<]+)</)?.[1];
    expect(context && JSON.parse(Buffer.from(context, "base64").toString()).props).toEqual({ page: 2 });

    const refused = await fetch(`${origin}/droplets/docs?page=x`);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe("Invalid props: page: Expected a page number");
  });

  it("404s unknown droplets", async () => {
    expect((await fetch(`${origin}/droplets/missing`)).status).toBe(404);
    expect((await fetch(`${origin}/api/missing`)).status).toBe(404);
  });
});
