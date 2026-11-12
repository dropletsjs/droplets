/**
 * Every workflow runs on GitHub-hosted runners, from `pull_request` and
 * `push` events only (AGENTS.md rule 22), and the release workflow's publish
 * job runs only from a public repository. The workflows are read line by
 * line, with no YAML parser: a form of `on` or `runs-on` the reader does not
 * know fails the suite, so a workflow never passes because it went unread.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflowsDir = fileURLToPath(new URL("../../../.github/workflows/", import.meta.url));
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

type JobConditionInput = { source: string; job: string };

/** The job-level `if` of `job` under `jobs:`, as written, or undefined when the job has none. */
function jobCondition({ source, job }: JobConditionInput): string | undefined {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start === -1) throw new Error(`no job \`${job}\``);
  for (const line of lines.slice(start + 1)) {
    if (!isContent(line)) continue;
    if (indentOf(line) <= 2) return undefined;
    const condition = /^ {4}if\s*:(.*)$/.exec(line)?.[1];
    if (condition !== undefined) return withoutComment(condition);
  }
  return undefined;
}

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

  it("release.yml skips the publish job while the repository is private", () => {
    const condition = jobCondition({ source: readFileSync(join(workflowsDir, "release.yml"), "utf8"), job: "publish" });
    expect(condition).toMatch(/^github\.event\.repository\.private == false && /);
    expect(condition).not.toMatch(/\|\|/);
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
});
