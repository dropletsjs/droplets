/**
 * The same project, every renderer in it, built for production with
 * `vite build`: nothing of HMR or of `vite dev` reaches the output. Not the
 * entry's dev module (`dev-element`, with the strategies, the remount, the
 * notices and the dev tool's hooks), not a renderer's `clientDev`, not a
 * framework's refresh runtime, not a dev-only warning, not the dev server's
 * options of the runtime app (in the server bundle); and no module of
 * theirs is in any chunk at all, nor a file of theirs among the output.
 *
 * Built again for Cloudflare Workers, where every dependency is bundled into
 * `worker.js`: each framework's production build, never its development one.
 */
import { execFileSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Text that only HMR or `vite dev` code holds. */
const DEV_MARKERS: (string | RegExp)[] = [
  "import.meta.hot",
  "__vite__createHotContext",
  "@vite/client",
  "droplets:update",
  "droplets:hooks-client",
  "droplets:hot-fallback",
  "vite:beforeUpdate",
  "virtual:droplet-client?",
  "droplets-dev-notifications",
  "Droplets notifications",
  "DropletsDevTools",
  "droplets:strategy:",
  "devElements",
  "injectTool",
  "index.js?strategy=",
  "use hmr, remount, reload or manual",
  "failed to handle hmr event",
  "reload the page to see it",
  "remounted in place",
  "remount failed",
  "changed its render contract",
  "takes its children in one <div data-droplet-slot>",
  "use true, false, visible or interactive",
  "a script droplet only runs in the browser",
  "updateInstance",
  "$RefreshReg$",
  "$RefreshSig$",
  "__PREFRESH__",
  "__getReactRefreshIgnoredExports",
  "__dropletsReactRefresh",
  "transformImportMap",
  /\.dev\s*\?\s*[\w$]+\.message\b/,
];

const hasMarker = (code: string, marker: string | RegExp) =>
  typeof marker === "string" ? code.includes(marker) : marker.test(code);

/** Our dev-only modules, as the bundler names them. */
const DEV_MODULE = /[\\/](?:dev-element|dev-notify|dev-contract|dev-tool|client-dev)(?:-[\w-]+)?\.js$|[\\/]devtools[\\/]/;

/** Text that only a framework's development build holds. */
const DEV_BUILD_MARKERS = ["jsxDEV", "react-stack-bottom-frame", "[Vue warn]"];

/** A dependency's development entry, as its package names it. */
const DEV_BUILD_MODULE = /\.development\.[cm]?js$/;

/** Hono's one JSX runtime is called `jsxDEV`, in production too: its modules and those calling it. */
const HONO = /[\\/]hono[\\/]|hono-jsx[\\/]|droplets-renderer=hono-jsx/;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));

const RECORDER = `import { writeFileSync } from "node:fs";
import config from "./vite.config.ts";

// The code each output chunk renders of each module, per environment.
const modules = {
  name: "test:rendered-modules",
  generateBundle(_, bundle) {
    const chunks = {};
    for (const item of Object.values(bundle)) {
      if (item.type !== "chunk") continue;
      chunks[item.fileName] = Object.fromEntries(
        Object.entries(item.modules).filter(([, info]) => info.renderedLength > 0).map(([id, info]) => [id, info.code]),
      );
    }
    writeFileSync(\`rendered-\${this.environment.name}.json\`, JSON.stringify(chunks));
  },
};

export default { ...config, plugins: [...config.plugins, modules] };
`;

type Build = {
  dist: string;
  /** Every output file, relative to `dist/`. */
  files: string[];
  /** Per Vite environment, per chunk, the code it renders of each module. */
  rendered: Record<string, Record<string, Record<string, string>>>;
};

/** A copy of the fixture built with `vite build`, as a user runs it, for one adapter. */
function build(adapter: "node" | "cloudflare"): Build {
  const project = here(`../.tmp/production-${adapter}`);
  const dist = join(project, "dist");
  // vitest's NODE_ENV=test would make Vite build for development.
  const { NODE_ENV: _, ...env } = process.env;
  rmSync(project, { recursive: true, force: true });
  cpSync(here("fixture"), project, { recursive: true });
  writeFileSync(join(project, "vite.production.config.ts"), RECORDER);
  execFileSync(here("../node_modules/.bin/vite"), ["build", "--config", "vite.production.config.ts"], {
    cwd: project,
    stdio: "pipe",
    env: { ...env, DROPLETS_ADAPTER: adapter },
  });
  const rendered: Build["rendered"] = {};
  for (const name of readdirSync(project)) {
    const environment = name.match(/^rendered-(\w+)\.json$/)?.[1];
    if (environment) rendered[environment] = JSON.parse(readFileSync(join(project, name), "utf8"));
  }
  return { dist, files: walk(dist).map((file) => relative(dist, file).replaceAll("\\", "/")), rendered };
}

