import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DropletEntry } from "../../src/core/discover.ts";
import {
  buildOrder,
  collectCss,
  createBuildEnvironments,
  createClientInputs,
  ENTRY_CLIENT_NAME,
  entryStubCode,
  fillStyles,
  GLOBAL_CSS_NAME,
  translateManifest,
  writeManifest,
} from "../../src/vite/build.ts";
import { createInitialState, type PluginState } from "../../src/vite/state.ts";

const fakeAdapter = (over: Partial<PluginState["adapter"] & object> = {}) => ({
  name: "fake",
  serverEntry: "/adapters/entry.js",
  serverFile: "server.js",
  separateSsrBundle: true,
  ...over,
});
import { clientEntryId, VIRTUAL_CSS } from "../../src/vite/virtual.ts";

const entry = (id: string, name = id): DropletEntry => ({
  id,
  name,
  file: "+droplet.svelte",
  renderer: "svelte",
  hasLoad: false,
  hasServerLoad: false,
  hasError: false,
  ssr: true,
  hydrate: true,
  prerender: false,
});

describe("createClientInputs", () => {
  it("has one named input per droplet plus the entry client and global css", () => {
    const inputs = createClientInputs([entry("hello", "Hello"), entry("clock")]);
    expect(Object.keys(inputs)).toEqual([ENTRY_CLIENT_NAME, GLOBAL_CSS_NAME, "droplets/hello", "droplets/clock"]);
    expect(inputs[GLOBAL_CSS_NAME]).toBe(VIRTUAL_CSS);
    expect(inputs["droplets/hello"]).toBe(clientEntryId("Hello"));
    expect(inputs[ENTRY_CLIENT_NAME]).toMatch(/entry-client\.js$/);
  });
});

describe("createBuildEnvironments", () => {
  it("lays out client, ssr and server under outDir", () => {
    const state = createInitialState();
    state.adapter = fakeAdapter();
    state.outDir = "/proj/out";
    state.entries = [entry("hello")];

    const envs = createBuildEnvironments(state);
    expect(envs["client"]?.build?.outDir).toBe(resolve("/proj/out/client"));
    expect(envs["client"]?.build?.manifest).toBe(true);
    // Externals are the user's own Vite option; the plugin adds none.
    expect(envs["client"]?.build?.rolldownOptions).not.toHaveProperty("external");
    expect(envs["ssr"]?.build?.outDir).toBe(resolve("/proj/out/server"));
    expect(envs["ssr"]?.consumer).toBe("server");
    expect(envs["server"]?.build?.outDir).toBe(resolve("/proj/out"));
    expect(envs["server"]?.build?.emptyOutDir).toBe(false);
    expect(envs["server"]?.build?.ssr).toBe("/adapters/entry.js");
  });

  it("refuses to build without an adapter", () => {
    const state = createInitialState();
    expect(() => createBuildEnvironments(state)).toThrow(/needs an adapter/);
    expect(() => buildOrder(state)).toThrow(/adapter-node/);
  });

  it("bundles everything and merges environment options when asked", () => {
    const state = createInitialState();
    state.adapter = fakeAdapter({
      noExternal: true,
      environment: { resolve: { conditions: ["workerd"] }, build: { target: "es2022" } },
    });
    const envs = createBuildEnvironments(state);
    expect(envs["server"]?.resolve?.noExternal).toBe(true);
    expect(envs["server"]?.resolve?.conditions).toEqual(["workerd"]);
    expect(envs["server"]?.build?.target).toBe("es2022");
    expect(envs["server"]?.build?.ssr).toBe("/adapters/entry.js");
  });

  it("lets an adapter choose the server entry, file name and externals", () => {
    const state = createInitialState();
    state.adapter = fakeAdapter({
      serverEntry: "/adapters/worker.js",
      serverFile: "worker.js",
      separateSsrBundle: false,
      noExternal: ["some-sdk"],
    });
    const envs = createBuildEnvironments(state);
    expect(envs["server"]?.build?.ssr).toBe("/adapters/worker.js");
    const output = envs["server"]?.build?.rolldownOptions?.output;
    expect((Array.isArray(output) ? output[0] : output)?.entryFileNames).toBe("worker.js");
    expect(envs["server"]?.resolve?.noExternal).toContain("some-sdk");
    expect(buildOrder(state)).toEqual(["client", "server"]);
    const withSsr = createInitialState();
    withSsr.adapter = fakeAdapter();
    expect(buildOrder(withSsr)).toEqual(["client", "ssr", "server"]);
  });

  it("names the entry client chunk by its content, under assets/", () => {
    const state = createInitialState();
    state.adapter = fakeAdapter();
    const output = createBuildEnvironments(state)["client"]?.build?.rolldownOptions?.output;
    const naming = (Array.isArray(output) ? output[0] : output)?.entryFileNames as (chunk: { name: string }) => string;
    expect(naming({ name: ENTRY_CLIENT_NAME })).toBe("assets/index.[hash].js");
    // Where the URL says, so its relative imports resolve: /droplets/hello/client.js.
    expect(naming({ name: "droplets/hello" })).toBe("[name]/client.js");
    expect(naming({ name: GLOBAL_CSS_NAME })).toBe("[name].js");
  });
});

