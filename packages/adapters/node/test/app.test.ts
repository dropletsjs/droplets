import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveConfig } from "@dropletsjs/droplets";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNodeServerApp, type NodeServerPaths } from "../src/app.ts";
import { buildFixture, FIXTURE_ROOT } from "./build-fixture.ts";

const outDir = resolve(FIXTURE_ROOT, "dist-node-app");

type DecodeInput = { base64: string };

type FormInput = { origin: string };

const IMMUTABLE = "public, max-age=2592000, immutable";

function decode({ base64 }: DecodeInput): Record<string, unknown> {
  return JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as Record<string, unknown>;
}

function form({ origin }: FormInput): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: "user=ana",
  };
}

describe("createNodeServerApp", () => {
  let paths: NodeServerPaths;

  beforeAll(async () => {
    paths = await buildFixture({ outDir });
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("serves the build", async () => {
    const app = await createNodeServerApp(paths, resolveConfig({ cors: true, element: "test-droplet" }));

    const fragment = await app.request("http://drops.test/droplets/hello?who=Node");
    expect(fragment.status).toBe(200);
    const html = await fragment.text();
    expect(html).toContain('data-testid="greeting">Hello Node!</h1>');
    expect(html.startsWith('<test-droplet data-droplet="hello"')).toBe(true);
    const data = html.match(/data-droplet-payload="data">([^<]+)</)?.[1];
    // Runtime secrets come from process.env in production; .env is a build input.
    expect(data && (decode({ base64: data }) as { data: unknown }).data).toMatchObject({
      who: "Node",
      hooked: true,
      secret: null,
      flag: "inlined-at-build",
      big: "41",
    });
    // The full page exists only under `vite dev`.
    expect((await app.request("/hello")).status).toBe(404);

    // Prerendered renders are read from dist/server/_prerendered, per request.
    const docs = await (await app.request("http://drops.test/droplets/docs?page=2")).text();
    expect(docs).toContain("<h1>Page 2</h1>");
    expect(docs).toContain("<p>drops.test</p>");
    const docsData = docs.match(/data-droplet-payload="data">([^<]+)</)?.[1];
    // Stored without a host: the token, replaced by this request's host.
    expect(docsData && decode({ base64: docsData })).toEqual({
      data: { page: 2, title: "Page 2", building: true, hooked: true, home: "http://drops.test/home" },
    });
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
    // The file of the build holds the same, at the same path.
    expect(await readFile(resolve(outDir, "client/droplets/static-note/style.css"), "utf8")).toBe(style);
    expect(await (await app.request(`/${manifest.droplets["static-note"].css.at(-1)}`)).text()).toContain("font-style");
    expect((await app.request("/droplets/static-note/client.js")).status).toBe(404);

    // The stub, never cached, and the hashed entry, cached for good.
    const entry = await app.request("/index.js");
    expect(entry.headers.get("cache-control")).toBe("no-store");
    expect(await entry.text()).toContain(`import "./${manifest.__entryModule}";\n`);
    const module = await app.request(`/${manifest.__entryModule}`);
    expect(module.headers.get("cache-control")).toContain("immutable");
    expect(await module.text()).toContain("test-droplet");

    // A fixed URL a page links itself: a stub, never cached, importing the
    // hashed stylesheet; the same as the file of the build.
    const globalCss = await app.request("/index.css");
    expect(globalCss.headers.get("cache-control")).toBe("no-store");
    expect(await globalCss.text()).toBe(`@import url("./${manifest.__globalCss}");\n`);
    expect(await readFile(resolve(outDir, "client/index.css"), "utf8")).toBe(`@import url("./${manifest.__globalCss}");\n`);

    const asset = await app.request(`/assets/${manifest.__globalCss.replace(/^assets\//, "")}`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("test-droplet .p-4");
    expect(asset.headers.get("cache-control")).toContain("immutable");

    expect((await app.request("/nope")).status).toBe(404);
    expect(await (await app.request("/health")).text()).toBe("ok");
    expect(await (await app.request("/")).text()).toContain("Powering Microfrontends");
  });

  it("serves public/ at /assets/public/ alone, revalidated, and never through handle", async () => {
    const app = await createNodeServerApp(paths, resolveConfig({ element: "test-droplet" }));
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
    const app = await createNodeServerApp(paths, resolveConfig({ element: "test-droplet" }));
    const echo = await app.request("http://drops.test/api/echo/3?q=n");
    expect(echo.headers.get("x-fixture-hook")).toBe("1");
    expect(await echo.json()).toEqual({ id: "3", hooked: true, q: "n" });
    expect((await app.request("/api/echo/3", { method: "DELETE" })).status).toBe(405);
    // The Origin check and cookies, from the built server.
    expect((await app.request("https://drops.test/api/session", form({ origin: "https://evil.example" }))).status).toBe(403);
    const signedIn = await app.request("https://drops.test/api/session", form({ origin: "https://drops.test" }));
    expect(signedIn.headers.getSetCookie()).toEqual(["session=ana; Path=/; HttpOnly; Secure; SameSite=Lax"]);
    const trusted = await createNodeServerApp(paths, resolveConfig({ element: "test-droplet", trustedOrigins: ["https://shop.example"] }));
    expect((await trusted.request("https://drops.test/api/session", form({ origin: "https://shop.example" }))).status).toBe(200);
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

  it("serves public/ with publicCacheControl from the config, and nothing else with it", async () => {
    const app = await createNodeServerApp(paths, resolveConfig({ element: "test-droplet", publicCacheControl: "public, max-age=60" }));
    expect((await app.request("/assets/public/robots.txt")).headers.get("cache-control")).toBe("public, max-age=60");
    expect((await app.request("/index.js")).headers.get("cache-control")).toBe("no-store");
  });

  it("keeps publicCacheControl, or none for false, on public/'s 304, with its ETag", async () => {
    for (const publicCacheControl of ["public, max-age=3600", false] as const) {
      const app = await createNodeServerApp(paths, resolveConfig({ element: "test-droplet", publicCacheControl }));
      const res = await app.request("/assets/public/robots.txt");
      const etag = res.headers.get("etag") ?? expect.unreachable("an etag");
      const again = await app.request("/assets/public/robots.txt", { headers: { "if-none-match": etag } });
      expect(again.status).toBe(304);
      for (const answer of [res, again]) {
        expect(answer.headers.get("cache-control")).toBe(publicCacheControl || null);
        expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
        expect(answer.headers.get("access-control-allow-origin")).toBe("*");
      }
    }
  });

  it("answers every build file with the headers of the file-header table, and no other of the table's", async () => {
    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    for (const publicCacheControl of ["no-cache", false] as const) {
      const app = await createNodeServerApp(paths, resolveConfig({ element: "test-droplet", publicCacheControl }));
      const files: Array<[string, string | null]> = [
        ["/index.js", "no-store"],
        ["/index.css", "no-store"],
        [`/${manifest.__entryModule}`, IMMUTABLE],
        ["/assets/public/robots.txt", publicCacheControl || null],
        ["/droplets/hello/client.js", IMMUTABLE],
        ["/droplets/static-note/style.css", IMMUTABLE],
      ];
      for (const [path, cache] of files) {
        const res = await app.request(path);
        expect(res.status, path).toBe(200);
        expect(
          {
            cache: res.headers.get("cache-control"),
            cors: res.headers.get("access-control-allow-origin"),
            nosniff: res.headers.get("x-content-type-options"),
          },
          `${path} ${publicCacheControl}`,
        ).toEqual({ cache, cors: "*", nosniff: "nosniff" });
      }
    }
  });

  it("answers a prerender file with the live fragment's Cache-Control, revalidated, and never through handle", async () => {
    await mkdir(resolve(outDir, "client/assets/prerendered/hello"), { recursive: true });
    await writeFile(resolve(outDir, "client/assets/prerendered/hello/home.html"), "<test-droplet>home</test-droplet>");
    for (const [fragmentCacheControl, cache] of [
      [undefined, "private, no-store, no-transform"],
      ["public, max-age=60", "public, max-age=60, no-transform"],
      ["no-transform, max-age=5", "no-transform, max-age=5"],
      [false, "no-transform"],
    ] as const) {
      const config = resolveConfig({ element: "test-droplet", ...(fragmentCacheControl === undefined ? {} : { fragmentCacheControl }) });
      const app = await createNodeServerApp(paths, config);
      const live = await app.request("/droplets/hello?who=ana");
      expect(live.headers.get("cache-control")).toBe(cache);
      const res = await app.request("/assets/prerendered/hello/home");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<test-droplet>home</test-droplet>");
      const etag = res.headers.get("etag") ?? expect.unreachable("an etag");
      const again = await app.request("/assets/prerendered/hello/home.html", { headers: { "if-none-match": etag } });
      expect(again.status).toBe(304);
      for (const answer of [res, again]) {
        expect({
          type: answer.headers.get("content-type"),
          cache: answer.headers.get("cache-control"),
          cors: answer.headers.get("access-control-allow-origin"),
          nosniff: answer.headers.get("x-content-type-options"),
          hook: answer.headers.get("x-fixture-hook"),
          etag: answer.headers.get("etag"),
        }).toEqual({
          type: "text/html; charset=utf-8",
          cache,
          cors: "*",
          nosniff: "nosniff",
          hook: null,
          etag,
        });
      }
      const missing = await app.request("/assets/prerendered/hello/away");
      expect(missing.status).toBe(404);
      expect(missing.headers.get("cache-control")).toBe("no-store");
      expect(missing.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("with cors: true, sends * on a build file it answers, and nothing of CORS on a missing one", async () => {
    const app = await createNodeServerApp(paths, resolveConfig({ element: "test-droplet", cors: true }));
    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    const origin = { headers: { origin: "https://shop.example" } };
    const found = await app.request(`/${manifest.__entryModule}`, origin);
    expect(found.status).toBe(200);
    expect(found.headers.get("access-control-allow-origin")).toBe("*");
    const missing = await app.request("/assets/missing.js", origin);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("access-control-allow-origin")).toBeNull();
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });

  it("sends Access-Control-Allow-Origin: * on every build file without cors, and nothing of CORS elsewhere", async () => {
    const app = await createNodeServerApp(paths, resolveConfig({ element: "test-droplet" }));
    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    const origin = { headers: { origin: "https://shop.example" } };
    for (const path of [
      "/index.js",
      "/index.css",
      `/${manifest.__entryModule}`,
      "/assets/public/robots.txt",
      "/droplets/hello/client.js",
    ]) {
      const res = await app.request(path, origin);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("access-control-allow-origin"), path).toBe("*");
    }
    expect((await app.request("/droplets/hello", origin)).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps a restricted cors off the build files: one *, no credentials, while the routes answer by name", async () => {
    const config = resolveConfig({ element: "test-droplet", cors: { origin: ["https://shop.example"], credentials: true } });
    const app = await createNodeServerApp(paths, config);
    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    const origin = { headers: { origin: "https://shop.example" } };
    for (const path of [
      "/index.js",
      "/index.css",
      `/${manifest.__entryModule}`,
      "/assets/public/robots.txt",
      "/droplets/hello/client.js",
      "/droplets/static-note/style.css",
    ]) {
      const res = await app.request(path, origin);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("access-control-allow-origin"), path).toBe("*");
      expect(res.headers.get("access-control-allow-credentials"), path).toBeNull();
      expect(res.headers.get("access-control-expose-headers"), path).toBeNull();
      expect(res.headers.get("vary") ?? "", path).not.toMatch(/origin/i);
    }
    for (const path of ["/droplets/hello", "/droplets/hello/_data", "/env.js"]) {
      const res = await app.request(path, origin);
      expect(res.headers.get("access-control-allow-origin"), path).toBe("https://shop.example");
      expect(res.headers.get("access-control-allow-credentials"), path).toBe("true");
    }
    expect(
      (await app.request("/droplets/hello", { headers: { origin: "https://elsewhere.example" } })).headers.get(
        "access-control-allow-origin",
      ),
    ).toBeNull();
  });

  it("reads runtime secrets from process.env", async () => {
    process.env["FIXTURE_SECRET"] = "from-process";
    try {
      const app = await createNodeServerApp(paths, resolveConfig({ element: "test-droplet" }));
      const html = await (await app.request("/droplets/hello")).text();
      const data = html.match(/data-droplet-payload="data">([^<]+)</)?.[1];
      expect(data && (decode({ base64: data }) as { data: unknown }).data).toMatchObject({ secret: "from-process" });
    } finally {
      delete process.env["FIXTURE_SECRET"];
    }
  });
});

describe("createNodeServerApp without a shared stylesheet", () => {
  const plainDir = resolve(FIXTURE_ROOT, "dist-node-app-no-css");
  let paths: NodeServerPaths;

  beforeAll(async () => {
    paths = await buildFixture({ outDir: plainDir, css: { path: false } });
  });

  afterAll(async () => {
    await rm(plainDir, { recursive: true, force: true });
  });

  it("serves no stylesheet that has nothing in it, and links none", async () => {
    const app = await createNodeServerApp(paths, resolveConfig({ element: "test-droplet" }));
    expect((await app.request("/index.css")).status).toBe(404);
    expect((await app.request("/droplets/hello/style.css")).status).toBe(404);
    expect((await app.request("/droplets/static-note/style.css")).status).toBe(200);
    expect((await app.request("/droplets-css.js")).status).toBe(404);
    const fragment = await app.request("/droplets/hello?who=Node");
    expect(await fragment.text()).not.toContain("data-droplet-style");
    expect(fragment.headers.get("link") ?? "").not.toContain(".css");
    expect(await (await app.request("/droplets/docs?page=2")).text()).not.toContain("style.css");
  });
});