let node: Build;
let workers: Build;

beforeAll(() => {
  node = build("node");
  workers = build("cloudflare");
});

describe("a production build of every renderer", () => {
  it("builds the client, the SSR bundle and the server, each droplet with its bundle", () => {
    const { files, rendered } = node;
    expect(Object.keys(rendered).sort()).toEqual(["client", "server", "ssr"]);
    for (const id of ["react-hello", "preact-hello", "vue-hello", "solid-hello", "svelte-hello", "lit-hello", "hono-hello", "script-hello"]) {
      expect(files).toContain(`client/droplets/${id}/client.js`);
    }
    // The recorder sees what it should: the entry is in the client output.
    expect(Object.values(rendered["client"]!).flatMap(Object.keys).some((id) => id.endsWith("/runtime/entry-client.js"))).toBe(true);
  });

  it("holds none of the dev markers in any JavaScript it emits", () => {
    const { dist, files } = node;
    const found: string[] = [];
    for (const file of files.filter((name) => /\.m?js$/.test(name))) {
      const code = readFileSync(join(dist, file), "utf8");
      for (const marker of DEV_MARKERS) {
        if (hasMarker(code, marker)) found.push(`${file}: ${marker}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("emits no update hook from a droplet's client module", () => {
    const { dist, files } = node;
    const found = files
      .filter((name) => /^client\/droplets\/[^/]+\/client\.js$/.test(name))
      .filter((name) => /\bas update\b|export\s*\{[^}]*\bupdate\b|export\s+(?:async\s+)?function\s+update\b/.test(readFileSync(join(dist, name), "utf8")));
    expect(found).toEqual([]);
  });

  it("renders no code of a dev module into any chunk, and emits no file of one", () => {
    const { files, rendered } = node;
    const reached = Object.entries(rendered).flatMap(([env, chunks]) =>
      Object.entries(chunks).flatMap(([chunk, modules]) =>
        Object.keys(modules).filter((id) => DEV_MODULE.test(id)).map((id) => `${env} ${chunk}: ${id}`),
      ),
    );
    expect(reached).toEqual([]);
    expect(files.filter((name) => /dev/i.test(name))).toEqual([]);
  });
});

describe("a production build for Cloudflare Workers", () => {
  const worker = () => readFileSync(join(workers.dist, "worker.js"), "utf8");
  const workerModules = (): Record<string, string> => Object.assign({}, ...Object.values(workers.rendered["server"]!));

  it("emits the SSR renderer inside worker.js", () => {
    expect(Object.keys(workers.rendered).sort()).toEqual(["client", "server"]);
    expect(workers.files.filter((name) => !name.startsWith("client/"))).toEqual(["worker.js"]);
  });

  it("decides every NODE_ENV switch at build time", () => {
    const found = Object.entries(workerModules()).filter(([, code]) => code.includes("process.env.NODE_ENV")).map(([id]) => id);
    expect(found).toEqual([]);
    expect(worker()).not.toContain("process.env.NODE_ENV");
  });

  it("bundles no dependency's development build", () => {
    const modules = workerModules();
    expect(Object.keys(modules).filter((id) => DEV_BUILD_MODULE.test(id))).toEqual([]);
    const found = Object.entries(modules)
      .filter(([id]) => !HONO.test(id))
      .flatMap(([id, code]) => DEV_BUILD_MARKERS.filter((marker) => code.includes(marker)).map((marker) => `${id}: ${marker}`));
    expect(found).toEqual([]);
  });

  it("holds none of the dev markers", () => {
    const code = worker();
    expect(DEV_MARKERS.filter((marker) => hasMarker(code, marker))).toEqual([]);
  });

  it("renders every framework's droplet", async () => {
    const { default: app } = (await import(pathToFileURL(join(workers.dist, "worker.js")).href)) as {
      default: { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
    };
    const env = { ASSETS: { fetch: async () => new Response("Not Found", { status: 404 }) } };
    for (const id of ["react-hello", "preact-hello", "vue-hello", "solid-hello", "svelte-hello", "lit-hello", "hono-hello"]) {
      const response = await app.fetch(new Request(`http://drops.test/droplets/${id}`), env, {});
      expect(response.status, id).toBe(200);
      expect(await response.text(), id).toMatch(/from the (?:server|universal load)/);
    }
  });
});
