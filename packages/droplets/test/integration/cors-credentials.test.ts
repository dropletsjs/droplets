// @vitest-environment happy-dom
/**
 * `cors.credentials` reaches the client build as one boolean: the built
 * `/index.js` records `include` for its server, and nothing else of the
 * `cors` config (the origin function) is in any client file.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuilder } from "vite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { DropletsManifest } from "../../src/server/manifest.ts";
import { serverCredentials, serverKey } from "../../src/runtime/server-records.ts";
import { fakeRenderer } from "../../src/testing/index.ts";
import { droplets, type DropletsAdapter } from "../../src/vite.ts";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

const fakeAdapter: DropletsAdapter = {
  name: "fake",
  serverEntry: resolve(fixtures, "app/fake-entry.js"),
  serverFile: "server.js",
  separateSsrBundle: true,
};

const ELEMENT = "cred-el";
const MARKER = "only-this-host-marker.example";

const FILES: Record<string, string> = {
  "droplets.config.ts": [
    "export default {",
    `  element: ${JSON.stringify(ELEMENT)},`,
    `  cors: { origin: (origin) => (origin === "https://${MARKER}" ? origin : null), credentials: true },`,
    "};",
    "",
  ].join("\n"),
  "src/droplets/card/+droplet.fake.js": "export default () => `<p>card</p>`;\n",
};

let root = "";
let client = "";

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

beforeAll(async () => {
  root = await mkdtemp(join(fixtures, ".cors-credentials-"));
  for (const [path, text] of Object.entries(FILES)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const builder = await createBuilder({
    root,
    logLevel: "silent",
    plugins: [droplets({ adapter: fakeAdapter, renderers: [fakeRenderer()] })],
  });
  await builder.buildApp();
  client = resolve(root, "dist/client");
}, 90_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

it("holds no part of the cors config but the boolean in any client file", async () => {
  const files = await filesUnder(client);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) expect(await readFile(file, "utf8"), file).not.toContain(MARKER);
  // The server bundle keeps the function: it answers CORS.
  const server = await filesUnder(resolve(root, "dist/server"));
  const texts = await Promise.all(server.map((file) => readFile(file, "utf8")));
  expect(texts.some((text) => text.includes(MARKER))).toBe(true);
});

it("records include for its server when the built /index.js runs", async () => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  const manifest = JSON.parse(await readFile(resolve(client, "droplets.json"), "utf8")) as DropletsManifest;
  const key = serverKey(ELEMENT, manifest.__hash);
  expect(serverCredentials({ key })).toBe("same-origin");
  await import(pathToFileURL(resolve(client, "index.js")).href);
  expect(serverCredentials({ key })).toBe("include");
});
