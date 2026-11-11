import { describe, expect, it } from "vitest";
import type { DropletEntry } from "../../src/core/discover.ts";
import type { DropletRenderer } from "../../src/renderer.ts";
import { withScriptRenderer } from "../../src/script/index.ts";
import { checkDropletGraphs, componentSpecifier, isStylesheet, markOf, ownersOf, ownersOfImport } from "../../src/vite/renderer-graphs.ts";
import { createInitialState } from "../../src/vite/state.ts";

type RendererInput = Pick<DropletRenderer, "name"> & Partial<DropletRenderer>;

const renderer = ({ name, ...extra }: RendererInput): DropletRenderer => ({
  name,
  extensions: [],
  server: `/r/${name}/server.js`,
  client: `/r/${name}/client.js`,
  ...extra,
});
const svelte = renderer({ name: "svelte", extensions: [".svelte"], packages: ["svelte"], suffixes: [".svelte.ts", ".svelte.js"] });
const react = renderer({ name: "react", extensions: [".tsx", ".jsx"], packages: ["react", "react-dom"] });
const solid = renderer({ name: "solid", extensions: [".tsx", ".jsx"], packages: ["solid-js"] });
const hono = renderer({ name: "hono-jsx", extensions: [".tsx", ".jsx"], packages: ["hono/jsx"] });
const renderers = [svelte, react, solid];

describe("marks", () => {
  it("reads the renderer a module is marked with", () => {
    expect(markOf({ id: "/app/src/lib/Button.tsx?droplets-renderer=solid" })).toBe("solid");
    expect(markOf({ id: "/app/src/lib/Button.tsx?v=1&droplets-renderer=react" })).toBe("react");
    expect(markOf({ id: "/app/src/lib/Button.tsx" })).toBeNull();
  });

  it("marks a component import only when its renderer shares an extension", () => {
    const shared = new Set(["react", "solid"]);
    expect(componentSpecifier({ path: "/src/droplets/a/+droplet.tsx", renderer: "react", shared })).toBe(
      "/src/droplets/a/+droplet.tsx?droplets-renderer=react",
    );
    expect(componentSpecifier({ path: "/src/droplets/b/+droplet.svelte", renderer: "svelte", shared })).toBe(
      "/src/droplets/b/+droplet.svelte",
    );
  });
});

describe("ownersOf", () => {
  it("knows each engine's files and packages, and leaves neutral code alone", () => {
    expect(ownersOf({ id: "/app/src/lib/Card.svelte", renderers: renderers })).toEqual(["svelte"]);
    expect(ownersOf({ id: "/app/src/lib/count.svelte.ts?droplets-renderer=react", renderers: renderers })).toEqual(["svelte"]);
    expect(ownersOf({ id: "/app/node_modules/.pnpm/react@19/node_modules/react/index.js", renderers: renderers })).toEqual(["react"]);
    expect(ownersOf({ id: "/app/node_modules/solid-js/web/dist/web.js", renderers: renderers })).toEqual(["solid"]);
    // A .tsx file is React's or Solid's: the mark says which build it is.
    expect(ownersOf({ id: "/app/src/lib/Button.tsx", renderers: renderers })).toEqual(["react", "solid"]);
    expect(ownersOf({ id: "/app/src/lib/format.ts", renderers: renderers })).toEqual([]);
    expect(ownersOf({ id: "/app/node_modules/react-icons/index.js", renderers: renderers })).toEqual([]);
  });
});

describe("ownersOf, with a renderer that owns a subpath", () => {
  it("owns that folder of the package, wherever its builds put it, and nothing else of it", () => {
    const withHono = [...renderers, hono];
    expect(ownersOf({ id: "/app/node_modules/.pnpm/hono@4/node_modules/hono/dist/jsx/dom/index.js", renderers: withHono })).toEqual([
      "hono-jsx",
    ]);
    expect(ownersOf({ id: "/app/node_modules/hono/dist/cjs/jsx/jsx-runtime.js", renderers: withHono })).toEqual(["hono-jsx"]);
    expect(ownersOf({ id: "/app/node_modules/hono/dist/hono.js", renderers: withHono })).toEqual([]);
    expect(ownersOf({ id: "/app/node_modules/hono/dist/middleware/jsx-renderer/index.js", renderers: withHono })).toEqual([]);
    expect(ownersOf({ id: "/app/node_modules/hono-jsx-extra/jsx/index.js", renderers: withHono })).toEqual([]);
  });

  it("knows the subpath by name in an import, and leaves the rest of the package alone", () => {
    const withHono = [...renderers, hono];
    const prebundled = "/app/node_modules/.vite/deps/hono_jsx_dom.js";
    expect(ownersOfImport({ source: "hono/jsx", resolved: prebundled, renderers: withHono })).toEqual(["hono-jsx"]);
    expect(ownersOfImport({ source: "hono/jsx/dom/client", resolved: prebundled, renderers: withHono })).toEqual(["hono-jsx"]);
    expect(ownersOfImport({ source: "hono", resolved: "/app/node_modules/hono/dist/index.js", renderers: withHono })).toEqual([]);
    expect(
      ownersOfImport({
        source: "hono/jsx-renderer",
        resolved: "/app/node_modules/hono/dist/middleware/jsx-renderer/index.js",
        renderers: withHono,
      }),
    ).toEqual([]);
  });
});

