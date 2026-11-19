/**
 * Every workflow runs on GitHub-hosted runners, from `pull_request` and
 * `push` events only (AGENTS.md rule 22), the release workflow's publish
 * job runs only from a public repository, and the Cloudflare deploys run
 * only on a push to main, after every other CI job, in the `cloudflare`
 * environment, the only jobs that name its secrets. The four required CI jobs
 * keep their names, and every step after the areas step runs by one of its
 * outputs (.github/scripts/areas.ts). The release workflow's
 * version job opens no PR and writes nothing, and Dependabot's npm updates
 * wait as long as pnpm's minimumReleaseAge. The workflows are read line by
 * line, with no YAML parser: a form of `on` or `runs-on` the reader does not
 * know fails the suite, so a workflow never passes because it went unread.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OUTPUTS } from "../../../.github/scripts/areas.ts";

const workflowsDir = fileURLToPath(new URL("../../../.github/workflows/", import.meta.url));
const rootPackage = fileURLToPath(new URL("../../../package.json", import.meta.url));
const dependabotFile = fileURLToPath(new URL("../../../.github/dependabot.yml", import.meta.url));
const workflows = readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort();

const ALLOWED_EVENTS = new Set(["pull_request", "push"]);
const GITHUB_HOSTED = /^(ubuntu|macos|windows)-[a-z0-9.-]+$/;

const withoutComment = (value: string) => value.replace(/\s+#.*$/, "").trim();
const unquote = (value: string) => value.replace(/^(["'])(.*)\1$/, "$2");
const isContent = (line: string) => line.trim() !== "" && !line.trimStart().startsWith("#");
const indentOf = (line: string) => line.length - line.trimStart().length;

/** The event names under the top-level `on`: inline (`on: push`, `on: [push, pull_request]`) or a block of keys or list items. */
function events(source: string): string[] {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => /^["']?on["']?\s*:/.test(line));
  const onLine = lines[start];
  if (onLine === undefined) throw new Error("no top-level `on`");
  const inline = withoutComment(onLine.replace(/^["']?on["']?\s*:/, ""));
  if (inline) {
    if (/[{}]/.test(inline)) throw new Error(`cannot read \`on: ${inline}\``);
    return inline
      .replace(/^\[(.*)\]$/, "$1")
      .split(",")
      .map((name) => unquote(name.trim()));
  }
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!isContent(line)) continue;
    if (indentOf(line) === 0) break;
    block.push(line);
  }
  const first = block[0];
  if (first === undefined) throw new Error("an empty `on`");
  const depth = indentOf(first);
  return block
    .filter((line) => indentOf(line) === depth)
    .map((line) => {
      const entry = withoutComment(line);
      const name = /^(?:-\s+)?(["']?)([A-Za-z_][\w-]*)\1\s*(:|$)/.exec(entry)?.[2];
      if (name === undefined) throw new Error(`cannot read \`${entry}\` under \`on\``);
      return name;
    });
}

/** Every `runs-on` value, as written; a list or an expression comes back as it is and fails the label check. */
function runners(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => /^\s*runs-on\s*:/.test(line))
    .map((line) => unquote(withoutComment(line.replace(/^\s*runs-on\s*:/, ""))));
}

/** The job ids under the top-level `jobs:`, in order. */
function jobIds(source: string): string[] {
  const lines = source.split("\n");
  const start = lines.indexOf("jobs:");
  if (start === -1) throw new Error("no top-level `jobs`");
  const ids: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!isContent(line)) continue;
    if (indentOf(line) === 0) break;
    if (indentOf(line) !== 2) continue;
    const id = /^([A-Za-z_][\w-]*):$/.exec(withoutComment(line))?.[1];
    if (id === undefined) throw new Error(`cannot read \`${line.trim()}\` under \`jobs\``);
    ids.push(id);
  }
  return ids;
}

type JobInput = { source: string; job: string };

/** The lines of `job` under `jobs:`, its header excluded. */
function jobLines({ source, job }: JobInput): string[] {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => indentOf(line) === 2 && withoutComment(line) === `${job}:`);
  if (start === -1) throw new Error(`no job \`${job}\``);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (isContent(line) && indentOf(line) <= 2) break;
    body.push(line);
  }
  return body;
}

type JobKeyInput = JobInput & { key: string };

/** The inline value of the job-level `key` of `job`, as written, or undefined when the job has none. */
function jobKey({ source, job, key }: JobKeyInput): string | undefined {
  for (const line of jobLines({ source, job })) {
    const value = new RegExp(`^ {4}${key}\\s*:(.*)$`).exec(line)?.[1];
    if (value !== undefined) return withoutComment(value);
  }
  return undefined;
}

