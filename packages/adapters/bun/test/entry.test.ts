import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixture, FIXTURE_ROOT } from "./build-fixture.ts";

const outDir = resolve(FIXTURE_ROOT, "dist-bun-entry");
const port = 8231;
const origin = `http://localhost:${port}`;

// `BUN` (the environment, or .env.local) points at a binary off the PATH; CI
// installs bun, so the suite runs there.
const bunBin = process.env["BUN"] || "bun";
const hasBun = spawnSync(bunBin, ["--version"]).status === 0;

type WaitForInput = { url: string; child: ChildProcess };

async function waitFor({ url, child }: WaitForInput): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`bun exited with ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet: try again.
    }
    await new Promise((wake) => setTimeout(wake, 100));
  }
  throw new Error(`${url} never answered`);
}

describe.skipIf(!hasBun)("bun entry", () => {
  let child: ChildProcess;
  let output = "";

  beforeAll(async () => {
    await buildFixture({ outDir });
    child = spawn(bunBin, [resolve(outDir, "server.js")], {
      env: { ...process.env, PORT: String(port), FIXTURE_SECRET: "from-bun" },
    });
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    await waitFor({ url: `${origin}/health`, child });
  });

  afterAll(async () => {
    child?.kill();
    await rm(outDir, { recursive: true, force: true });
  });

  it("serves the build from `bun dist/server.js`, on PORT", async () => {
    expect(output).toContain(`Started server: ${origin}`);

    const fragment = await fetch(`${origin}/droplets/hello?who=Bun`);
    expect(fragment.status).toBe(200);
    const html = await fragment.text();
    expect(html).toContain('data-testid="greeting">Hello Bun!</h1>');
    expect(html.startsWith('<test-droplet data-droplet="hello"')).toBe(true);
    // Runtime secrets come from the process environment.
    const data = html.match(/data-droplet-data>([^<]+)</)?.[1];
    expect(data && JSON.parse(Buffer.from(data, "base64").toString("utf8")).data).toMatchObject({ who: "Bun", secret: "from-bun" });

    const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8"));
    const entry = await fetch(`${origin}/index.js`);
    expect(entry.headers.get("cache-control")).toBe("no-store");
    expect(await entry.text()).toContain(`import "./${manifest.__entryModule}";\n`);
    const asset = await fetch(`${origin}/${manifest.__entryModule}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");

    const echo = await fetch(`${origin}/api/echo/3?q=n`);
    expect(await echo.json()).toEqual({ id: "3", hooked: true, q: "n" });
    // An error page, not Bun's own debug page.
    const crash = await fetch(`${origin}/droplets/hello?who=crash`);
    expect(crash.status).toBe(500);
    expect(await crash.text()).toContain("data-droplet-error");
    expect((await fetch(`${origin}/nope`)).status).toBe(404);
  });

  it("does not listen when imported", async () => {
    const script = `const m = await import(${JSON.stringify(resolve(outDir, "server.js"))}); console.log(typeof m.default.fetch);`;
    const run = spawnSync(bunBin, ["-e", script], { env: { ...process.env, PORT: String(port + 1) }, timeout: 10_000 });
    expect(run.stdout.toString().trim()).toBe("function");
    expect(run.status).toBe(0);
  });
});
