/**
 * A React, Preact, Vue and Solid project under `vite dev`, as a user runs it.
 *
 * The regression this guards: @vitejs/plugin-react turned React's Fast
 * Refresh on in Vite's shared `oxc` options, and @vitejs/plugin-vue compiles
 * every `<script lang="ts">` with those, so a Vue composable call
 * (`useGreeting()`) was signed as a React hook with a `$RefreshSig$` the
 * server does not have: every droplet answered 500. Each renderer's
 * transforms must see that renderer's modules only.
 *
 * Over HTTP: each droplet renders (200), and only React's modules carry
 * React's refresh. In a browser, on a host page of another origin: each
 * hydrates without an error, and an edit to each, a Vue composable's
 * included, reaches the page in place, with no reload.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const project = here("../.tmp/project");
const PORT = 5191;
const ORIGIN = `http://localhost:${PORT}`;
/** The host's page, on another origin, as a host embeds droplets. */
const HOST = "http://localhost:5192/";
const DROPLETS = ["react-hello", "preact-hello", "vue-hello", "solid-hello"] as const;

let server: ChildProcess | undefined;
let output = "";
let host: Server | undefined;
let browser: Browser | undefined;

const get = (path: string) => fetch(`${ORIGIN}${path}`, { headers: { "x-host": HOST } });
const file = (path: string) => `${project}/${path}`;
const edit = (path: string, from: string, to: string) => {
  const source = readFileSync(file(path), "utf8");
  if (!source.includes(from)) throw new Error(`${path} has no ${from}`);
  writeFileSync(file(path), source.replace(from, to));
};

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server?.exitCode != null) throw new Error(`vite exited:\n${output}`);
    try {
      if ((await fetch(`${ORIGIN}/droplets/react-hello`)).status) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`vite did not start:\n${output}`);
}

/** The host's page: each fragment as the server renders it, and /index.js once. */
async function hostPage(): Promise<string> {
  const fragments = await Promise.all(DROPLETS.map(async (id) => (await get(`/droplets/${id}`)).text()));
  return `<!doctype html><html><head><meta charset="utf-8"><title>host</title>
<script type="module" src="${ORIGIN}/index.js"></script></head>
<body>${fragments.join("\n")}</body></html>`;
}

/** A page on the host, its errors collected. */
async function open(): Promise<{ page: Page; errors: string[] }> {
  const page = await browser!.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(HOST);
  for (const name of ["react", "preact", "vue", "solid"]) {
    await page.locator(`[data-testid=${name}][data-hydrated=true]`).waitFor({ timeout: 30_000 });
  }
  return { page, errors };
}

beforeAll(async () => {
  rmSync(project, { recursive: true, force: true });
  cpSync(here("fixture"), project, { recursive: true });
  server = spawn(here("../node_modules/.bin/vite"), ["--strictPort"], { cwd: project, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (chunk) => (output += chunk));
  server.stderr?.on("data", (chunk) => (output += chunk));
  await waitForServer();
  host = createServer((_request, response) => {
    void hostPage().then((html) => response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html));
  });
  await new Promise<void>((done) => host!.listen(5192, "localhost", done));
  browser = await chromium.launch();
  // The first visit has Vite discover and optimize the dependencies, which
  // may reload the page once; the tests start on a settled server. A page
  // that does not come up fails in the tests below, with their reasons.
  const page = await browser.newPage();
  await page.goto(HOST);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1_000);
  await page.close();
});

afterAll(async () => {
  await browser?.close();
  host?.close();
  server?.kill();
  rmSync(project, { recursive: true, force: true });
});

describe("a React, Preact, Vue and Solid project under vite dev", () => {
  it("renders every droplet on the server", async () => {
    for (const id of DROPLETS) {
      const response = await get(`/droplets/${id}`);
      const body = await response.text();
      expect(response.status, `${id}: ${body.slice(0, 500)}`).toBe(200);
      expect(body).toContain("greets");
    }
    expect(output).not.toContain("$RefreshSig$");
  });

  it("gives React's refresh to React's modules alone", async () => {
    const vue = await (await get("/src/droplets/vue-hello/+droplet.vue")).text();
    expect(vue).toContain("useGreeting");
    expect(vue).not.toMatch(/\$Refresh(?:Sig|Reg)\$/);
    const composable = await (await get("/src/lib/useGreeting.ts")).text();
    expect(composable).not.toMatch(/\$Refresh(?:Sig|Reg)\$/);
    const solid = await (await get("/src/droplets/solid-hello/+droplet.tsx?droplets-renderer=solid")).text();
    expect(solid).not.toMatch(/\$Refresh(?:Sig|Reg)\$/);
    // Preact's own JSX runtime, and none of React's.
    const preact = await (await get("/src/droplets/preact-hello/+droplet.tsx?droplets-renderer=preact")).text();
    expect(preact).toMatch(/preact[/_]jsx-runtime/);
    expect(preact).not.toMatch(/\$Refresh(?:Sig|Reg)\$|[^p]react[/_]jsx/);
    const react = await (await get("/src/droplets/react-hello/+droplet.tsx?droplets-renderer=react")).text();
    expect(react).toContain("$RefreshReg$");
    expect(react).toContain("$RefreshSig$");
  });

  it("hydrates every droplet in the browser, without an error", async () => {
    const { page, errors } = await open();
    for (const name of ["react", "preact", "vue", "solid"]) {
      const button = page.locator(`[data-testid=${name}] button`);
      await button.click();
      await expect.poll(() => button.textContent()).toBe("1");
    }
    expect(errors).toEqual([]);
    await page.close();
  });

  it("brings an edit to each droplet to the page, with no reload", async () => {
    const { page, errors } = await open();
    await page.evaluate(() => ((window as { loaded?: string }).loaded = "once"));
    const text = (name: string) => page.locator(`[data-testid=${name}] [data-text]`).textContent();

    const edits = [
      { name: "react", path: "src/droplets/react-hello/+droplet.tsx", from: "React greets", to: "React waves to" },
      // No Prefresh: Preact's droplet remounts, still in place.
      { name: "preact", path: "src/droplets/preact-hello/+droplet.tsx", from: "Preact greets", to: "Preact waves to" },
      { name: "vue", path: "src/droplets/vue-hello/+droplet.vue", from: '"the host"', to: '"the edit"' },
      // Through the import graph: the composable, not the component.
      { name: "vue", path: "src/lib/useGreeting.ts", from: "Vue greets", to: "Vue waves to" },
      { name: "solid", path: "src/droplets/solid-hello/+droplet.tsx", from: "Solid greets", to: "Solid waves to" },
    ];
    for (const { name, path, from, to } of edits) {
      const before = await text(name);
      edit(path, from, to);
      await expect.poll(() => text(name), { timeout: 15_000 }).not.toBe(before);
      await page.locator(`[data-testid=${name}][data-hydrated=true]`).waitFor();
    }
    expect(await text("react")).toBe("React waves to the host");
    expect(await text("preact")).toBe("Preact waves to the host");
    expect(await text("vue")).toBe("Vue waves to the edit");
    expect(await text("solid")).toBe("Solid waves to the host");
    expect(await page.evaluate(() => (window as { loaded?: string }).loaded)).toBe("once");
    expect(errors).toEqual([]);
    await page.close();
  });
});
