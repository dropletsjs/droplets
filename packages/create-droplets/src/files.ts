/**
 * The files of a new project, by path: package.json, the Vite and droplets
 * configs, tsconfig, the shared stylesheet, one starter droplet per
 * framework (the files `djs add` writes for `--target full --with server`),
 * AGENTS.md and the rest.
 */
import { agentsMd } from "./agents.ts";
import { ADAPTERS, commands, defaultAdapter, starterName, type Adapter, type Choices } from "./choices.ts";
import { dropletFiles, flagsFor, packageName, VERSIONS, versionOf } from "./shared.ts";

const START: Record<Adapter, string> = {
  node: "node dist/server.js",
  cloudflare: "wrangler dev",
  bun: "bun dist/server.js",
  deno: "deno serve -A dist/server.js",
};

type ScriptsInput = Pick<Choices, "adapters">;

/** The scripts: `build` and `start` for the default adapter, `build:<a>` and `start:<a>` for the others. */
export function scripts({ adapters }: ScriptsInput): Record<string, string> {
  const main = defaultAdapter({ adapters });
  const scripts: Record<string, string> = {
    dev: "vite",
    build: "vite build",
    preview: "vite preview",
    start: START[main],
  };
  if (main === "cloudflare") scripts["deploy"] = "wrangler deploy";
  for (const adapter of adapters.filter((a) => a !== main)) {
    scripts[`build:${adapter}`] = `DROPLETS_ADAPTER=${adapter} vite build`;
    scripts[`start:${adapter}`] = START[adapter];
    if (adapter === "cloudflare") scripts["deploy:cloudflare"] = "wrangler deploy";
  }
  return {
    ...scripts,
    sync: "djs sync",
    typecheck: "djs sync && tsc -p tsconfig.json",
    // Writes .droplets/ after every install, so a fresh checkout type-checks.
    prepare: "djs sync",
  };
}

type SortedInput = { entries: Array<[string, string]> };

function sorted({ entries }: SortedInput): Record<string, string> {
  return Object.fromEntries(entries.toSorted(([a], [b]) => a.localeCompare(b)));
}

type SpecInput = { name: string };

function spec({ name }: SpecInput): [string, string] {
  return [name, versionOf({ name })];
}

type FromCatalogInput = { entry: string };

/** `react@^19.0.0` → `["react", "^19.0.0"]`. */
function fromCatalog({ entry }: FromCatalogInput): [string, string] {
  const name = packageName({ spec: entry });
  return [name, entry.slice(name.length + 1)];
}

