/**
 * `npm create droplets`, as a user runs it without a terminal: each
 * framework alone, all of them with every adapter and Tailwind, and a pair
 * with the dev tool and Claude. Then what a user does next: `djs sync`, a
 * type check, a build, and the built server answering for every starter
 * droplet. The projects live in `.tmp/`, so they resolve the workspace's
 * packages instead of installing.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const tmp = here("../.tmp");
const bin = (name: string) => here(`../node_modules/.bin/${name}`);
const env = { ...process.env, npm_config_user_agent: "pnpm/10" };

const create = (args: string[], cwd = tmp, extra: NodeJS.ProcessEnv = {}) =>
  exec(bin("create-droplets"), args, { cwd, env: { ...env, ...extra } });

const FRAMEWORKS = ["svelte", "vue", "react", "preact", "solid", "hono-jsx", "handlebars", "lit"] as const;
const starter = (framework: string) => `hello-${framework === "hono-jsx" ? "hono" : framework}`;

type Case = { name: string; frameworks: readonly string[]; args: string[] };

const CASES: Case[] = [
  ...FRAMEWORKS.map((f) => ({ name: `only-${f}`, frameworks: [f], args: ["--frameworks", f] })),
  {
    name: "everything",
    frameworks: FRAMEWORKS,
    args: ["--frameworks", FRAMEWORKS.join(","), "--adapters", "node,cloudflare,bun,deno", "--tailwind"],
  },
  {
    name: "pair",
    frameworks: ["svelte", "react"],
    args: ["--frameworks", "react,svelte", "--no-tailwind", "--inject-tool", "--claude"],
  },
];

beforeAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
});

describe("without a terminal", () => {
  it("needs the frameworks, and names the flag", async () => {
    await expect(create(["nothing", "--yes"])).rejects.toMatchObject({ stderr: expect.stringContaining("--frameworks svelte,vue") });
    expect(existsSync(join(tmp, "nothing"))).toBe(false);
  });

  it("needs the folder", async () => {
    await expect(create(["--frameworks", "vue", "--yes"])).rejects.toMatchObject({ stderr: expect.stringContaining("name the folder") });
  });

  it("refuses a folder with files in it", async () => {
    mkdirSync(join(tmp, "taken"));
    writeFileSync(join(tmp, "taken", "notes.txt"), "mine");
    await expect(create(["taken", "--frameworks", "vue", "--yes", "--no-install", "--no-git"])).rejects.toMatchObject({
      stderr: expect.stringContaining("taken is not empty"),
    });
    expect(readFileSync(join(tmp, "taken", "notes.txt"), "utf8")).toBe("mine");
  });
});

describe("git", () => {
  const outside = mkdtempSync(join(tmpdir(), "create-droplets-"));
  afterAll(() => rmSync(outside, { recursive: true, force: true }));
  const who = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };

  it("makes the first commit in a new repository", async () => {
    await create(["fresh", "--frameworks", "vue", "--yes", "--no-install"], outside, who);
    const { stdout } = await exec("git", ["log", "--format=%s"], { cwd: join(outside, "fresh") });
    expect(stdout.trim()).toBe("Initial commit from create-droplets");
    const { stdout: files } = await exec("git", ["ls-files"], { cwd: join(outside, "fresh") });
    expect(files).toContain("src/droplets/hello-vue/+droplet.vue");
  });

  it("leaves a repository it is already in alone", async () => {
    const { stdout } = await create(["nested", "--frameworks", "vue", "--yes", "--no-install"]);
    expect(stdout).toContain("already inside a git repository");
    expect(existsSync(join(tmp, "nested", ".git"))).toBe(false);
  });
});

describe.each(CASES.map((c, i) => [c.name, c, 8300 + i] as const))("%s", (name, { frameworks, args }, port) => {
  const project = join(tmp, name);
  let server: ChildProcess | undefined;
  afterAll(() => {
    server?.kill();
  });

  it("writes the project", async () => {
    await create([name, ...args, "--yes", "--no-install", "--no-git"]);
    for (const framework of frameworks) expect(existsSync(join(project, "src/droplets", starter(framework)))).toBe(true);
    expect(existsSync(join(project, "CLAUDE.md"))).toBe(name === "pair");
    if (name === "pair") expect(readFileSync(join(project, "droplets.config.ts"), "utf8")).toContain("dev: { injectTool: true }");
  });

  it("syncs and type-checks", async () => {
    await exec(bin("djs"), ["sync"], { cwd: project, env });
    expect(existsSync(join(project, ".droplets/tsconfig.json"))).toBe(true);
    await exec(bin("tsc"), ["-p", "tsconfig.json"], { cwd: project });
  });

  if (name === "everything") {
    it("builds for Cloudflare with DROPLETS_ADAPTER", async () => {
      await exec(bin("vite"), ["build"], { cwd: project, env: { ...env, DROPLETS_ADAPTER: "cloudflare" } });
      expect(existsSync(join(project, "dist/worker.js"))).toBe(true);
    });
  }

  it("builds for Node and serves every starter droplet", async () => {
    await exec(bin("vite"), ["build"], { cwd: project, env });
    expect(existsSync(join(project, "dist/server.js"))).toBe(true);
    server = spawn(process.execPath, ["dist/server.js"], { cwd: project, env: { ...env, PORT: String(port) }, stdio: "ignore" });
    const get = (path: string) => fetch(`http://localhost:${port}${path}`);
    for (let i = 0; i < 100; i++) {
      if (await get("/health").then((r) => r.ok, () => false)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const framework of frameworks) {
      const response = await get(`/droplets/${starter(framework)}?who=Ana`);
      expect(response.status, starter(framework)).toBe(200);
      // Without the comments some renderers mark their parts with (Lit, Vue, Svelte).
      const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, "");
      expect(html, starter(framework)).toMatch(/<h1[^>]*>Hello Ana!<\/h1>/);
    }
  });
});
