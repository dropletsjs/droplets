import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeRenderer } from "@dropletsjs/droplets/testing";
import { droplets } from "@dropletsjs/droplets/vite";
import { createBuilder } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deno } from "../src/index.ts";

// The framework's own fixture (fake renderer, see @dropletsjs/droplets/testing), element "test-droplet".
const root = fileURLToPath(new URL("../../../droplets/test/fixtures/app/", import.meta.url));
const outDir = resolve(root, "dist-deno");
const port = 8241;
const origin = `http://localhost:${port}`;

// `DENO` (the environment, or .env.local) points at a binary off the PATH; CI
// installs deno, so the suite runs there.
const denoBin = process.env["DENO"] || "deno";
const hasDeno = spawnSync(denoBin, ["--version"]).status === 0;

async function waitFor(url: string, child: ChildProcess): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`deno exited with ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${url} never answered`);
}

describe.skipIf(!hasDeno)("deno adapter", () => {
  let child: ChildProcess;
  let output = "";

  beforeAll(async () => {
    if (!existsSync(resolve(root, "../../../dist/vite.js"))) {
      throw new Error("Build @dropletsjs/droplets first (pnpm build at the root).");
    }
    await rm(outDir, { recursive: true, force: true });
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "silent",
      build: { outDir },
      plugins: [droplets({ adapter: deno(), renderers: [fakeRenderer()], css: { tailwind: true } })],
    });
    await builder.buildApp();
    child = spawn(denoBin, ["serve", "-A", "--port", String(port), resolve(outDir, "server.js")], {
      env: { ...process.env, FIXTURE_SECRET: "from-deno" },
    });
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    await waitFor(`${origin}/health`, child);
  });

  afterAll(async () => {
    child?.kill();
    await rm(outDir, { recursive: true, force: true });
  });

  it("emits server.js with only node: imports left", async () => {
    const server = await readFile(resolve(outDir, "server.js"), "utf8");
    const bare = [...server.matchAll(/^import .* from "([^"]+)";?$/gm)].map((m) => m[1]);
    expect(bare.every((spec) => spec?.startsWith("node:"))).toBe(true);
    expect(server).not.toContain("@hono/node-server");
  });

  it("serves the build from `deno serve`", async () => {
    expect(output).toContain(`Listening on`);

    const fragment = await fetch(`${origin}/droplets/hello?who=Deno`);
    expect(fragment.status).toBe(200);
    const html = await fragment.text();
    expect(html).toContain('data-testid="greeting">Hello Deno!</h1>');
    expect(html.startsWith('<test-droplet data-droplet="hello"')).toBe(true);
    // Runtime secrets come from the process environment.
    const data = html.match(/data-droplet-data>([^<]+)</)?.[1];
    expect(data && JSON.parse(Buffer.from(data, "base64").toString("utf8")).data).toMatchObject({ who: "Deno", secret: "from-deno" });

    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    const entry = await fetch(`${origin}/index.js`);
    expect(entry.headers.get("cache-control")).toBe("no-store");
    expect((await entry.text()).endsWith(`import("./${manifest.__entryModule}");\n`)).toBe(true);
    const asset = await fetch(`${origin}/${manifest.__entryModule}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");

    const echo = await fetch(`${origin}/api/echo/3?q=n`);
    expect(await echo.json()).toEqual({ id: "3", hooked: true, q: "n" });
    const crash = await fetch(`${origin}/droplets/hello?who=crash`);
    expect(crash.status).toBe(500);
    expect(await crash.text()).toContain("data-droplet-error");
    expect((await fetch(`${origin}/nope`)).status).toBe(404);
  });

  it("does not listen when imported", async () => {
    const script = `const m = await import(${JSON.stringify(resolve(outDir, "server.js"))}); console.log(typeof m.default.fetch);`;
    const run = spawnSync(denoBin, ["eval", script], { timeout: 10_000 });
    expect(run.stdout.toString().trim()).toBe("function");
    expect(run.status).toBe(0);
  });
});
