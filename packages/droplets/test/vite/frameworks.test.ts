import { describe, expect, it } from "vitest";
import type { DropletEntry } from "../../src/core/discover.ts";
import type { DropletRenderer } from "../../src/renderer.ts";
import { withScriptRenderer } from "../../src/script/index.ts";
import { checkDropletGraphs, componentSpecifier, isStylesheet, markOf, ownersOf, ownersOfImport } from "../../src/vite/frameworks.ts";
import { createInitialState } from "../../src/vite/state.ts";

const renderer = (name: string, extra: Partial<DropletRenderer>): DropletRenderer => ({
  name,
  extensions: [],
  server: `/r/${name}/server.js`,
  client: `/r/${name}/client.js`,
  ...extra,
});
const svelte = renderer("svelte", { extensions: [".svelte"], packages: ["svelte"], suffixes: [".svelte.ts", ".svelte.js"] });
const react = renderer("react", { extensions: [".tsx", ".jsx"], packages: ["react", "react-dom"] });
const solid = renderer("solid", { extensions: [".tsx", ".jsx"], packages: ["solid-js"] });
const hono = renderer("hono-jsx", { extensions: [".tsx", ".jsx"], packages: ["hono/jsx"] });
const renderers = [svelte, react, solid];

describe("marks", () => {
  it("reads the renderer a module is marked with", () => {
    expect(markOf("/app/src/lib/Button.tsx?droplets-renderer=solid")).toBe("solid");
    expect(markOf("/app/src/lib/Button.tsx?v=1&droplets-renderer=react")).toBe("react");
    expect(markOf("/app/src/lib/Button.tsx")).toBeNull();
  });

  it("marks a component import only when its renderer shares an extension", () => {
    const shared = new Set(["react", "solid"]);
    expect(componentSpecifier("/src/droplets/a/+droplet.tsx", "react", shared)).toBe(
      "/src/droplets/a/+droplet.tsx?droplets-renderer=react",
    );
    expect(componentSpecifier("/src/droplets/b/+droplet.svelte", "svelte", shared)).toBe("/src/droplets/b/+droplet.svelte");
  });
});

describe("ownersOf", () => {
  it("knows each engine's files and packages, and leaves neutral code alone", () => {
    expect(ownersOf("/app/src/lib/Card.svelte", renderers)).toEqual(["svelte"]);
    expect(ownersOf("/app/src/lib/count.svelte.ts?droplets-renderer=react", renderers)).toEqual(["svelte"]);
    expect(ownersOf("/app/node_modules/.pnpm/react@19/node_modules/react/index.js", renderers)).toEqual(["react"]);
    expect(ownersOf("/app/node_modules/solid-js/web/dist/web.js", renderers)).toEqual(["solid"]);
    // A .tsx file is React's or Solid's: the mark says which build it is.
    expect(ownersOf("/app/src/lib/Button.tsx", renderers)).toEqual(["react", "solid"]);
    expect(ownersOf("/app/src/lib/format.ts", renderers)).toEqual([]);
    expect(ownersOf("/app/node_modules/react-icons/index.js", renderers)).toEqual([]);
  });
});

describe("ownersOf, with a renderer that owns a subpath", () => {
  it("owns that folder of the package, wherever its builds put it, and nothing else of it", () => {
    const withHono = [...renderers, hono];
    expect(ownersOf("/app/node_modules/.pnpm/hono@4/node_modules/hono/dist/jsx/dom/index.js", withHono)).toEqual(["hono-jsx"]);
    expect(ownersOf("/app/node_modules/hono/dist/cjs/jsx/jsx-runtime.js", withHono)).toEqual(["hono-jsx"]);
    expect(ownersOf("/app/node_modules/hono/dist/hono.js", withHono)).toEqual([]);
    expect(ownersOf("/app/node_modules/hono/dist/middleware/jsx-renderer/index.js", withHono)).toEqual([]);
    expect(ownersOf("/app/node_modules/hono-jsx-extra/jsx/index.js", withHono)).toEqual([]);
  });

  it("knows the subpath by name in an import, and leaves the rest of the package alone", () => {
    const withHono = [...renderers, hono];
    const prebundled = "/app/node_modules/.vite/deps/hono_jsx_dom.js";
    expect(ownersOfImport("hono/jsx", prebundled, withHono)).toEqual(["hono-jsx"]);
    expect(ownersOfImport("hono/jsx/dom/client", prebundled, withHono)).toEqual(["hono-jsx"]);
    expect(ownersOfImport("hono", "/app/node_modules/hono/dist/index.js", withHono)).toEqual([]);
    expect(ownersOfImport("hono/jsx-renderer", "/app/node_modules/hono/dist/middleware/jsx-renderer/index.js", withHono)).toEqual([]);
  });
});

describe("ownersOfImport", () => {
  it("knows a package by its name, whatever the dev server resolved it to", () => {
    const prebundled = "/app/node_modules/.vite/deps/solid-js.js?v=1";
    expect(ownersOfImport("solid-js", prebundled, renderers)).toEqual(["solid"]);
    expect(ownersOfImport("solid-js/web", prebundled, renderers)).toEqual(["solid"]);
    expect(ownersOfImport("react-dom/client", "/x.js", renderers)).toEqual(["react"]);
    expect(ownersOfImport("./Card.svelte", "/app/src/lib/Card.svelte", renderers)).toEqual(["svelte"]);
    expect(ownersOfImport("$droplets/drop", "\0$droplets/drop", renderers)).toEqual([]);
    expect(ownersOfImport("@scope/react", "/x.js", renderers)).toEqual([]);
  });
});

