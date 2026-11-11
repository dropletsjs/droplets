import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FRAMEWORKS, frameworkNamed, packageName } from "../../src/add/catalog.ts";

const renderers = fileURLToPath(new URL("../../../renderers/", import.meta.url));

describe("the framework catalog", () => {
  it.each(FRAMEWORKS.map((f) => [f.name, f] as const))("%s installs what its renderer's peers ask for", (_, framework) => {
    const folder = framework.package.replace("@dropletsjs/renderer-", "");
    const pkg = JSON.parse(readFileSync(`${renderers}${folder}/package.json`, "utf8")) as {
      name: string;
      peerDependencies: Record<string, string>;
    };
    expect(pkg.name).toBe(framework.package);
    const peers = Object.entries(pkg.peerDependencies)
      .filter(([name]) => name !== "vite" && name !== "@dropletsjs/droplets")
      .map(([name, range]) => `${name}@${range}`);
    expect(framework.dependencies.toSorted()).toEqual(peers.toSorted());
  });

  it("finds a framework by renderer name, and Hono JSX as hono too", () => {
    expect(frameworkNamed({ name: "react" })?.factory).toBe("react");
    expect(frameworkNamed({ name: "hono" })?.name).toBe("hono-jsx");
    expect(frameworkNamed({ name: "angular" })).toBeUndefined();
  });

  it("reads the package name out of a spec", () => {
    expect(packageName({ spec: "react@^19.0.0" })).toBe("react");
    expect(packageName({ spec: "@types/react@^19.0.0" })).toBe("@types/react");
    expect(packageName({ spec: "@dropletsjs/renderer-vue" })).toBe("@dropletsjs/renderer-vue");
  });
});
