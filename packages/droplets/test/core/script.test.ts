/**
 * Script droplets as core sees them before anything is built: discovery
 * tells `+droplet.script.ts` from the load files, the flags that cannot
 * apply are errors, no renderer can take the built-in's place, the server
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
import { dropletTypesCode } from "../../src/vite/types.ts";

const svelte: DropletRenderer = {
  name: "svelte",
  extensions: [".svelte"],
  server: "/r/svelte/server.js",
  client: "/r/svelte/client.js",
};
const renderers = withScriptRenderer([svelte]);

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
    const entries = await discoverDroplets(root, renderers);
    expect(entries).toEqual([
      expect.objectContaining({
        id: "tracker",
        file: "+droplet.script.ts",
        renderer: "script",
        hasLoad: true,
        hasServerLoad: true,
        hasError: false,
        ssr: true,
        hydrate: true,
        prerender: false,
      }),
      expect.objectContaining({ id: "widget", file: "+droplet.script.js", renderer: "script", hasLoad: false }),
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
    const entries = await discoverDroplets(root, withScriptRenderer([tsx, lit]));
    expect(entries.map((e) => [e.id, e.renderer])).toEqual([["card", "lit"], ["hello", "preact"], ["tracker", "script"]]);
  });

  it("finds no droplet in a folder with load files only", async () => {
    const root = await folder({
      "loads/+droplet.ts": "export const load = () => ({});\n",
      "loads/+droplet.server.ts": "export const load = () => ({});\n",
      "loads/+droplet.js": "export const load = () => ({});\n",
    });
    expect(await discoverDroplets(root, renderers)).toEqual([]);
  });

  it("refuses a script next to another component", async () => {
    const root = await folder({ "both/+droplet.script.ts": RUN, "both/+droplet.svelte": "<p>hi</p>" });
    await expect(discoverDroplets(root, renderers)).rejects.toThrow(/both\/ has 2 droplet components/);
  });

  it("ignores an error page, with a word in dev", async () => {
    setLogLevel("warn");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = await folder({ "tracker/+droplet.script.ts": RUN, "tracker/+error.script.ts": RUN });
    const [entry] = await discoverDroplets(root, renderers, { dev: true });
    expect(entry).toMatchObject({ hasError: false });
    expect(entry?.errorFile).toBeUndefined();
    expect(warn.mock.calls.flat().join(" ")).toContain("a script droplet has no error page");
  });

  it("reads hydrate = \"visible\" and prerender", async () => {
    const root = await folder({
      "later/+droplet.script.ts": `export const hydrate = "visible";\nexport const prerender = true;\n${RUN}`,
    });
    const [entry] = await discoverDroplets(root, renderers);
    expect(entry).toMatchObject({ hydrate: "visible", prerender: true, ssr: true });
  });
});

describe("the flags of a script droplet", () => {
  const read = (source: string) => readScriptFlags({ source, file: "+droplet.script.ts", droplet: "tracker" });

  it("are a build error when they would keep it from running, or cannot apply", () => {
    expect(() => read("export const hydrate = false;")).toThrow(/tracker\/\+droplet\.script\.ts: hydrate = false would never run it/);
    expect(() => read('export const hydrate = "interactive";')).toThrow(/a script droplet has none; use true \(the default\) or "visible"/);
    expect(() => read("export const ssr = false;")).toThrow(/renders nothing on the server, so it has no ssr flag/);
    expect(() => read("export const ssr = true;")).toThrow(/no ssr flag/);
  });

  it("stop discovery, and so the build", async () => {
    const root = await folder({ "off/+droplet.script.ts": `export const hydrate = false;\n${RUN}` });
    await expect(discoverDroplets(root, renderers)).rejects.toThrow(/hydrate = false would never run it/);
  });

  it("take true and \"visible\"", () => {
    expect(read("export const hydrate = true;")).toEqual({ hydrate: true });
    expect(read("export const hydrate = 'visible';")).toEqual({ hydrate: "visible" });
    expect(read(RUN)).toEqual({});
  });
});

describe("the built-in renderer", () => {
  it("comes after the user's, and is not among them", () => {
    expect(renderers.map((r) => r.name)).toEqual(["svelte", "script"]);
    expect(userRenderers(renderers)).toEqual([svelte]);
    expect(scriptRenderer().extensions).toEqual([".script.ts", ".script.js"]);
  });

  it("keeps its suffixes and its name", () => {
    const greedy = { ...svelte, name: "greedy", extensions: [".script.ts"] };
    expect(() => validateRenderers(withScriptRenderer([greedy]))).toThrow(
      'renderer "greedy" cannot claim ".script.ts"; +droplet.script.ts is a script droplet, built in',
    );
    const named = { ...svelte, name: "script", extensions: [".js.txt"] };
    expect(() => validateRenderers(withScriptRenderer([named]))).toThrow(/"script" is the built-in renderer/);
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
  ssr: true,
  hydrate: true as const,
  prerender: false,
};

describe("the registries", () => {
  it("never import the script on the server, and keep its loads there", () => {
    const code = buildServerCode([tracker], "/src/droplets", { renderers });
    expect(code).not.toContain("+droplet.script.ts");
    expect(code).toContain("const component_0 = Object.freeze({});");
    expect(code).toContain('"/src/droplets/tracker/+droplet.ts"');
    expect(code).toContain('"/src/droplets/tracker/+droplet.server.ts"');
    expect(code).toContain(JSON.stringify(scriptRenderer().server));
  });

  it("import it in its browser entry, with the built-in renderer and +droplet.ts, never the server load", () => {
    const code = createClientModuleCode("/src/droplets", tracker, renderers);
    expect(code).toContain('import * as component from "/src/droplets/tracker/+droplet.script.ts";');
    expect(code).toContain(`import * as renderer from ${JSON.stringify(scriptRenderer().client)};`);
    expect(code).toContain('"/src/droplets/tracker/+droplet.ts"');
    expect(code).not.toContain("+droplet.server.ts");
  });
});

describe("./$types of a script droplet", () => {
  it("type its default export by the loads' data", () => {
    const code = dropletTypesCode(tracker, scriptRenderer(), "/p/.droplets/types/src/droplets/tracker/$types.d.ts", "/p/src/droplets/tracker");
    expect(code).toContain('import type { DropletScript as BaseDropletScript } from "@dropletsjs/droplets";');
    expect(code).toContain("export type DropletScript = BaseDropletScript<Data>;");
  });

  it("are not there for other droplets", () => {
    const code = dropletTypesCode({ ...tracker, renderer: "svelte", file: "+droplet.svelte" }, svelte, "/p/a/$types.d.ts", "/p/b");
    expect(code).not.toContain("DropletScript");
  });
});
