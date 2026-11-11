/**
 * The renderers `djs add` knows: what to install for each, how it appears
 * in `vite.config.ts`, and the component extension it writes. The framework
 * ranges match each renderer's peer dependencies (a test keeps them so).
 * Script droplets need no renderer: `SCRIPT` is offered next to them, and
 * installs and registers nothing.
 */

export type FrameworkName = "svelte" | "vue" | "react" | "preact" | "solid" | "hono-jsx" | "handlebars" | "lit" | "script";

export type Framework = {
  /** The renderer's `name`, as `droplets({ renderers })` reports it. */
  name: FrameworkName;
  /** Built into core (script droplets): nothing to install, nothing to add to the Vite config. */
  builtIn?: true;
  label: string;
  /** The renderer package, installed as a dev dependency. */
  package: string;
  /** Its factory: `import { <factory> } from "<package>"`, then `<factory>()`. */
  factory: string;
  /** The framework itself, installed as dependencies. */
  dependencies: string[];
  /** Types and the like, installed as dev dependencies next to the renderer. */
  devDependencies: string[];
  /** The component extension written: `+droplet<extension>`. */
  extension: string;
  /** For `.tsx` frameworks: the `@jsxImportSource` every component names. */
  jsxImportSource?: string;
};

export const FRAMEWORKS: readonly Framework[] = [
  {
    name: "svelte",
    label: "Svelte",
    package: "@dropletsjs/renderer-svelte",
    factory: "svelte",
    dependencies: ["svelte@^5.5.0"],
    devDependencies: [],
    extension: ".svelte",
  },
  {
    name: "vue",
    label: "Vue",
    package: "@dropletsjs/renderer-vue",
    factory: "vue",
    dependencies: ["vue@^3.5.0"],
    devDependencies: [],
    extension: ".vue",
  },
  {
    name: "react",
    label: "React",
    package: "@dropletsjs/renderer-react",
    factory: "react",
    dependencies: ["react@^19.0.0", "react-dom@^19.0.0"],
    devDependencies: ["@types/react@^19.0.0", "@types/react-dom@^19.0.0"],
    extension: ".tsx",
    jsxImportSource: "react",
  },
  {
    name: "preact",
    label: "Preact",
    package: "@dropletsjs/renderer-preact",
    factory: "preact",
    dependencies: ["preact@^11.0.0", "preact-render-to-string@^6.8.0"],
    devDependencies: [],
    extension: ".tsx",
    jsxImportSource: "preact",
  },
  {
    name: "solid",
    label: "Solid",
    package: "@dropletsjs/renderer-solid",
    factory: "solid",
    dependencies: ["solid-js@^1.9.0"],
    devDependencies: [],
    extension: ".tsx",
    jsxImportSource: "solid-js",
  },
  {
    name: "hono-jsx",
    label: "Hono JSX",
    package: "@dropletsjs/renderer-hono-jsx",
    factory: "honoJsx",
    dependencies: ["hono@^4.13.0"],
    devDependencies: [],
    extension: ".tsx",
    jsxImportSource: "hono/jsx",
  },
  {
    name: "handlebars",
    label: "Handlebars",
    package: "@dropletsjs/renderer-handlebars",
    factory: "handlebars",
    dependencies: [],
    devDependencies: [],
    extension: ".hbs",
  },
  {
    name: "lit",
    label: "Lit",
    package: "@dropletsjs/renderer-lit",
    factory: "lit",
    dependencies: ["lit@^3.3.0"],
    devDependencies: [],
    extension: ".lit.ts",
  },
];

/** A script droplet: `+droplet.script.ts`, plain browser code run with `(data, el)`. Built in. */
export const SCRIPT: Framework = {
  name: "script",
  builtIn: true,
  label: "Script (plain JavaScript)",
  package: "@dropletsjs/droplets",
  factory: "",
  dependencies: [],
  devDependencies: [],
  extension: ".script.ts",
};

/** What `djs add` offers: every renderer, then script droplets. */
export const ADD_KINDS: readonly Framework[] = [...FRAMEWORKS, SCRIPT];

export type KindNamedInput = { name: string };

/** A droplet kind `djs add` offers, by name: a framework (see `frameworkNamed`) or `script`. */
export function kindNamed({ name }: KindNamedInput): Framework | undefined {
  return name === SCRIPT.name ? SCRIPT : frameworkNamed({ name });
}

export type FrameworkNamedInput = { name: string };

/** The framework by renderer name, or by a common alias (`hono`). */
export function frameworkNamed({ name }: FrameworkNamedInput): Framework | undefined {
  const wanted = name === "hono" ? "hono-jsx" : name;
  return FRAMEWORKS.find((framework) => framework.name === wanted);
}

export type PackageNameInput = { spec: string };

/** `react@^19.0.0` → `react`; `@types/react@^19.0.0` → `@types/react`. */
export function packageName({ spec }: PackageNameInput): string {
  const at = spec.indexOf("@", 1);
  return at === -1 ? spec : spec.slice(0, at);
}
