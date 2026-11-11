import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  discoverDroplets,
  dropletId,
} from "../../src/core/discover.ts";
import { setLogLevel } from "../../src/core/logger.ts";
import {
  importsPackage,
  pickRenderer,
  readExportedFlag,
  readExportedFlags,
  sharingRenderers,
  validateRenderers,
  type DropletRenderer,
} from "../../src/renderer.ts";

/** Renderers as discovery sees them: a name and the extensions they claim. */
const renderer = (name: string, extensions: string[], extra: Partial<DropletRenderer> = {}): DropletRenderer => ({
  name,
  extensions,
  server: `/renderers/${name}/server.js`,
  client: `/renderers/${name}/client.js`,
  ...extra,
});
const svelte = renderer("svelte", [".svelte"]);
const vue = renderer("vue", [".vue"]);
const react = renderer("react", [".tsx", ".jsx"], { packages: ["react", "react-dom"] });
const solid = renderer("solid", [".tsx", ".jsx"], { packages: ["solid-js"] });

describe("dropletId", () => {
  it.each([
    ["hello", "hello"],
    ["HelloWorld", "hello-world"],
    ["hello_world", "hello-world"],
    ["user profile", "user-profile"],
  ])("%s -> %s", (folder, id) => {
    expect(dropletId(folder)).toBe(id);
  });
});

describe("readExportedFlag", () => {
  beforeAll(() => setLogLevel("warn"));
  afterAll(() => setLogLevel("error"));
  afterEach(() => vi.restoreAllMocks());

  it("reads literal booleans", () => {
    const source = `<script module>\n  export const ssr = true;\n  export const hydrate=false\n</script>`;
    expect(readExportedFlag(source, "ssr", "x")).toBe(true);
    expect(readExportedFlag(source, "hydrate", "x")).toBe(false);
    expect(readExportedFlags(source, "x")).toEqual({ ssr: true, hydrate: false });
  });

  it("reads when a droplet hydrates: a boolean, \"visible\" or \"interactive\"", () => {
    expect(readExportedFlags('export const hydrate = "visible";', "x")).toEqual({ hydrate: "visible" });
    expect(readExportedFlags("export const hydrate = 'interactive'", "x")).toEqual({ hydrate: "interactive" });
    expect(readExportedFlags("export const hydrate = false;", "x")).toEqual({ hydrate: false });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readExportedFlags('export const hydrate = "idle";', "x")).toEqual({});
    expect(readExportedFlags('export const ssr = "visible";', "x")).toEqual({});
    expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      '`export const hydrate` must be true, false, "visible" or "interactive"',
    );
  });

  it("returns undefined when the flag is absent", () => {
    expect(readExportedFlag("<script>let a = 1</script>", "ssr", "x")).toBeUndefined();
    expect(readExportedFlags("", "x")).toEqual({});
  });

  it("warns and ignores non-literal values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readExportedFlag("export const ssr = !dev;", "ssr", "x")).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("literal true or false");
  });

  it("does not confuse a flag with a longer name", () => {
    expect(readExportedFlag("export const ssrMode = true;", "ssr", "x")).toBeUndefined();
  });
});

describe("validateRenderers", () => {
  it("maps extensions to renderers", () => {
    const map = validateRenderers([svelte, vue]);
    expect(map.get(".svelte")).toEqual([svelte]);
    expect(map.get(".vue")).toEqual([vue]);
  });

  it("lets renderers share an extension when each lists its packages", () => {
    expect(validateRenderers([react, solid]).get(".tsx")).toEqual([react, solid]);
    expect([...sharingRenderers([svelte, react, solid])]).toEqual(["react", "solid"]);
    expect([...sharingRenderers([svelte, react])]).toEqual([]);
  });

  it("refuses two renderers on one extension, duplicate names and core suffixes", () => {
    expect(() => validateRenderers([renderer("a", [".tsx"]), renderer("b", [".tsx"])])).toThrow(
      /renderers "a" and "b" both claim \.tsx, and "a" lists no packages/,
    );
    expect(() => validateRenderers([react, renderer("b", [".tsx"])])).toThrow(/"b" lists no packages/);
    expect(() => validateRenderers([renderer("a", [".x"]), renderer("a", [".y"])])).toThrow(/named "a"/);
    expect(() => validateRenderers([renderer("a", [".ts"])])).toThrow(/cannot claim "\.ts"/);
    expect(() => validateRenderers([renderer("a", ["vue"])])).toThrow(/start with a dot/);
    expect(() => validateRenderers([renderer("a", [])])).toThrow(/lists no extensions/);
  });
});

