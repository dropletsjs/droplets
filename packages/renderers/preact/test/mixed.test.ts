// @vitest-environment node
/**
 * React and Preact in one project: both claim `.tsx`, each droplet goes to
 * the renderer whose package it imports, and each renderer compiles only
 * the modules its droplets reach. A shared, neutral `lib/Label.tsx` is
 * compiled once for each, so neither JSX runtime leaks into the other's
 * droplet, even with `jsxImportSource: "preact"` in the fixture's
 * tsconfig.json. Built with the Node adapter and served for real.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { node } from "@dropletsjs/adapter-node";
import { droplets } from "@dropletsjs/droplets/vite";
import { react } from "@dropletsjs/renderer-react";
import { preact } from "../src/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/mixed");
const outDir = resolve(root, "dist-mixed");
const PORT = 8261;
const get = (path: string) => fetch(`http://localhost:${PORT}${path}`);

let server: ChildProcess | undefined;

/** A droplet's browser bundle with every chunk it imports, as one text. */
async function bundleOf(id: string): Promise<string> {
  const manifest = JSON.parse(await readFile(resolve(outDir, "client/droplets.json"), "utf8")) as {
    droplets: Record<string, { client?: string }>;
  };
  const seen = new Set<string>();
  const texts: string[] = [];
  const visit = async (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = await readFile(resolve(outDir, "client", file), "utf8");
    texts.push(text);
    for (const [, path] of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) {
      await visit(resolve(dirname(resolve("/", file)), path!).slice(1));
    }
  };
  await visit(manifest.droplets[id]!.client!);
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
  server = spawn(process.execPath, ["dist-mixed/server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    if (await get("/health").then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}, 180_000);

afterAll(async () => {
  server?.kill();
  await rm(outDir, { recursive: true, force: true });
});

describe("React and Preact in one project", () => {
  it("renders each droplet on the server with its own framework, the shared module included", async () => {
    const preactHtml = await (await get("/droplets/preact-card")).text();
    expect(preactHtml).toMatch(/<section class="preact-card"><b data-label="preact">preact<\/b><button>0<\/button><\/section>/);
    const reactHtml = await (await get("/droplets/react-card")).text();
    expect(reactHtml).toMatch(/<section class="react-card"><b data-label="react">react<\/b><button>0<\/button><\/section>/);
  });

  it("keeps each JSX runtime out of the other framework's browser bundle", async () => {
    const preactBundle = await bundleOf("preact-card");
    expect(preactBundle).toMatch(/node_modules\/preact\//);
    expect(preactBundle).not.toMatch(/node_modules\/react(?:-dom)?\//);

    const reactBundle = await bundleOf("react-card");
    expect(reactBundle).toMatch(/node_modules\/react-dom\//);
    expect(reactBundle).not.toMatch(/node_modules\/preact\//);
  });
});
