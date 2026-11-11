/**
 * The shared package build (packages/tsdown.config.base.ts) on small
 * samples: a `.css` import inlined as text, what minifying keeps, and a
 * client entry that reaches server code failing the build.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packageConfig, type PackageOptions } from "../../../tsdown.config.base.ts";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

const run = (options: PackageOptions, overrides: Parameters<typeof build>[0] = {}) =>
  build({ ...packageConfig(options), config: false, logLevel: "silent", ...overrides });

describe("a .css import", () => {
  const dir = join(fixtures, "css-text");
  let code = "";

  beforeAll(async () => {
    await run({ dir, entry: ["index"], client: ["index"] });
    code = await readFile(join(dir, "dist/index.js"), "utf8");
  });
  afterAll(() => rm(join(dir, "dist"), { recursive: true, force: true }));

  it("is inlined as the file's text, with no import or file left", async () => {
    const css = await readFile(join(dir, "src/styles.css"), "utf8");
    const { css: built } = (await import(join(dir, "dist/index.js"))) as { css: string };
    expect(built).toBe(css);
    expect(code).not.toMatch(/\.css["'`]/);
    expect(await readdir(join(dir, "dist"))).toEqual(["index.d.ts", "index.js"]);
  });

  it("types the export as a string, with its JSDoc", async () => {
    const dts = await readFile(join(dir, "dist/index.d.ts"), "utf8");
    expect(dts).toContain("/** The stylesheet, as text. */");
    expect(dts).toMatch(/declare const css: string/);
    expect(dts).not.toContain(".css");
  });

  it("is minified, keeping function and class names, import.meta.env.DEV and @vite-ignore", async () => {
    expect(code.split("\n").length).toBeLessThan(10);
    const { fail } = (await import(join(dir, "dist/index.js"))) as { fail: () => never };
    const error = (() => {
      try {
        fail();
      } catch (error) {
        return error as Error;
      }
    })();
    expect(error?.constructor.name).toBe("LocalError");
    expect(error?.stack).toContain("throwLocal");
    expect(code).toContain("import.meta.env.DEV");
    expect(code).toMatch(/import\(\s*\/\* @vite-ignore \*\/\s*\w+\)/);
    expect(existsSync(join(dir, "dist/index.js.map"))).toBe(false);
  });
});

describe("a client entry", () => {
  const dir = join(fixtures, `.client-graph-${process.pid}`);

  beforeAll(async () => {
    await mkdir(join(dir, "src/server"), { recursive: true });
    await writeFile(join(dir, "package.json"), `{ "name": "client-graph-fixture", "type": "module" }\n`);
    await writeFile(join(dir, "src/shared.ts"), `export const shared = () => "shared";\n`);
    await writeFile(join(dir, "src/db.server.ts"), `export const secret = () => "secret";\n`);
    await writeFile(join(dir, "src/server/keys.ts"), `export const key = () => "key";\n`);
    await writeFile(join(dir, "src/app.ts"), `import { secret } from "./db.server.ts";\nexport const app = () => secret();\n`);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const entries = async (client: string) => {
    await writeFile(join(dir, "src/client.ts"), client);
    await writeFile(join(dir, "src/server.ts"), `import { shared } from "./shared.ts";\nimport { app } from "./app.ts";\nexport const render = () => shared() + app();\n`);
  };
  const options = (extra: Partial<PackageOptions> = {}): PackageOptions => ({
    dir,
    entry: ["client", "server"],
    client: ["client"],
    ...extra,
  });

  it("builds when it shares only client-safe code with the server", async () => {
    await entries(`import { shared } from "./shared.ts";\nexport const hydrate = () => shared();\n`);
    await run(options(), { dts: false });
    expect(await readFile(join(dir, "dist/client.js"), "utf8")).not.toContain("secret");
  });

  it.each([
    ["a *.server.* module", `import { secret } from "./db.server.ts";\nexport const hydrate = () => secret();\n`, /reaches server code db\.server\.ts/],
    ["a module under server/", `export const hydrate = () => import("./server/keys.ts");\n`, /reaches server code server\/keys\.ts/],
    ["a module named server code", `import { app } from "./app.ts";\nexport const hydrate = () => app();\n`, /reaches server code (app|db\.server)\.ts/],
    ["a Node built-in", `import { join } from "node:path";\nexport const hydrate = () => join("a", "b");\n`, /imports a Node built-in/],
  ])("fails the build when it reaches %s", async (_, client, message) => {
    await entries(client);
    await expect(run(options({ server: ["app"] }), { dts: false })).rejects.toThrow(message);
  });
});