describe("translateManifest", () => {
  const viteManifest = {
    "virtual:droplet-client?name=Hello": {
      name: "droplets/hello",
      file: "droplets/hello.js",
      css: ["assets/hello-abc.css"],
    },
    [VIRTUAL_CSS]: {
      name: GLOBAL_CSS_NAME,
      file: "droplets-css.js",
      css: ["assets/droplets-css-def.css"],
    },
    "../../packages/droplets/dist/runtime/entry-client.js": {
      name: ENTRY_CLIENT_NAME,
      file: "assets/index.h4sh.js",
    },
  };

  it("maps droplets to bundles and stylesheets by input name", () => {
    const manifest = translateManifest(viteManifest, "h4sh", [
      { id: "hello", name: "Hello" },
      { id: "plain", name: "plain" },
    ]);
    expect(manifest).toEqual({
      __hash: "h4sh",
      __globalCss: "assets/droplets-css-def.css",
      __entryClient: "index.js",
      __entryModule: "assets/index.h4sh.js",
      __index: null,
      __externals: [],
      // The shared stylesheet first, in every droplet's list.
      droplets: {
        hello: { client: "droplets/hello/client.js", css: ["assets/droplets-css-def.css", "assets/hello-abc.css"] },
        plain: { client: "droplets/plain/client.js", css: ["assets/droplets-css-def.css"] },
      },
    });
  });

  it("leaves an empty shared stylesheet out of the droplets' lists", () => {
    const manifest = translateManifest(viteManifest, "h4sh", [{ id: "hello", name: "Hello" }], null, [], false);
    expect(manifest.__globalCss).toBe("assets/droplets-css-def.css");
    expect(manifest.droplets["hello"]?.css).toEqual(["assets/hello-abc.css"]);
  });

  it("falls back to default paths without a Vite manifest", () => {
    const manifest = translateManifest(null, "x", [{ id: "a", name: "a" }]);
    expect(manifest.__globalCss).toBe(`assets/${GLOBAL_CSS_NAME}.css`);
    expect(manifest.__entryClient).toBe("index.js");
    // No entry to name: /index.js has nothing to import.
    expect(manifest.__entryModule).toBeUndefined();
    expect(manifest.droplets).toEqual({ a: { client: "droplets/a/client.js" } });
  });

  it("lists no client bundle for hydrate = false, keeping its stylesheet", () => {
    const manifest = translateManifest(
      { "virtual:droplet-client?name=clock": { name: "droplets/clock", css: ["assets/clock.css"] } },
      "x",
      [{ id: "clock", name: "clock", hydrate: false }],
    );
    expect(manifest.droplets["clock"]).toEqual({ css: ["assets/clock.css"] });
  });

  it("carries the index page, or null", () => {
    expect(translateManifest(null, "x", []).__index).toBeNull();
    expect(translateManifest(null, "x", [], "<p>home</p>").__index).toBe("<p>home</p>");
  });

  it("falls back to path-shaped keys when names are missing", () => {
    const manifest = translateManifest({ "virtual:droplet-client?name=Hello": { css: ["assets/h.css"] } }, "x", [
      { id: "hello", name: "Hello" },
    ]);
    expect(manifest.droplets["hello"]?.css).toEqual(["assets/h.css"]);
  });

  it("lists every stylesheet: shared chunks' first, through nested imports, each once", () => {
    // Badge is shared by counter and hello; Icon only through Badge.
    const shared = {
      "virtual:droplet-client?name=counter": {
        name: "droplets/counter",
        file: "droplets/counter.js",
        imports: ["_client-1.js", "_Badge-2.js"],
        css: ["assets/counter-3.css"],
      },
      "virtual:droplet-client?name=hello": {
        name: "droplets/hello",
        file: "droplets/hello.js",
        imports: ["_Badge-2.js", "_client-1.js"],
      },
      "_client-1.js": { file: "assets/chunks/client-1.js", name: "client" },
      "_Badge-2.js": {
        file: "assets/chunks/Badge-2.js",
        name: "Badge",
        imports: ["_Icon-4.js", "_client-1.js"],
        css: ["assets/Badge-2.css"],
      },
      "_Icon-4.js": { file: "assets/chunks/Icon-4.js", name: "Icon", imports: ["_Badge-2.js"], css: ["assets/Icon-4.css"] },
    };
    const manifest = translateManifest(shared, "x", [
      { id: "counter", name: "counter" },
      { id: "hello", name: "hello" },
    ]);
    expect(manifest.droplets["counter"]?.css).toEqual(["assets/Icon-4.css", "assets/Badge-2.css", "assets/counter-3.css"]);
    expect(manifest.droplets["hello"]?.css).toEqual(["assets/Icon-4.css", "assets/Badge-2.css"]);
    // An import missing from the manifest is skipped, a cycle walked once.
    expect(collectCss(shared, { imports: ["_gone.js", "_Icon-4.js"] })).toEqual(["assets/Badge-2.css", "assets/Icon-4.css"]);
  });
});

