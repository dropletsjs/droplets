import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, listensOn } from "@dropletsjs/shared/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The Worker build under `wrangler dev` (workerd, local, no account), with
// the assets config of wrangler.jsonc as it is deployed: no
// `run_worker_first`, so static assets answer the build's files with the
// headers of dist/client/_headers, and the rest reaches the Worker. Built
// into dist-worker/ so the Node build in dist/ stays as it is.
const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "dist-worker");
const DOCS = "https://dropletsjs.dev";
const SECRET = "test-worker-secret-0123456789abcdef-0123456789";

/** Strings that live only in server code (see server.test.ts). */
const SERVER_ONLY = [
  "Which framework would you write your next droplet in?",
  "because fail was set",
  "This is the droplet's +error page",
  "public, max-age=300",
];

let wrangler: ChildProcess | undefined;
let base = "";
let manifest: { __entryModule: string; __globalCss: string; droplets: Record<string, { css?: string[] }> };

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, { redirect: "manual", ...init, headers: { origin: DOCS, ...(init.headers as Record<string, string>) } });

/** wrangler.jsonc, as deployed, pointed at dist-worker/ and without the custom domain. */
async function testConfig() {
  const source = await readFile(join(root, "wrangler.jsonc"), "utf8");
  const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
  delete config.$schema;
  delete config.routes;
  config.main = "worker.js";
  config.assets.directory = "client";
  return config;
}