export function packageJson(choices: Choices): string {
  const dependencies = sorted({
    entries: [
      spec({ name: "@dropletsjs/droplets" }),
      ...choices.frameworks.flatMap((f) => f.dependencies.map((entry) => fromCatalog({ entry }))),
    ],
  });
  const devDependencies = sorted({
    entries: [
      spec({ name: "@dropletsjs/devtools" }),
      ...ADAPTERS.filter((a) => choices.adapters.includes(a.value)).map((a) => spec({ name: a.package })),
      ...choices.frameworks.map((f) => spec({ name: f.package })),
      // The catalog's types (`@types/react`) at the version the example is tested with.
      ...choices.frameworks.flatMap((f) => f.devDependencies.map((entry) => spec({ name: packageName({ spec: entry }) }))),
      spec({ name: "vite" }),
      spec({ name: "typescript" }),
      spec({ name: "@types/node" }),
      ...(choices.tailwind ? [spec({ name: "tailwindcss" }), spec({ name: "@tailwindcss/vite" })] : []),
      ...(choices.adapters.includes("cloudflare") ? [spec({ name: "wrangler" })] : []),
    ],
  });
  const pkg = { name: choices.name, private: true, type: "module", scripts: scripts(choices), dependencies, devDependencies };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

type ViteConfigInput = Pick<Choices, "adapters" | "frameworks" | "tailwind">;

export function viteConfig({ adapters: chosen, frameworks, tailwind }: ViteConfigInput): string {
  const adapters = ADAPTERS.filter((a) => chosen.includes(a.value));
  const main = defaultAdapter({ adapters: chosen });
  const [only] = adapters;
  const imports = [
    'import { defineConfig } from "vite";',
    'import { droplets } from "@dropletsjs/droplets/vite";',
    'import { dropletsDevtools } from "@dropletsjs/devtools";',
    ...adapters.map((a) => `import { ${a.factory} } from "${a.package}";`),
    ...frameworks.map((f) => `import { ${f.factory} } from "${f.package}";`),
  ];
  const select =
    adapters.length === 1
      ? []
      : [
          "",
          `// \`vite build\` builds for ${main}; \`DROPLETS_ADAPTER=<name> vite build\` for another.`,
          `const adapters = { ${adapters.map((a) => a.factory).join(", ")} };`,
          `const adapter = (adapters[process.env["DROPLETS_ADAPTER"] as keyof typeof adapters] ?? ${main})();`,
        ];
  const options = [
    only !== undefined && adapters.length === 1 ? `      adapter: ${only.factory}(),` : "      adapter,",
    `      renderers: [${frameworks.map((f) => `${f.factory}()`).join(", ")}],`,
    ...(tailwind ? ["      // src/app.css is the shared stylesheet; Tailwind compiles it.", "      css: { tailwind: true },"] : []),
  ];
  return [
    ...imports,
    ...select,
    "",
    "export default defineConfig({",
    "  // The devtools serve `/` in `vite dev` only; builds never see them.",
    "  plugins: [",
    "    droplets({",
    ...options,
    "    }),",
    "    dropletsDevtools(),",
    "  ],",
    "});",
    "",
  ].join("\n");
}

type DropletsConfigInput = Pick<Choices, "element" | "injectTool">;

export function dropletsConfig({ element, injectTool }: DropletsConfigInput): string {
  return [
    'import { config } from "@dropletsjs/droplets";',
    "",
    "export default config({",
    "  // The custom element every droplet renders in. Named after the project,",
    "  // so it never collides with droplets from other servers on one page.",
    `  element: ${JSON.stringify(element)},`,
    "  // Pages on other origins may load these droplets and their bundles.",
    "  cors: true,",
    ...(injectTool
      ? ["  // Under `vite dev`, the dev tool on every page that loads index.js, not only on `/`.", "  dev: { injectTool: true },"]
      : []),
    "});",
    "",
  ].join("\n");
}

type TsconfigInput = Pick<Choices, "frameworks">;

export function tsconfig({ frameworks }: TsconfigInput): string {
  const jsx = frameworks.find((f) => f.jsxImportSource);
  const options: Record<string, unknown> = {
    target: "ES2023",
    lib: ["ES2023", "DOM", "DOM.Iterable"],
    module: "ESNext",
    moduleResolution: "bundler",
    moduleDetection: "force",
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    noEmit: true,
    strict: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    forceConsistentCasingInFileNames: true,
    types: ["node", "vite/client", "@dropletsjs/droplets/ambient"],
    ...(jsx ? { jsx: "react-jsx", jsxImportSource: jsx.jsxImportSource } : {}),
  };
  const include = ["src/**/*.ts", ...(jsx ? ["src/**/*.tsx"] : []), "droplets.config.ts", "vite.config.ts"];
  const body = JSON.stringify({ extends: "./.droplets/tsconfig.json", compilerOptions: options, include }, null, 2);
  // A comment where the generated part comes in.
  return (
    body.replace('  "extends"', '  // .droplets/ is written by `vite` and `djs sync`: it maps each droplet\'s ./$types.\n  "extends"') +
    "\n"
  );
}

type AppCssInput = Pick<Choices, "tailwind">;

export function appCss({ tailwind }: AppCssInput): string {
  const head = [
    "/*",
    " * The stylesheet every droplet shares (`css.path`), linked before each",
    " * droplet's own. Every selector is confined to the droplet element, and",
    " * `:root`, `html` and `body` become the element itself.",
    " */",
  ];
  return [
    ...head,
    ...(tailwind ? ['@import "tailwindcss";', ""] : []),
    ":root {",
    "  display: block;",
    "  font-family: system-ui, sans-serif;",
    "}",
    "",
  ].join("\n");
}

const GITIGNORE = [
  "node_modules/",
  "dist/",
  "# Written by vite and `djs sync`: each droplet's ./$types.",
  ".droplets/",
  ".wrangler/",
  ".env.local",
  ".env.*.local",
  "",
].join("\n");

type WranglerInput = Pick<Choices, "name">;

function wrangler({ name }: WranglerInput): string {
  return `${JSON.stringify(
    {
      $schema: "node_modules/wrangler/config-schema.json",
      name,
      main: "dist/worker.js",
      compatibility_date: "2025-10-01",
      compatibility_flags: ["nodejs_compat"],
      assets: { directory: "dist/client", binding: "ASSETS", run_worker_first: true },
    },
    null,
    2,
  )}\n`;
}

const SVELTE_CONFIG = [
  "/**",
  " * Read by editor tooling. The framework passes the same options to the",
  " * compiler at build time.",
  " */",
  "export default {",
  "  compilerOptions: { runes: true },",
  "};",
  "",
].join("\n");

type ReadmeInput = Pick<Choices, "name" | "pm" | "adapters">;

function readme({ name, pm, adapters }: ReadmeInput): string {
  const { run, djs } = commands({ pm });
  return [
    `# ${name}`,
    "",
    "Droplets: server-rendered components any page can embed. Each one lives in",
    "`src/droplets/<name>/` and is served at `/droplets/<name>`.",
    "",
    "```bash",
    `${run} dev        # http://localhost:5173: the devtools page`,
    `${run} build      # dist/, for ${defaultAdapter({ adapters })}`,
    `${run} typecheck  # djs sync, then tsc`,
    `${djs} add <name>   # a new droplet`,
    "```",
    "",
    "AGENTS.md has the conventions; the guide is at https://dropletsjs.dev.",
    "",
  ].join("\n");
}

const RELEASE_AGE_NOTE = "Droplets' own packages are exempt, so a project made on the day of a release installs.";
const DROPLETS_PACKAGES = Object.keys(VERSIONS)
  .filter((name) => name.startsWith("@dropletsjs/"))
  .sort();

/**
 * The package manager's own settings: install only versions published at
 * least 7 days ago. Bun and Deno document no name pattern for the
 * exemption, so they list every `@dropletsjs/*` package, `djs add`'s too.
 */
type PackageManagerFilesInput = Pick<Choices, "pm">;

export function packageManagerFiles({ pm }: PackageManagerFilesInput): Record<string, string> {
  switch (pm) {
    case "pnpm":
      return {
        "pnpm-workspace.yaml": [
          "# pnpm's settings (pnpm 10 reads them here).",
          "# Install only versions published at least 7 days ago (minutes).",
          `# ${RELEASE_AGE_NOTE}`,
          "minimumReleaseAge: 10080",
          "minimumReleaseAgeExclude:",
          '  - "@dropletsjs/*"',
          "",
        ].join("\n"),
      };
    case "npm":
      return {
        ".npmrc": [
          "# Install only versions published at least 7 days ago (npm 11.10 and later;",
          "# the exemption, npm 11.17 and later).",
          `# ${RELEASE_AGE_NOTE}`,
          "min-release-age=7",
          "min-release-age-exclude=@dropletsjs/*",
          "",
        ].join("\n"),
      };
    case "yarn":
      return {
        ".yarnrc.yml": [
          "# Install only versions published at least 7 days ago (minutes; Yarn 4.10 and later).",
          `# ${RELEASE_AGE_NOTE}`,
          "npmMinimalAgeGate: 10080",
          "npmPreapprovedPackages:",
          '  - "@dropletsjs/*"',
          "",
        ].join("\n"),
      };
    case "bun":
      return {
        "bunfig.toml": [
          "[install]",
          "# Install only versions published at least 7 days ago (seconds).",
          `# ${RELEASE_AGE_NOTE}`,
          "minimumReleaseAge = 604800",
          `minimumReleaseAgeExcludes = [${DROPLETS_PACKAGES.map((name) => JSON.stringify(name)).join(", ")}]`,
          "",
        ].join("\n"),
      };
    case "deno":
      return {
        "deno.json": `${JSON.stringify(
          { minimumDependencyAge: { age: "P7D", exclude: DROPLETS_PACKAGES.map((name) => `npm:${name}`) } },
          null,
          2,
        )}\n`,
      };
  }
}

export function projectFiles(choices: Choices): Record<string, string> {
  const files: Record<string, string> = {
    "package.json": packageJson(choices),
    "vite.config.ts": viteConfig(choices),
    "droplets.config.ts": dropletsConfig(choices),
    "tsconfig.json": tsconfig(choices),
    "src/app.css": appCss(choices),
    ".gitignore": GITIGNORE,
    "AGENTS.md": agentsMd(choices),
    "README.md": readme(choices),
    ...packageManagerFiles(choices),
  };
  if (choices.claude) files["CLAUDE.md"] = "@AGENTS.md\n";
  if (choices.adapters.includes("cloudflare")) files["wrangler.jsonc"] = wrangler(choices);
  if (choices.frameworks.some((f) => f.name === "svelte")) files["svelte.config.js"] = SVELTE_CONFIG;
  for (const framework of choices.frameworks) {
    const name = starterName({ framework });
    const droplet = dropletFiles({
      name,
      framework,
      flags: flagsFor({ target: "full", hydrate: "always" }).flags,
      files: new Set(["server"]),
    });
    for (const [file, content] of Object.entries(droplet)) files[`src/droplets/${name}/${file}`] = content;
  }
  return files;
}
