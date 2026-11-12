/**
 * Every renderer in one project under `vite dev`, as a user runs it, on a
 * host page of another origin.
 *
 * The first regression this guards: @vitejs/plugin-react turned React's
 * Fast Refresh on in Vite's shared `oxc` options, and @vitejs/plugin-vue
 * compiles every `<script lang="ts">` with those, so a Vue composable call
 * (`useGreeting()`) was signed as a React hook with a `$RefreshSig$` the
 * server does not have: every droplet answered 500. Each renderer's
 * transforms must see that renderer's modules only.
 *
 * Then `dev.strategy: "hmr"`, the default: an edit to a component goes
 * through its framework's own HMR, so React (Fast Refresh), Preact
 * (Prefresh) and Vue keep the component's state; Svelte and Solid swap the
 * component in place with their own HMR; Lit and Hono JSX, which have none,
 * remount in place; Handlebars gets its fragment again when it does not
 * hydrate and remounts in place when it does; a script droplet
 * runs its cleanup and then its function again, on the same element. A load
 * edit brings new data to the live component, its state kept. A new render
 * contract (`ssr`, `hydrate`, `prerender`) leaves the droplet as it is and
 * says so, in a toast or in the dev tool, but for `hydrate` turning on,
 * which hydrates live. The page never reloads.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "@playwright/test";
import { freePort, listensOn, stopServer } from "@dropletsjs/shared/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const project = here("../.tmp/project");
// Ports the OS hands out: another run of this suite (a worktree, a parallel
// check) may hold any fixed one.
let PORT = 0;
let ORIGIN = "";
/** The host's page, on another origin, as a host embeds droplets. */
let HOST = "";
const DROPLETS = [
  "react-hello",
  "preact-hello",
  "vue-hello",
  "solid-hello",
  "svelte-hello",
  "lit-hello",
  "hono-hello",
  "hbs-hello",
  "hbs-live",
  "script-hello",
  "contract",
] as const;
/** The droplets that hydrate and say so, by the `data-testid` of their section. */
const LIVE = ["react", "preact", "vue", "solid", "svelte", "lit", "hono"] as const;

let server: ChildProcess | undefined;
let output = "";
let host: Server | undefined;
let browser: Browser | undefined;

const get = (path: string) => fetch(`${ORIGIN}${path}`, { headers: { "x-droplet-location": HOST } });
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
      if (listensOn({ output, port: PORT }) && (await fetch(`${ORIGIN}/droplets/react-hello`)).status) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`vite did not start:\n${output}`);
}

/** The host's page: each fragment as the server renders it, and /index.js once, with the page's query. */
async function hostPage(query: string): Promise<string> {
  const fragments = await Promise.all(DROPLETS.map(async (id) => (await get(`/droplets/${id}`)).text()));
  return `<!doctype html><html><head><meta charset="utf-8"><title>host</title>
<script type="module" src="${ORIGIN}/index.js${query}"></script></head>
<body>${fragments.join("\n")}</body></html>`;
}

type Opened = { page: Page; errors: string[]; logs: string[]; posts: string[] };

/**
 * A page on the host, its errors and console lines collected, and the
 * fragment requests it makes; with a marker on `window` that a reload
 * would lose.
 */
async function open(query = ""): Promise<Opened> {
  const page = await browser!.newPage();
  const errors: string[] = [];
  const logs: string[] = [];
  const posts: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    else logs.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && /^\/droplets\/[^/]+$/.test(url.pathname)) posts.push(url.pathname);
  });
  await page.goto(`${HOST}${query}`);
  for (const name of LIVE) {
    await page.locator(`[data-testid=${name}][data-hydrated=true]`).waitFor({ timeout: 30_000 });
  }
  await hydratedElement(page, "hbs-live");
  await page.locator("[data-testid=script]").waitFor();
  await page.evaluate(() => ((window as { loaded?: string }).loaded = "once"));
  return { page, errors, logs, posts };
}

/** A template's markup says nothing of hydration: the element itself does. */
async function hydratedElement(page: Page, droplet: string) {
  await page.waitForFunction(
    (id) => (document.querySelector(`[data-droplet="${id}"]`) as { _hydrated?: boolean } | null)?._hydrated === true,
    droplet,
    { timeout: 30_000 },
  );
}

/** The page is the one `open` loaded: nothing reloaded it. */
async function notReloaded(page: Page) {
  expect(await page.evaluate(() => (window as { loaded?: string }).loaded)).toBe("once");
}

const text = (page: Page, name: string, field = "[data-text]") => page.locator(`[data-testid=${name}] ${field}`).textContent();
const count = (page: Page, name: string) => page.locator(`[data-testid=${name}] button`).textContent();