/** The job-level `if` of `job` under `jobs:`, as written, or undefined when the job has none. */
function jobCondition({ source, job }: JobInput): string | undefined {
  return jobKey({ source, job, key: "if" });
}

/** A job's `needs`, inline (`needs: a`, `needs: [a, b]`); a block list fails the suite. */
function jobNeeds({ source, job }: JobInput): string[] {
  const value = jobKey({ source, job, key: "needs" });
  if (value === undefined) return [];
  if (value === "") throw new Error(`cannot read the block \`needs\` of \`${job}\``);
  return value
    .replace(/^\[(.*)\]$/, "$1")
    .split(",")
    .map((name) => unquote(name.trim()));
}

/** One step of a job: its keys with their inline values, a `run: |` block as its lines joined, a nested map (`with`, `env`) as `with.key`. */
type Step = Map<string, string>;

/** The steps of `job`, in order; a step line the reader cannot place fails the suite. */
function jobSteps({ source, job }: JobInput): Step[] {
  const lines = jobLines({ source, job });
  const start = lines.findIndex((line) => withoutComment(line) === "steps:" && indentOf(line) === 4);
  if (start === -1) throw new Error(`no steps in \`${job}\``);
  const steps: Step[] = [];
  let parent: string | undefined;
  let block: { key: string; indent: number } | undefined;
  for (const raw of lines.slice(start + 1)) {
    if (raw.trim() === "") continue;
    const line = /^ {6}- /.test(raw) ? `        ${raw.slice(8)}` : raw;
    const step = steps.at(-1);
    if (/^ {6}- /.test(raw)) {
      steps.push(new Map());
      parent = undefined;
      block = undefined;
    } else if (block && step && indentOf(line) > block.indent) {
      step.set(block.key, [step.get(block.key), line.trim()].filter(Boolean).join("\n"));
      continue;
    }
    if (!isContent(line)) continue;
    const current = steps.at(-1);
    if (current === undefined || indentOf(line) <= 4) throw new Error(`cannot read \`${line.trim()}\` in the steps of \`${job}\``);
    const entry = /^(\s*)([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (entry === undefined || entry === null) throw new Error(`cannot read \`${line.trim()}\` in the steps of \`${job}\``);
    const [, indent = "", key = "", value = ""] = entry;
    const inline = withoutComment(value);
    if (indent.length === 8) {
      parent = key;
      block = inline === "|" ? { key, indent: 8 } : undefined;
      if (!block && inline !== "") current.set(key, inline);
    } else if (indent.length === 10 && parent !== undefined) {
      current.set(`${parent}.${key}`, inline);
    } else {
      throw new Error(`cannot read \`${line.trim()}\` in the steps of \`${job}\``);
    }
  }
  return steps;
}

type UpdateInput = { source: string; ecosystem: string };

/** The lines of the `updates` entry for `ecosystem` in dependabot.yml, its `- package-ecosystem` line excluded. */
function updateLines({ source, ecosystem }: UpdateInput): string[] {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => indentOf(line) === 2 && withoutComment(line) === `- package-ecosystem: ${ecosystem}`);
  if (start === -1) throw new Error(`no \`${ecosystem}\` entry`);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (isContent(line) && indentOf(line) <= 2) break;
    body.push(line);
  }
  return body;
}

/** The top-level `permissions` block's lines, or the inline value as one line. */
function topPermissions(source: string): string[] {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => /^permissions\s*:/.test(line));
  if (start === -1) return [];
  const inline = withoutComment((lines[start] ?? "").replace(/^permissions\s*:/, ""));
  if (inline) return [inline];
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!isContent(line)) continue;
    if (indentOf(line) === 0) break;
    block.push(withoutComment(line));
  }
  return block;
}

const grantsWrite = (line: string) => /\bwrite(-all)?$/.test(line);

const DEPLOY_JOBS = ["deploy-demo", "deploy-docs"];
/** The contexts ruleset "main: CI" requires: the jobs' names, never to change. */
const REQUIRED_JOBS: Record<string, string> = {
  check: "Check (Node 22)",
  e2e: "Browser (tests/examples)",
  hosts: "Hosts typecheck (examples/hosts)",
  docker: "Docker image smoke test",
};
const AREAS_RUN = "node .github/scripts/areas.ts";
const AREAS_IF = /^steps\.areas\.outputs\.(\w+) != 'false'$/;
/** The root `check` script's commands as the check job writes them. */
const IN_CI: Record<string, string> = {
  "biome ci": "pnpm exec biome ci",
  "pnpm typecheck": "pnpm -r $TYPECHECK_FILTER typecheck",
};
const DEPLOY_CONDITION = "github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'dropletsjs/droplets'";

