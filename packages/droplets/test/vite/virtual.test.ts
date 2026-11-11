import { describe, expect, it } from "vitest";
import type { DropletEntry } from "../../src/core/discover.ts";
import type { DropletRenderer } from "../../src/renderer.ts";
import { locationScript, serverKey } from "../../src/runtime/server-records.ts";
import { createInitialState, type PluginState } from "../../src/vite/state.ts";
import {
  buildClientCode,
  buildClientDevCode,
  buildConfigCode,
  clientInitCode,
  buildDropClientCode,
  buildFormClientCode,
  buildFormServerCode,
  buildDropServerCode,
  buildServerCode,
  clientEntryId,
  createClientModuleCode,
  mayImportServerOnly,
  parseClientName,
  RESOLVED_VIRTUAL_DROPLETS,
  VIRTUAL_CLIENT,
  VIRTUAL_CONFIG,
  VIRTUAL_CSS,
  VIRTUAL_DROPLETS,
  VIRTUAL_ENV,
  virtualModulesPlugin,
} from "../../src/vite/virtual.ts";

const entry = (overrides: Partial<DropletEntry>): DropletEntry => ({
  id: "hello",
  name: "hello",
  file: "+droplet.svelte",
  renderer: "svelte",
  hasLoad: false,
  hasServerLoad: false,
  hasError: false,
  ssr: true,
  hydrate: true,
  prerender: false,
  ...overrides,
});

const svelte: DropletRenderer = {
  name: "svelte",
  extensions: [".svelte"],
  server: "/r/svelte/server.js",
  client: "/r/svelte/client.js",
};
const vue: DropletRenderer = {
  name: "vue",
  extensions: [".vue"],
  server: "/r/vue/server.js",
  client: "/r/vue/client.js",
  clientSetup: "/r/vue/setup.js",
};
const renderers = [svelte, vue];

describe("client entry ids", () => {
  it("round-trip the folder name", () => {
    const id = clientEntryId({ folderName: "Hello World" });
    expect(id).toBe(`${VIRTUAL_CLIENT}?name=Hello%20World`);
    expect(parseClientName({ id: id })).toBe("Hello World");
    expect(parseClientName({ id: `\0${id}` })).toBe("Hello World");
  });

  it("returns null without a name", () => {
    expect(parseClientName({ id: VIRTUAL_CLIENT })).toBeNull();
    expect(parseClientName({ id: `${VIRTUAL_CLIENT}?name=` })).toBeNull();
    expect(parseClientName({ id: `${VIRTUAL_CLIENT}?other=x` })).toBeNull();
  });
});