describe("the entry stub and the stylesheet registry", () => {
  it("imports the entry relative to the stub's own URL", () => {
    expect(entryStubCode("assets/index.abc.js")).toBe('import("./assets/index.abc.js");\n');
  });

  it("writes the droplets with stylesheets where the registry left room, whatever the quotes", () => {
    const droplets = { a: { css: ["assets/a.css"] }, b: { client: "droplets/b.js" } };
    for (const quote of ['"', "'", "`"]) {
      const code = `const s=JSON.parse(${quote}__DROPLETS_STYLES__${quote});`;
      const filled = fillStyles(code, droplets);
      expect(filled).not.toContain("__DROPLETS_STYLES__");
      // eslint-disable-next-line no-new-func
      expect(new Function(`${filled} return s;`)()).toEqual({ a: ["assets/a.css"] });
    }
    expect(() => fillStyles("const s = {};", droplets)).toThrow(/no room/);
  });
});

describe("writeManifest", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-write-manifest-"));
    await mkdir(join(root, "client/.vite"), { recursive: true });
    await writeFile(
      join(root, "client/.vite/manifest.json"),
      JSON.stringify({
        "virtual:droplet-client?name=hello": {
          name: "droplets/hello",
          file: "droplets/hello.js",
          imports: ["_Badge.js"],
          css: ["assets/hello.css"],
        },
        "_Badge.js": { file: "assets/chunks/Badge.js", css: ["assets/Badge.css"] },
        "entry-client.js": { name: ENTRY_CLIENT_NAME, file: "assets/index.abc.js" },
      }),
    );
    await mkdir(join(root, "client/assets"), { recursive: true });
    await writeFile(join(root, "client/assets/index.abc.js"), 'const styles=JSON.parse("__DROPLETS_STYLES__");');
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes dist/client/droplets.json", async () => {
    const state = createInitialState();
    state.root = root;
    state.outDir = root;
    state.buildHash = "abc";
    state.entries = [entry("hello")];
    const path = await writeManifest(state);
    expect(path).toBe(join(root, "client/droplets.json"));
    const written = JSON.parse(await readFile(path, "utf8"));
    expect(written.__hash).toBe("abc");
    expect(written.droplets.hello).toEqual({ client: "droplets/hello/client.js", css: ["assets/Badge.css", "assets/hello.css"] });
    // The stub, and the stylesheets in the entry.
    expect(written.__entryClient).toBe("index.js");
    expect(await readFile(join(root, "client/index.js"), "utf8")).toBe('import("./assets/index.abc.js");\n');
    expect(await readFile(join(root, "client/assets/index.abc.js"), "utf8")).toBe(
      `const styles=JSON.parse(${JSON.stringify(JSON.stringify({ hello: ["assets/Badge.css", "assets/hello.css"] }))});`,
    );
    // No index.html in the root: the placeholder page goes in.
    expect(written.__index).toContain("Powering Microfrontends");
  });
});