/** Clicks `name`'s button until it shows `to`. */
async function clickTo(page: Page, name: string, to: number) {
  const button = page.locator(`[data-testid=${name}] button`);
  while (Number(await button.textContent()) < to) await button.click();
  await expect.poll(() => button.textContent()).toBe(String(to));
}

beforeAll(async () => {
  rmSync(project, { recursive: true, force: true });
  cpSync(here("fixture"), project, { recursive: true });
  host = createServer((request, response) => {
    const query = new URL(request.url ?? "/", HOST).search;
    void hostPage(query).then((html) => response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html));
  });
  await new Promise<void>((done) => host!.listen(0, "localhost", done));
  HOST = `http://localhost:${(host.address() as AddressInfo).port}/`;
  PORT = await freePort();
  ORIGIN = `http://localhost:${PORT}`;
  // `PORT` is the production server's: `vite dev` stays on `dev.server.port`,
  // which the fixture's config takes from `DEV_MIXED_PORT`.
  server = spawn(here("../node_modules/.bin/vite"), ["--strictPort"], {
    cwd: project,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: "5555", DEV_MIXED_PORT: String(PORT), DEV_MIXED_HOST: new URL(HOST).origin },
  });
  server.stdout?.on("data", (chunk) => (output += chunk));
  server.stderr?.on("data", (chunk) => (output += chunk));
  await waitForServer();
  browser = await chromium.launch();
  // The first visit has Vite discover and optimize the dependencies, which
  // may reload the page once; the tests start on a settled server. A page
  // that does not come up fails in the tests below, with their reasons.
  const page = await browser.newPage();
  await page.goto(HOST);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1_500);
  await page.close();
});

afterAll(async () => {
  await browser?.close();
  host?.close();
  await stopServer({ child: server });
  rmSync(project, { recursive: true, force: true });
});

