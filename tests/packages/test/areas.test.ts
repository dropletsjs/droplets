/**
 * `.github/scripts/areas.ts`: which parts of CI a pull request runs, from
 * the files it changes. Each rule's exact outputs, the union, when `dist`
 * builds, a typecheck filter that is safe in a shell and names real
 * projects, and every tracked file of the repository under a rule or the
 * fallback.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FALLBACK, type Outputs, plan, RULES, SAFE_FILTER } from "../../../.github/scripts/areas.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

const EVERYTHING: Outputs = {
  unit: true,
  dist: false,
  runtimes: true,
  integration: true,
  typecheck: true,
  typecheck_filter: "",
  examples: true,
  shop: true,
  demo: true,
  docs: true,
  e2e: true,
  hosts: true,
  docker: true,
};

const NONE: Outputs = {
  unit: false,
  dist: false,
  runtimes: false,
  integration: false,
  typecheck: false,
  typecheck_filter: "",
  examples: false,
  shop: false,
  demo: false,
  docs: false,
  e2e: false,
  hosts: false,
  docker: false,
};

function only(on: Partial<Outputs>): Outputs {
  return { ...NONE, ...on };
}

const outputsOf = (...files: string[]) => plan({ files }).outputs;

const EIGHT = ["handlebars", "hono-jsx", "lit", "preact", "react", "solid", "svelte", "vue"]
  .map((name) => `--filter ./examples/frameworks/${name}`)
  .join(" ");

const RUN_EVERYTHING = [
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package.json",
  ".github/workflows/ci.yml",
  ".github/scripts/areas.ts",
  "packages/shared/hosts.ts",
  "packages/shared/README.md",
  "biome.jsonc",
  "tsconfig.json",
  "apps/docs/tsconfig.json",
  "examples/hosts/astro/tsconfig.app.json",
  ".dockerignore",
  ".changeset/config.json",
  "packages/droplets/src/runtime/app.ts",
  "packages/renderers/svelte/package.json",
];

const SAMPLES: Array<[string, Outputs]> = [
  ["apps/docs/astro.config.mjs", only({ docs: true, dist: true, typecheck: true, typecheck_filter: "--filter ./apps/docs" })],
  ["apps/docs/src/content/docs/start/x.md", only({ docs: true, dist: true, typecheck: true, typecheck_filter: "--filter ./apps/docs" })],
  ["README.md", NONE],
  ["CONTRIBUTING.md", NONE],
  ["LICENSE", NONE],
  ["docs/style/code.md", NONE],
  [".vscode/settings.json", NONE],
  [".changeset/brave-cats-sing.md", NONE],
  ["packages/droplets/README.md", NONE],
  ["packages/droplets/src/core/AGENTS.md", NONE],
  ["examples/hosts/astro/CLAUDE.md", NONE],
  [
    "apps/demo/src/droplets/counter-svelte/+droplet.svelte",
    only({ demo: true, docs: true, dist: true, typecheck: true, typecheck_filter: "--filter ./apps/demo" }),
  ],
  [
    "examples/shop/src/lib/db.ts",
    only({ shop: true, dist: true, typecheck: true, typecheck_filter: "--filter ./examples/shop --filter ./examples/wp-shop" }),
  ],
  [
    "examples/wp-shop/test/unit.test.ts",
    only({ shop: true, dist: true, typecheck: true, typecheck_filter: "--filter ./examples/shop --filter ./examples/wp-shop" }),
  ],
  ["examples/frameworks/vue/src/x.vue", only({ examples: true, e2e: true, dist: true, typecheck: true, typecheck_filter: EIGHT })],
  [
    "examples/frameworks/svelte/src/x.svelte",
    only({ examples: true, e2e: true, docker: true, dist: true, typecheck: true, typecheck_filter: EIGHT }),
  ],
  [
    "examples/frameworks/Dockerfile",
    only({ examples: true, e2e: true, docker: true, dist: true, typecheck: true, typecheck_filter: EIGHT }),
  ],
  ["examples/hosts/hosts.json", only({ hosts: true, docs: true, dist: true })],
  ["examples/hosts/express/src/server.js", only({ hosts: true })],
  ["tests/examples/e2e/examples.spec.ts", only({ e2e: true, typecheck: true, typecheck_filter: "--filter ./tests/examples" })],
  ["tests/hosts/typecheck.mjs", only({ hosts: true, typecheck: true, typecheck_filter: "--filter ./tests/hosts" })],
  ...["create-droplets", "djs-add", "dev-mixed", "packages"].map((name): [string, Outputs] => [
    `tests/${name}/test/x.test.ts`,
    only({ integration: true, dist: true, typecheck: true, typecheck_filter: `--filter ./tests/${name}` }),
  ]),
];

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8" }).split("\0").filter(Boolean);
}

describe("areas: everything", () => {
  it.each([
    ["undefined", undefined],
    ["[]", []],
  ])("plans everything for %s", (_name, files) => {
    expect(plan({ files }).outputs).toEqual(EVERYTHING);
  });

  it.each(RUN_EVERYTHING)("plans everything for %s, alone and with others", (file) => {
    expect(outputsOf(file)).toEqual(EVERYTHING);
    expect(outputsOf("README.md", file, "apps/demo/src/x.ts")).toEqual(EVERYTHING);
  });

  it.each(["foo/bar.txt", ".gitignore", ".env.example", "tests/vitest.workspace.ts", "examples/new.ts"])(
    "plans everything for %s, which no rule knows",
    (file) => {
      expect(outputsOf(file)).toEqual(EVERYTHING);
      expect(plan({ files: [file] }).because["unit"]).toEqual([FALLBACK.name]);
    },
  );
});

describe("areas: the rules", () => {
  it.each(SAMPLES)("%s", (file, expected) => {
    expect(outputsOf(file)).toEqual(expected);
  });

  it("joins two areas", () => {
    expect(outputsOf("examples/hosts/nginx/nginx.conf", "tests/examples/e2e/lit.spec.ts", "README.md")).toEqual(
      only({ hosts: true, e2e: true, typecheck: true, typecheck_filter: "--filter ./tests/examples" }),
    );
    expect(outputsOf("apps/demo/src/x.ts", "tests/hosts/run.mjs")).toEqual(
      only({
        demo: true,
        docs: true,
        hosts: true,
        dist: true,
        typecheck: true,
        typecheck_filter: "--filter ./apps/demo --filter ./tests/hosts",
      }),
    );
  });

  it("builds dist/ exactly when a command needs it and the unit build does not run", () => {
    // The Browser job builds its own dist/; the hosts and the tests' typechecks need none.
    for (const file of ["tests/examples/e2e/x.ts", "tests/hosts/x.ts", "examples/hosts/php/index.php", "README.md"]) {
      expect(outputsOf(file).dist, file).toBe(false);
    }
    for (const file of ["apps/docs/x.ts", "apps/demo/x.ts", "examples/shop/x.ts", "examples/frameworks/lit/x.ts", "tests/djs-add/x.ts"]) {
      expect(outputsOf(file).dist, file).toBe(true);
    }
    expect(outputsOf("apps/docs/x.ts", "packages/droplets/src/x.ts")).toMatchObject({ unit: true, dist: false });
  });
});

describe("areas: the typecheck filter", () => {
  const filters = [
    ...SAMPLES.map(([file]) => outputsOf(file)),
    outputsOf(...SAMPLES.map(([file]) => file).filter((file) => !RUN_EVERYTHING.includes(file))),
  ].map((outputs) => outputs.typecheck_filter);

  it("is only paths and flags, safe as words in a shell", () => {
    for (const filter of filters) {
      expect(filter).toMatch(SAFE_FILTER);
      expect(filter).toMatch(/^(--filter \.\/[\w./-]+( |$))*$/);
    }
  });

  it("names workspace projects that have a typecheck script", () => {
    const projects = new Set(filters.flatMap((filter) => filter.split(" ").filter((word) => word.startsWith("./"))));
    expect(projects.size).toBeGreaterThan(0);
    for (const project of projects) {
      const manifest = JSON.parse(readFileSync(join(repo, project, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      expect(manifest.scripts?.["typecheck"], project).toBeDefined();
    }
  });

  it("names every framework example", () => {
    const examples = readdirSync(join(repo, "examples/frameworks"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(repo, "examples/frameworks", entry.name, "package.json")))
      .map((entry) => `--filter ./examples/frameworks/${entry.name}`)
      .sort();
    expect(examples.join(" ")).toBe(EIGHT);
  });
});

describe("areas: the repository's files", () => {
  const files = trackedFiles();

  it("puts every tracked file under a rule, or the fallback for the names listed here", () => {
    expect(files.length).toBeGreaterThan(1000);
    const unmatched = files.filter((file) => !RULES.some((rule) => rule.matches(file)));
    expect([...new Set(unmatched.map((file) => file.split("/")[0]))].sort()).toEqual([".env.example", ".gitignore"]);
  });

  it("plans everything for the whole tree", () => {
    expect(plan({ files }).outputs).toEqual(EVERYTHING);
  });
});
