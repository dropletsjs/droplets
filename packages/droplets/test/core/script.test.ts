/**
 * Script droplets as core sees them before anything is built: discovery
 * tells `+droplet.script.ts` from the load files, a script droplet is
 * client only whatever it exports (a flag warns once and is ignored), no renderer can take the built-in's place, the server
 * registry never imports the file, and `./$types` types its default export.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverDroplets } from "../../src/core/discover.ts";
import { setLogLevel } from "../../src/core/logger.ts";
import { validateRenderers, type DropletRenderer } from "../../src/renderer.ts";
import { readScriptFlags, scriptRenderer, userRenderers, withScriptRenderer } from "../../src/script/index.ts";
import { buildServerCode, createClientModuleCode } from "../../src/vite/virtual.ts";
import { dropletTypesCode } from "../../src/vite/sync-types.ts";

const svelte: DropletRenderer = {
  name: "svelte",
  extensions: [".svelte"],
  server: "/r/svelte/server.js",
  client: "/r/svelte/client.js",
};
const renderers = withScriptRenderer({ renderers: [svelte] });

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  setLogLevel("error");
});

/** A droplets folder with these files, by `<folder>/<file>`. */
async function folder(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "droplets-script-"));
  temps.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const RUN = "export default (data, el) => { el.textContent = String(data); };\n";

describe("discovering script droplets", () => {
  it("takes +droplet.script.ts as the droplet, and +droplet.ts and +droplet.server.ts as its loads", async () => {
    const root = await folder({
      "tracker/+droplet.script.ts": RUN,
      "tracker/+droplet.ts": "export const load = ({ data }) => data;\n",
      "tracker/+droplet.server.ts": "export const load = () => ({ views: 1 });\n",
      "widget/+droplet.script.js": RUN,
    });
    const entries = await discoverDroplets({ dropletsRoot: root, renderers });
    expect(entries).toEqual([
      expect.objectContaining({
        id: "tracker",
        file: "+droplet.script.ts",
        renderer: "script",
        hasLoad: true,
        hasServerLoad: true,
        hasError: false,
        ssr: false,
        hydrate: true,
        prerender: false,
      }),
      expect.objectContaining({ id: "widget", file: "+droplet.script.js", renderer: "script", hasLoad: false, ssr: false }),
    ]);
  });

  it("stays the built-in's next to renderers of .tsx and .lit.ts (Preact, Lit)", async () => {
    const tsx: DropletRenderer = { name: "preact", extensions: [".tsx", ".jsx"], server: "/r/p/server.js", client: "/r/p/client.js" };
    const lit: DropletRenderer = { name: "lit", extensions: [".lit.ts", ".lit.js"], server: "/r/l/server.js", client: "/r/l/client.js" };
    const root = await folder({
      "tracker/+droplet.script.ts": RUN,
      "card/+droplet.lit.ts": "export default class {}\n",
      "hello/+droplet.tsx": "export default () => null;\n",
    });
    const entries = await discoverDroplets({ dropletsRoot: root, renderers: withScriptRenderer({ renderers: [tsx, lit] }) });
    expect(entries.map((e) => [e.id, e.renderer])).toEqual([
      ["card", "lit"],
      ["hello", "preact"],
      ["tracker", "script"],
    ]);
  });

  it("finds no droplet in a folder with load files only", async () => {
    const root = await folder({
      "loads/+droplet.ts": "export const load = () => ({});\n",
      "loads/+droplet.server.ts": "export const load = () => ({});\n",
      "loads/+droplet.js": "export const load = () => ({});\n",
    });
    expect(await discoverDroplets({ dropletsRoot: root, renderers })).toEqual([]);
  });

  it("refuses a script next to another component", async () => {
    const root = await folder({ "both/+droplet.script.ts": RUN, "both/+droplet.svelte": "<p>hi</p>" });
    await expect(discoverDroplets({ dropletsRoot: root, renderers })).rejects.toThrow(/both\/ has 2 droplet components/);
  });

  it("ignores an error page, with a word in dev", async () => {
    setLogLevel("warn");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = await folder({ "tracker/+droplet.script.ts": RUN, "tracker/+error.script.ts": RUN });
    const [entry] = await discoverDroplets({ dropletsRoot: root, renderers, dev: true });
    expect(entry).toMatchObject({ hasError: false });
    expect(entry?.errorFile).toBeUndefined();
    expect(warn.mock.calls.flat().join(" ")).toContain("a script droplet has no error page");
  });

  it("is client only whatever it exports: ssr false, hydrated, never prerendered", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = await folder({
      "later/+droplet.script.ts": `export const hydrate = "visible";\nexport const prerender = true;\nexport const ssr = true;\n${RUN}`,
      "off/+droplet.script.ts": `export const hydrate = false;\n${RUN}`,
    });
    const entries = await discoverDroplets({ dropletsRoot: root, renderers });
    expect(entries.map(({ id, ssr, hydrate, prerender }) => ({ id, ssr, hydrate, prerender }))).toEqual([
      { id: "later", ssr: false, hydrate: true, prerender: false },
      { id: "off", ssr: false, hydrate: true, prerender: false },
    ]);
  });
});

