/**
 * The same project, every renderer in it, built for production with
 * `vite build`: nothing of HMR or of `vite dev` reaches the output. Not the
 * entry's dev module (`dev-element`, with the strategies, the remount, the
 * notices and the dev tool's hooks), not a renderer's `clientDev`, not a
 * framework's refresh runtime, not a dev-only warning, not the dev server's
 * options of the runtime app (in the server bundle); and no module of
 * theirs is in any chunk at all, nor a file of theirs among the output.
 */
import { execFileSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const project = here("../.tmp/production");
const dist = join(project, "dist");

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
  "updateInstance",
  "$RefreshReg$",
  "$RefreshSig$",
  "__PREFRESH__",
  "__getReactRefreshIgnoredExports",
  "__dropletsReactRefresh",
  "transformImportMap",
  /\.dev\s*\?\s*[\w$]+\.message\b/,
];

/** Our dev-only modules, as the bundler names them. */
const DEV_MODULE = /[\\/](?:dev-element|dev-notify|dev-contract|dev-tool|client-dev)(?:-[\w-]+)?\.js$|[\\/]devtools[\\/]/;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));

/** Every output file, relative to `dist/`. */
let files: string[] = [];
/** Per Vite environment, the modules each chunk renders code of. */
let rendered: Record<string, Record<string, string[]>> = {};

const RECORDER = `import { writeFileSync } from "node:fs";
import config from "./vite.config.ts";

// The modules each output chunk holds code of, per environment.
const modules = {
  name: "test:rendered-modules",
  generateBundle(_, bundle) {
    const chunks = {};
    for (const item of Object.values(bundle)) {
      if (item.type !== "chunk") continue;
      chunks[item.fileName] = Object.entries(item.modules).filter(([, info]) => info.renderedLength > 0).map(([id]) => id);
    }
    writeFileSync(\`rendered-\${this.environment.name}.json\`, JSON.stringify(chunks));
  },
};

export default { ...config, plugins: [...config.plugins, modules] };
`;

beforeAll(() => {
  // As a user runs it: vitest's NODE_ENV=test would make Vite build for development.
  const { NODE_ENV: _, ...env } = process.env;
  rmSync(project, { recursive: true, force: true });
  cpSync(here("fixture"), project, { recursive: true });
  writeFileSync(join(project, "vite.production.config.ts"), RECORDER);
  execFileSync(here("../node_modules/.bin/vite"), ["build", "--config", "vite.production.config.ts"], {
    cwd: project,
    stdio: "pipe",
    env,
  });
  files = walk(dist).map((file) => relative(dist, file).replaceAll("\\", "/"));
  for (const name of readdirSync(project)) {
    const env = name.match(/^rendered-(\w+)\.json$/)?.[1];
    if (env) rendered[env] = JSON.parse(readFileSync(join(project, name), "utf8"));
  }
});

describe("a production build of every renderer", () => {
  it("builds the client, the SSR bundle and the server, each droplet with its bundle", () => {
    expect(Object.keys(rendered).sort()).toEqual(["client", "server", "ssr"]);
    for (const id of ["react-hello", "preact-hello", "vue-hello", "solid-hello", "svelte-hello", "lit-hello", "hono-hello", "script-hello"]) {
      expect(files).toContain(`client/droplets/${id}/client.js`);
    }
    // The recorder sees what it should: the entry is in the client output.
    expect(Object.values(rendered["client"]!).flat().some((id) => id.endsWith("/runtime/entry-client.js"))).toBe(true);
  });

  it("holds none of the dev markers in any JavaScript it emits", () => {
    const found: string[] = [];
    for (const file of files.filter((name) => /\.m?js$/.test(name))) {
      const code = readFileSync(join(dist, file), "utf8");
      for (const marker of DEV_MARKERS) {
        if (typeof marker === "string" ? code.includes(marker) : marker.test(code)) found.push(`${file}: ${marker}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("emits no update hook from a droplet's client module", () => {
    const found = files
      .filter((name) => /^client\/droplets\/[^/]+\/client\.js$/.test(name))
      .filter((name) => /\bas update\b|export\s*\{[^}]*\bupdate\b|export\s+(?:async\s+)?function\s+update\b/.test(readFileSync(join(dist, name), "utf8")));
    expect(found).toEqual([]);
  });

  it("renders no code of a dev module into any chunk, and emits no file of one", () => {
    const reached = Object.entries(rendered).flatMap(([env, chunks]) =>
      Object.entries(chunks).flatMap(([chunk, ids]) => ids.filter((id) => DEV_MODULE.test(id)).map((id) => `${env} ${chunk}: ${id}`)),
    );
    expect(reached).toEqual([]);
    expect(files.filter((name) => /dev/i.test(name))).toEqual([]);
  });
});
