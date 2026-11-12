/**
 * What a new project is made of, and how the command line spells it. The
 * prompts in `index.ts` fill in whatever the flags leave out.
 */
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { FRAMEWORKS, frameworkNamed, isValidElementName, PACKAGE_MANAGERS, type Framework, type PackageManager } from "./shared.ts";

export type Adapter = "node" | "cloudflare" | "bun" | "deno";

export type AdapterOption = { value: Adapter; label: string; hint: string; package: string; factory: string };

export const ADAPTERS: readonly AdapterOption[] = [
  { value: "node", label: "Node", hint: "dist/server.js for node", package: "@dropletsjs/adapter-node", factory: "node" },
  {
    value: "cloudflare",
    label: "Cloudflare Workers",
    hint: "dist/worker.js for wrangler",
    package: "@dropletsjs/adapter-cloudflare",
    factory: "cloudflare",
  },
  { value: "bun", label: "Bun", hint: "dist/server.js for bun", package: "@dropletsjs/adapter-bun", factory: "bun" },
  { value: "deno", label: "Deno", hint: "dist/server.js for deno serve", package: "@dropletsjs/adapter-deno", factory: "deno" },
];

export type Choices = {
  /** The project folder, as given (relative to the working directory, or absolute). */
  folder: string;
  /** The `name` in package.json. */
  name: string;
  /** The custom element every droplet renders in. */
  element: string;
  /** In catalog order. */
  frameworks: Framework[];
  /** In `ADAPTERS` order. */
  adapters: Adapter[];
  tailwind: boolean;
  /** `dev: { injectTool: true }`: the dev tool on every host page under `vite dev`. */
  injectTool: boolean;
  /** Writes CLAUDE.md next to AGENTS.md. */
  claude: boolean;
  pm: PackageManager;
};

export type Commands = { install: string; run: string; djs: string };

type CommandsInput = Pick<Choices, "pm">;

/** How each package manager runs a script and a local binary: `pnpm run dev`, `pnpm exec djs`. */
export function commands({ pm }: CommandsInput): Commands {
  switch (pm) {
    case "npm":
      return { install: "npm install", run: "npm run", djs: "npx djs" };
    case "pnpm":
      return { install: "pnpm install", run: "pnpm run", djs: "pnpm exec djs" };
    case "yarn":
      return { install: "yarn install", run: "yarn run", djs: "yarn djs" };
    case "bun":
      return { install: "bun install", run: "bun run", djs: "bunx djs" };
    case "deno":
      // `deno task` finds `djs` in node_modules/.bin; outside a task, Deno runs a package's binary by name.
      return { install: "deno install", run: "deno task", djs: "deno run -A npm:@dropletsjs/droplets/djs" };
  }
}

type StarterNameInput = { framework: Framework };

/** The starter droplet's folder: `hello-svelte`, `hello-hono`. */
export function starterName({ framework }: StarterNameInput): string {
  return `hello-${framework.name === "hono-jsx" ? "hono" : framework.name}`;
}

type DefaultAdapterInput = { adapters: readonly Adapter[] };

/** The adapter `vite build` uses without `DROPLETS_ADAPTER`: node when chosen, else the first. */
export function defaultAdapter({ adapters }: DefaultAdapterInput): Adapter {
  if (adapters.includes("node")) return "node";
  const [first] = adapters;
  if (first === undefined) throw new Error("create-droplets: no adapter chosen");
  return first;
}

type PackageNameForInput = { folder: string };

/** A package name from the folder: `My Widgets` → `my-widgets`. */
export function packageNameFor({ folder }: PackageNameForInput): string {
  const name = basename(folder)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|-+$/g, "");
  return name || "droplets";
}

type SuggestElementInput = { folder: string };

/** The element the folder suggests: its name, or `<name>-droplets` when that has no hyphen. */
export function suggestElement({ folder }: SuggestElementInput): string {
  const name = packageNameFor({ folder }).replace(/^[^a-z]+/, "");
  if (!name) return "my-droplets";
  return isValidElementName(name) ? name : `${name.replace(/-+$/, "")}-droplets`;
}

type ElementProblemInput = { element: string };

