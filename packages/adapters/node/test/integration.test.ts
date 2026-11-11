import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveConfig } from "@dropletsjs/droplets";
import { fakeRenderer } from "@dropletsjs/droplets/testing";
import { droplets } from "@dropletsjs/droplets/vite";
import { createBuilder } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNodeServerApp, node } from "../src/index.ts";

// The framework's own fixture (fake renderer, see @dropletsjs/droplets/testing), element "test-droplet".
const root = fileURLToPath(new URL("../../../droplets/test/fixtures/app/", import.meta.url));
const outDir = resolve(root, "dist-node");

const decode = (b64: string) => JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Record<string, unknown>;

describe("node adapter", () => {
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
      plugins: [droplets({ adapter: node(), renderers: [fakeRenderer()], css: { tailwind: true } })],
    });
    await builder.buildApp();
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("emits server.js next to the SSR bundle, with only node: imports left", async () => {
    expect(existsSync(resolve(outDir, "server.js"))).toBe(true);
    expect(existsSync(resolve(outDir, "server/entry-server.js"))).toBe(true);
    const server = await readFile(resolve(outDir, "server.js"), "utf8");
    const bare = [...server.matchAll(/^import .* from "([^"]+)";?$/gm)].map((m) => m[1]);
    expect(bare.every((spec) => spec?.startsWith("node:"))).toBe(true);
    // The user's config is baked in, so no droplets.config.ts is read at runtime.
    expect(server).toContain("8123");
  });

  it("serves the build", async () => {
    const app = await createNodeServerApp(
      {
        clientRoot: resolve(outDir, "client"),
        ssrEntryUrl: pathToFileURL(resolve(outDir, "server/entry-server.js")).href,
      },
      resolveConfig({ cors: true, element: "test-droplet" }),
    );

    const fragment = await app.request("http://drops.test/droplets/hello?who=Node");
    expect(fragment.status).toBe(200);
    const html = await fragment.text();
    expect(html).toContain('data-testid="greeting">Hello Node!</h1>');
    expect(html.startsWith('<test-droplet data-droplet="hello"')).toBe(true);
    const data = html.match(/data-droplet-data>([^<]+)</)?.[1];
    // Runtime secrets come from process.env in production; .env is a build input.
    expect(data && (decode(data) as { data: unknown }).data).toEqual({ who: "Node", hooked: true, secret: null, flag: "inlined-at-build" });
    // The full page exists only under `vite dev`.
    expect((await app.request("/hello")).status).toBe(404);

    // Prerendered renders are read from dist/server/_prerendered, per request.
    const docs = await (await app.request("http://drops.test/droplets/docs?page=2")).text();
    expect(docs).toContain("<h1>Page 2</h1>");
    expect(docs).toContain("<p>drops.test</p>");
    const docsData = docs.match(/data-droplet-data>([^<]+)</)?.[1];
    // Stored without a host: the token, replaced by this request's host.
    expect(docsData && decode(docsData)).toEqual({ data: { page: 2, building: true, hooked: true, home: "http://drops.test/home" } });
    // ...server-only: never in the public client build, never served.
    expect(existsSync(resolve(outDir, "server/_prerendered/docs/index.json"))).toBe(true);
    expect(existsSync(resolve(outDir, "client/_prerendered"))).toBe(false);
    for (const path of [
      "/_prerendered/docs/index.json",
      "/server/_prerendered/docs/index.json",
      "/assets/../server/_prerendered/docs/index.json",
      "/assets/%2e%2e/server/_prerendered/docs/index.json",
      "/assets/..%2fserver/_prerendered/docs/index.json",
      "/assets/..%2f..%2fserver/_prerendered/docs/index.json",
    ]) {
      const res = await app.request(`http://drops.test${path}`);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).not.toContain("{");
    }

    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    expect((await app.request("/droplets/hello/client.js")).status).toBe(200);
    // style.css imports the droplet's stylesheets from /assets/.
    const style = await (await app.request("/droplets/static-note/style.css")).text();
    expect(style).toBe(manifest.droplets["static-note"].css.map((file: string) => `@import url("../../${file}");\n`).join(""));
    expect(await (await app.request(`/${manifest.droplets["static-note"].css.at(-1)}`)).text()).toContain("font-style");
    expect((await app.request("/droplets/static-note/client.js")).status).toBe(404);

    // The stub, never cached, and the hashed entry, cached for good.
    const entry = await app.request("/index.js");
    expect(entry.headers.get("cache-control")).toBe("no-store");
    expect((await entry.text()).endsWith(`import("./${manifest.__entryModule}");\n`)).toBe(true);
    const module = await app.request(`/${manifest.__entryModule}`);
    expect(module.headers.get("cache-control")).toContain("immutable");
    expect(await module.text()).toContain("test-droplet");

    const globalCss = await (await app.request("/index.css")).text();
    expect(globalCss).toContain("test-droplet .p-4");

    const asset = await app.request(`/assets/${manifest.__globalCss.replace(/^assets\//, "")}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");

    expect((await app.request("/nope")).status).toBe(404);
    expect(await (await app.request("/health")).text()).toBe("ok");
    expect(await (await app.request("/")).text()).toContain("Powering Microfrontends");
  });

  it("serves public/ at /assets/public/ alone, revalidated, and never through handle", async () => {
    const app = await createNodeServerApp(
      {
        clientRoot: resolve(outDir, "client"),
        ssrEntryUrl: pathToFileURL(resolve(outDir, "server/entry-server.js")).href,
      },
      resolveConfig({ element: "test-droplet" }),
    );
    expect(existsSync(resolve(outDir, "client/assets/public/robots.txt"))).toBe(true);
    expect(existsSync(resolve(outDir, "client/robots.txt"))).toBe(false);
    expect(existsSync(resolve(outDir, "robots.txt"))).toBe(false);
    expect(existsSync(resolve(outDir, "server/robots.txt"))).toBe(false);

    const res = await app.request("http://drops.test/assets/public/robots.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("User-agent: *\n");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("x-fixture-hook")).toBeNull();
    const etag = res.headers.get("etag") ?? expect.unreachable("an etag");
    expect((await app.request("http://drops.test/assets/public/robots.txt", { headers: { "if-none-match": etag } })).status).toBe(304);
    expect((await app.request("http://drops.test/robots.txt")).status).toBe(404);
    expect((await app.request("http://drops.test/index.js")).headers.get("x-fixture-hook")).toBeNull();
    expect((await app.request("http://drops.test/droplets/hello")).headers.get("x-fixture-hook")).toBe("1");
  });

  it("runs hooks and API routes from the SSR bundle", async () => {
    const app = await createNodeServerApp(
      {
        clientRoot: resolve(outDir, "client"),
        ssrEntryUrl: pathToFileURL(resolve(outDir, "server/entry-server.js")).href,
      },
      resolveConfig({ element: "test-droplet" }),
    );
    const echo = await app.request("http://drops.test/api/echo/3?q=n");
    expect(echo.headers.get("x-fixture-hook")).toBe("1");
    expect(await echo.json()).toEqual({ id: "3", hooked: true, q: "n" });
    expect((await app.request("/api/echo/3", { method: "DELETE" })).status).toBe(405);
    // The Origin check and cookies, from the built server.
    const form = (origin: string) => ({
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      body: "user=ana",
    });
    expect((await app.request("https://drops.test/api/session", form("https://evil.example"))).status).toBe(403);
    const signedIn = await app.request("https://drops.test/api/session", form("https://drops.test"));
    expect(signedIn.headers.getSetCookie()).toEqual(["session=ana; Path=/; HttpOnly; Secure; SameSite=Lax"]);
    const trusted = await createNodeServerApp(
      {
        clientRoot: resolve(outDir, "client"),
        ssrEntryUrl: pathToFileURL(resolve(outDir, "server/entry-server.js")).href,
      },
      resolveConfig({ element: "test-droplet", trustedOrigins: ["https://shop.example"] }),
    );
    expect((await trusted.request("https://drops.test/api/session", form("https://shop.example"))).status).toBe(200);
    // error() answers as an endpoint does.
    const missing = await app.request("/droplets/hello?who=nobody");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Nobody is here");
    // A load that throws renders the error page, with its styles.
    const crash = await app.request("/droplets/hello?who=crash");
    expect(crash.status).toBe(500);
    const page = await crash.text();
    expect(page).toContain("data-droplet-error");
    expect(page).toContain("[hello] Sorry, ref 42");
    expect(page).toMatch(/color: crimson/);
  });

  it("reads runtime secrets from process.env", async () => {
    process.env["FIXTURE_SECRET"] = "from-process";
    try {
      const app = await createNodeServerApp(
        {
          clientRoot: resolve(outDir, "client"),
          ssrEntryUrl: pathToFileURL(resolve(outDir, "server/entry-server.js")).href,
        },
        resolveConfig({ element: "test-droplet" }),
      );
      const html = await (await app.request("/droplets/hello")).text();
      const data = html.match(/data-droplet-data>([^<]+)</)?.[1];
      expect(data && (decode(data) as { data: unknown }).data).toMatchObject({ secret: "from-process" });
    } finally {
      delete process.env["FIXTURE_SECRET"];
    }
  });

  it("previews the build the same way", async () => {
    const adapter = node();
    if (adapter.preview === undefined) expect.unreachable("node().preview");
    const app = await adapter.preview({
      root,
      outDir,
      config: resolveConfig({ element: "test-droplet" }),
    });
    const res = await app.fetch(new Request("http://drops.test/droplets/hello?who=Preview"));
    expect(await res.text()).toContain("Hello Preview!");
  });
});