describe("buildServerCode", () => {
  it("imports every file a droplet has, its renderer, and wraps loads in thunks", () => {
    const code = buildServerCode({
      entries: [
        entry({ id: "hello", name: "hello", hasLoad: true, hasServerLoad: true }),
        entry({ id: "upper", name: "upper", file: "+Droplet.vue", renderer: "vue", hydrate: false }),
      ],
      globRoot: "/src/droplets",
      renderers,
    });
    expect(code).toContain('import * as renderer_0 from "/r/svelte/server.js";');
    expect(code).toContain('import * as renderer_1 from "/r/vue/server.js";');
    expect(code).toContain('import * as component_0 from "/src/droplets/hello/+droplet.svelte";');
    expect(code).toContain('import * as load_0 from "/src/droplets/hello/+droplet.ts";');
    expect(code).toContain('import * as serverLoad_0 from "/src/droplets/hello/+droplet.server.ts";');
    expect(code).toContain("component: component_0,");
    expect(code).toContain("renderer: renderer_0,");
    expect(code).toContain("load: () => Promise.resolve(load_0),");
    expect(code).toContain("serverLoad: () => Promise.resolve(serverLoad_0),");

    expect(code).toContain('import * as component_1 from "/src/droplets/upper/+Droplet.vue";');
    expect(code).toContain("renderer: renderer_1,");
    expect(code).toContain("hydrate: false,");
    expect(code).toContain("load: undefined,");
    expect(code).toContain("export default droplets;");
    expect(code).toContain("export const api = [\n];");
    expect(code).toContain("export const hooks = {};");
    // Nothing engine-specific in what core generates.
    expect(code).not.toMatch(/from "svelte|createRawSnippet/);
  });

  it("refuses an entry whose renderer is not configured", () => {
    expect(() => buildServerCode({ entries: [entry({ renderer: "gone" })], globRoot: "/src/droplets", renderers })).toThrow(
      /no renderer named "gone"/,
    );
  });

  it("imports API routes and the hooks file", () => {
    const code = buildServerCode({
      entries: [],
      globRoot: "/src/droplets",
      apiGlobRoot: "/src/api",
      apiRoutes: [
        {
          id: "/api/users/[id]",
          file: "users/[id]/+server.ts",
          segments: [
            { type: "static", value: "api" },
            { type: "static", value: "users" },
            { type: "param", name: "id" },
          ],
        },
      ],
      hooksFile: "/src/hooks.server.ts",
    });
    expect(code).toContain('import * as api_0 from "/src/api/users/[id]/+server.ts";');
    expect(code).toContain(
      '{ id: "/api/users/[id]", segments: [{"type":"static","value":"api"},{"type":"static","value":"users"},{"type":"param","name":"id"}], module: api_0 },',
    );
    expect(code).toContain('import * as hooks from "/src/hooks.server.ts";');
    expect(code).toContain("export { hooks };");
    expect(code).not.toContain("errorComponent");
  });

  it("imports each droplet's own error page, rendered by the droplet's renderer", () => {
    const code = buildServerCode({
      entries: [
        entry({
          id: "hello",
          name: "hello",
          hasError: true,
          errorFile: "+error.svelte",
        }),
      ],
      globRoot: "/src/droplets",
      renderers,
    });
    expect(code).toContain('import * as error_0 from "/src/droplets/hello/+error.svelte";');
    expect(code).toContain("error: error_0,");
    expect(code).not.toContain("errorRenderer");
    expect(code).not.toContain("errorFlags");
    expect(code).not.toContain('"/src/droplets/+error.svelte"');
  });

  it("emits an empty registry when there are no droplets", () => {
    const code = buildServerCode({ entries: [], globRoot: "/src" });
    expect(code).toContain("const droplets = {\n};");
  });
});

describe("buildClientDevCode", () => {
  it("exports the config's dev strategy, injectTool and the dev tool's URL", () => {
    expect(buildClientDevCode({ strategy: "reload", injectTool: true, toolUrl: "/@fs/tool.js" })).toBe(
      ['export const strategy = "reload";', "export const injectTool = true;", 'export const toolUrl = "/@fs/tool.js";', ""].join("\n"),
    );
    expect(buildClientDevCode({ strategy: "hmr", injectTool: false, toolUrl: null })).toContain("export const toolUrl = null;");
  });
});

describe("buildClientCode", () => {
  it("lists ids and hydration flags with the build hash", () => {
    const code = buildClientCode({ entries: [entry({ id: "a" }), entry({ id: "b", hydrate: false })], buildHash: "h4sh" });
    expect(code).toContain('export const buildHash = "h4sh";');
    expect(code).toContain('export const elementName = "djs-droplet";');
    expect(buildClientCode({ entries: [], buildHash: "x", elementName: "acme-widget" })).toContain(
      'export const elementName = "acme-widget";',
    );
    // What only `vite dev` reads is in `virtual:droplets-dev`, which nothing but the dev module imports.
    expect(code).not.toMatch(/strategy|injectTool|toolUrl/i);
    expect(code).toContain('export const dropletsById = {\n  "a": true,\n  "b": true,\n};');
    expect(code).toContain('export const dropletsHydrateById = {\n  "a": true,\n};');
    expect(
      buildClientCode({ entries: [entry({ id: "v", hydrate: "visible" }), entry({ id: "i", hydrate: "interactive" })], buildHash: "h" }),
    ).toContain('export const dropletsHydrateById = {\n  "v": "visible",\n  "i": "interactive",\n};');
    // Dev: Vite injects the shared stylesheet with the registry. A build lists it per droplet.
    expect(code).toMatch(/^import "virtual:droplets-css";\n/);
    const built = buildClientCode({ entries: [entry({ id: "a" })], buildHash: "h", elementName: "djs-droplet", isBuilding: true });
    expect(built).not.toContain("import ");
    expect(code).not.toContain("clientHooks");
  });

  it("is the same module as ever without src/hooks.client.ts", () => {
    const built = [
      "const droplets = {};",
      "export default droplets;",
      'export const buildHash = "h";',
      'export const elementName = "djs-droplet";',
      "export const dropletsById = {",
      '  "a": true,',
      "};",
      "export const dropletsHydrateById = {",
      '  "a": true,',
      "};",
      "export const dropletsServerLoadById = {",
      "};",
      "export const dropletsScriptById = {",
      "};",
      'export const dropletsStylesById = JSON.parse("__DROPLETS_STYLES__");',
      "",
    ].join("\n");
    expect(buildClientCode({ entries: [entry({ id: "a" })], buildHash: "h", elementName: "djs-droplet", isBuilding: true })).toBe(built);
    expect(
      buildClientCode({
        entries: [entry({ id: "a" })],
        buildHash: "h",
        elementName: "djs-droplet",
        isBuilding: true,
        clientHooksFile: null,
      }),
    ).toBe(built);
  });

  it("imports src/hooks.client.ts and calls its init, last, when there is one", () => {
    const plain = buildClientCode({ entries: [entry({ id: "a" })], buildHash: "h", elementName: "djs-droplet", isBuilding: true });
    const code = buildClientCode({
      entries: [entry({ id: "a" })],
      buildHash: "h",
      elementName: "djs-droplet",
      isBuilding: true,
      clientHooksFile: "/src/hooks.client.ts",
    });
    expect(code.startsWith(plain)).toBe(true);
    expect(code.slice(plain.length)).toBe(clientInitCode({ clientHooksFile: "/src/hooks.client.ts" }));
    expect(clientInitCode({ clientHooksFile: "/src/hooks.client.mjs", initModule: "/pkg/client-init.js" })).toBe(
      [
        'import * as clientHooks from "/src/hooks.client.mjs";',
        'import { runClientInit } from "/pkg/client-init.js";',
        'runClientInit(clientHooks, "src/hooks.client.mjs");',
        "",
      ].join("\n"),
    );
  });

  it("has no registry of its own for error pages, which hydrate with their droplet", () => {
    const code = buildClientCode({ entries: [entry({ id: "a", hasError: true })], buildHash: "h" });
    expect(code).not.toContain("dropletsErrorHydrateById");
  });
});

describe("createClientModuleCode", () => {
  it("imports the component, its renderer's client module and the client load", () => {
    const code = createClientModuleCode({
      globRoot: "/src/droplets",
      entry: entry({ id: "hello", name: "hello", hasError: true, errorFile: "+error.svelte" }),
      renderers,
    });
    expect(code).toContain('import * as renderer from "/r/svelte/client.js";');
    expect(code).not.toContain("errorRenderer");
    expect(code).toContain('import * as component from "/src/droplets/hello/+droplet.svelte";');
    expect(code).toContain('import * as errorComponent from "/src/droplets/hello/+error.svelte";');
    expect(code).toContain('import.meta.glob("/src/droplets/hello/+droplet.ts")');
    expect(code).toContain("renderer.hydrate(module, target, props, context)");
    expect(code).toContain("renderer.mount(module, target, props, context)");
    // A droplet mounted with data still to come gets its error page for the boundary.
    expect(code).toContain("error: { module: errorComponent, handle: info.handleError }");
    expect(code).toContain("export async function handleError(error)");
    expect(code).toContain("export async function load(event)");
    expect(code).toContain("export function unmount(handle)");
    // No setup module for this renderer; nothing engine-specific from core.
    expect(code).not.toContain("setup.js");
    expect(code).not.toMatch(/from "svelte"/);
  });

  it("leaves the error page out when the droplet has none", () => {
    const code = createClientModuleCode({ globRoot: "/src/droplets", entry: entry({ name: "hello" }), renderers });
    expect(code).not.toContain("+error.");
    expect(code).toContain("const errorComponent = undefined;");
  });

  it("marks the component with its renderer when another renderer shares its extension", () => {
    type JsxInput = { name: string; pkg: string };

    const jsx = ({ name, pkg }: JsxInput): DropletRenderer => ({
      name,
      extensions: [".tsx"],
      packages: [pkg],
      server: `/r/${name}/server.js`,
      client: `/r/${name}/client.js`,
    });
    const both = [jsx({ name: "react", pkg: "react" }), jsx({ name: "solid", pkg: "solid-js" })];
    const droplet = entry({ name: "s", file: "+droplet.tsx", renderer: "solid", hasError: true, errorFile: "+error.tsx" });
    const code = createClientModuleCode({ globRoot: "/src/droplets", entry: droplet, renderers: both });
    expect(code).toContain('import * as component from "/src/droplets/s/+droplet.tsx?droplets-renderer=solid";');
    expect(code).toContain('import * as errorComponent from "/src/droplets/s/+error.tsx?droplets-renderer=solid";');
    const server = buildServerCode({ entries: [droplet], globRoot: "/src/droplets", renderers: both });
    expect(server).toContain('from "/src/droplets/s/+droplet.tsx?droplets-renderer=solid";');
    const solidOnly = [both[1] ?? expect.unreachable("the solid renderer")];
    expect(createClientModuleCode({ globRoot: "/src/droplets", entry: droplet, renderers: solidOnly })).toContain(
      'import * as component from "/src/droplets/s/+droplet.tsx";',
    );
  });

  it("exports update only with dev and a renderer's clientDev module", () => {
    const withDev = [{ ...svelte, clientDev: "/r/svelte/client-dev.js" }, vue];
    const hello = entry({ name: "hello" });
    const dev = createClientModuleCode({ globRoot: "/src/droplets", entry: hello, renderers: withDev, isDev: true });
    expect(dev).toContain('import { update as updateInstance } from "/r/svelte/client-dev.js";');
    expect(dev).toContain("export async function update(handle, data, info)");
    expect(dev).toContain("updateInstance(handle.instance, props)");
    for (const code of [
      createClientModuleCode({ globRoot: "/src/droplets", entry: hello, renderers: withDev }),
      createClientModuleCode({ globRoot: "/src/droplets", entry: hello, renderers, isDev: true }),
    ]) {
      expect(code).not.toContain("client-dev");
      expect(code).not.toContain("function update(");
    }
  });

  it("accepts its component's HMR update with dev only, for the remount in place", () => {
    const hello = entry({ name: "hello" });
    expect(createClientModuleCode({ globRoot: "/src/droplets", entry: hello, renderers, isDev: true })).toContain(
      'new CustomEvent("droplets:hot-fallback"',
    );
    const built = createClientModuleCode({ globRoot: "/src/droplets", entry: hello, renderers });
    expect(built).not.toContain("import.meta.hot");
    expect(built).not.toContain("droplets:hot-fallback");
  });
});

describe("mayImportServerOnly", () => {
  it("allows server files and files under server/, in the project only", () => {
    const ok = (file: string) => mayImportServerOnly({ root: "/proj", importer: file });
    expect(ok("/proj/src/api/+server.ts")).toBe(true);
    expect(ok("/proj/src/hooks.server.ts")).toBe(true);
    expect(ok("/proj/src/droplets/a/+droplet.server.ts")).toBe(true);
    expect(ok("/proj/src/lib/db.server.js")).toBe(true);
    expect(ok("/proj/src/lib/server/db.ts")).toBe(true);
    expect(ok("/proj/src/lib/server/deep/x.js?v=1")).toBe(true);
    expect(ok("/proj/src/droplets/a/+droplet.server.ts?import")).toBe(true);
    expect(ok("/proj/src/droplets/a/+droplet.ts")).toBe(false);
    expect(ok("/proj/src/droplets/a/+droplet.svelte")).toBe(false);
    expect(ok("/proj/src/lib/util.ts")).toBe(false);
    expect(ok("/proj/src/server.tsx")).toBe(false);
    // Any extension after `.server.`; only a folder named exactly `server`.
    expect(ok("/proj/src/lib/db.server.tsx")).toBe(true);
    expect(ok("/proj/src/lib/a.server.mjs")).toBe(true);
    expect(ok("/proj/src/lib/x.server.cts")).toBe(true);
    expect(ok("/proj/src/server/x.ts")).toBe(true);
    // A name that merely ends in "server" is not a server file.
    expect(ok("/proj/src/lib/observer.ts")).toBe(false);
    expect(ok("/proj/src/lib/webserver.js")).toBe(false);
    expect(ok("/proj/src/myserver/x.ts")).toBe(false);
    expect(ok("/proj/src/server-utils/x.ts")).toBe(false);
    // Not the project's to check: dependencies, other folders, virtual modules.
    expect(ok("/proj/node_modules/pkg/index.js")).toBe(true);
    expect(ok("/elsewhere/lib.ts")).toBe(true);
    expect(ok("\0virtual:droplets")).toBe(true);
  });
});

describe("buildConfigCode", () => {
  it("imports the user's config or exports an empty object", () => {
    expect(buildConfigCode({ configPath: null })).toBe("export default {};\n");
    expect(buildConfigCode({ configPath: "/p/droplets.config.ts" })).toContain('import userConfig from "/p/droplets.config.ts";');
  });
});

describe("virtualModulesPlugin", () => {
  const state = createInitialState();
  state.configPath = "/proj/droplets.config.ts";
  state.css = { ...state.css, path: "./src/app.css" };
  const plugin = virtualModulesPlugin(state);
  const resolveIdIn = plugin.resolveId as (
    this: { environment: { config: { consumer: string } }; error(message: string): never },
    id: string,
    importer?: string,
  ) => string | null;
  const withConsumer = (consumer: string) => ({
    environment: { config: { consumer } },
    error(message: string): never {
      throw new Error(message);
    },
  });
  const resolveId = (id: string) => resolveIdIn.call(withConsumer("server"), id);
  const load = plugin.load as (this: { environment: { config: { consumer: string } } }, id: string) => Promise<string | null>;
  const server = { environment: { config: { consumer: "server" } } };
  const client = { environment: { config: { consumer: "client" } } };

  it("resolves its virtual ids and nothing else", () => {
    expect(resolveId(VIRTUAL_DROPLETS)).toBe(RESOLVED_VIRTUAL_DROPLETS);
    expect(resolveId(VIRTUAL_ENV)).toBe(`\0${VIRTUAL_ENV}`);
    expect(resolveId(VIRTUAL_CSS)).toBe(`\0${VIRTUAL_CSS}`);
    expect(resolveId(VIRTUAL_CONFIG)).toBe(`\0${VIRTUAL_CONFIG}`);
    expect(resolveId("/index.js")).toBe("\0droplets:loader");
    expect(resolveId(clientEntryId({ folderName: "x" }))).toBe(`\0${clientEntryId({ folderName: "x" })}`);
    expect(resolveId("./src/thing.ts")).toBeNull();
    expect(resolveId("svelte")).toBeNull();
  });

  it("resolves the env modules, and keeps the private one out of the browser", () => {
    expect(resolveId("$droplets/env/public")).toBe("\0$droplets/env/public");
    expect(resolveId("$droplets/env/private")).toBe("\0$droplets/env/private");
    expect(resolveIdIn.call(withConsumer("client"), "$droplets/env/public")).toBe("\0$droplets/env/public");
    expect(() => resolveIdIn.call(withConsumer("client"), "$droplets/env/private", "/src/droplets/x/+droplet.ts")).toThrow(
      /\$droplets\/env\/private can only be imported by server files/,
    );
  });

  it("generates the env modules from the declaration", async () => {
    state.env = {
      path: "/proj/src/env.ts",
      declaration: { KEY: {}, PUBLIC_NAME: { public: true, static: true }, PUBLIC_API: { public: true } },
      values: { KEY: "secret", PUBLIC_NAME: "Site", PUBLIC_API: "https://api" },
      dependencies: [],
    };
    const browser = await load.call(client, "\0$droplets/env/public");
    expect(browser).toContain('"PUBLIC_NAME": "Site"');
    expect(browser).toContain(`?.[${JSON.stringify(`${state.config.element}:${state.buildHash}`)}]?.env`);
    expect(browser).not.toContain("https://api");
    expect(await load.call(server, "\0$droplets/env/public")).toContain('return readRuntimeEnv("PUBLIC_API")');
    expect(await load.call(client, "\0$droplets/drop")).toContain("serverLocation");
    expect(await load.call(server, "\0$droplets/drop")).toContain("requestInfo");
    const privateCode = await load.call(server, "\0$droplets/env/private");
    expect(privateCode).toContain('get "KEY"()');
    expect(privateCode).not.toContain("secret");
    expect(await load.call(client, "\0$droplets/env")).toContain("export const dev = import.meta.env.DEV;");
  });

  it("resolves $droplets/server for server code and refuses it in the browser", () => {
    expect(resolveId("$droplets/server")).toMatch(/runtime[\\/]server\.js$/);
    expect(() => resolveIdIn.call(withConsumer("client"), "$droplets/server", "/src/droplets/x/+droplet.svelte")).toThrow(
      /can only be imported by server files.*\+droplet\.svelte/,
    );
  });

  it("refuses server-only modules to project files that are not server files, on the server too", () => {
    const project = createInitialState();
    project.root = "/proj";
    const resolveIn = virtualModulesPlugin(project).resolveId as typeof resolveIdIn;
    const onServer = (id: string, importer: string) => resolveIn.call(withConsumer("server"), id, importer);
    expect(onServer("$droplets/server", "/proj/src/droplets/x/+droplet.server.ts")).toMatch(/server\.js$/);
    expect(onServer("$droplets/env/private", "/proj/src/lib/server/db.ts")).toBe("\0$droplets/env/private");
    expect(() => onServer("$droplets/server", "/proj/src/droplets/x/+droplet.ts")).toThrow(
      /can only be imported by server files: names with \.server\. in them.*under a server\/ folder; imported by \/proj\/src\/droplets\/x\/\+droplet\.ts/,
    );
    expect(() => onServer("$droplets/env/private", "/proj/src/droplets/x/+droplet.svelte")).toThrow(/server files/);
    expect(() => onServer("$droplets/server", "/proj/src/lib/observer.ts")).toThrow(/server files/);
    expect(() => onServer("$droplets/env/private", "/proj/src/lib/webserver.js")).toThrow(/server files/);
  });

  it("generates the env, css and config modules", async () => {
    const env = await load.call(client, `\0${VIRTUAL_ENV}`);
    expect(env).toContain("export const browser = !import.meta.env.SSR;");
    expect(env).toContain("export const dev = import.meta.env.DEV;");
    // Only the server reads the build flag; the browser never prerenders.
    expect(env).toContain('export const building = import.meta.env.SSR && globalThis[Symbol.for("droplets.building")] === true;');
    expect(await load.call(client, `\0${VIRTUAL_CSS}`)).toBe('import "./src/app.css";\n');
    expect(await load.call(server, `\0${VIRTUAL_CONFIG}`)).toContain('import userConfig from "/proj/droplets.config.ts";');
    // The dev loader carries where it was loaded from and the dynamic public env the way
    // the built /index.js route does: first, then the entry through a dynamic import.
    const loader = await load.call(client, "\0droplets:loader");
    expect(loader?.startsWith(locationScript(serverKey(state.config.element, state.buildHash)))).toBe(true);
    expect(loader).toMatch(/^\n\(\(globalThis.*\.env = \{"PUBLIC_API":"https:\/\/api"\};\nimport\("\/@fs\/.*entry-client\.js"\);\n$/s);
    expect(await load.call(client, "\0something-else")).toBeNull();
  });

  it("falls back to Tailwind when there is no project stylesheet, and to nothing without Tailwind", async () => {
    const sheet = async (setup: (state: PluginState) => void) => {
      const state = createInitialState();
      setup(state);
      const plugin = virtualModulesPlugin(state);
      const stateLoad = plugin.load as typeof load;
      expect(await stateLoad.call(client, `\0${VIRTUAL_CSS}`)).toBe('import "virtual:droplets-css-file.css";\n');
      return stateLoad.call(client, "\0virtual:droplets-css-file.css");
    };
    // No Tailwind: no stylesheet to fall back to.
    expect(await sheet(() => {})).toBe("");
    // With scoping on, the full Tailwind (reset included) is confined to the element.
    expect(
      await sheet((s) => {
        s.tailwind.ours = true;
      }),
    ).toBe('@import "tailwindcss";\n');
    expect(
      await sheet((s) => {
        s.tailwind.user = true;
      }),
    ).toBe('@import "tailwindcss";\n');
    // Without scoping, the reset would restyle the pages that embed droplets.
    const unscoped = await sheet((s) => {
      s.tailwind.ours = true;
      s.css = { ...s.css, scoped: false };
    });
    expect(unscoped).toContain('@import "tailwindcss/utilities"');
    expect(unscoped).not.toContain('@import "tailwindcss";');
    // Without preflight, by choice.
    expect(
      await sheet((s) => {
        s.tailwind.ours = true;
        s.css = { ...s.css, twPreflight: false };
      }),
    ).not.toContain('@import "tailwindcss";');
  });

  it("generates a client module per discovered droplet folder", async () => {
    // Nothing on disk for this state: unknown folders answer nothing.
    expect(await load.call(client, `\0${clientEntryId({ folderName: "Widget" })}`)).toBeNull();
    expect(await load.call(client, `\0${VIRTUAL_CLIENT}`)).toBeNull();
  });
});

const records = new URL("../../src/runtime/server-records.ts", import.meta.url).pathname;
const store = new URL("../../src/runtime/request-store.ts", import.meta.url).pathname;
const TOKEN = "http://droplets.invalid/__$DROPLET_LOCATION_n1$__";

describe("$droplets/drop", () => {
  type Drop = { origin: string; url(path: string): string };
  const load = async (code: string) => {
    const module = (await import(`data:text/javascript,${encodeURIComponent(code)}`)) as {
      droplet: Drop;
      default: Drop;
    };
    // `import droplet from "$droplets/drop"` and `import { droplet }` are the same object.
    expect(module.default).toBe(module.droplet);
    return module.droplet;
  };

  it("answers this server's origin in the browser, as the first element wrote it", async () => {
    const servers = Symbol.for("droplets.servers");
    const global = globalThis as unknown as Record<symbol, Record<string, { origin?: string }> | undefined>;
    global[servers] = {
      "djs:b1": { origin: "https://drops.example/prefix" },
      "other:b1": { origin: "https://other.example" },
    };
    const droplet = await load(buildDropClientCode({ key: "djs:b1", recordsModule: `file://${records}` }));
    expect(droplet.origin).toBe("https://drops.example/prefix");
    expect(droplet.url("/api/counter")).toBe("https://drops.example/prefix/api/counter");
    expect(droplet.url("api/counter")).toBe("https://drops.example/prefix/api/counter");
    expect(droplet.url("assets/public/logo.svg")).toBe("https://drops.example/prefix/assets/public/logo.svg");
    // A file the bundle imports is on the location already.
    expect(droplet.url("https://drops.example/prefix/assets/a.png")).toBe("https://drops.example/prefix/assets/a.png");
    delete global[servers];
  });

  it("answers the request's public location on the server, the location token outside a request", async () => {
    const { withRequestInfo } = await import(store);
    const droplet = await load(buildDropServerCode({ requestStore: `file://${store}`, location: TOKEN }));
    // A module's top level: the token, which each response replaces.
    expect(droplet.origin).toBe(TOKEN);
    expect(droplet.url("/api/x")).toBe(`${TOKEN}/api/x`);
    withRequestInfo({ origin: "https://host.example/mfe" }, () => {
      expect(droplet.origin).toBe("https://host.example/mfe");
      expect(droplet.url("/api/x")).toBe("https://host.example/mfe/api/x");
      expect(droplet.url("assets/public/robots.txt")).toBe("https://host.example/mfe/assets/public/robots.txt");
      // An imported file's URL, as the server bundle writes it.
      expect(droplet.url(`${TOKEN}/assets/logo.png`)).toBe("https://host.example/mfe/assets/logo.png");
    });
  });

  it("answers a fixed location everywhere, with no token and no request store", async () => {
    const { withRequestInfo } = await import(store);
    const code = buildDropServerCode({ requestStore: `file://${store}`, location: "https://cdn.example/mfe", isFixed: true });
    expect(code).not.toContain("requestInfo");
    expect(code).not.toContain("startsWith");
    const droplet = await load(code);
    expect(droplet.origin).toBe("https://cdn.example/mfe");
    withRequestInfo({ origin: "https://host.example" }, () => {
      expect(droplet.url("/api/x")).toBe("https://cdn.example/mfe/api/x");
      expect(droplet.url("https://cdn.example/mfe/assets/a.png")).toBe("https://cdn.example/mfe/assets/a.png");
    });
  });
});

describe("$droplets/form", () => {
  type ActionUrl = (name?: string, options?: { droplet?: string; props?: Record<string, unknown> }) => string;
  const form = new URL("../../src/runtime/form.ts", import.meta.url).pathname;
  const enhance = new URL("../../src/runtime/enhance.ts", import.meta.url).pathname;
  const load = async (code: string) => {
    const module = (await import(`data:text/javascript,${encodeURIComponent(code)}`)) as {
      actionUrl: ActionUrl;
      default: ActionUrl;
      enhanceDropletForm: unknown;
    };
    expect(module.default).toBe(module.actionUrl);
    expect(module.enhanceDropletForm).toBeTypeOf("function");
    return module.actionUrl;
  };

  it("answers the rendering droplet's action URL on the server, on the request's public location", async () => {
    const { withRequestInfo } = await import(store);
    const actionUrl = await load(
      buildFormServerCode({
        requestStore: `file://${store}`,
        formModule: `file://${form}`,
        location: TOKEN,
        enhanceModule: `file://${enhance}`,
      }),
    );
    // Outside a render it needs the droplet.
    expect(() => actionUrl("add")).toThrow(/knows the droplet only while one renders/);
    expect(actionUrl("add", { droplet: "cart" })).toBe(`${TOKEN}/droplets/cart?/add`);
    const info = { origin: "https://drops.example/mfe", render: { droplet: "cart", props: { id: "p1" } } };
    withRequestInfo(info, () => {
      expect(actionUrl()).toBe("https://drops.example/mfe/droplets/cart?id=p1");
      expect(actionUrl("add")).toBe("https://drops.example/mfe/droplets/cart?/add&id=p1");
      // Another droplet's props are not this one's.
      expect(actionUrl("add", { droplet: "other" })).toBe("https://drops.example/mfe/droplets/other?/add");
      expect(() => actionUrl("a&b")).toThrow(/is not an action name/);
    });
    // The page of `event.host` (tokens at build), last, as `__droplet_return`; a prop by that name never replaces it.
    const onPage = {
      ...info,
      page: "https://shop.example/p/1",
      render: { droplet: "cart", props: { __droplet_return: "https://evil.example/" } },
    };
    withRequestInfo(onPage, () => {
      expect(actionUrl("add")).toBe("https://drops.example/mfe/droplets/cart?/add&__droplet_return=https%3A%2F%2Fshop.example%2Fp%2F1");
    });
  });

  it("answers the rendering droplet's action URL in the browser, on the location /index.js recorded", async () => {
    const { withRender } = await import(form);
    const servers = Symbol.for("droplets.servers");
    const global = globalThis as unknown as Record<symbol, Record<string, { origin?: string }> | undefined>;
    global[servers] = { "djs:b1": { origin: "https://drops.example/prefix/" } };
    const actionUrl = await load(
      buildFormClientCode({
        key: "djs:b1",
        formModule: `file://${form}`,
        enhanceModule: `file://${enhance}`,
        recordsModule: `file://${records}`,
      }),
    );
    expect(() => actionUrl()).toThrow(/call it as the component sets up/);
    expect(actionUrl("add", { droplet: "cart" })).toBe("https://drops.example/prefix/droplets/cart?/add");
    withRender({ droplet: "cart", location: "https://drops.example/prefix/", props: { page: 2 } }, () => {
      expect(actionUrl("add")).toBe("https://drops.example/prefix/droplets/cart?/add&page=2");
    });
    // On a web page: `origin + pathname` of `window.location`, never its query or hash.
    const saved = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { protocol: "https:", origin: "https://shop.example", pathname: "/p/1", search: "?q=1", hash: "#x" },
    });
    try {
      expect(actionUrl("add", { droplet: "cart" })).toBe(
        "https://drops.example/prefix/droplets/cart?/add&__droplet_return=https%3A%2F%2Fshop.example%2Fp%2F1",
      );
    } finally {
      if (saved) Object.defineProperty(globalThis, "location", saved);
      else delete (globalThis as { location?: unknown }).location;
    }
    delete global[servers];
  });
});

describe("buildServerCode: public runtime variables", () => {
  it("lists their names for /index.js", () => {
    expect(buildServerCode({ entries: [], globRoot: "/src/droplets", publicEnvNames: ["PUBLIC_API"] })).toContain(
      'export const publicEnvNames = ["PUBLIC_API"];',
    );
    expect(buildServerCode({ entries: [], globRoot: "/src/droplets" })).toContain("export const publicEnvNames = [];");
  });
});