/** Why `element` cannot name the custom element, or `undefined` when it can. */
export function elementProblem({ element }: ElementProblemInput): string | undefined {
  return isValidElementName(element) ? undefined : "lowercase letters, digits and a hyphen, starting with a letter: my-widgets";
}

export type Flags = {
  folder?: string;
  element?: string;
  frameworks?: Framework[];
  adapters?: Adapter[];
  tailwind?: boolean;
  injectTool?: boolean;
  claude?: boolean;
  pm?: PackageManager;
  install: boolean;
  git: boolean;
  yes: boolean;
  help: boolean;
};

export const USAGE = `Usage: npm create droplets@latest [folder] [options]

  --element <name>        the custom element (default: the folder name, or <folder>-droplets when it has no hyphen)
  --frameworks <list>     ${FRAMEWORKS.map((f) => f.name).join(",")}
  --adapters <list>       ${ADAPTERS.map((a) => a.value).join(",")} (default: node)
  --tailwind, --no-tailwind
  --inject-tool           the dev tool on external host pages under vite dev
  --claude                CLAUDE.md next to AGENTS.md
  --pm <pm>               ${PACKAGE_MANAGERS.join(" | ")} (default: the one running this)
  --no-install            write the files only
  --no-git                no git init
  --yes, -y               ask nothing: the folder and --frameworks are then required`;

type ListInput<T> = {
  value: string | undefined;
  flag: string;
  pick: (item: string) => T | undefined;
  allowed: readonly string[];
};

function list<T>({ value, flag, pick, allowed }: ListInput<T>): T[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const picked = items.map((item) => {
    const found = pick(item);
    if (found === undefined) throw new Error(`--${flag} ${item}: expected ${allowed.join(", ")}`);
    return found;
  });
  if (picked.length === 0) throw new Error(`--${flag}: name at least one of ${allowed.join(", ")}`);
  return [...new Set(picked)];
}

type ParseFlagsInput = { argv: string[] };

/** The command line, checked: unknown values are errors, unset ones stay `undefined`. */
export function parseFlags({ argv }: ParseFlagsInput): Flags {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      element: { type: "string" },
      frameworks: { type: "string" },
      adapters: { type: "string" },
      tailwind: { type: "boolean" },
      "inject-tool": { type: "boolean" },
      claude: { type: "boolean" },
      pm: { type: "string" },
      install: { type: "boolean", default: true },
      git: { type: "boolean", default: true },
      yes: { type: "boolean", short: "y", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (positionals.length > 1) throw new Error(`one folder, not ${positionals.length}: ${positionals.join(" ")}`);
  const frameworkNames = FRAMEWORKS.map((f) => f.name);
  const adapterNames = ADAPTERS.map((a) => a.value);
  const frameworks = list({
    value: values.frameworks,
    flag: "frameworks",
    pick: (name) => frameworkNamed({ name }),
    allowed: frameworkNames,
  });
  const adapters = list({
    value: values.adapters,
    flag: "adapters",
    pick: (a) => adapterNames.find((name) => name === a),
    allowed: adapterNames,
  });
  if (values.pm !== undefined && !(PACKAGE_MANAGERS as readonly string[]).includes(values.pm)) {
    throw new Error(`--pm ${values.pm}: expected ${PACKAGE_MANAGERS.join(", ")}`);
  }
  if (values.element !== undefined) {
    const problem = elementProblem({ element: values.element });
    if (problem) throw new Error(`--element ${values.element}: ${problem}`);
  }
  return {
    ...(positionals[0] !== undefined ? { folder: positionals[0] } : {}),
    ...(values.element !== undefined ? { element: values.element } : {}),
    // Catalog and adapter order, whatever order the flags gave.
    ...(frameworks ? { frameworks: FRAMEWORKS.filter((f) => frameworks.includes(f)) } : {}),
    ...(adapters ? { adapters: adapterNames.filter((a) => adapters.includes(a)) } : {}),
    ...(values.tailwind !== undefined ? { tailwind: values.tailwind } : {}),
    ...(values["inject-tool"] !== undefined ? { injectTool: values["inject-tool"] } : {}),
    ...(values.claude !== undefined ? { claude: values.claude } : {}),
    ...(values.pm !== undefined ? { pm: values.pm as PackageManager } : {}),
    install: values.install,
    git: values.git,
    yes: values.yes,
    help: values.help,
  };
}
