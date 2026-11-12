// @vitest-environment node
/**
 * React and Preact in one project: both claim `.tsx`, each droplet goes to
 * the renderer whose package it imports, and each renderer compiles only
 * the modules its droplets reach. A shared, neutral `lib/Label.tsx` is
 * compiled once for each, so neither JSX runtime leaks into the other's
 * droplet, even with `jsxImportSource: "preact"` in the fixture's
 * tsconfig.json. Built with the Node adapter and served for real.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { node } from "@dropletsjs/adapter-node";
import { droplets } from "@dropletsjs/droplets/vite";
import { react } from "@dropletsjs/renderer-react";
import { freePort, fromBuild, stopServer, waitForServer } from "@dropletsjs/shared/vitest";
import { createBuilder } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { preact } from "../../src/index.ts";

type GetInput = { path: string };

type BundleOfInput = { id: string };

type VisitInput = { file: string };

type ClientManifest = { droplets: Record<string, { client?: string }> };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/mixed");
const outDir = resolve(root, "dist-mixed");
let PORT = 0;
const get = ({ path }: GetInput): Promise<Response> => fetch(`http://localhost:${PORT}${path}`);

let server: ChildProcess | undefined;

/** A droplet's browser bundle with every chunk it imports, as one text. */
async function bundleOf({ id }: BundleOfInput): Promise<string> {
  const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8")) as ClientManifest;
  const seen = new Set<string>();
  const texts: string[] = [];
  const visit = async ({ file }: VisitInput): Promise<void> => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = await readFile(resolve(outDir, "client", file), "utf8");
    texts.push(text);
    const imports = text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+\.js)["']/g);
    await Promise.all(
      Array.from(imports, ([, path = expect.unreachable("an import path")]) =>
        visit({ file: resolve(dirname(resolve("/", file)), path).slice(1) }),
      ),
    );
  };
  await visit({ file: manifest.droplets[id]?.client ?? expect.unreachable(`a client bundle for ${id}`) });
  return texts.join("\n");
}

beforeAll(async () => {
  await rm(outDir, { recursive: true, force: true });
  const builder = await createBuilder({
    root,
    configFile: false,
    logLevel: "silent",
    // Readable bundles: the region comments name the packages each one holds.
    build: { outDir, minify: false },
    plugins: [droplets({ adapter: node(), renderers: [react(), preact()] })],
  });
  await builder.buildApp();
  PORT = await freePort();
  server = spawn(process.execPath, ["dist-mixed/server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  await waitForServer({
    url: `http://localhost:${PORT}/droplets/preact-card`,
    child: server,
    name: "dist-mixed/server.js",
    isOurs: await fromBuild({ outDir }),
  });
}, 180_000);

afterAll(async () => {
  await stopServer({ child: server });
  await rm(outDir, { recursive: true, force: true });
});

describe("React and Preact in one project", () => {
  it("renders each droplet on the server with its own framework, the shared module included", async () => {
    const preactHtml = await (await get({ path: "/droplets/preact-card" })).text();
    expect(preactHtml).toMatch(/<section class="preact-card"><b data-label="preact">preact<\/b><button>0<\/button><\/section>/);
    const reactHtml = await (await get({ path: "/droplets/react-card" })).text();
    expect(reactHtml).toMatch(/<section class="react-card"><b data-label="react">react<\/b><button>0<\/button><\/section>/);
  });

  it("keeps each JSX runtime out of the other framework's browser bundle", async () => {
    const preactBundle = await bundleOf({ id: "preact-card" });
    expect(preactBundle).toMatch(/node_modules\/preact\//);
    expect(preactBundle).not.toMatch(/node_modules\/react(?:-dom)?\//);

    const reactBundle = await bundleOf({ id: "react-card" });
    expect(reactBundle).toMatch(/node_modules\/react-dom\//);
    expect(reactBundle).not.toMatch(/node_modules\/preact\//);
  });
});
