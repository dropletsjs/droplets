import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { freePort, listensOn, onFreePort, waitForServer } from "@dropletsjs/shared/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixture, FIXTURE_ROOT } from "./build-fixture.ts";

const outDir = resolve(FIXTURE_ROOT, "dist-bun-entry");
let port = 0;
let origin = "";

// `BUN` (the environment, or .env.local) points at a binary off the PATH; CI
// installs bun, so the suite runs there.
const bunBin = process.env["BUN"] || "bun";
const hasBun = spawnSync(bunBin, ["--version"]).status === 0;

describe.skipIf(!hasBun)("bun entry", () => {
  let child: ChildProcess;
  let output = "";

  beforeAll(async () => {
    await buildFixture({ outDir });
    await onFreePort({
      start: async (free) => {
        port = free;
        output = "";
        origin = `http://localhost:${port}`;
        child = spawn(bunBin, [resolve(outDir, "server.js")], {
          env: { ...process.env, PORT: String(port), FIXTURE_SECRET: "from-bun" },
        });
        child.stdout?.on("data", (chunk) => (output += chunk));
        child.stderr?.on("data", (chunk) => (output += chunk));
        await waitForServer({
          url: `${origin}/health`,
          child,
          name: "bun",
          isOurs: () => listensOn({ output, port }),
          output: () => output,
        });
      },
    });
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
    const data = html.match(/data-droplet-payload="data">([^<]+)</)?.[1];
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
    const run = spawnSync(bunBin, ["-e", script], { env: { ...process.env, PORT: String(await freePort()) }, timeout: 10_000 });
    expect(run.stdout.toString().trim()).toBe("function");
    expect(run.status).toBe(0);
  });
});