describe("the workflows", () => {
  it("finds the workflow files", () => {
    expect(workflows).toEqual(expect.arrayContaining(["ci.yml", "release.yml"]));
  });

  it.each(workflows)("%s runs from pull_request and push only", (name) => {
    const found = events(readFileSync(join(workflowsDir, name), "utf8"));
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((event) => !ALLOWED_EVENTS.has(event))).toEqual([]);
  });

  it.each(workflows)("%s runs every job on a GitHub-hosted runner", (name) => {
    const found = runners(readFileSync(join(workflowsDir, name), "utf8"));
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((label) => !GITHUB_HOSTED.test(label))).toEqual([]);
  });

  it("release.yml creates no GitHub Release: the maintainer writes each by hand", () => {
    const publish = jobLines({ source: readFileSync(join(workflowsDir, "release.yml"), "utf8"), job: "publish" }).filter(isContent);
    expect(publish.map(withoutComment)).toContain("create-github-releases: false");
    expect(publish.join("\n")).not.toMatch(/create-github-releases: true/);
  });

  it("release.yml skips the publish job while the repository is private", () => {
    const condition = jobCondition({ source: readFileSync(join(workflowsDir, "release.yml"), "utf8"), job: "publish" });
    expect(condition).toMatch(/^github\.event\.repository\.private == false && /);
    expect(condition).not.toMatch(/\|\|/);
  });

  it("release.yml's version job opens no PR and writes nothing: no changesets/action, no write permission", () => {
    const source = readFileSync(join(workflowsDir, "release.yml"), "utf8");
    const version = jobLines({ source, job: "version" }).filter(isContent).map(withoutComment);
    expect(version.join("\n")).not.toMatch(/changesets\/action/);
    expect(version.filter(grantsWrite)).toEqual([]);
    // The job inherits the workflow's permissions.
    expect(topPermissions(source).filter(grantsWrite)).toEqual([]);
  });

  describe("ci.yml's Cloudflare deploys", () => {
    const source = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
    const others = jobIds(source).filter((job) => !DEPLOY_JOBS.includes(job));

    it("has both deploy jobs and the four it waits for", () => {
      expect(jobIds(source)).toEqual(expect.arrayContaining(DEPLOY_JOBS));
      expect(others.sort()).toEqual(["check", "docker", "e2e", "hosts"]);
    });

    it.each(DEPLOY_JOBS)("%s runs only on a push to main of dropletsjs/droplets", (job) => {
      expect(jobCondition({ source, job })).toBe(DEPLOY_CONDITION);
    });

    it("deploys only a commit every other job passed, the demo before the docs", () => {
      expect(jobNeeds({ source, job: "deploy-demo" }).sort()).toEqual([...others].sort());
      expect(jobNeeds({ source, job: "deploy-docs" }).sort()).toEqual([...others, "deploy-demo"].sort());
    });

    it("builds the docs only once the demo serves the build deploy-demo produced", () => {
      const demo = jobLines({ source, job: "deploy-demo" }).filter(isContent).map(withoutComment);
      expect(demo).toContain("build: ${{ steps.build.outputs.hash }}");
      expect(demo).toContain("- id: build");
      const docs = jobLines({ source, job: "deploy-docs" }).filter(isContent).map(withoutComment);
      const wait = docs.indexOf("- name: Wait for the demo to serve the new build");
      expect(wait).toBeGreaterThan(-1);
      expect(docs).toContain("DEMO_BUILD: ${{ needs.deploy-demo.outputs.build }}");
      expect(docs.findIndex((line) => line === "- run: pnpm docs:build")).toBeGreaterThan(wait);
      // Bounded, and failing with a message of its own when the time runs out.
      expect(docs).toContain("deadline=$((SECONDS + 120))");
      expect(docs.some((line) => line.startsWith('echo "::error::https://demo.dropletsjs.dev did not serve build'))).toBe(true);
    });

    it.each(DEPLOY_JOBS)("%s runs in the cloudflare environment, its credentials on steps only", (job) => {
      expect(jobKey({ source, job, key: "environment" })).toBe("cloudflare");
      expect(jobKey({ source, job, key: "env" })).toBeUndefined();
      expect(jobLines({ source, job }).join("\n")).not.toMatch(/cache: (pnpm|npm)|actions\/cache/);
    });

    it.each(DEPLOY_JOBS)("%s leaves the Worker's DROPLETS_SECRET alone", (job) => {
      const code = jobLines({ source, job }).filter(isContent).join("\n");
      expect(code).not.toMatch(/DROPLETS_SECRET|secrets-file|secret put/);
    });

    it("names the Cloudflare secrets in the deploy jobs alone", () => {
      for (const name of workflows) {
        const text = readFileSync(join(workflowsDir, name), "utf8");
        const jobs = jobIds(text).filter((job) => name !== "ci.yml" || !DEPLOY_JOBS.includes(job));
        for (const job of jobs) expect(jobLines({ source: text, job }).join("\n"), `${name}: ${job}`).not.toMatch(/CLOUDFLARE_/);
      }
      for (const job of others) expect(jobLines({ source, job }).join("\n"), job).not.toMatch(/secrets\./);
    });
  });
  describe("ci.yml's areas", () => {
    const source = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
    const required = Object.keys(REQUIRED_JOBS);
    const stepsOf = (job: string) => jobSteps({ source, job });
    const areasIndex = (job: string) => stepsOf(job).findIndex((step) => step.get("id") === "areas");

    it.each(required)("%s keeps the name the ruleset requires, with no needs and no job-level if", (job) => {
      expect(jobKey({ source, job, key: "name" })).toBe(REQUIRED_JOBS[job]);
      expect(jobNeeds({ source, job })).toEqual([]);
      expect(jobCondition({ source, job })).toBeUndefined();
    });

    it.each(workflows)("%s filters no trigger by path", (name) => {
      expect(readFileSync(join(workflowsDir, name), "utf8")).not.toMatch(/^\s*(paths|paths-ignore)\s*:/m);
    });

    it.each(required)("%s fetches the merge commit's parents and runs the areas step once, ungated", (job) => {
      const steps = stepsOf(job);
      const checkout = steps.filter((step) => step.get("uses")?.startsWith("actions/checkout@"));
      expect(checkout.map((step) => step.get("with.fetch-depth"))).toEqual(["2"]);
      const areas = steps.filter((step) => step.get("id") === "areas");
      expect(areas).toHaveLength(1);
      expect(areas[0]?.get("run")).toBe(AREAS_RUN);
      expect(areas[0]?.has("if")).toBe(false);
      expect(areas[0]?.has("continue-on-error")).toBe(false);
      expect(steps.slice(0, areasIndex(job)).filter((step) => step.has("if"))).toEqual([]);
    });

    it.each(required)("%s gates its steps on an output of the areas step, never on == 'true'", (job) => {
      for (const step of stepsOf(job)) {
        const condition = step.get("if");
        if (condition === undefined) continue;
        const output = AREAS_IF.exec(condition)?.[1];
        expect(output, condition).toBeDefined();
        expect(OUTPUTS, condition).toContain(output);
      }
    });

    it("uses every output, the typecheck filter as the typecheck step's env", () => {
      const used = new Set(required.flatMap((job) => stepsOf(job).map((step) => AREAS_IF.exec(step.get("if") ?? "")?.[1])));
      expect(OUTPUTS.filter((output) => output !== "typecheck_filter" && !used.has(output))).toEqual([]);
      const typecheck = stepsOf("check").find((step) => step.get("if") === "steps.areas.outputs.typecheck != 'false'");
      expect(typecheck?.get("env.TYPECHECK_FILTER")).toBe("${{ steps.areas.outputs.typecheck_filter }}");
      expect(typecheck?.get("run")).toBe("set -f\npnpm -r $TYPECHECK_FILTER typecheck");
    });

    it.each([
      ["e2e", "e2e"],
      ["hosts", "hosts"],
      ["docker", "docker"],
    ])("%s runs every step after the areas step by its one output, %s", (job, output) => {
      const after = stepsOf(job).slice(areasIndex(job) + 1);
      expect(after.length).toBeGreaterThan(0);
      expect(after.map((step) => step.get("if"))).toEqual(after.map(() => `steps.areas.outputs.${output} != 'false'`));
    });

    it("runs every command of the root check script, the lint and the tree suites on every run", () => {
      const scripts = (JSON.parse(readFileSync(rootPackage, "utf8")) as { scripts: Record<string, string> }).scripts;
      // The CI form of pnpm typecheck is the same command with a filter.
      expect(scripts["typecheck"]).toBe("pnpm -r typecheck");
      const commands = (scripts["check"] ?? "").split(" && ");
      expect(commands.length).toBeGreaterThan(5);
      const runs = stepsOf("check").flatMap((step) => step.get("run")?.split("\n") ?? []);
      expect(commands.map((command) => IN_CI[command] ?? command).filter((command) => !runs.includes(command))).toEqual([]);
      const always = stepsOf("check")
        .filter((step) => !step.has("if"))
        .map((step) => step.get("run"));
      expect(always).toEqual(
        expect.arrayContaining([
          "pnpm exec biome ci",
          "pnpm --filter @dropletsjs/tests-hosts test",
          "pnpm --filter @dropletsjs/tests-packages test:tree",
        ]),
      );
    });
  });
});