describe("ownersOfImport", () => {
  it("knows a package by its name, whatever the dev server resolved it to", () => {
    const prebundled = "/app/node_modules/.vite/deps/solid-js.js?v=1";
    expect(ownersOfImport({ source: "solid-js", resolved: prebundled, renderers: renderers })).toEqual(["solid"]);
    expect(ownersOfImport({ source: "solid-js/web", resolved: prebundled, renderers: renderers })).toEqual(["solid"]);
    expect(ownersOfImport({ source: "react-dom/client", resolved: "/x.js", renderers: renderers })).toEqual(["react"]);
    expect(ownersOfImport({ source: "./Card.svelte", resolved: "/app/src/lib/Card.svelte", renderers: renderers })).toEqual(["svelte"]);
    expect(ownersOfImport({ source: "$droplets/drop", resolved: "\0$droplets/drop", renderers: renderers })).toEqual([]);
    expect(ownersOfImport({ source: "@scope/react", resolved: "/x.js", renderers: renderers })).toEqual([]);
  });
});

describe("checkDropletGraphs", () => {
  const state = createInitialState();
  state.root = "/app";
  state.dropletsRoot = "/app/src/droplets";
  state.renderers = renderers;
  type EntryInput = Pick<DropletEntry, "name" | "file" | "renderer">;

  const entry = ({ name, file, renderer }: EntryInput): DropletEntry => ({
    id: name,
    name,
    file,
    renderer,
    hasLoad: false,
    hasServerLoad: false,
    hasError: false,
    ssr: true,
    hydrate: true,
    prerender: false,
  });
  state.entries = [
    entry({ name: "r", file: "+droplet.tsx", renderer: "react" }),
    entry({ name: "s", file: "+droplet.svelte", renderer: "svelte" }),
  ];

  const graph = (edges: Record<string, string[]>) => (id: string) => {
    const importedIds = edges[id];
    return importedIds === undefined ? null : { importedIds, dynamicallyImportedIds: [] };
  };

  it("accepts neutral code and the droplet's own framework", () => {
    const edges = {
      "/app/src/droplets/r/+droplet.tsx?droplets-renderer=react": [
        "/app/src/lib/format.ts?droplets-renderer=react",
        "/app/node_modules/react/index.js",
      ],
      "/app/src/lib/format.ts?droplets-renderer=react": [],
      "/app/src/droplets/s/+droplet.svelte": ["/app/src/lib/format.ts", "/app/src/lib/count.svelte.ts"],
    };
    expect(() => checkDropletGraphs({ state: state, moduleIds: Object.keys(edges), getModule: graph(edges) })).not.toThrow();
  });

  it("fails on another framework's module, naming the import chain", () => {
    const edges = {
      "/app/src/droplets/s/+droplet.svelte": ["/app/src/lib/index.ts"],
      "/app/src/lib/index.ts": ["/app/node_modules/.pnpm/react@19/node_modules/react/index.js"],
    };
    expect(() => checkDropletGraphs({ state: state, moduleIds: Object.keys(edges), getModule: graph(edges) })).toThrow(
      "droplets: a svelte droplet imports react code: src/droplets/s/+droplet.svelte -> src/lib/index.ts -> " +
        "react/index.js. A droplet uses its own framework's modules and neutral code only.",
    );
  });

  it("fails on a rune module in a React droplet", () => {
    const edges = {
      "/app/src/droplets/r/+droplet.tsx?droplets-renderer=react": ["/app/src/lib/count.svelte.ts?droplets-renderer=react"],
    };
    expect(() => checkDropletGraphs({ state: state, moduleIds: Object.keys(edges), getModule: graph(edges) })).toThrow(
      "a react droplet imports svelte code",
    );
  });

  it("leaves a script droplet alone, and owns nothing for it", () => {
    const scripted = createInitialState();
    scripted.root = "/app";
    scripted.dropletsRoot = "/app/src/droplets";
    scripted.renderers = withScriptRenderer({ renderers });
    scripted.entries = [...state.entries, entry({ name: "t", file: "+droplet.script.ts", renderer: "script" })];
    const edges = {
      // A widget built on React, from a script droplet.
      "/app/src/droplets/t/+droplet.script.ts": ["/app/node_modules/react/index.js", "/app/src/lib/Badge.svelte"],
      // A helper named like a script, from a Svelte droplet.
      "/app/src/droplets/s/+droplet.svelte": ["/app/src/lib/consent.script.ts"],
    };
    expect(() => checkDropletGraphs({ state: scripted, moduleIds: Object.keys(edges), getModule: graph(edges) })).not.toThrow();
  });
});