describe("checkDropletGraphs", () => {
  const state = createInitialState();
  state.root = "/app";
  state.dropletsRoot = "/app/src/droplets";
  state.renderers = renderers;
  const entry = (name: string, file: string, renderer: string): DropletEntry => ({
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
  state.entries = [entry("r", "+droplet.tsx", "react"), entry("s", "+droplet.svelte", "svelte")];

  const graph = (edges: Record<string, string[]>) => (id: string) =>
    id in edges ? { importedIds: edges[id]!, dynamicallyImportedIds: [] } : null;

  it("accepts neutral code and the droplet's own framework", () => {
    const edges = {
      "/app/src/droplets/r/+droplet.tsx?droplets-renderer=react": [
        "/app/src/lib/format.ts?droplets-renderer=react",
        "/app/node_modules/react/index.js",
      ],
      "/app/src/lib/format.ts?droplets-renderer=react": [],
      "/app/src/droplets/s/+droplet.svelte": ["/app/src/lib/format.ts", "/app/src/lib/count.svelte.ts"],
    };
    expect(() => checkDropletGraphs(state, Object.keys(edges), graph(edges))).not.toThrow();
  });

  it("fails on another framework's module, naming the import chain", () => {
    const edges = {
      "/app/src/droplets/s/+droplet.svelte": ["/app/src/lib/index.ts"],
      "/app/src/lib/index.ts": ["/app/node_modules/.pnpm/react@19/node_modules/react/index.js"],
    };
    expect(() => checkDropletGraphs(state, Object.keys(edges), graph(edges))).toThrow(
      "droplets: a svelte droplet imports react code: src/droplets/s/+droplet.svelte -> src/lib/index.ts -> " +
        "react/index.js. A droplet uses its own framework's modules and neutral code only.",
    );
  });

  it("fails on a rune module in a React droplet", () => {
    const edges = {
      "/app/src/droplets/r/+droplet.tsx?droplets-renderer=react": ["/app/src/lib/count.svelte.ts?droplets-renderer=react"],
    };
    expect(() => checkDropletGraphs(state, Object.keys(edges), graph(edges))).toThrow(
      "a react droplet imports svelte code",
    );
  });

  it("leaves a script droplet alone, and owns nothing for it", () => {
    const scripted = createInitialState();
    scripted.root = "/app";
    scripted.dropletsRoot = "/app/src/droplets";
    scripted.renderers = withScriptRenderer(renderers);
    scripted.entries = [...state.entries, entry("t", "+droplet.script.ts", "script")];
    const edges = {
      // A widget built on React, from a script droplet.
      "/app/src/droplets/t/+droplet.script.ts": ["/app/node_modules/react/index.js", "/app/src/lib/Badge.svelte"],
      // A helper named like a script, from a Svelte droplet.
      "/app/src/droplets/s/+droplet.svelte": ["/app/src/lib/consent.script.ts"],
    };
    expect(() => checkDropletGraphs(scripted, Object.keys(edges), graph(edges))).not.toThrow();
  });
});

describe("isStylesheet", () => {
  it("takes CSS in any of Vite's languages, a virtual style id included", () => {
    expect(isStylesheet("/app/src/a.css")).toBe(true);
    expect(isStylesheet("./theme.scss")).toBe(true);
    expect(isStylesheet("/app/src/droplets/a/+droplet.hbs?droplets-style=0&lang.css")).toBe(true);
    expect(isStylesheet("C:\\app\\a.less")).toBe(true);
  });

  it("leaves CSS imported as a string, and scripts, alone", () => {
    for (const id of ["./a.css?url", "./a.css?raw", "./a.css?inline", "./a.css?inline&lang.css"]) expect(isStylesheet(id)).toBe(false);
    expect(isStylesheet("/app/src/lib/theme.css.ts")).toBe(false);
    expect(isStylesheet("/app/src/droplets/a/+droplet.ts")).toBe(false);
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
  const graph = (edges: Record<string, string[]>) => (id: string) =>
    id in edges ? { importedIds: edges[id]!, dynamicallyImportedIds: [] } : null;
  const advice = "Styles belong to the component: import them from +droplet.<ext> or +error.<ext> (or a <style> block).";

  it("accepts CSS the component imports, and strings of CSS anywhere", () => {
    const edges = {
      "/app/src/droplets/card/+droplet.svelte": ["/app/src/droplets/card/card.css", "/app/src/lib/format.ts"],
      "/app/src/droplets/card/+droplet.ts": ["/app/src/lib/format.ts", "/app/src/droplets/card/card.css?inline"],
      "/app/src/lib/format.ts": [],
    };
    expect(() => checkDropletGraphs(state, Object.keys(edges), graph(edges))).not.toThrow();
  });

  it("fails on CSS +droplet.ts imports", () => {
    const edges = { "/app/src/droplets/card/+droplet.ts": ["/app/src/droplets/card/style.css"] };
    expect(() => checkDropletGraphs(state, Object.keys(edges), graph(edges))).toThrow(
      `droplets: src/droplets/card/+droplet.ts imports CSS: src/droplets/card/+droplet.ts -> src/droplets/card/style.css. ${advice}`,
    );
  });

  it("fails on CSS +droplet.server.ts reaches through a module, naming the chain", () => {
    const edges = {
      "/app/src/droplets/card/+droplet.server.ts": ["/app/src/lib/x.ts"],
      "/app/src/lib/x.ts": ["/app/node_modules/ui/a.css"],
    };
    expect(() => checkDropletGraphs(state, Object.keys(edges), graph(edges))).toThrow(
      "droplets: src/droplets/card/+droplet.server.ts imports CSS: src/droplets/card/+droplet.server.ts -> src/lib/x.ts -> ui/a.css.",
    );
  });
});
