// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { createServer, type RunnableDevEnvironment, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compileTemplate,
  handlebarsPlugin,
  listPartials,
  partialName,
  runtimeModule,
  SETUP_ID,
  setupModuleCode,
} from "../src/plugin.ts";
import type { env as Env } from "../src/runtime.ts";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/app");

type Template = (context: unknown, options?: unknown) => string;
type RuntimeModule = { env: typeof Env };

/** A dev server on `root` with only the renderer's plugin, and its SSR runner. */
async function devServer(root: string, options = {}): Promise<ViteDevServer> {
  return createServer({
    root,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null },
    plugins: [handlebarsPlugin(options)],
  });
}

const load = <T>(server: ViteDevServer, file: string) =>
  (server.environments.ssr as RunnableDevEnvironment).runner.import(file) as Promise<T>;

describe("compileTemplate", () => {
  it("precompiles into a module whose default is the template, built on the shared runtime", () => {
    const code = compileTemplate("<p>{{data.title}}</p>", "/app/x.hbs", { setup: true });
    expect(code).toContain(`import { env } from ${JSON.stringify(runtimeModule.replace(/\\/g, "/"))};`);
    expect(code).toContain(`import "${SETUP_ID}";`);
    expect(code).toMatch(/export default env\.template\(\{.*"main":function/s);
    expect(code).not.toContain("import.meta.hot");
    // The spec is what Handlebars' own runtime understands.
    const spec = new Function(`return ${code.match(/env\.template\((\{.*\})\);/s)![1]}`)() as never;
    expect(Handlebars.template(spec)({ data: { title: "A <b>" } })).toBe("<p>A &lt;b&gt;</p>");
  });

  it("leaves the setup import out of a partial and accepts HMR in dev", () => {
    const code = compileTemplate("<p/>", "/app/src/partials/p.hbs", { setup: false, dev: true });
    expect(code).not.toContain(SETUP_ID);
    expect(code).toContain("if (import.meta.hot) import.meta.hot.accept();");
  });

  it("passes precompile options through", () => {
    const noEscape = compileTemplate("{{x}}", "/x.hbs", { setup: false, compile: { noEscape: true } });
    const spec = new Function(`return ${noEscape.match(/env\.template\((\{.*\})\);/s)![1]}`)() as never;
    expect(Handlebars.template(spec)({ x: "<b>" })).toBe("<b>");
  });
});

describe("setupModuleCode", () => {
  it("imports every partial and the helpers once and registers them by name", () => {
    const code = setupModuleCode({
      partialsDir: "/app/src/partials",
      partials: ["/app/src/partials/card.hbs", "/app/src/partials/layout/header.hbs"],
      helpers: "/app/src/handlebars.ts",
    });
    expect(code).toContain('import partial_0 from "/app/src/partials/card.hbs";');
    expect(code).toContain('import partial_1 from "/app/src/partials/layout/header.hbs";');
    expect(code).toContain('env.registerPartial("card", partial_0);');
    expect(code).toContain('env.registerPartial("layout/header", partial_1);');
    expect(code).toContain('import * as helpers from "/app/src/handlebars.ts";');
    expect(code).toContain("registerHelpers(env, helpers);");
  });

  it("registers nothing when there is nothing", () => {
    const code = setupModuleCode({ partialsDir: null, partials: [], helpers: null });
    expect(code).not.toContain("registerPartial");
    expect(code).not.toContain("registerHelpers(");
  });

  it("names partials by their path under the folder", () => {
    expect(partialName("/p", "/p/card.hbs")).toBe("card");
    expect(partialName("/p", "/p/layout/header.hbs")).toBe("layout/header");
    expect(listPartials("/nowhere/at/all")).toEqual([]);
    expect(listPartials(resolve(fixture, "src/partials"))).toEqual([resolve(fixture, "src/partials/greeting.hbs")]);
  });
});

describe("the plugin in a Vite server, on the fixture", () => {
  let server: ViteDevServer;

  beforeAll(async () => {
    server = await devServer(fixture);
  });

  afterAll(async () => {
    await server.close();
  });

  it("compiles a droplet template that uses a partial, a helper and {{{children}}}", async () => {
    const mod = await load<{ default: Template }>(server, "/src/droplets/hello/+droplet.hbs");
    const html = mod.default({ data: { greeting: "Hello Ana!", who: "Ana" } });
    expect(html).toContain('<h1 data-testid="greeting">Hello Ana!</h1>');
    expect(html).toContain('<p data-testid="shout">ANA</p>');
    expect(html).toContain('<div data-testid="children"><div data-droplet-children style="display: contents"></div></div>');
  });

  it("registers partials and helpers once, in the renderer's own environment", async () => {
    await load(server, "/src/droplets/hello/+droplet.hbs");
    await load(server, "/src/droplets/frame/+droplet.hbs");
    await load(server, "/src/droplets/hello/+error.hbs");
    const { env } = await load<RuntimeModule>(server, runtimeModule);
    expect(Object.keys(env.partials)).toEqual(["greeting"]);
    expect(typeof env.helpers["upper"]).toBe("function");
    expect(typeof env.helpers["repeat"]).toBe("function");
    expect(typeof env.helpers["children"]).toBe("function");
    // Nothing leaked into the global Handlebars.
    expect(Handlebars.partials["greeting"]).toBeUndefined();
    expect(Handlebars.helpers["upper"]).toBeUndefined();
    expect(Handlebars.helpers["children"]).toBeUndefined();
  });

  it("compiles a partial as a bare template, without the setup import", async () => {
    const mod = await load<{ default: Template }>(server, "/src/partials/greeting.hbs");
    expect(mod.default({ data: { greeting: "Hi" } })).toBe('<h1 data-testid="greeting">Hi</h1>\n');
    const transformed = await server.environments.ssr.transformRequest("/src/partials/greeting.hbs");
    expect(transformed?.code).not.toContain(SETUP_ID);
    const droplet = await server.environments.ssr.transformRequest("/src/droplets/frame/+droplet.hbs");
    expect(droplet?.code).toContain(SETUP_ID);
  });
});

describe("configurable partials and helpers", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "droplets-hbs-"));
    await mkdir(join(root, "templates/parts/ui"), { recursive: true });
    await mkdir(join(root, "lib"), { recursive: true });
    await writeFile(join(root, "templates/parts/ui/badge.hbs"), '<b class="badge">{{shout text}}</b>');
    await writeFile(join(root, "lib/helpers.ts"), "export const shout = (v: unknown) => `${String(v)}!`;\n");
    await writeFile(join(root, "templates/page.hbs"), "{{> ui/badge text=data.name}}{{{children}}}");
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads partials from the configured folder and helpers from the configured module", async () => {
    const server = await devServer(root, { partials: "templates/parts", helpers: "lib/helpers.ts" });
    try {
      const mod = await load<{ default: Template }>(server, "/templates/page.hbs");
      expect(mod.default({ data: { name: "new" } })).toBe('<b class="badge">new!</b><div data-droplet-children style="display: contents"></div>');
    } finally {
      await server.close();
    }
  });

  it("registers nothing with partials: false and helpers: false", async () => {
    const server = await devServer(root, { partials: false, helpers: false });
    try {
      const { env } = await load<RuntimeModule>(server, runtimeModule);
      await load(server, "/templates/page.hbs");
      expect(Object.keys(env.partials)).toEqual([]);
      expect(env.helpers["shout"]).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
