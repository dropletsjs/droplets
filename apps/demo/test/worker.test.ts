import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The Worker build under `wrangler dev` (workerd, local, no account), with
// the assets config of wrangler.jsonc as it is deployed: `run_worker_first`
// is true, so every request, files included, reaches the Worker. Built into
// dist-worker/ so the Node build in dist/ stays as it is.
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
let manifest: { __entryModule: string; __globalCss: string };

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

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
      if ((await fetch(`${base}/health`)).ok) return;
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

describe("the Worker, behind run_worker_first", () => {
  it("serves /index.js itself: the stub that records where it was loaded from", async () => {
    const response = await call("/index.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(DOCS);
    const code = await response.text();
    expect(code).toContain('Symbol.for("droplets.servers")');
    expect(code.endsWith(`import("./${manifest.__entryModule}");\n`)).toBe(true);
  });

  it("serves /assets/* itself, through the binding, with CORS and cached for good", async () => {
    for (const path of [manifest.__entryModule, manifest.__globalCss]) {
      const response = await call(`/${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control"), path).toBe("public, max-age=2592000, immutable");
      expect(response.headers.get("access-control-allow-origin"), path).toBe(DOCS);
    }
  });

  it("renders fragments and serves bundles under /droplets/*", async () => {
    const hello = await call("/droplets/hello?who=Worker");
    expect(hello.status).toBe(200);
    expect(await hello.text()).toContain("Hello Worker!");
    const bundle = await call("/droplets/hello/client.js");
    expect(bundle.headers.get("cache-control")).toBe("public, max-age=2592000, immutable");
    expect(bundle.headers.get("access-control-allow-origin")).toBe(DOCS);
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
    const index = await call("/index.js", { headers: { origin: "https://evil.example" } });
    expect(index.headers.get("access-control-allow-origin")).toBeNull();
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
    // The prerendered renders' folder would be random and in the Worker only;
    // the demo prerenders nothing, so there is none at all.
    expect(files.some((path) => path.startsWith("/_prerendered"))).toBe(false);
  });
});
