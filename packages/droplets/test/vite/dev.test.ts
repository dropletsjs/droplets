import { describe, expect, it } from "vitest";
import type { EnvironmentModuleNode } from "vite";
import {
  affectedDroplets,
  classifyChange,
  dropletForFile,
  extractDropletIdFromModuleId,
  extractLoadFromModuleId,
} from "../../src/vite/dev.ts";
import { withViteIdAliases } from "../../src/vite/externalize.ts";

describe("extractDropletIdFromModuleId", () => {
  it.each([
    ["/proj/src/droplets/hello/+droplet.svelte", "hello"],
    ["/proj/src/droplets/HelloWorld/+Droplet.svelte?svelte&type=style", "hello-world"],
    ["/proj/src/droplets/HelloWorld/+droplet.vue?vue&type=style&index=0&lang.css", "hello-world"],
    ["C:\\proj\\src\\droplets\\Clock\\+droplet.svelte", "clock"],
    ["/proj/src/droplets/hello/Badge.svelte", null],
    // Load files are not components.
    ["/proj/src/droplets/hello/+droplet.ts", null],
    ["/proj/src/droplets/hello/+droplet.server.ts", null],
    ["/proj/src/droplets/drops/+droplet.svelte", "drops"],
    ["/proj/src/lib/+droplet.svelte", "lib"],
    ["/proj/src/droplets/tpl/+droplet.fake.js", "tpl"],
  ])("%s -> %s", (id, expected) => {
    expect(extractDropletIdFromModuleId(id)).toBe(expected);
  });

  it("matches only the configured extensions when given", () => {
    expect(extractDropletIdFromModuleId("/p/src/droplets/a/+droplet.svelte", [".vue"])).toBeNull();
    expect(extractDropletIdFromModuleId("/p/src/droplets/a/+droplet.vue", [".vue"])).toBe("a");
  });
});

describe("dropletForFile", () => {
  const root = "/proj/src/droplets";
  it("maps files inside a droplet folder to its id", () => {
    expect(dropletForFile(root, "/proj/src/droplets/HelloWorld/+droplet.ts")).toBe("hello-world");
    expect(dropletForFile(root, "/proj/src/droplets/hello/nested/util.ts")).toBe("hello");
  });
  it("ignores files outside the root", () => {
    expect(dropletForFile(root, "/proj/src/lib/Badge.svelte")).toBeNull();
    expect(dropletForFile(root, "/proj/src/droplets")).toBeNull();
    expect(dropletForFile(root, "/proj/src/droplets-other/x/+droplet.svelte")).toBeNull();
    // Nothing is reserved any more: every route lives under /droplets/.
    expect(dropletForFile(root, "/proj/src/droplets/drops/+droplet.svelte")).toBe("drops");
  });
});

/** Minimal module-graph nodes: an id and who imports them. */
function node(id: string, importers: EnvironmentModuleNode[] = []): EnvironmentModuleNode {
  return { id, importers: new Set(importers) } as unknown as EnvironmentModuleNode;
}

describe("affectedDroplets", () => {
  const root = "/proj/src/droplets";

  it("short-circuits for files inside a droplet folder", () => {
    const found = affectedDroplets(root, "/proj/src/droplets/clock/+droplet.server.ts", []);
    expect([...found]).toEqual(["clock"]);
  });

  it("walks importers up to every droplet entry, once each", () => {
    const hello = node("/proj/src/droplets/hello/+droplet.svelte");
    const world = node("/proj/src/droplets/World/+droplet.svelte");
    const card = node("/proj/src/lib/Card.svelte", [hello, world]);
    const badge = node("/proj/src/lib/Badge.svelte", [card, hello]);
    // A cycle must not hang the walk.
    card.importers.add(badge);

    const found = affectedDroplets(root, "/proj/src/lib/Badge.svelte", [badge]);
    expect([...found].sort()).toEqual(["hello", "world"]);
  });

  it("returns nothing for files no droplet depends on", () => {
    const util = node("/proj/src/lib/util.ts", [node("/proj/src/other.ts")]);
    expect(affectedDroplets(root, "/proj/src/lib/util.ts", [util]).size).toBe(0);
  });
});

describe("classifyChange: what an edit touches, per droplet", () => {
  const root = "/proj/src/droplets";
  const serverFile = (file: string) => /\.server\./.test(file) || file.includes("/server/");
  const at = (file: string, modules: EnvironmentModuleNode[] = []) =>
    Object.fromEntries(classifyChange(root, file, modules, [".svelte"], serverFile));

  it("tells a droplet's load files from its component in its folder", () => {
    expect(at("/proj/src/droplets/Clock/+droplet.server.ts")).toEqual({ clock: { component: false, load: true, universal: false } });
    expect(at("/proj/src/droplets/clock/+droplet.ts")).toEqual({ clock: { component: false, load: true, universal: true } });
    expect(at("/proj/src/droplets/clock/db.server.ts")).toEqual({ clock: { component: false, load: true, universal: false } });
    expect(at("/proj/src/droplets/clock/server/db.ts")).toEqual({ clock: { component: false, load: true, universal: false } });
    expect(at("/proj/src/droplets/clock/+droplet.svelte")).toEqual({ clock: { component: true, load: false, universal: false } });
    expect(at("/proj/src/droplets/clock/Face.svelte")).toEqual({ clock: { component: true, load: false, universal: false } });
  });

  it("traces a shared file to the components and the loads that import it", () => {
    const hello = node("/proj/src/droplets/hello/+droplet.svelte");
    const worldLoad = node("/proj/src/droplets/World/+droplet.server.ts");
    const pageLoad = node("/proj/src/droplets/page/+droplet.ts");
    const util = node("/proj/src/lib/format.ts", [hello, worldLoad, pageLoad]);
    expect(at("/proj/src/lib/format.ts", [util])).toEqual({
      hello: { component: true, load: false, universal: false },
      world: { component: false, load: true, universal: false },
      page: { component: false, load: true, universal: true },
    });
  });

  it("reaches nothing from a file no droplet imports", () => {
    expect(at("/proj/src/lib/util.ts", [node("/proj/src/lib/util.ts", [node("/proj/src/other.ts")])])).toEqual({});
  });

  it("reads a load file's droplet off its id", () => {
    expect(extractLoadFromModuleId("/p/src/droplets/HelloWorld/+droplet.server.ts?t=1")).toEqual({ droplet: "hello-world", server: true });
    expect(extractLoadFromModuleId("/p/src/droplets/a/+droplet.js")).toEqual({ droplet: "a", server: false });
    expect(extractLoadFromModuleId("/p/src/droplets/a/+droplet.svelte")).toBeNull();
  });
});

describe("withViteIdAliases", () => {
  it("adds /@id/ twins for bare specifiers only", () => {
    expect(
      withViteIdAliases({
        "ag-grid": "https://cdn.test/ag.js",
        "/@id/already": "https://cdn.test/a.js",
        "./relative": "https://cdn.test/r.js",
        "https://cdn.test/x.js": "https://cdn.test/y.js",
      }),
    ).toEqual({
      "ag-grid": "https://cdn.test/ag.js",
      "/@id/ag-grid": "https://cdn.test/ag.js",
      "/@id/already": "https://cdn.test/a.js",
      "./relative": "https://cdn.test/r.js",
      "https://cdn.test/x.js": "https://cdn.test/y.js",
    });
  });

  it("passes undefined through", () => {
    expect(withViteIdAliases(undefined)).toBeUndefined();
  });
});