describe("every renderer under vite dev", () => {
  it("renders every droplet on the server", async () => {
    for (const id of DROPLETS) {
      const response = await get(`/droplets/${id}`);
      const body = await response.text();
      expect(response.status, `${id}: ${body.slice(0, 500)}`).toBe(200);
      // A script droplet renders nothing on the server.
      if (id !== "script-hello" && id !== "contract") expect(body).toContain("greets");
    }
    expect(output).not.toContain("$RefreshSig$");
  });

  it("gives React's refresh to React's modules alone, and Prefresh to Preact's", async () => {
    const vue = await (await get("/src/droplets/vue-hello/+droplet.vue")).text();
    expect(vue).toContain("useGreeting");
    expect(vue).not.toMatch(/\$Refresh(?:Sig|Reg)\$/);
    const composable = await (await get("/src/lib/useGreeting.ts")).text();
    expect(composable).not.toMatch(/\$Refresh(?:Sig|Reg)\$/);
    const solid = await (await get("/src/droplets/solid-hello/+droplet.tsx?droplets-renderer=solid")).text();
    expect(solid).not.toMatch(/\$Refresh(?:Sig|Reg)\$/);
    const hono = await (await get("/src/droplets/hono-hello/+droplet.tsx?droplets-renderer=hono-jsx")).text();
    expect(hono).not.toMatch(/\$Refresh(?:Sig|Reg)\$|__PREFRESH__/);
    // Preact's own JSX runtime and Prefresh, none of React's.
    const preact = await (await get("/src/droplets/preact-hello/+droplet.tsx?droplets-renderer=preact")).text();
    expect(preact).toMatch(/preact[/_]jsx-runtime/);
    expect(preact).toContain("__PREFRESH__");
    expect(preact).not.toMatch(/[^p]react[/_]jsx|react-refresh/);
    const react = await (await get("/src/droplets/react-hello/+droplet.tsx?droplets-renderer=react")).text();
    expect(react).toContain("$RefreshReg$");
    expect(react).toContain("$RefreshSig$");
    expect(react).not.toContain("__PREFRESH__");
    // The server's renders have neither.
    const fragment = await (await get("/droplets/preact-hello")).text();
    expect(fragment).toContain("Preact greets");
  });

  it("hydrates every droplet in the browser, without an error", async () => {
    const { page, errors } = await open();
    for (const name of LIVE) await clickTo(page, name, 1);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("keeps the count through a component edit in React, Preact and Vue: their own HMR", async () => {
    const { page, errors, logs } = await open();
    const edits = [
      {
        name: "react",
        path: "src/droplets/react-hello/+droplet.tsx",
        from: "React greets",
        to: "React waves to",
        field: "[data-text]",
        now: "React waves to the host",
      },
      {
        name: "preact",
        path: "src/droplets/preact-hello/+droplet.tsx",
        from: "Preact greets",
        to: "Preact waves to",
        field: "[data-text]",
        now: "Preact waves to the host",
      },
      // A template edit: Vue re-renders, the component stays.
      {
        name: "vue",
        path: "src/droplets/vue-hello/+droplet.vue",
        from: "Vue says hi",
        to: "Vue says hello",
        field: "[data-label]",
        now: "Vue says hello",
      },
    ];
    for (const { name, path, from, to, field, now } of edits) {
      await clickTo(page, name, 2);
      edit(path, from, to);
      await expect.poll(() => text(page, name, field), { timeout: 15_000 }).toBe(now);
      expect(await count(page, name), `${name} kept its count`).toBe("2");
    }
    expect(logs.filter((line) => line.includes("remounted in place"))).toEqual([]);
    await notReloaded(page);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("swaps a Svelte and a Solid component with their own HMR, in place", async () => {
    const { page, errors, logs, posts } = await open();
    const edits = [
      {
        name: "svelte",
        path: "src/droplets/svelte-hello/+droplet.svelte",
        from: "Svelte greets",
        to: "Svelte waves to",
        now: "Svelte waves to the host",
      },
      {
        name: "solid",
        path: "src/droplets/solid-hello/+droplet.tsx",
        from: "Solid greets",
        to: "Solid waves to",
        now: "Solid waves to the host",
      },
    ];
    for (const { name, path, from, to, now } of edits) {
      await clickTo(page, name, 2);
      edit(path, from, to);
      await expect.poll(() => text(page, name), { timeout: 15_000 }).toBe(now);
      // Their HMR makes the component again: its own state starts over
      // (Svelte 5, solid-refresh), but nothing else on the page moves.
      await expect.poll(() => count(page, name)).toBe("0");
      await clickTo(page, name, 1);
    }
    // No fragment asked for again, no remount: the frameworks did it.
    expect(posts).toEqual([]);
    expect(logs.filter((line) => line.includes("remounted in place"))).toEqual([]);
    await notReloaded(page);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("keeps Vue's count through a template edit saved in two writes: emptied, then written", async () => {
    const { page, errors, logs } = await open();
    await clickTo(page, "vue", 2);
    // A save that truncates first, the watcher reporting the empty file. The
    // gap outlasts the ~100 ms Vite's `read()` waits for content, as a
    // loaded machine can: plugin-vue would take the empty file for the new
    // version and reload the component on the next write.
    const path = file("src/droplets/vue-hello/+droplet.vue");
    const source = readFileSync(path, "utf8");
    writeFileSync(path, "");
    await new Promise((done) => setTimeout(done, 400));
    writeFileSync(path, source.replace(/<p data-label>[^<]*<\/p>/, "<p data-label>Vue says hey</p>"));
    await expect.poll(() => text(page, "vue", "[data-label]"), { timeout: 15_000 }).toBe("Vue says hey");
    expect(await count(page, "vue"), "vue kept its count").toBe("2");
    expect(logs.filter((line) => line.includes("remounted in place"))).toEqual([]);
    await notReloaded(page);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("brings an edit through the import graph: a Vue composable", async () => {
    const { page, errors } = await open();
    edit("src/lib/useGreeting.ts", "Vue greets", "Vue waves to");
    await expect.poll(() => text(page, "vue"), { timeout: 15_000 }).toBe("Vue waves to the host");
    await page.locator("[data-testid=vue][data-hydrated=true]").waitFor();
    await clickTo(page, "vue", 1);
    await notReloaded(page);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("remounts Lit and Hono JSX in place, which have no HMR of their own", async () => {
    const { page, errors, logs } = await open();
    const edits = [
      {
        name: "lit",
        path: "src/droplets/lit-hello/+droplet.lit.ts",
        from: "Lit greets",
        to: "Lit waves to",
        now: "Lit waves to the host",
        droplet: "lit-hello",
      },
      {
        name: "hono",
        path: "src/droplets/hono-hello/+droplet.tsx",
        from: "Hono greets",
        to: "Hono waves to",
        now: "Hono waves to the host",
        droplet: "hono-hello",
      },
    ];
    for (const { name, path, from, to, now, droplet } of edits) {
      await clickTo(page, name, 2);
      edit(path, from, to);
      await expect.poll(() => text(page, name), { timeout: 15_000 }).toBe(now);
      await page.locator(`[data-testid=${name}][data-hydrated=true]`).waitFor();
      // A fresh instance, from the fragment asked for again.
      expect(await count(page, name)).toBe("0");
      await expect
        .poll(() => logs.some((line) => line.includes(`${droplet}: no HMR of its framework took this edit; remounted in place`)))
        .toBe(true);
      await clickTo(page, name, 1);
    }
    await notReloaded(page);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("swaps the markup of a Handlebars droplet, asked for again", async () => {
    const { page, errors, posts } = await open();
    edit("src/droplets/hbs-hello/+droplet.hbs", "Handlebars greets", "Handlebars waves to");
    await expect.poll(() => text(page, "hbs"), { timeout: 15_000 }).toBe("Handlebars waves to the host");
    expect(posts).toContain("/droplets/hbs-hello");
    await notReloaded(page);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("remounts a hydrated Handlebars droplet in place: a template has no HMR of its own", async () => {
    const { page, errors, logs } = await open();
    edit("src/droplets/hbs-live/+droplet.hbs", "Handlebars live greets", "Handlebars live waves to");
    await expect.poll(() => text(page, "hbs-live"), { timeout: 15_000 }).toBe("Handlebars live waves to the host");
    await hydratedElement(page, "hbs-live");
    await expect
      .poll(() => logs.some((line) => line.includes("hbs-live: no HMR of its framework took this edit; remounted in place")))
      .toBe(true);
    await notReloaded(page);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("runs a script droplet's cleanup, then its function again on the same element", async () => {
    const { page, errors } = await open();
    const runs = () =>
      page.evaluate(() => {
        const runs = (window as { scriptRuns?: { els: HTMLElement[]; cleanups: number; texts: string[] } }).scriptRuns;
        return runs
          ? { calls: runs.els.length, cleanups: runs.cleanups, same: runs.els.every((el) => el === runs.els[0]), texts: runs.texts }
          : null;
      });
    expect(await runs()).toMatchObject({ calls: 1, cleanups: 0 });
    edit("src/droplets/script-hello/+droplet.script.ts", "Script greets", "Script waves to");
    await expect.poll(() => text(page, "script"), { timeout: 15_000 }).toBe("Script waves to the host");
    expect(await runs()).toEqual({ calls: 2, cleanups: 1, same: true, texts: ["Script greets the host", "Script waves to the host"] });
    // The old run's markup went with its cleanup.
    expect(await page.locator("[data-testid=script]").count()).toBe(1);
    await notReloaded(page);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("brings a load edit to the live component as new data, its count kept", async () => {
    const { page, errors, posts } = await open();
    // The server load: `_data` again, and the renderer's `update` hands the
    // live component the new data.
    for (const name of ["react", "preact", "vue", "solid", "lit", "hono"] as const) {
      await clickTo(page, name, 2);
      edit(`src/droplets/${name}-hello/+droplet.server.ts`, "from the server", "from the edited server");
      await expect.poll(() => text(page, name, "[data-word]"), { timeout: 15_000 }).toBe("from the edited server");
      expect(await count(page, name), `${name} kept its count`).toBe("2");
    }
    // The universal load: it runs in the browser too, the new one.
    await clickTo(page, "svelte", 2);
    edit("src/droplets/svelte-hello/+droplet.ts", "from the universal load", "from the edited load");
    await expect.poll(() => text(page, "svelte", "[data-word]"), { timeout: 15_000 }).toBe("from the edited load");
    expect(await count(page, "svelte")).toBe("2");
    // Data, not a fragment: nothing rendered again on the server.
    expect(posts).toEqual([]);
    await notReloaded(page);
    expect(errors).toEqual([]);
    await page.close();
  });

  describe("a new render contract", () => {
    const flags = "src/droplets/contract/+droplet.tsx";
    const toasts = (page: Page) => page.locator("droplets-dev-notifications .toast");

    it("hydrates live when hydrate turns on, and tells of every other change without touching the droplet", async () => {
      const { page, errors, logs } = await open();
      const contract = page.locator("[data-testid=contract]");
      expect(await contract.getAttribute("data-hydrated")).toBe("false");

      // hydrate false → true: the server markup hydrates, live.
      edit(flags, "export const hydrate = false;", "export const hydrate = true;");
      await page.locator("[data-testid=contract][data-hydrated=true]").waitFor({ timeout: 15_000 });
      await clickTo(page, "contract", 2);
      const status = toasts(page).filter({ hasText: "contract changed its render contract: hydrate false → true" });
      await expect.poll(() => status.count()).toBe(1);
      expect(await status.getAttribute("role")).toBe("status");
      expect(await status.evaluate((toast) => getComputedStyle(toast).borderLeftWidth)).toBe("3px");
      expect(await status.locator("button", { hasText: "Reload page" }).count()).toBe(0);

      // Between modes on a hydrated droplet: a console note, nothing else.
      edit(flags, "export const hydrate = true;", 'export const hydrate = "visible";');
      await expect
        .poll(() => logs.some((line) => line.includes("contract changed its render contract: hydrate true → visible")))
        .toBe(true);
      expect(await toasts(page).filter({ hasText: "hydrate true → visible" }).count()).toBe(0);

      // hydrate on → false: the running component stays; a reload shows it without.
      edit(flags, 'export const hydrate = "visible";', "export const hydrate = false;");
      const off = toasts(page).filter({ hasText: "contract changed its render contract: hydrate visible → false" });
      await expect.poll(() => off.count(), { timeout: 15_000 }).toBe(1);
      expect(await off.getAttribute("role")).toBe("alertdialog");
      expect(await off.locator("button", { hasText: "Reload page" }).count()).toBe(1);
      await clickTo(page, "contract", 3);

      // ssr true → false: the markup stays.
      edit(flags, "export const ssr = true;", "export const ssr = false;");
      const ssrOff = toasts(page).filter({ hasText: "contract changed its render contract: ssr true → false" });
      await expect.poll(() => ssrOff.count(), { timeout: 15_000 }).toBe(1);
      expect(await ssrOff.getAttribute("role")).toBe("status");
      expect(await ssrOff.locator("button").filter({ hasText: "Reload page" }).count()).toBe(0);

      // ssr false → true: a reload renders it on the server.
      edit(flags, "export const ssr = false;", "export const ssr = true;");
      const ssrOn = toasts(page).filter({ hasText: "contract changed its render contract: ssr false → true" });
      await expect.poll(() => ssrOn.count(), { timeout: 15_000 }).toBe(1);
      // The newer news of the same flag replaces the older.
      expect(await ssrOff.count()).toBe(0);
      expect(await ssrOn.getAttribute("role")).toBe("alertdialog");
      expect(await ssrOn.locator("button", { hasText: "Reload page" }).count()).toBe(1);

      // prerender: only a build prerenders.
      edit(flags, "export const prerender = false;", "export const prerender = true;");
      const prerender = toasts(page).filter({ hasText: "contract changed its render contract: prerender false → true" });
      await expect.poll(() => prerender.count(), { timeout: 15_000 }).toBe(1);
      expect(await prerender.textContent()).toContain("vite preview");

      // Never more than three at once, and one console line each.
      expect(await toasts(page).count()).toBeLessThanOrEqual(3);
      expect(logs.filter((line) => line.includes("contract changed its render contract: ssr false → true"))).toHaveLength(1);
      // The droplet itself never moved: still the same, live instance.
      expect(await count(page, "contract")).toBe("3");
      // Dismissed, it goes.
      await ssrOn.locator("button[aria-label=Dismiss]").click();
      await expect.poll(() => ssrOn.count()).toBe(0);
      await notReloaded(page);
      expect(errors).toEqual([]);
      await page.close();
    });

    it("shows the notice in the dev tool when it is on the page", async () => {
      const { page, errors } = await open("?injectTool=true");
      await page.locator("droplets-devtools").waitFor({ state: "attached" });
      edit(flags, "export const prerender = true;", "export const prerender = false;");
      const note = page.locator("droplets-devtools .note", { hasText: "contract changed its render contract: prerender true → false" });
      await expect.poll(() => note.count(), { timeout: 15_000 }).toBe(1);
      expect(await note.evaluate((item) => getComputedStyle(item).borderLeftWidth)).toBe("3px");
      expect(await page.locator("droplets-dev-notifications .toast").count()).toBe(0);
      await notReloaded(page);
      expect(errors).toEqual([]);
      await page.close();
    });
  });

  it("still remounts under index.js?strategy=remount: no framework HMR runs there", async () => {
    const { page, errors, posts } = await open("?strategy=remount");
    await clickTo(page, "react", 2);
    edit("src/droplets/react-hello/+droplet.tsx", "React waves to", "React bows to");
    await expect.poll(() => text(page, "react"), { timeout: 15_000 }).toBe("React bows to the host");
    await page.locator("[data-testid=react][data-hydrated=true]").waitFor();
    // A fresh instance, from the fragment asked for again.
    await expect.poll(() => count(page, "react")).toBe("0");
    expect(posts).toContain("/droplets/react-hello");
    await notReloaded(page);
    expect(errors).toEqual([]);
    await page.close();
  });
});
