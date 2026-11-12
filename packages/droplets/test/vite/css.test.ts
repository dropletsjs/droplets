import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postcss, { type AcceptedPlugin } from "postcss";
import type { Plugin, ResolvedConfig } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CssConfig, createCssConfig, hasPreflight, resolveCss, tailwindPlugins, withoutPreflight } from "../../src/vite/css.ts";
import { createInitialState } from "../../src/vite/state.ts";

describe("resolveCss", () => {
  let root: string;
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "droplets-css-")));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("applies defaults, ./src/app.css only when it exists", async () => {
    expect(await resolveCss({ options: {}, root })).toEqual({ scoped: true, tailwind: false, twPreflight: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/app.css"), "");
    expect((await resolveCss({ options: {}, root })).path).toBe("./src/app.css");
    expect((await resolveCss({ options: { path: "./styles/x.css" }, root })).path).toBe("./styles/x.css");
    expect((await resolveCss({ options: { path: false }, root })).path).toBeUndefined();
  });

  it("takes every option", async () => {
    expect(await resolveCss({ options: { scoped: false, tailwind: true, twPreflight: false }, root })).toMatchObject({
      scoped: false,
      tailwind: true,
      twPreflight: false,
    });
  });
});

describe("withoutPreflight", () => {
  it('splits @import "tailwindcss" into theme and utilities, options kept', () => {
    expect(withoutPreflight({ code: '@import "tailwindcss";\n.x { color: red }' })).toBe(
      '@layer theme, base, components, utilities;\n@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities);\n.x { color: red }',
    );
    expect(withoutPreflight({ code: "@import 'tailwindcss' prefix(tw) important;" })).toBe(
      '@layer theme, base, components, utilities;\n@import "tailwindcss/theme.css" layer(theme) prefix(tw) important;\n@import "tailwindcss/utilities.css" layer(utilities) prefix(tw) important;',
    );
  });

  it("drops an import of the preflight, and leaves the rest alone", () => {
    const split =
      '@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/preflight.css" layer(base);\n@import "tailwindcss/utilities.css" layer(utilities);\n';
    expect(withoutPreflight({ code: split })).toBe(
      '@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities);\n',
    );
    expect(withoutPreflight({ code: '@import "tailwindcss/utilities.css";' })).toBeNull();
    expect(withoutPreflight({ code: ".x { color: red }" })).toBeNull();
  });
});

describe("hasPreflight", () => {
  const check = (css: string) => hasPreflight({ root: postcss.parse(css) });

  it("finds the preflight as Tailwind writes it, and as its optimizer leaves it", () => {
    expect(check("@layer base { *, ::after, ::before, ::backdrop, ::file-selector-button { box-sizing: border-box; margin: 0 } }")).toBe(
      true,
    );
    expect(check("@layer base{*,:after,:before,::backdrop{box-sizing:border-box;margin:0}:root{color:red}}")).toBe(true);
    expect(check("@layer base { :root { color: red } * { box-sizing: border-box } }")).toBe(false);
  });
});