describe("importsPackage", () => {
  it("sees imports of the package and its subpaths, and @jsxImportSource", () => {
    expect(importsPackage('import { useState } from "react";', "react")).toBe(true);
    expect(importsPackage("import {createSignal} from 'solid-js/store'", "solid-js")).toBe(true);
    expect(importsPackage('import "react";', "react")).toBe(true);
    expect(importsPackage('const m = await import("react-dom/client")', "react-dom")).toBe(true);
    expect(importsPackage("/** @jsxImportSource solid-js */\nexport default () => <p/>", "solid-js")).toBe(true);
    expect(importsPackage('import x from "react-icons";', "react")).toBe(false);
    expect(importsPackage('import x from "preact";', "react")).toBe(false);
    expect(importsPackage("// works with react\n", "react")).toBe(false);
  });
});

describe("pickRenderer", () => {
  it("picks the renderer whose package the component imports", () => {
    expect(pickRenderer([react, solid], 'import { useState } from "react";', "a/+droplet.tsx")).toBe(react);
    expect(pickRenderer([react, solid], 'import { createSignal } from "solid-js";', "a/+droplet.tsx")).toBe(solid);
    expect(pickRenderer([svelte], "", "a/+droplet.svelte")).toBe(svelte);
  });

  it("falls back to the droplet's renderer for an error page", () => {
    expect(pickRenderer([react, solid], "export default () => <p/>", "a/+error.tsx", solid)).toBe(solid);
  });

  it("says what to add when the imports do not decide", () => {
    expect(() => pickRenderer([react, solid], "export default () => <p/>", "a/+droplet.tsx")).toThrow(
      "a/+droplet.tsx: react and solid both handle this file and it imports neither; import from react or solid-js, " +
        "or add a /** @jsxImportSource <package> */ comment",
    );
    expect(() =>
      pickRenderer([react, solid], 'import "react";\nimport "solid-js";', "a/+droplet.tsx")
    ).toThrow("imports from both");
  });

  it("names a component that two of three renderers claim, as Hono JSX next to React and Solid", () => {
    const hono = { ...solid, name: "hono-jsx", packages: ["hono/jsx"] };
    expect(pickRenderer([react, solid, hono], 'import { useState } from "hono/jsx";', "a/+droplet.tsx")).toBe(hono);
    expect(pickRenderer([react, solid, hono], "/** @jsxImportSource hono/jsx */\nexport default () => <p/>", "a/+droplet.tsx")).toBe(hono);
    expect(() => pickRenderer([react, solid, hono], 'import "react";\nimport "hono/jsx";', "a/+droplet.tsx")).toThrow(
      "a/+droplet.tsx: react, solid and hono-jsx all handle this file and it imports from react and hono-jsx; " +
        "import from react, solid-js or hono/jsx, or add a /** @jsxImportSource <package> */ comment",
    );
    expect(() => pickRenderer([react, solid, hono], "export default () => <p/>", "a/+droplet.tsx")).toThrow("imports none of them");
  });
});