describe("dependabot.yml", () => {
  it("holds npm updates for at least 7 days, as pnpm's minimumReleaseAge does", () => {
    const npm = updateLines({ source: readFileSync(dependabotFile, "utf8"), ecosystem: "npm" })
      .filter(isContent)
      .map(withoutComment);
    const cooldown = npm.indexOf("cooldown:");
    expect(cooldown).toBeGreaterThan(-1);
    const days = npm
      .slice(cooldown + 1)
      .map((line) => /^default-days:\s*(\d+)$/.exec(line)?.[1])
      .find((value) => value !== undefined);
    expect(Number(days)).toBeGreaterThanOrEqual(7);
  });
});

describe("the workflow reader", () => {
  it.each([
    ["on: push", ["push"]],
    ['"on": [push, pull_request]', ["push", "pull_request"]],
    ["on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n\njobs:", ["push", "workflow_dispatch"]],
    ["on:\n  # a comment\n  - pull_request\n  - schedule\njobs:", ["pull_request", "schedule"]],
    ["on:\n  pull_request_target: # fork code with secrets\n    types: [opened]\n", ["pull_request_target"]],
  ])("reads the events of %j", (source, expected) => {
    expect(events(source)).toEqual(expected);
  });

  it.each(["jobs:\n  a:", "on: { push: {} }", "on:\n  ${{ x }}: y", "on:\njobs:"])("refuses %j", (source) => {
    expect(() => events(source)).toThrow();
  });

  it("returns a runner label it cannot vouch for as it is", () => {
    const found = runners(
      "jobs:\n  a:\n    runs-on: [self-hosted, linux]\n  b:\n    runs-on: ${{ matrix.os }}\n  c:\n    runs-on: 'ubuntu-24.04' # pinned\n",
    );
    expect(found).toEqual(["[self-hosted, linux]", "${{ matrix.os }}", "ubuntu-24.04"]);
    expect(found.filter((label) => GITHUB_HOSTED.test(label))).toEqual(["ubuntu-24.04"]);
  });

  it("reads a job's own condition, not a step's", () => {
    const source =
      "jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - if: x\n  b:\n    needs: a\n    if: y # why\n    steps: []\n";
    expect(jobCondition({ source, job: "a" })).toBeUndefined();
    expect(jobCondition({ source, job: "b" })).toBe("y");
    expect(() => jobCondition({ source, job: "c" })).toThrow();
  });

  it("reads job ids and inline needs, and refuses a block list of needs", () => {
    const source =
      "on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n  b-c: # why\n    needs: [a, 'd']\n  e:\n    needs: a\n  f:\n    needs:\n      - a\n";
    expect(jobIds(source)).toEqual(["a", "b-c", "e", "f"]);
    expect(jobNeeds({ source, job: "a" })).toEqual([]);
    expect(jobNeeds({ source, job: "b-c" })).toEqual(["a", "d"]);
    expect(jobNeeds({ source, job: "e" })).toEqual(["a"]);
    expect(() => jobNeeds({ source, job: "f" })).toThrow();
  });
  it("reads a job's steps: inline keys, a run block, nested maps; a stray line fails", () => {
    const source =
      "jobs:\n  a:\n    steps:\n      - uses: x@1 # v1\n        with:\n          fetch-depth: 2\n      # a comment\n      - id: s\n        run: echo\n      - if: c\n        env:\n          A: b\n        run: |\n          set -f\n          # kept\n          go\n  b:\n    steps:\n      - run: x\n       oops: 1\n";
    expect(jobSteps({ source, job: "a" }).map((step) => Object.fromEntries(step))).toEqual([
      { uses: "x@1", "with.fetch-depth": "2" },
      { id: "s", run: "echo" },
      { if: "c", "env.A": "b", run: "set -f\n# kept\ngo" },
    ]);
    expect(() => jobSteps({ source, job: "b" })).toThrow();
  });
});
