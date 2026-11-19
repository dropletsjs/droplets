/**
 * Which parts of CI a pull request needs, from the files it changes.
 * `.github/workflows/ci.yml` runs it as `node .github/scripts/areas.ts`
 * before the install, so it has no dependencies. Each file takes the first
 * rule it matches and the plan is the union; a file no rule knows runs
 * everything, and so does a push, a HEAD that is not the PR's merge commit or
 * a git error. Every step after it reads one output and runs unless it is
 * `false`.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const OUTPUTS = [
  "unit",
  "dist",
  "runtimes",
  "integration",
  "typecheck",
  "typecheck_filter",
  "examples",
  "shop",
  "demo",
  "docs",
  "e2e",
  "hosts",
  "docker",
] as const;
export type Output = (typeof OUTPUTS)[number];

/** What a rule turns on itself; `unit`, `runtimes`, `dist` and `typecheck` follow from the plan. */
export type Area = "integration" | "examples" | "shop" | "demo" | "docs" | "e2e" | "hosts" | "docker";

export type Outputs = Record<Exclude<Output, "typecheck_filter">, boolean> & { typecheck_filter: string };

/** `everything`, or the areas and the projects to typecheck (`./<path>`, as `pnpm --filter` takes it). */
export type Runs = "everything" | { readonly areas: readonly Area[]; readonly typecheck: readonly string[] };

export type Rule = { readonly name: string; readonly matches: (file: string) => boolean; readonly runs: Runs };

export type Plan = {
  readonly outputs: Outputs;
  /** The rules behind each output that is on. */
  readonly because: Partial<Record<Output, string[]>>;
  /** The files each rule took, in rule order. */
  readonly matched: ReadonlyArray<{ rule: string; files: string[] }>;
};

export const SAFE_FILTER = /^[\w@./ -]*$/;

const FRAMEWORKS = ["handlebars", "hono-jsx", "lit", "preact", "react", "solid", "svelte", "vue"].map(
  (name) => `./examples/frameworks/${name}`,
);
const NOTES = new Set(["README.md", "AGENTS.md", "CLAUDE.md"]);
const EVERYTHING_FILES = new Set([
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package.json",
  "biome.jsonc",
  ".dockerignore",
  ".changeset/config.json",
]);

function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

function under(...prefixes: string[]): (file: string) => boolean {
  return (file) => prefixes.some((prefix) => file.startsWith(prefix));
}

const nothing: Runs = { areas: [], typecheck: [] };

export const RULES: readonly Rule[] = [
  {
    name: "the workspace, the lockfile, .github, packages/shared, the tool configs",
    matches: (file) =>
      EVERYTHING_FILES.has(file) || under(".github/", "packages/shared/")(file) || /^tsconfig.*\.json$/.test(baseName(file)),
    runs: "everything",
  },
  { name: "apps/docs/**", matches: under("apps/docs/"), runs: { areas: ["docs"], typecheck: ["./apps/docs"] } },
  {
    name: "notes: README.md, AGENTS.md, CLAUDE.md, root *.md, LICENSE, docs/**, .vscode/**, .changeset/*.md",
    matches: (file) =>
      NOTES.has(baseName(file)) ||
      /^[^/]+\.md$/.test(file) ||
      file === "LICENSE" ||
      under("docs/", ".vscode/")(file) ||
      /^\.changeset\/[^/]+\.md$/.test(file),
    runs: nothing,
  },
  { name: "packages/**", matches: under("packages/"), runs: "everything" },
  { name: "apps/demo/**", matches: under("apps/demo/"), runs: { areas: ["demo", "docs"], typecheck: ["./apps/demo"] } },
  {
    name: "examples/shop/**, examples/wp-shop/**",
    matches: under("examples/shop/", "examples/wp-shop/"),
    runs: { areas: ["shop"], typecheck: ["./examples/shop", "./examples/wp-shop"] },
  },
  {
    name: "examples/frameworks/svelte/**, examples/frameworks/Dockerfile",
    matches: (file) => file === "examples/frameworks/Dockerfile" || file.startsWith("examples/frameworks/svelte/"),
    runs: { areas: ["examples", "e2e", "docker"], typecheck: FRAMEWORKS },
  },
  { name: "examples/frameworks/**", matches: under("examples/frameworks/"), runs: { areas: ["examples", "e2e"], typecheck: FRAMEWORKS } },
  {
    name: "examples/hosts/hosts.json",
    matches: (file) => file === "examples/hosts/hosts.json",
    runs: { areas: ["hosts", "docs"], typecheck: [] },
  },
  { name: "examples/hosts/**", matches: under("examples/hosts/"), runs: { areas: ["hosts"], typecheck: [] } },
  { name: "tests/examples/**", matches: under("tests/examples/"), runs: { areas: ["e2e"], typecheck: ["./tests/examples"] } },
  { name: "tests/hosts/**", matches: under("tests/hosts/"), runs: { areas: ["hosts"], typecheck: ["./tests/hosts"] } },
  ...["create-droplets", "djs-add", "dev-mixed", "packages"].map(
    (name): Rule => ({
      name: `tests/${name}/**`,
      matches: under(`tests/${name}/`),
      runs: { areas: ["integration"], typecheck: [`./tests/${name}`] },
    }),
  ),
];