describe("discoverDroplets", () => {
  let root: string;

  const droplet = async (name: string, files: Record<string, string>) => {
    await mkdir(join(root, name), { recursive: true });
    for (const [file, contents] of Object.entries(files)) {
      await writeFile(join(root, name, file), contents);
    }
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-discover-"));
    setLogLevel("warn");
  });
  afterAll(async () => {
    setLogLevel("error");
    await rm(root, { recursive: true, force: true });
  });

  it("returns [] for a missing folder", async () => {
    expect(await discoverDroplets(join(root, "missing"), [svelte])).toEqual([]);
  });

  it("finds components, their renderer, flags and load files, sorted by id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await droplet("Zeta", {
      "+droplet.svelte": "<script module>export const hydrate = false;</script>",
      "+droplet.server.ts": "export const load = () => ({});",
      "+error.vue": "<p>failed</p>",
    });
    await droplet("alpha-beta", {
      "+Droplet.vue": "<p>upper</p>",
      "+droplet.ts": "export const load = (e) => e.data;",
    });
    await droplet("not-a-droplet", { "index.ts": "export {};" });
    // Load files next to no component: not a droplet.
    await droplet("loads-only", { "+droplet.ts": "export {};", "+droplet.server.ts": "export {};" });
    // Nothing is reserved: every route lives under /droplets/, so this is just another droplet.
    await droplet("drops", { "+droplet.svelte": "<p>not reserved</p>" });
    // Same id as alpha-beta; readdir order decides which folder wins, so give
    // it the same files to keep the assertions below order-independent.
    await droplet("AlphaBeta", {
      "+Droplet.vue": "<p>duplicate id</p>",
      "+droplet.ts": "export const load = (e) => e.data;",
    });

    const entries = await discoverDroplets(root, [svelte, vue]);

    expect(entries.map((e) => e.id)).toEqual(["alpha-beta", "drops", "zeta"]);

    const zeta = entries.find((e) => e.id === "zeta");
    expect(zeta).toMatchObject({
      name: "Zeta",
      file: "+droplet.svelte",
      renderer: "svelte",
      hasLoad: false,
      hasServerLoad: true,
      // +error.vue is not in the droplet's framework: ignored.
      hasError: false,
      ssr: true,
      hydrate: false,
      prerender: false,
    });
    expect(zeta).not.toHaveProperty("error");

    const alpha = entries.find((e) => e.id === "alpha-beta");
    expect(alpha).toMatchObject({
      file: "+Droplet.vue",
      renderer: "vue",
      hasLoad: true,
      hasServerLoad: false,
      hasError: false,
      ssr: true,
      hydrate: true,
    });
    expect(alpha?.errorFile).toBeUndefined();
    // Folder order is filesystem-dependent; one of the two spellings wins.
    expect(["alpha-beta", "AlphaBeta"]).toContain(alpha?.name);

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes("duplicate droplet id"))).toBe(true);
    vi.restoreAllMocks();
  });

  it("ignores flags declared by the error page, with a warning in dev only", async () => {
    const other = await mkdtemp(join(tmpdir(), "droplets-discover-"));
    await mkdir(join(other, "docs"));
    await writeFile(join(other, "docs", "+droplet.svelte"), "<script module>export const hydrate = false;</script><p></p>");
    await writeFile(
      join(other, "docs", "+error.svelte"),
      "<script module>export const hydrate = true;\nexport const prerender = true;</script><p></p>",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [built] = await discoverDroplets(other, [svelte]);
    expect(built).toMatchObject({ hasError: true, hydrate: false, prerender: false });
    expect(warn).not.toHaveBeenCalled();

    const [dev] = await discoverDroplets(other, [svelte], { dev: true });
    expect(dev).toMatchObject({ hydrate: false, prerender: false });
    // A rescan says it once.
    await discoverDroplets(other, [svelte], { dev: true });
    const messages = warn.mock.calls.map((call) => String(call[0])).filter((m) => m.includes("+error.svelte"));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(
      'docs/+error.svelte declares "hydrate", "prerender"; ignored, +error.* follows the droplet\'s ssr, hydrate and prerender',
    );
    warn.mockRestore();
  });

  it("lets a renderer read the flags from a sibling file", async () => {
    await droplet("tpl", {
      "+droplet.hbs": "<p>{{data.title}}</p>",
      "+droplet.ts": "export const ssr = true;\nexport const hydrate = false;\nexport const load = () => ({});",
      "+error.hbs": "<p>{{error.message}}</p>",
    });
    const seen: string[] = [];
    const handlebars = renderer("handlebars", [".hbs"], {
      readFlags: async ({ kind, file, readFile }) => {
        seen.push(`${kind}:${file}`);
        return kind === "droplet" ? readExportedFlags((await readFile("+droplet.ts")) ?? "", file) : undefined;
      },
    });
    const [entry] = await discoverDroplets(root, [handlebars, svelte, vue]).then((all) => all.filter((e) => e.id === "tpl"));
    expect(entry).toMatchObject({
      renderer: "handlebars",
      hydrate: false,
      ssr: true,
    });
    expect(seen).toEqual(["droplet:+droplet.hbs", "error:+error.hbs"]);
  });

  it("names the renderer to install for an unknown extension", async () => {
    const other = await mkdtemp(join(tmpdir(), "droplets-discover-"));
    await mkdir(join(other, "docs"));
    await writeFile(join(other, "docs", "+droplet.hbs"), "<p></p>");
    await expect(discoverDroplets(other, [svelte])).rejects.toThrow(
      "docs/+droplet.hbs: no renderer for .hbs; install @dropletsjs/renderer-handlebars and add handlebars() to renderers",
    );
    await writeFile(join(other, "docs", "+droplet.hbs"), "");
    await rm(join(other, "docs", "+droplet.hbs"));
    await writeFile(join(other, "docs", "+droplet.weird"), "");
    await expect(discoverDroplets(other, [svelte])).rejects.toThrow(/docs\/\+droplet\.weird: no renderer for \.weird; add a renderer/);
    // A two-part suffix is known by itself, not by its last part.
    await rm(join(other, "docs", "+droplet.weird"));
    await writeFile(join(other, "docs", "+droplet.lit.ts"), "");
    await expect(discoverDroplets(other, [svelte])).rejects.toThrow(
      "docs/+droplet.lit.ts: no renderer for .lit.ts; install @dropletsjs/renderer-lit and add lit() to renderers",
    );
    await rm(join(other, "docs", "+droplet.lit.ts"));
    await writeFile(join(other, "docs", "+droplet.weird"), "");
    // An error page outside the droplet's framework is ignored, renderer or not.
    await rm(join(other, "docs", "+droplet.weird"));
    await writeFile(join(other, "docs", "+droplet.svelte"), "");
    await writeFile(join(other, "docs", "+error.vue"), "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [docs] = await discoverDroplets(other, [svelte], { dev: true });
    expect(docs).toMatchObject({ id: "docs", hasError: false });
    expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      "docs/+error.vue is not a svelte component like the droplet; ignored",
    );
    warn.mockRestore();
    await rm(other, { recursive: true, force: true });
  });

  it("refuses two components in one folder", async () => {
    const other = await mkdtemp(join(tmpdir(), "droplets-discover-"));
    await mkdir(join(other, "twice"));
    await writeFile(join(other, "twice", "+droplet.svelte"), "");
    await writeFile(join(other, "twice", "+droplet.vue"), "");
    await expect(discoverDroplets(other, [svelte, vue])).rejects.toThrow(
      "twice/ has 2 droplet components (+droplet.svelte, +droplet.vue); keep one",
    );
    await rm(other, { recursive: true, force: true });
  });

  it("tells React and Solid components apart by their imports", async () => {
    const other = await mkdtemp(join(tmpdir(), "droplets-discover-"));
    await mkdir(join(other, "r"));
    await writeFile(join(other, "r", "+droplet.tsx"), 'import { useState } from "react";');
    await writeFile(join(other, "r", "+error.tsx"), "export default () => <p/>;");
    await mkdir(join(other, "s"));
    await writeFile(join(other, "s", "+droplet.tsx"), 'import { createSignal } from "solid-js";');
    await writeFile(join(other, "s", "+error.tsx"), 'import { useState } from "react";');
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entries = await discoverDroplets(other, [react, solid], { dev: true });
    expect(entries.map((e) => [e.id, e.renderer, e.errorFile ?? null])).toEqual([
      ["r", "react", "+error.tsx"],
      ["s", "solid", null],
    ]);
    expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      "s/+error.tsx is not a solid component like the droplet; ignored",
    );
    warn.mockRestore();
    await rm(other, { recursive: true, force: true });
  });
});
