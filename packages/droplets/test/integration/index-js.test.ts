// @vitest-environment happy-dom
/**
 * `dist/client/index.js` as the browser runs it: `env.js` evaluates before
 * the entry, so `init()` and the first elements see the runtime public
 * variables; the location record comes after the entry, and the element
 * reads the same location before it.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../src/core/config.ts";
import { setRuntimeEnv } from "../../src/runtime/env-store.ts";
import { locationScript, serverKey } from "../../src/runtime/server-records.ts";
import { createServerApp, type SsrModule } from "../../src/server/app.ts";
import type { DropletsManifest } from "../../src/server/manifest.ts";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

const ELEMENT = "order-el";

const FILES: Record<string, string> = {
  "droplets.config.ts": `export default { element: ${JSON.stringify(ELEMENT)} };\n`,
  "src/env.ts": "export const variables = { PUBLIC_RUNTIME: { public: true } };\n",
  "src/app.css": ".card { color: teal; }\n",
  "src/droplets/card/+droplet.fake.js": "export default () => `<p>card</p>`;\n",
  "src/hooks.client.ts": [
    'import { env } from "$droplets/env/public";',
    "export function init() {",
    '  const records = Object.values(globalThis[Symbol.for("droplets.servers")] ?? {});',
    "  globalThis.__indexOrder = { env: env.PUBLIC_RUNTIME, recorded: records.some((record) => record.origin !== undefined) };",
    "}",
    "",
  ].join("\n"),
};

let root = "";
let client = "";
let manifest: DropletsManifest;

beforeAll(async () => {
  root = await mkdtemp(join(fixtures, ".index-js-"));
  for (const [path, text] of Object.entries(FILES)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const builder = await createBuilder({
    root,
    logLevel: "silent",
    plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()] })],
  });
  await builder.buildApp();
  client = resolve(root, "dist/client");
  manifest = JSON.parse(await readFile(resolve(client, "droplets.json"), "utf8")) as DropletsManifest;
  // What the built server answers at `/env.js`, next to `/index.js`.
  const ssr = (await import(pathToFileURL(resolve(root, "dist/server/entry-server.js")).href)) as SsrModule;
  const app = createServerApp({
    ssr,
    config: resolveConfig({ element: ELEMENT }),
    assets: {
      buildHash: manifest.__hash,
      loadClientModule: async () => null,
      loadEntryClient: async () => null,
      entryModule: async () => null,
      loadGlobalStyle: async () => null,
      dropletStyles: async () => [],
      loadIndex: async () => null,
      externals: [],
      assetHandler: (c) => c.text("Not Found", 404),
    },
  });
  setRuntimeEnv({ PUBLIC_RUNTIME: "from env.js" });
  try {
    await writeFile(resolve(client, "env.js"), await (await app.request("/env.js")).text());
  } finally {
    setRuntimeEnv(undefined);
  }
}, 90_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

describe("dist/client/index.js in the browser", () => {
  it("runs env.js before the entry, and the element loads from index.js's own location before and after the record", async () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    document.body.innerHTML = `<${ELEMENT} data-droplet="card"></${ELEMENT}>`;
    const location = pathToFileURL(client).href;

    await import(pathToFileURL(resolve(client, "index.js")).href);

    expect((globalThis as { __indexOrder?: unknown }).__indexOrder).toEqual({ env: "from env.js", recorded: false });
    // Linked as the element connected, during the entry's define: before the record.
    const link = document.querySelector<HTMLLinkElement>(`${ELEMENT} > link[data-droplet-style]`);
    expect(link?.href).toBe(`${location}/droplets/card/style.css?c=${manifest.__hash}`);
    // The record the stub writes after the entry: the same location. Run on its own, as Vitest's
    // transform of the stub would rewrite `new URL(".", import.meta.url)`.
    const key = serverKey(ELEMENT, manifest.__hash);
    const stub = await readFile(resolve(client, "index.js"), "utf8");
    expect(stub.endsWith(locationScript(key))).toBe(true);
    const servers = Symbol.for("droplets.servers");
    const global = globalThis as unknown as Record<symbol, Record<string, { origin?: string }>>;
    delete global[servers]?.[key];
    new Function("meta", locationScript(key).replace("import.meta", "meta"))({ url: pathToFileURL(resolve(client, "index.js")).href });
    expect(global[servers]?.[key]?.origin).toBe(location);
  });
});
