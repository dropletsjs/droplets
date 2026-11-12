/**
 * A droplet that fails to import under `vite dev` (its component imports
 * `$droplets/server`) fails alone: its own fragment and its component's
 * module answer 500, with the import chain in the terminal, while the other
 * droplet, its `client.js` and `/index.js` keep answering 200. The server
 * registry imports each droplet's modules on demand, so the SSR module
 * evaluates whatever one droplet does. Once the file is fixed, the next
 * request to that droplet answers 200.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listensOn, onFreePort, stopServer } from "@dropletsjs/shared/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const project = here("../.tmp/isolation");
let PORT = 0;
let ORIGIN = "";

const BROKEN = "src/droplets/broken/+droplet.tsx";
/** A React component that imports what only server files may. */
const BROKEN_SOURCE = `/** @jsxImportSource react */
import { error } from "$droplets/server";

export default function Broken() {
  return <p data-text>{typeof error}</p>;
}
`;

let server: ChildProcess | undefined;
let output = "";

const get = (path: string) => fetch(`${ORIGIN}${path}`);
const file = (path: string) => `${project}/${path}`;

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server?.exitCode != null) throw new Error(`vite exited:\n${output}`);
    try {
      if (listensOn({ output, port: PORT }) && (await fetch(`${ORIGIN}/droplets/healthy`)).status) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`vite did not start:\n${output}`);
}

beforeAll(async () => {
  rmSync(project, { recursive: true, force: true });
  // The fixture's config and renderers, with two droplets of its React one.
  cpSync(here("fixture"), project, { recursive: true, filter: (source) => !source.includes("/src/droplets/") });
  mkdirSync(file("src/droplets/broken"), { recursive: true });
  cpSync(here("fixture/src/droplets/react-hello"), file("src/droplets/healthy"), { recursive: true });
  writeFileSync(file(BROKEN), BROKEN_SOURCE);
  await onFreePort({
    start: async (free) => {
      PORT = free;
      ORIGIN = `http://localhost:${PORT}`;
      output = "";
      writeFileSync(
        file("droplets.config.ts"),
        `export default { element: "djs-mixed", cors: true, dev: { server: { port: ${PORT} } } };\n`,
      );
      server = spawn(here("../node_modules/.bin/vite"), ["--strictPort"], { cwd: project, stdio: ["ignore", "pipe", "pipe"] });
      server.stdout?.on("data", (chunk) => (output += chunk));
      server.stderr?.on("data", (chunk) => (output += chunk));
      await waitForServer();
    },
  });
});

afterAll(async () => {
  // Vite writes into the project until it exits.
  await stopServer({ child: server });
  rmSync(project, { recursive: true, force: true });
});

describe("a droplet that fails to import under vite dev", () => {
  it("fails alone: the other droplet, its client.js and /index.js keep answering", async () => {
    const broken = await get("/droplets/broken");
    expect(broken.status).toBe(500);
    expect(output).toMatch(/\$droplets\/server can only be imported by server files.*src\/droplets\/broken\/\+droplet\.tsx/);
    // Vite serves modules one by one: the droplet's client module is the
    // registry's entry, and the component it imports is what is refused.
    expect((await get("/droplets/broken/client.js")).status).toBe(200);
    expect((await get("/src/droplets/broken/+droplet.tsx?droplets-renderer=react")).status).toBe(500);

    const healthy = await get("/droplets/healthy");
    expect(healthy.status, output.slice(-1_000)).toBe(200);
    expect(await healthy.text()).toContain("React greets the host");
    expect((await get("/droplets/healthy/client.js")).status).toBe(200);
    expect((await get("/droplets/healthy/_data")).status).toBe(200);
    expect((await get("/index.js")).status).toBe(200);
  });

  it("answers again once the file is fixed, with no restart", async () => {
    const source = readFileSync(file(BROKEN), "utf8");
    writeFileSync(file(BROKEN), source.replace('import { error } from "$droplets/server";\n', "").replace("{typeof error}", "fixed"));
    await expect.poll(async () => (await get("/droplets/broken")).status, { timeout: 15_000 }).toBe(200);
    expect(await (await get("/droplets/broken")).text()).toContain("fixed");
    expect((await get("/src/droplets/broken/+droplet.tsx?droplets-renderer=react")).status).toBe(200);
    expect((await get("/droplets/healthy")).status).toBe(200);
  });
});