describe("the flags of a script droplet", () => {
  const CLIENT_ONLY = { ssr: false, hydrate: true, prerender: false };
  let file = 0;
  /** Each read is another file: the warnings come once per file. */
  const read = (source: string) => readScriptFlags({ source, file: "+droplet.script.ts", droplet: `tracker${++file}` });
  const warnings = () => {
    setLogLevel("warn");
    return vi.spyOn(console, "warn").mockImplementation(() => {});
  };

  it("are locked: ssr false, hydrate true, prerender false, with nothing exported", () => {
    const warn = warnings();
    expect(read(RUN)).toEqual(CLIENT_ONLY);
    expect(warn).not.toHaveBeenCalled();
  });

  it("never fail the build: hydrate = true warns that it is locked", () => {
    const warn = warnings();
    expect(read(`export const hydrate = true;\n${RUN}`)).toEqual(CLIENT_ONLY);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      `[droplets:framework] tracker${file}/+droplet.script.ts exports hydrate = true; a script droplet is always hydrated (locked to true)`,
    ]);
  });

  it.each([
    ["export const hydrate = false;", "hydrate = false"],
    ['export const hydrate = "interactive";', 'hydrate = "interactive"'],
    ['export const hydrate = "visible";', 'hydrate = "visible"'],
    ["export const ssr = false;", "ssr = false"],
    ["export const ssr = true;", "ssr = true"],
    ["export const prerender = true;", "prerender = true"],
    ["export const prerender = false;", "prerender = false"],
  ])("ignore %s, with a warning", (line, shown) => {
    const warn = warnings();
    expect(read(`${line}\n${RUN}`)).toEqual(CLIENT_ONLY);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      `[droplets:framework] tracker${file}/+droplet.script.ts exports ${shown}; this is ignored, a script droplet is client only`,
    ]);
  });

  it("warn once per file, and say nothing of exports that are not flags", () => {
    const warn = warnings();
    const source = `export const hydrate = false;\nexport const ssr = true;\nexport const answer = 42;\n${RUN}`;
    const once = (droplet: string) => readScriptFlags({ source, file: "+droplet.script.ts", droplet });
    for (const droplet of ["twice", "twice", "again"]) expect(once(droplet)).toEqual(CLIENT_ONLY);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      "[droplets:framework] twice/+droplet.script.ts exports ssr = true; this is ignored, a script droplet is client only",
      "[droplets:framework] twice/+droplet.script.ts exports hydrate = false; this is ignored, a script droplet is client only",
      "[droplets:framework] again/+droplet.script.ts exports ssr = true; this is ignored, a script droplet is client only",
      "[droplets:framework] again/+droplet.script.ts exports hydrate = false; this is ignored, a script droplet is client only",
    ]);
  });

  it("never stop discovery", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = await folder({ "off/+droplet.script.ts": `export const hydrate = false;\n${RUN}` });
    expect(await discoverDroplets({ dropletsRoot: root, renderers })).toEqual([
      expect.objectContaining({ id: "off", ssr: false, hydrate: true }),
    ]);
  });
});

describe("the built-in renderer", () => {
  it("comes after the user's, and is not among them", () => {
    expect(renderers.map((r) => r.name)).toEqual(["svelte", "script"]);
    expect(userRenderers({ renderers })).toEqual([svelte]);
    expect(scriptRenderer().extensions).toEqual([".script.ts", ".script.js"]);
  });

  it("keeps its suffixes and its name", () => {
    const greedy = { ...svelte, name: "greedy", extensions: [".script.ts"] };
    expect(() => validateRenderers(withScriptRenderer({ renderers: [greedy] }))).toThrow(
      'renderer "greedy" cannot claim ".script.ts"; +droplet.script.ts is a script droplet, built in',
    );
    const named = { ...svelte, name: "script", extensions: [".js.txt"] };
    expect(() => validateRenderers(withScriptRenderer({ renderers: [named] }))).toThrow(/"script" is the built-in renderer/);
  });
});

const tracker = {
  id: "tracker",
  name: "tracker",
  file: "+droplet.script.ts",
  renderer: "script",
  hasLoad: true,
  hasServerLoad: true,
  hasError: false,
  ssr: false,
  hydrate: true as const,
  prerender: false,
};

describe("the registries", () => {
  it("never import the script on the server, and keep its loads there", () => {
    const code = buildServerCode({ entries: [tracker], globRoot: "/src/droplets", renderers });
    expect(code).not.toContain("+droplet.script.ts");
    expect(code).toContain("const component_0 = Object.freeze({});");
    expect(code).toContain('"/src/droplets/tracker/+droplet.ts"');
    expect(code).toContain('"/src/droplets/tracker/+droplet.server.ts"');
    expect(code).toContain(JSON.stringify(scriptRenderer().server));
  });

  it("import it in its browser entry, with the built-in renderer and +droplet.ts, never the server load", () => {
    const code = createClientModuleCode({ globRoot: "/src/droplets", entry: tracker, renderers });
    expect(code).toContain('import * as component from "/src/droplets/tracker/+droplet.script.ts";');
    expect(code).toContain(`import * as renderer from ${JSON.stringify(scriptRenderer().client)};`);
    expect(code).toContain('"/src/droplets/tracker/+droplet.ts"');
    expect(code).not.toContain("+droplet.server.ts");
  });
});

describe("./$types of a script droplet", () => {
  it("type its default export by the loads' data", () => {
    const code = dropletTypesCode({
      entry: tracker,
      renderer: scriptRenderer(),
      typesFile: "/p/.droplets/types/src/droplets/tracker/$types.d.ts",
      folder: "/p/src/droplets/tracker",
    });
    expect(code).toContain('import type { DropletScript as BaseDropletScript } from "@dropletsjs/droplets";');
    expect(code).toContain("export type DropletScript = BaseDropletScript<Data>;");
  });

  it("are not there for other droplets", () => {
    const code = dropletTypesCode({
      entry: { ...tracker, renderer: "svelte", file: "+droplet.svelte" },
      renderer: svelte,
      typesFile: "/p/a/$types.d.ts",
      folder: "/p/b",
    });
    expect(code).not.toContain("DropletScript");
  });
});