/** The rule for a file no rule matches. */
export const FALLBACK: Rule = { name: "anything else", matches: () => true, runs: "everything" };

/** The areas whose commands need the packages' `dist/`. */
const NEEDS_DIST: readonly Area[] = ["integration", "examples", "shop", "demo", "docs"];

type PlanInput = { files: readonly string[] | undefined };

/** The plan for the changed files; `undefined` or none plans everything. */
export function plan({ files }: PlanInput): Plan {
  const matched = new Map<Rule, string[]>();
  for (const file of files ?? []) {
    const rule = RULES.find((candidate) => candidate.matches(file)) ?? FALLBACK;
    matched.set(rule, [...(matched.get(rule) ?? []), file]);
  }
  const ordered = [...RULES, FALLBACK]
    .filter((rule) => matched.has(rule))
    .map((rule) => ({ rule: rule.name, files: matched.get(rule) ?? [] }));
  const runEverything = [...matched.keys()].filter((rule) => rule.runs === "everything").map((rule) => rule.name);
  if (files === undefined) runEverything.push("no diff");
  else if (files.length === 0) runEverything.push("an empty diff");

  const because: Partial<Record<Output, string[]>> = {};
  const turnOn = (output: Output, reason: string) => {
    const reasons = because[output] ?? [];
    if (!reasons.includes(reason)) reasons.push(reason);
    because[output] = reasons;
  };

  if (runEverything.length > 0) {
    for (const output of OUTPUTS) {
      if (output === "dist" || output === "typecheck_filter") continue;
      for (const reason of runEverything) turnOn(output, reason);
    }
    const outputs: Outputs = {
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
    return { outputs, because, matched: ordered };
  }

  const areas = new Set<Area>();
  const projects = new Set<string>();
  for (const rule of matched.keys()) {
    if (rule.runs === "everything") continue;
    for (const area of rule.runs.areas) {
      areas.add(area);
      turnOn(area, rule.name);
    }
    for (const project of rule.runs.typecheck) {
      projects.add(project);
      turnOn("typecheck", rule.name);
    }
  }
  for (const area of NEEDS_DIST) if (areas.has(area)) turnOn("dist", `${area} needs dist/`);
  const outputs: Outputs = {
    unit: false,
    dist: NEEDS_DIST.some((area) => areas.has(area)),
    runtimes: false,
    integration: areas.has("integration"),
    typecheck: projects.size > 0,
    typecheck_filter: [...projects]
      .sort()
      .map((project) => `--filter ${project}`)
      .join(" "),
    examples: areas.has("examples"),
    shop: areas.has("shop"),
    demo: areas.has("demo"),
    docs: areas.has("docs"),
    e2e: areas.has("e2e"),
    hosts: areas.has("hosts"),
    docker: areas.has("docker"),
  };
  return { outputs, because, matched: ordered };
}

type Changed = { files: string[] | undefined; why: string };

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function changedFiles(): Changed {
  const event = process.env["GITHUB_EVENT_NAME"];
  if (event !== "pull_request") return { files: undefined, why: `a ${event ?? "local"} run plans everything` };
  try {
    // A pull_request run checks out the PR's merge commit: base, then head.
    if (git(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(" ").length !== 3) {
      return { files: undefined, why: "HEAD is not a two-parent merge: everything" };
    }
    const files = git(["diff", "--name-only", "--no-renames", "-z", "HEAD^1", "HEAD"]).split("\0").filter(Boolean);
    return { files, why: `${files.length} files changed against the base` };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.log(`::warning::areas: git failed, so everything runs: ${message}`);
    return { files: undefined, why: "git failed: everything" };
  }
}

type SummaryInput = { result: Plan; why: string };

function summary({ result, why }: SummaryInput): string {
  const rows = OUTPUTS.map((output) => {
    const value = result.outputs[output];
    const shown = typeof value === "boolean" ? (value ? "runs" : "skipped") : value === "" ? "(every project)" : `\`${value}\``;
    return `| \`${output}\` | ${shown} | ${(result.because[output] ?? []).join("; ")} |`;
  });
  const files = result.matched.map(({ rule, files }) => `- ${rule}: ${files.length} (\`${files[0]}\`${files.length > 1 ? ", …" : ""})`);
  return [`### CI areas\n\n${why}.\n`, "| Output | | Because |", "|---|---|---|", ...rows, "", ...files, ""].join("\n");
}

function main(): void {
  const { files, why } = changedFiles();
  const result = plan({ files });
  if (!SAFE_FILTER.test(result.outputs.typecheck_filter)) {
    throw new Error(`areas: unsafe typecheck_filter ${JSON.stringify(result.outputs.typecheck_filter)}`);
  }
  const lines = OUTPUTS.map((output) => `${output}=${result.outputs[output]}\n`).join("");
  const outputFile = process.env["GITHUB_OUTPUT"];
  if (outputFile) appendFileSync(outputFile, lines);
  process.stdout.write(lines);
  const text = summary({ result, why });
  const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
  if (summaryFile) appendFileSync(summaryFile, text);
  else process.stdout.write(text);
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url)) main();
