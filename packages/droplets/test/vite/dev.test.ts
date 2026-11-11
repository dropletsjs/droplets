import { describe, expect, it } from "vitest";
import type { EnvironmentModuleNode } from "vite";
import {
  affectedDroplets,
  classifyChange,
  dropletForFile,
  extractDropletIdFromModuleId,
  extractLoadFromModuleId,
} from "../../src/vite/dev.ts";

describe("extractDropletIdFromModuleId", () => {
  it.each([
    ["/proj/src/droplets/hello/+droplet.svelte", "hello"],
    ["/proj/src/droplets/hello-world/+Droplet.svelte?svelte&type=style", "hello-world"],
    ["/proj/src/droplets/hello-world/+droplet.vue?vue&type=style&index=0&lang.css", "hello-world"],
    ["C:\\proj\\src\\droplets\\clock\\+droplet.svelte", "clock"],
    // Not lowercase kebab-case: not a droplet.
    ["/proj/src/droplets/HelloWorld/+droplet.svelte", null],
    ["/proj/src/droplets/hello/Badge.svelte", null],
    // Load files are not components.
    ["/proj/src/droplets/hello/+droplet.ts", null],
    ["/proj/src/droplets/hello/+droplet.server.ts", null],
    ["/proj/src/droplets/drops/+droplet.svelte", "drops"],
    ["/proj/src/lib/+droplet.svelte", "lib"],
    ["/proj/src/droplets/tpl/+droplet.fake.js", "tpl"],
  ])("%s -> %s", (id, expected) => {
    expect(extractDropletIdFromModuleId({ id })).toBe(expected);
  });

  it("matches only the configured extensions when given", () => {
    expect(extractDropletIdFromModuleId({ id: "/p/src/droplets/a/+droplet.svelte", extensions: [".vue"] })).toBeNull();
    expect(extractDropletIdFromModuleId({ id: "/p/src/droplets/a/+droplet.vue", extensions: [".vue"] })).toBe("a");
  });
});

describe("dropletForFile", () => {
  const root = "/proj/src/droplets";
  it("maps files inside a droplet folder to its id", () => {
    expect(dropletForFile({ dropletsRoot: root, file: "/proj/src/droplets/hello-world/+droplet.ts" })).toBe("hello-world");
    expect(dropletForFile({ dropletsRoot: root, file: "/proj/src/droplets/HelloWorld/+droplet.ts" })).toBeNull();
    expect(dropletForFile({ dropletsRoot: root, file: "/proj/src/droplets/hello/nested/util.ts" })).toBe("hello");
  });
  it("ignores files outside the root", () => {
    expect(dropletForFile({ dropletsRoot: root, file: "/proj/src/lib/Badge.svelte" })).toBeNull();
    expect(dropletForFile({ dropletsRoot: root, file: "/proj/src/droplets" })).toBeNull();
    expect(dropletForFile({ dropletsRoot: root, file: "/proj/src/droplets-other/x/+droplet.svelte" })).toBeNull();
    // No id is reserved: every route lives under /droplets/.
    expect(dropletForFile({ dropletsRoot: root, file: "/proj/src/droplets/drops/+droplet.svelte" })).toBe("drops");
  });
});

type NodeInput = { id: string; importers?: EnvironmentModuleNode[] };

/** Minimal module-graph nodes: an id and who imports them. */
function node({ id, importers = [] }: NodeInput): EnvironmentModuleNode {
  return { id, importers: new Set(importers) } as unknown as EnvironmentModuleNode;
}

