/**
 * `djs add`, as a user runs it, on a Svelte project: every framework (the
 * seven others are added to the Vite config and tsconfig on the way), every
 * target, the optional files. Then what a user does next: a type check, a
 * build, and the built server answering for each droplet.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const project = here("../.tmp/project");
const bin = (name: string) => here(`../node_modules/.bin/${name}`);

const FRAMEWORKS = ["svelte", "vue", "react", "preact", "solid", "hono-jsx", "handlebars", "lit"] as const;

/** The markup, without the comments some renderers mark their parts with (Lit, Vue, Svelte). */
const text = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");

/** One droplet per framework and case: its name ends with the case. */
const CASES = {
  // Nothing optional: the component shows its name.
  full: ["--target", "full"],
  // Every optional file: data from both loads, the error page, styles.
  loaded: ["--target", "full", "--hydrate", "visible", "--with", "server,universal,error,css"],
  // No JavaScript.
  static: ["--target", "ssr", "--with", "server,error"],
  // Rendered in the browser only.
  browser: ["--target", "client", "--with", "universal"],
  // Rendered at build time.
  built: ["--target", "ssg", "--with", "server"],
} as const;

const djs = (args: string[]) =>
  exec(bin("djs"), [...args, "--root", project], { cwd: project, env: { ...process.env, npm_config_user_agent: "pnpm/10" } });

let server: ChildProcess | undefined;
const PORT = 8251;
const get = (path: string) => fetch(`http://localhost:${PORT}${path}`);

/** A droplet's stylesheet with its `@import`s followed: the rules it serves. */
async function stylesheet(path: string): Promise<string> {
  const url = new URL(path, `http://localhost:${PORT}`);
  const css = await (await fetch(url)).text();
  const imports = [...css.matchAll(/@import url\("([^"]+)"\)/g)].map((match) => new URL(match[1]!, url).pathname);
  return [css, ...(await Promise.all(imports.map(stylesheet)))].join("\n");
}

beforeAll(async () => {
  rmSync(project, { recursive: true, force: true });
  cpSync(here("fixture"), project, { recursive: true });
  for (const framework of FRAMEWORKS) {
    for (const [name, args] of Object.entries(CASES)) {
      await djs(["add", `${framework}-${name}`, "--framework", framework, ...args, "--yes"]);
    }
  }
  // Script droplets: built in, nothing to install or register.
  await djs(["add", "script-plain", "--framework", "script", "--yes"]);
  await djs(["add", "script-loaded", "--framework", "script", "--with", "server,universal,css", "--yes"]);
});

afterAll(() => {
  server?.kill();
});

describe("djs add", () => {
  it("registers every framework it brings in, once, and turns JSX on", () => {
    const config = readFileSync(`${project}/vite.config.ts`, "utf8");
    expect(config).toContain("renderers: [svelte(), vue(), react(), preact(), solid(), honoJsx(), handlebars(), lit()]");
    expect(config.match(/^import /gm)).toHaveLength(11);
    expect(config).toContain("// A Svelte project: djs add brings in the other frameworks.");
    const tsconfig = readFileSync(`${project}/tsconfig.json`, "utf8");
    expect(tsconfig).toContain('"jsx": "react-jsx", "jsxImportSource": "react"');
    expect(tsconfig).toContain('"include": ["src/**/*.tsx", ');
  });

  it("refuses a name in use, and full without hydration", async () => {
    await expect(djs(["add", "react-full", "--framework", "react", "--yes"])).rejects.toMatchObject({
      stderr: expect.stringContaining("exists already"),
    });
    await expect(djs(["add", "x-none", "--framework", "react", "--hydrate", "none", "--yes"])).rejects.toMatchObject({
      stderr: expect.stringContaining("--target ssr"),
    });
  });

  it("writes a script droplet without a renderer, and refuses what cannot apply to one", async () => {
    expect(readFileSync(`${project}/src/droplets/script-plain/+droplet.script.ts`, "utf8")).toContain(
      "const run: DropletScript = (_data, el) => {",
    );
    const loaded = readFileSync(`${project}/src/droplets/script-loaded/+droplet.script.ts`, "utf8");
    expect(loaded).toContain('import "./style.css";');
    expect(loaded).not.toMatch(/export const (ssr|hydrate|prerender)/);
    for (const args of [
      ["--target", "ssr"],
      ["--hydrate", "always"],
      ["--hydrate", "visible"],
      ["--hydrate", "none"],
      ["--hydrate", "interactive"],
      ["--with", "error"],
    ]) {
      await expect(djs(["add", "script-x", "--framework", "script", ...args, "--yes"]), args.join(" ")).rejects.toMatchObject({
        stderr: expect.stringMatching(/script droplet/),
      });
    }
  });

  it("writes droplets that type-check", async () => {
    await exec(bin("tsc"), ["-p", "tsconfig.json"], { cwd: project });
  });

  it("writes droplets that build and serve", async () => {
    await exec(bin("vite"), ["build"], { cwd: project });
    server = spawn(process.execPath, ["dist/server.js"], { cwd: project, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
    for (let i = 0; i < 100; i++) {
      if (
        await get("/health").then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const framework of FRAMEWORKS) {
      const fragment = async (name: string, query = "") => {
        const response = await get(`/droplets/${framework}-${name}${query}`);
        expect(response.status, `${framework}-${name}`).toBe(200);
        return text(await response.text());
      };
      const script = async (name: string) => (await get(`/droplets/${framework}-${name}/client.js`)).status;

      expect(await fragment("full")).toMatch(new RegExp(`<h1[^>]*>${framework}-full</h1>`));
      expect(await script("full")).toBe(200);

      const loaded = await fragment("loaded", "?who=Ana");
      expect(loaded, `${framework}-loaded`).toMatch(/<h1[^>]*>Hello Ana!<\/h1>/);
      // Lit's styles travel in the shadow root, inside the markup.
      if (framework === "lit") expect(loaded).toMatch(/<style>\s*\.lit-loaded \{\s*font-family/);
      else expect(await stylesheet(`/droplets/${framework}-loaded/style.css`)).toContain("font-family");

      expect(await fragment("static", "?who=Bo")).toMatch(/<h1[^>]*>Hello Bo!<\/h1>/);
      expect(await script("static")).toBe(404);

      expect(await fragment("browser")).not.toContain("<h1");
      expect(await script("browser")).toBe(200);

      expect(await fragment("built")).toMatch(/<h1[^>]*>Hello world!<\/h1>/);
    }
    // A script droplet: an empty element with its data, and a bundle.
    for (const name of ["script-plain", "script-loaded"]) {
      const response = await get(`/droplets/${name}?who=Cy`);
      expect(response.status, name).toBe(200);
      expect(await response.text()).toMatch(/<div style="display: contents" data-droplet-entry><\/div><\/[a-z-]+>$/);
      expect((await get(`/droplets/${name}/client.js`)).status, name).toBe(200);
    }
    expect(await stylesheet("/droplets/script-loaded/style.css")).toContain("font-family");
  });
});