beforeAll(async () => {
  await rm(out, { recursive: true, force: true });
  const vite = join(root, "node_modules/vite/bin/vite.js");
  const build = spawnSync(process.execPath, [vite, "build", "--outDir", "dist-worker", "--logLevel", "error"], {
    cwd: root,
    env: { ...process.env, DROPLETS_ADAPTER: "cloudflare" },
    encoding: "utf8",
  });
  if (build.status !== 0) throw new Error(`the Worker build failed:\n${build.stderr}`);
  const exported = spawnSync(process.execPath, [join(root, "scripts/export-testimonials.mjs"), out], { cwd: root, encoding: "utf8" });
  if (exported.status !== 0) throw new Error(`exporting the testimonials failed:\n${exported.stderr}`);
  manifest = JSON.parse(await readFile(join(out, "client/droplets.json"), "utf8"));
  await writeFile(join(out, "wrangler.json"), JSON.stringify(await testConfig(), null, 2));

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const bin = join(root, "node_modules/wrangler/bin/wrangler.js");
  wrangler = spawn(
    process.execPath,
    [
      bin,
      "dev",
      "--config",
      "wrangler.json",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--var",
      `DROPLETS_SECRET:${SECRET}`,
      "--show-interactive-dev-session=false",
    ],
    { cwd: out, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  wrangler.stdout?.on("data", (chunk) => (log += chunk));
  wrangler.stderr?.on("data", (chunk) => (log += chunk));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (wrangler.exitCode !== null) throw new Error(`wrangler dev exited:\n${log}`);
    try {
      if (listensOn({ output: log, port }) && (await fetch(`${base}/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`wrangler dev did not start:\n${log}`);
});

afterAll(async () => {
  wrangler?.kill("SIGTERM");
  await rm(out, { recursive: true, force: true });
});

describe("static assets, with the headers of _headers", () => {
  it("deploys no run_worker_first", async () => {
    expect((await testConfig()).assets).not.toHaveProperty("run_worker_first");
  });

  it("answers /index.js and /index.css, the files of the build, to any origin and never cached", async () => {
    for (const path of ["index.js", "index.css"]) {
      for (const origin of [DOCS, "https://elsewhere.example"]) {
        const response = await call(`/${path}`, { headers: { origin } });
        expect(response.status, `${path} ${origin}`).toBe(200);
        expect(response.headers.get("cache-control"), `${path} ${origin}`).toBe("no-store");
        expect(response.headers.get("access-control-allow-origin"), `${path} ${origin}`).toBe("*");
        expect(await response.text(), `${path} ${origin}`).toBe(await readFile(join(out, `client/${path}`), "utf8"));
      }
    }
  });

  it("answers the entry, the stylesheets and each droplet's client.js and style.css, cached for good", async () => {
    const styled = Object.keys(manifest.droplets).find((id) => manifest.droplets[id]?.css?.length);
    if (!styled) expect.unreachable("a droplet with stylesheets");
    for (const path of [manifest.__entryModule, manifest.__globalCss, "droplets/hello/client.js", `droplets/${styled}/style.css`]) {
      const response = await call(`/${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control"), path).toBe("public, max-age=2592000, immutable");
      expect(response.headers.get("access-control-allow-origin"), path).toBe("*");
      expect(await response.text(), path).toBe(await readFile(join(out, "client", path), "utf8"));
    }
  });

  it("answers the exported testimonials pages as files, byte-equal to the Worker's render, to any origin", async () => {
    for (const page of [1, 7, 10]) {
      const path = `/assets/public/testimonials/page-${page}.html`;
      const file = await call(path, { headers: { origin: "https://elsewhere.example" } });
      expect(file.status, path).toBe(200);
      expect(file.headers.get("content-type"), path).toMatch(/^text\/html/);
      expect(file.headers.get("access-control-allow-origin"), path).toBe("*");
      expect(file.headers.get("cache-control"), path).toBe("no-cache");
      const html = await file.text();
      expect(html, path).toBe(await readFile(join(out, `client${path}`), "utf8"));
      const render = await call(`/droplets/testimonials-prerender-only?page=${page}`);
      expect(render.status, path).toBe(200);
      expect(await render.text(), path).toBe(html);
    }
  });

  it("tells search engines not to index the build's files, and keeps no robots.txt from fetching them", async () => {
    expect(await readFile(join(out, "client/_headers"), "utf8")).toContain("/*\n  X-Robots-Tag: noindex\n");
    for (const path of [
      "/index.js",
      "/index.css",
      `/${manifest.__entryModule}`,
      "/droplets/hello/client.js",
      "/assets/public/testimonials/page-1.html",
    ]) {
      const response = await call(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("x-robots-tag"), path).toBe("noindex");
    }
    expect((await call("/robots.txt")).status).toBe(404);
  });

  it("leaves what is no file to the Worker: _data and /env.js with the docs' CORS, a missing file no-store", async () => {
    const data = await call("/droplets/hello/_data?who=Worker");
    expect(data.status).toBe(200);
    expect(data.headers.get("access-control-allow-origin")).toBe(DOCS);
    // The demo declares no runtime public variables: the Worker's 404, not a file.
    expect((await call("/env.js")).status).toBe(404);
    const missing = await call(`/assets/missing-${Date.now()}.js`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });
});

describe("the Worker", () => {
  it("renders fragments with the docs' CORS", async () => {
    const hello = await call("/droplets/hello?who=Worker");
    expect(hello.status).toBe(200);
    expect(hello.headers.get("access-control-allow-origin")).toBe(DOCS);
    expect(hello.headers.get("x-robots-tag")).toBe("noindex");
    expect(await hello.text()).toContain("Hello Worker!");
    const crashed = await call("/droplets/crash?fail=1");
    expect(crashed.status).toBe(500);
    expect(await crashed.text()).toContain("data-droplet-error");
  });

  it("renders every renderer's counter, Lit's server build on workerd included", async () => {
    for (const id of ["svelte", "vue", "react", "preact", "solid", "hono-jsx", "handlebars", "lit", "script"]) {
      const response = await call(`/droplets/counter-${id}`);
      expect(response.status, id).toBe(200);
      const html = await response.text();
      expect(html.startsWith(`<djs-demo data-droplet="counter-${id}"`), id).toBe(true);
      if (id !== "script") expect(html, id).toMatch(/<output[^>]*>(?:<!--[^>]*-->)*3(?:<!--[^>]*-->)*<\/output>/);
    }
    expect(await (await call("/droplets/counter-lit")).text()).toContain('shadowrootmode="open"');
  });

  it("runs the poll's action, fail() included, and Post/Redirect/Get with the Worker secret", async () => {
    const post = (answer: string, accept?: string) =>
      call(`/droplets/poll?/vote&__droplet_return=${encodeURIComponent(`${DOCS}/guides/writing-droplets/`)}`, {
        method: "POST",
        body: new URLSearchParams({ answer }),
        headers: accept ? { accept } : {},
      });
    expect(await (await post("vue", "application/json")).json()).toMatchObject({ type: "success", data: { voted: "vue" } });
    const failed = await post("__proto__", "application/json");
    expect(failed.status).toBe(422);
    expect((await failed.json()).data).toEqual({ field: "answer", code: "unknown" });
    const native = await post("react");
    expect(native.status).toBe(303);
    expect(native.headers.get("location")).toMatch(/^https:\/\/dropletsjs\.dev\/guides\/writing-droplets\/\?__droplet_form_poll_/);
  });

  it("refuses CORS and form posts to other origins", async () => {
    const fragment = await call("/droplets/hello?who=Worker", { headers: { origin: "https://evil.example" } });
    expect(fragment.headers.get("access-control-allow-origin")).toBeNull();
    const posted = await call("/droplets/poll?/vote", {
      method: "POST",
      body: new URLSearchParams({ answer: "vue" }),
      headers: { origin: "https://evil.example", accept: "application/json" },
    });
    expect(posted.status).toBe(403);
  });

  it("serves nothing server-only, at any path", async () => {
    for (const path of [
      "/droplets.json",
      "/.vite/manifest.json",
      "/.assetsignore",
      "/_headers",
      "/worker.js",
      "/wrangler.json",
      "/server.js",
      "/_prerendered/",
      "/assets/../droplets.json",
      "/assets/%2e%2e/droplets.json",
      "/droplets/../droplets.json",
    ]) {
      expect((await call(path)).status, path).toBe(404);
    }
  });

  it("uploads no server code: nothing under client/ but .assetsignore'd files names it", async () => {
    const ignored = (await readFile(join(out, "client/.assetsignore"), "utf8")).split("\n").filter(Boolean);
    const files = (await readdir(join(out, "client"), { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(join(out, "client").length))
      .filter((path) => !ignored.some((rule) => (rule.endsWith("/") ? path.startsWith(rule) : path === rule)));
    expect(files).toContain(`/${manifest.__entryModule}`);
    for (const file of files) {
      const source = await readFile(join(out, "client", file), "utf8");
      for (const marker of SERVER_ONLY) expect(source.includes(marker), `${marker} in ${file}`).toBe(false);
    }
    // The stored renders sit under a directory named anew every build, known
    // to the Worker only: one, holding the testimonials pages and nothing else.
    const stored = files.filter((path) => path.startsWith("/_prerendered/"));
    expect(stored.length).toBeGreaterThan(0);
    expect(new Set(stored.map((path) => path.split("/")[2])).size).toBe(1);
    expect(stored.every((path) => path.split("/")[3] === "testimonials-prerender-only")).toBe(true);
  });
});