describe("affectedDroplets", () => {
  const root = "/proj/src/droplets";

  it("short-circuits for files inside a droplet folder", () => {
    const found = affectedDroplets({ dropletsRoot: root, file: "/proj/src/droplets/clock/+droplet.server.ts", modules: [] });
    expect([...found]).toEqual(["clock"]);
  });

  it("walks importers up to every droplet entry, once each", () => {
    const hello = node({ id: "/proj/src/droplets/hello/+droplet.svelte" });
    const world = node({ id: "/proj/src/droplets/world/+droplet.svelte" });
    const card = node({ id: "/proj/src/lib/Card.svelte", importers: [hello, world] });
    const badge = node({ id: "/proj/src/lib/Badge.svelte", importers: [card, hello] });
    // A cycle must not hang the walk.
    card.importers.add(badge);

    const found = affectedDroplets({ dropletsRoot: root, file: "/proj/src/lib/Badge.svelte", modules: [badge] });
    expect([...found].sort()).toEqual(["hello", "world"]);
  });

  it("returns nothing for files no droplet depends on", () => {
    const util = node({ id: "/proj/src/lib/util.ts", importers: [node({ id: "/proj/src/other.ts" })] });
    expect(affectedDroplets({ dropletsRoot: root, file: "/proj/src/lib/util.ts", modules: [util] }).size).toBe(0);
  });
});

describe("classifyChange: what an edit touches, per droplet", () => {
  const root = "/proj/src/droplets";
  const serverFile = (file: string) => /\.server\./.test(file) || file.includes("/server/");
  type AtInput = { file: string; modules?: EnvironmentModuleNode[] };

  const at = ({ file, modules = [] }: AtInput) =>
    Object.fromEntries(classifyChange({ dropletsRoot: root, file, modules, extensions: [".svelte"], isServerFile: serverFile }));

  it("tells a droplet's load files from its component in its folder", () => {
    expect(at({ file: "/proj/src/droplets/clock/+droplet.server.ts" })).toEqual({
      clock: { component: false, load: true, universal: false },
    });
    expect(at({ file: "/proj/src/droplets/clock/+droplet.ts" })).toEqual({ clock: { component: false, load: true, universal: true } });
    expect(at({ file: "/proj/src/droplets/clock/db.server.ts" })).toEqual({ clock: { component: false, load: true, universal: false } });
    expect(at({ file: "/proj/src/droplets/clock/server/db.ts" })).toEqual({ clock: { component: false, load: true, universal: false } });
    expect(at({ file: "/proj/src/droplets/clock/+droplet.svelte" })).toEqual({ clock: { component: true, load: false, universal: false } });
    expect(at({ file: "/proj/src/droplets/clock/Face.svelte" })).toEqual({ clock: { component: true, load: false, universal: false } });
  });

  it("traces a shared file to the components and the loads that import it", () => {
    const hello = node({ id: "/proj/src/droplets/hello/+droplet.svelte" });
    const worldLoad = node({ id: "/proj/src/droplets/world/+droplet.server.ts" });
    const pageLoad = node({ id: "/proj/src/droplets/page/+droplet.ts" });
    const util = node({ id: "/proj/src/lib/format.ts", importers: [hello, worldLoad, pageLoad] });
    expect(at({ file: "/proj/src/lib/format.ts", modules: [util] })).toEqual({
      hello: { component: true, load: false, universal: false },
      world: { component: false, load: true, universal: false },
      page: { component: false, load: true, universal: true },
    });
  });

  it("reaches nothing from a file no droplet imports", () => {
    expect(
      at({
        file: "/proj/src/lib/util.ts",
        modules: [node({ id: "/proj/src/lib/util.ts", importers: [node({ id: "/proj/src/other.ts" })] })],
      }),
    ).toEqual({});
  });

  it("reads a load file's droplet off its id", () => {
    expect(extractLoadFromModuleId({ id: "/p/src/droplets/hello-world/+droplet.server.ts?t=1" })).toEqual({
      droplet: "hello-world",
      server: true,
    });
    expect(extractLoadFromModuleId({ id: "/p/src/droplets/HelloWorld/+droplet.server.ts" })).toBeNull();
    expect(extractLoadFromModuleId({ id: "/p/src/droplets/a/+droplet.js" })).toEqual({ droplet: "a", server: false });
    expect(extractLoadFromModuleId({ id: "/p/src/droplets/a/+droplet.svelte" })).toBeNull();
  });
});