describe("createCssConfig", () => {
  type RunInput = { config: CssConfig | undefined; css: string };

  const run = ({ config, css }: RunInput) => {
    const plugins = (config?.postcss as { plugins: AcceptedPlugin[] } | undefined)?.plugins ?? [];
    return postcss(plugins).process(css, { from: "/p/src/droplets/a/style.css" }).css;
  };
  const names = (config: CssConfig | undefined) =>
    ((config?.postcss as { plugins: Array<{ postcssPlugin: string }> } | undefined)?.plugins ?? []).map((p) => p.postcssPlugin);

  let root: string;
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "droplets-postcss-")));
    // No workspace above it: the search stops here.
    await writeFile(join(root, "package.json"), '{ "type": "module", "workspaces": ["."] }\n');
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("scopes every stylesheet, keeping the user's inline PostCSS plugins", async () => {
    const state = createInitialState();
    const own = { postcssPlugin: "own" };
    const config =
      (await createCssConfig({ userConfig: { css: { postcss: { plugins: [own] } } }, state, root })) ?? expect.unreachable("a css config");
    const plugins = (config.postcss as { plugins: unknown[] }).plugins;
    expect(plugins[0]).toBe(own);
    expect(run({ config, css: ".x { color: red }" })).toBe("djs-droplet .x { color: red }");
  });

  it("checks for a stray preflight without twPreflight, and does nothing when there is nothing to do", async () => {
    const state = createInitialState();
    state.css = { ...state.css, scoped: false, twPreflight: false };
    expect(names(await createCssConfig({ userConfig: {}, state, root }))).toEqual(["droplets:preflight-check"]);
    state.css = { ...state.css, twPreflight: true };
    expect(await createCssConfig({ userConfig: {}, state, root })).toBeUndefined();
  });

  it("loads the project's PostCSS config file, its plugins first and its options kept", async () => {
    const project = join(root, "with-file");
    await mkdir(join(project, "elsewhere"), { recursive: true });
    await writeFile(join(project, "postcss.config.js"), 'export default { map: false, plugins: [{ postcssPlugin: "from-file" }] };\n');
    await writeFile(join(project, "elsewhere", "postcss.config.js"), 'export default { plugins: [{ postcssPlugin: "from-dir" }] };\n');
    const config = await createCssConfig({ userConfig: {}, state: createInitialState(), root: project });
    expect(names(config)).toEqual(["from-file", "droplets:scope-styles"]);
    expect(config?.postcss).toMatchObject({ map: false });
    // `css.postcss` as a string is a directory to search from, as for Vite.
    const fromDir = await createCssConfig({ userConfig: { css: { postcss: "./elsewhere" } }, state: createInitialState(), root: project });
    expect(names(fromDir)).toEqual(["from-dir", "droplets:scope-styles"]);
    // Inline options win, and the file is not read.
    const inline = await createCssConfig({ userConfig: { css: { postcss: { plugins: [] } } }, state: createInitialState(), root: project });
    expect(names(inline)).toEqual(["droplets:scope-styles"]);
  });

  it("throws, naming the file, when the PostCSS config file fails to load", async () => {
    const project = join(root, "broken");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "postcss.config.js"), 'throw new Error("not today");\n');
    await expect(createCssConfig({ userConfig: {}, state: createInitialState(), root: project })).rejects.toThrow(
      `droplets: the PostCSS config ${join(project, "postcss.config.js")} failed to load: not today`,
    );
  });
});

describe("tailwindPlugins", () => {
  const resolved = (plugins: Plugin[]) => ({ plugins }) as unknown as ResolvedConfig;
  const named = (name: string) => ({ name }) as Plugin;

  it("adds Tailwind for css.tailwind, under its own names", async () => {
    const state = createInitialState();
    state.css = { ...state.css, tailwind: true };
    const plugins = await tailwindPlugins(state);
    expect(plugins.map((p) => p.name)).toEqual([
      "droplets:tailwind",
      "droplets:tailwind:scan",
      "droplets:tailwind:generate:serve",
      "droplets:tailwind:generate:build",
    ]);
    const tailwind = plugins[0] ?? expect.unreachable("droplets:tailwind");
    (tailwind.configResolved as (config: ResolvedConfig) => void)(resolved(plugins));
    expect(state.tailwind).toEqual({ user: false, ours: true });

    // twPreflight: false rewrites the imports ahead of Tailwind's compile.
    const transform = tailwind.transform as { order: string; handler: (code: string, id: string) => { code: string } | undefined };
    expect(transform.order).toBe("pre");
    expect(transform.handler('@import "tailwindcss";', "/p/app.css")).toBeUndefined();
    state.css = { ...state.css, twPreflight: false };
    expect(transform.handler('@import "tailwindcss";', "/p/app.css")?.code).toContain('"tailwindcss/utilities.css"');
    expect(transform.handler('@import "tailwindcss";', "/p/app.ts")).toBeUndefined();
  });

  it("stays out beside the user's own @tailwindcss/vite, and without css.tailwind", async () => {
    const state = createInitialState();
    state.css = { ...state.css, tailwind: true };
    const plugins = await tailwindPlugins(state);
    const detect = (plugins[0] ?? expect.unreachable("droplets:tailwind")).configResolved as (config: ResolvedConfig) => void;
    detect(resolved([named("@tailwindcss/vite:scan"), ...plugins]));
    expect(state.tailwind).toEqual({ user: true, ours: false });
    // Gated: Tailwind's transform answers nothing.
    const transform = (
      plugins.find((p) => p.name === "droplets:tailwind:generate:build") ?? expect.unreachable("droplets:tailwind:generate:build")
    ).transform as {
      handler: (code: string, id: string) => unknown;
    };
    expect(transform.handler.call({}, '@import "tailwindcss";', "/p/app.css")).toBeUndefined();

    const off = createInitialState();
    const offPlugins = await tailwindPlugins(off);
    ((offPlugins[0] ?? expect.unreachable("droplets:tailwind")).configResolved as (config: ResolvedConfig) => void)(resolved(offPlugins));
    expect(off.tailwind).toEqual({ user: false, ours: false });
  });
});
