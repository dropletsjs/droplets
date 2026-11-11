import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingPackages } from "../../src/add/add.ts";
import { frameworkNamed } from "../../src/add/catalog.ts";
import { coreVersion, detectPackageManager, installCommand, isInstalled } from "../../src/add/install.ts";

describe("the package manager", () => {
  it("is the one running djs, else the nearest lockfile's, else npm", () => {
    const top = mkdtempSync(join(tmpdir(), "djs-pm-"));
    const project = join(top, "apps", "web");
    mkdirSync(project, { recursive: true });
    expect(detectPackageManager(project, "bun/1.4.4 npm/? node/v24.0.0 darwin arm64")).toBe("bun");
    expect(detectPackageManager(project, "")).toBe("npm");
    writeFileSync(join(top, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(project, "")).toBe("pnpm");
    writeFileSync(join(project, "deno.lock"), "{}");
    expect(detectPackageManager(project, "")).toBe("deno");
  });

  it("adds dependencies and dev dependencies in each one's words", () => {
    expect(installCommand("npm", ["react@^19.0.0"], true)).toEqual(["npm", "install", "--save-dev", "react@^19.0.0"]);
    expect(installCommand("pnpm", ["vue@^3.5.0"], false)).toEqual(["pnpm", "add", "vue@^3.5.0"]);
    expect(installCommand("yarn", ["a"], true)).toEqual(["yarn", "add", "--dev", "a"]);
    expect(installCommand("bun", ["a"], true)).toEqual(["bun", "add", "--dev", "a"]);
    expect(installCommand("deno", ["hono@^4.13.0", "@types/react"], true)).toEqual([
      "deno",
      "add",
      "--dev",
      "npm:hono@^4.13.0",
      "npm:@types/react",
    ]);
  });

  it("finds packages in node_modules up the tree", () => {
    const top = mkdtempSync(join(tmpdir(), "djs-installed-"));
    mkdirSync(join(top, "node_modules", "@scope", "pkg"), { recursive: true });
    writeFileSync(join(top, "node_modules", "@scope", "pkg", "package.json"), "{}");
    mkdirSync(join(top, "app"));
    expect(isInstalled(join(top, "app"), "@scope/pkg")).toBe(true);
    expect(isInstalled(join(top, "app"), "missing")).toBe(false);
  });

  it("pins the renderer to the version of the core the project has installed", () => {
    const top = mkdtempSync(join(tmpdir(), "djs-core-"));
    const core = join(top, "node_modules", "@dropletsjs", "droplets");
    mkdirSync(core, { recursive: true });
    writeFileSync(join(core, "package.json"), JSON.stringify({ name: "@dropletsjs/droplets", version: "1.0.0-alpha.3" }));
    mkdirSync(join(top, "app"));
    expect(coreVersion(join(top, "app"))).toBe("1.0.0-alpha.3");

    const react = frameworkNamed("react") ?? expect.unreachable("react");
    expect(missingPackages(join(top, "app"), react)).toEqual({
      dependencies: ["react@^19.0.0", "react-dom@^19.0.0"],
      devDependencies: ["@dropletsjs/renderer-react@1.0.0-alpha.3", "@types/react@^19.0.0", "@types/react-dom@^19.0.0"],
    });
    expect(
      installCommand("npm", missingPackages(join(top, "app"), frameworkNamed("vue") ?? expect.unreachable("vue")).devDependencies, true),
    ).toEqual(["npm", "install", "--save-dev", "@dropletsjs/renderer-vue@1.0.0-alpha.3"]);
  });

  it("falls back to the version of the core running djs", () => {
    const own = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    const lone = mkdtempSync(join(tmpdir(), "djs-lone-"));
    expect(coreVersion(lone)).toBe(own.version);
    expect(missingPackages(lone, frameworkNamed("svelte") ?? expect.unreachable("svelte")).devDependencies).toEqual([
      `@dropletsjs/renderer-svelte@${own.version}`,
    ]);
  });
});
