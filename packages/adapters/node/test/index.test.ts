import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { resolveConfig } from "@dropletsjs/droplets";
import { fromBuild, onFreePort, rawGet, stopServer, waitForServer } from "@dropletsjs/shared/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { node } from "../src/index.ts";
import { buildFixture, FIXTURE_ROOT } from "./build-fixture.ts";

const outDir = resolve(FIXTURE_ROOT, "dist-node-index");

type Server = { default: { fetch(request: Request): Promise<Response> } };

/** A function-form config: the element tells which env it was called with, and `cors.origin` is a function the bundle must keep. */
const FUNCTION_CONFIGS = {
  sync: `export default ({ command, mode, isPreview }) => ({
  element: command === "build" && mode === "production" && !isPreview ? "test-droplet" : "wrong-env",
  cors: { origin: (origin) => origin },
  server: { port: 8127 },
});
`,
  async: `export default async ({ command, mode, isPreview }) => {
  await new Promise((wake) => setTimeout(wake, 5));
  return {
    element: command === "build" && mode === "production" && !isPreview ? "test-droplet" : "wrong-env",
    cors: { origin: (origin) => origin },
    server: { port: 8128 },
  };
};
`,
} as const;

describe("node", () => {
  beforeAll(async () => {
    await buildFixture({ outDir });
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("emits server.js next to the SSR bundle, with only node: imports left", async () => {
    expect(existsSync(resolve(outDir, "server.js"))).toBe(true);
    expect(existsSync(resolve(outDir, "server/entry-server.js"))).toBe(true);
    const server = await readFile(resolve(outDir, "server.js"), "utf8");
    const bare = [...server.matchAll(/^import .* from "([^"]+)";?$/gm)].map((m) => m[1]);
    expect(bare.every((spec) => spec?.startsWith("node:"))).toBe(true);
    // The user's config is baked in, so no droplets.config.ts is read at runtime.
    expect(server).toContain("8123");
  });

  it("previews the build the same way", async () => {
    const { preview } = node();
    if (!preview) throw new Error("node() has no preview");
    const app = await preview({ root: FIXTURE_ROOT, outDir, config: resolveConfig({ element: "test-droplet" }) });
    const res = await app.fetch(new Request("http://drops.test/droplets/hello?who=Preview"));
    expect(await res.text()).toContain("Hello Preview!");
  });

  it("sends a fragment over 1 KiB gzipped once from `node dist/server.js`, and plain to a client without gzip", async () => {
    let child: ChildProcess | undefined;
    let output = "";
    const isOurs = await fromBuild({ outDir });
    const origin = await onFreePort({
      start: async (port) => {
        output = "";
        child = spawn(process.execPath, [resolve(outDir, "server.js")], { env: { ...process.env, PORT: String(port) } });
        child.stdout?.on("data", (chunk) => (output += chunk));
        child.stderr?.on("data", (chunk) => (output += chunk));
        await waitForServer({ url: `http://localhost:${port}/droplets/hello`, child, name: "node", isOurs, output: () => output });
        return `http://localhost:${port}`;
      },
    });
    try {
      const url = `${origin}/droplets/hello?who=${"n".repeat(1500)}`;
      const plain = await rawGet({ url });
      expect(plain.headers["content-encoding"]).toBeUndefined();
      const zipped = await rawGet({ url, headers: { "accept-encoding": "gzip" } });
      expect(zipped.headers["content-encoding"]).toBe("gzip");
      expect(zipped.headers["cache-control"]).toBe("private, no-store, no-transform");
      expect(zipped.headers["vary"]).toContain("accept-encoding");
      // Each render has an id of its own.
      const unrendered = (html: string) => html.replace(/ data-droplet-render="[^"]+"/, "");
      expect(unrendered(gunzipSync(zipped.body).toString())).toBe(unrendered(plain.body.toString()));
    } finally {
      await stopServer({ child });
    }
  });
});

describe("node with a function-form droplets.config.ts", () => {
  for (const [form, source] of Object.entries(FUNCTION_CONFIGS)) {
    describe(form, () => {
      const dir = resolve(FIXTURE_ROOT, `dist-node-config-${form}`);
      const configFile = resolve(FIXTURE_ROOT, `droplets.${form}.config.ts`);
      let server: Server;

      beforeAll(async () => {
        await writeFile(configFile, source);
        try {
          await buildFixture({ outDir: dir, configFile });
        } finally {
          await rm(configFile, { force: true });
        }
        server = (await import(pathToFileURL(resolve(dir, "server.js")).href)) as Server;
      });

      afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
      });

      it("calls it in the server with the build's config env and keeps the functions inside the config", async () => {
        const bundle = await readFile(resolve(dir, "server.js"), "utf8");
        expect(bundle).toMatch(/"command":\s*"build"/);
        expect(bundle).toMatch(/"mode":\s*"production"/);
        const fragment = await server.default.fetch(
          new Request("http://drops.test/droplets/hello?who=Config", { headers: { origin: "http://other.test" } }),
        );
        expect(fragment.status).toBe(200);
        expect((await fragment.text()).startsWith('<test-droplet data-droplet="hello"')).toBe(true);
        expect(fragment.headers.get("access-control-allow-origin")).toBe("http://other.test");
      });
    });
  }
});