describe("isStylesheet", () => {
  it("takes CSS in any of Vite's languages, a virtual style id included", () => {
    expect(isStylesheet({ id: "/app/src/a.css" })).toBe(true);
    expect(isStylesheet({ id: "./theme.scss" })).toBe(true);
    expect(isStylesheet({ id: "/app/src/droplets/a/+droplet.hbs?droplets-style=0&lang.css" })).toBe(true);
    expect(isStylesheet({ id: "C:\\app\\a.less" })).toBe(true);
  });

  it("leaves CSS imported as a string, and scripts, alone", () => {
    for (const id of ["./a.css?url", "./a.css?raw", "./a.css?inline", "./a.css?inline&lang.css"])
      expect(isStylesheet({ id: id })).toBe(false);
    expect(isStylesheet({ id: "/app/src/lib/theme.css.ts" })).toBe(false);
    expect(isStylesheet({ id: "/app/src/droplets/a/+droplet.ts" })).toBe(false);
  });
});

describe("checkDropletGraphs, for styles", () => {
  const state = createInitialState();
  state.root = "/app";
  state.dropletsRoot = "/app/src/droplets";
  state.renderers = renderers;
  state.entries = [
    {
      id: "card",
      name: "card",
      file: "+droplet.svelte",
      renderer: "svelte",
      hasLoad: true,
      hasServerLoad: true,
      hasError: false,
      ssr: true,
      hydrate: true,
      prerender: false,
    },
  ];
  const graph = (edges: Record<string, string[]>) => (id: string) => {
    const importedIds = edges[id];
    return importedIds === undefined ? null : { importedIds, dynamicallyImportedIds: [] };
  };
  const advice = "Styles belong to the component: import them from +droplet.<ext> or +error.<ext> (or a <style> block).";

  it("accepts CSS the component imports, and strings of CSS anywhere", () => {
    const edges = {
      "/app/src/droplets/card/+droplet.svelte": ["/app/src/droplets/card/card.css", "/app/src/lib/format.ts"],
      "/app/src/droplets/card/+droplet.ts": ["/app/src/lib/format.ts", "/app/src/droplets/card/card.css?inline"],
      "/app/src/lib/format.ts": [],
    };
    expect(() => checkDropletGraphs({ state: state, moduleIds: Object.keys(edges), getModule: graph(edges) })).not.toThrow();
  });

  it("fails on CSS +droplet.ts imports", () => {
    const edges = { "/app/src/droplets/card/+droplet.ts": ["/app/src/droplets/card/style.css"] };
    expect(() => checkDropletGraphs({ state: state, moduleIds: Object.keys(edges), getModule: graph(edges) })).toThrow(
      `droplets: src/droplets/card/+droplet.ts imports CSS: src/droplets/card/+droplet.ts -> src/droplets/card/style.css. ${advice}`,
    );
  });

  it("fails on CSS +droplet.server.ts reaches through a module, naming the chain", () => {
    const edges = {
      "/app/src/droplets/card/+droplet.server.ts": ["/app/src/lib/x.ts"],
      "/app/src/lib/x.ts": ["/app/node_modules/ui/a.css"],
    };
    expect(() => checkDropletGraphs({ state: state, moduleIds: Object.keys(edges), getModule: graph(edges) })).toThrow(
      "droplets: src/droplets/card/+droplet.server.ts imports CSS: src/droplets/card/+droplet.server.ts -> src/lib/x.ts -> ui/a.css.",
    );
  });
});
