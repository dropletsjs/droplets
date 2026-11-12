// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createBuilder, createServer, type InlineConfig, type Plugin } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { validateRenderers, type ReadFlagsInput } from "@dropletsjs/droplets";
import { droplets, type DropletsPluginApi } from "@dropletsjs/droplets/vite";
import { readFlags, readTemplateFlags } from "../src/flags.ts";
import { handlebars } from "../src/index.ts";

type InputOfInput = { kind: ReadFlagsInput["kind"]; source?: string };

/** What core hands `readFlags`. */
function inputOf({ kind, source = "<p/>" }: InputOfInput): ReadFlagsInput {
  return {
    kind,
    source,
    file: kind === "droplet" ? "+droplet.hbs" : "+error.hbs",
    folder: "/app/src/droplets/hello",
    droplet: "hello",
  };
}

describe("handlebars()", () => {
  it("claims .hbs and points at its built server and client modules", () => {
    const renderer = handlebars();
    expect(renderer.name).toBe("handlebars");
    expect(renderer.extensions).toEqual([".hbs"]);
    expect(validateRenderers([renderer]).get(".hbs")).toEqual([renderer]);
    expect(renderer.packages).toEqual(["handlebars", "@dropletsjs/renderer-handlebars"]);
    expect(renderer.server).toMatch(/[\\/]dist[\\/]server\.js$/);
    expect(renderer.client).toMatch(/[\\/]dist[\\/]client\.js$/);
    expect(existsSync(renderer.server), "build the package first").toBe(true);
    expect(existsSync(renderer.client)).toBe(true);
    expect(renderer.plugins).toHaveLength(1);
    expect(renderer.readFlags).toBe(readFlags);
  });
});

describe("readFlags", () => {
  it("reads the flags from the template's opening comment, for either kind", () => {
    expect(readFlags(inputOf({ kind: "droplet", source: "{{!--\nexport hydrate = false\nexport prerender = true\n--}}\n<p/>" }))).toEqual({
      hydrate: false,
      prerender: true,
    });
    expect(readFlags(inputOf({ kind: "error", source: "{{!-- export prerender = true --}}<p/>" }))).toEqual({ prerender: true });
  });

  it("declares nothing without the comment, so core applies the defaults", () => {
    expect(readFlags(inputOf({ kind: "droplet" }))).toBeUndefined();
  });
});

describe("readTemplateFlags", () => {
  const where = "hello/+droplet.hbs";

  it("reads a multi-line block comment the template opens with", () => {
    expect(readTemplateFlags("{{!--\nexport hydrate = false\nexport prerender = true\nexport ssr = true\n--}}\n<p/>", where)).toEqual({
      hydrate: false,
      prerender: true,
      ssr: true,
    });
  });

  it("reads a one-line or short comment, `const` and a trailing semicolon too", () => {
    expect(readTemplateFlags("{{!-- export ssr = false --}}<p/>", where)).toEqual({ ssr: false });
    expect(readTemplateFlags("{{! export const hydrate = false; }}<p/>", where)).toEqual({ hydrate: false });
    expect(readTemplateFlags("\n  {{~!-- export prerender = true --~}}\n<p/>", where)).toEqual({ prerender: true });
  });

  it("reads several flags on one line, split by `;` or by the next `export`", () => {
    expect(readTemplateFlags("{{!-- export hydrate = false; export prerender = true --}}<p/>", where)).toEqual({
      hydrate: false,
      prerender: true,
    });
    expect(readTemplateFlags("{{!-- export const ssr = false export hydrate = false; --}}<p/>", where)).toEqual({
      ssr: false,
      hydrate: false,
    });
    expect(() => readTemplateFlags("{{!-- export ssr = false and more --}}", where)).toThrow(
      'flag "ssr" must be true or false, found "false and more"',
    );
  });

  it("reads when the template hydrates", () => {
    expect(readTemplateFlags('{{!-- export hydrate = "visible" --}}<p/>', where)).toEqual({ hydrate: "visible" });
    expect(readTemplateFlags("{{!-- export hydrate = 'interactive' --}}<p/>", where)).toEqual({ hydrate: "interactive" });
    expect(() => readTemplateFlags('{{!-- export hydrate = "idle" --}}', where)).toThrow(
      'flag "hydrate" must be true, false, "visible" or "interactive", found ""idle""',
    );
    expect(() => readTemplateFlags('{{!-- export ssr = "visible" --}}', where)).toThrow('flag "ssr" must be true or false');
  });

  it("leaves a template without the comment, or with an ordinary one, to the defaults", () => {
    expect(readTemplateFlags("<p/>", where)).toBeUndefined();
    expect(readTemplateFlags("{{!-- The card of the signed-in user --}}<p/>", where)).toBeUndefined();
    expect(readTemplateFlags("", where)).toBeUndefined();
  });

  it("refuses flags anywhere but the first thing in the template", () => {
    const message = "flags go in the comment the template starts with, before anything else";
    expect(() => readTemplateFlags("<p/>\n{{!-- export ssr = false --}}", where)).toThrow(message);
    expect(() => readTemplateFlags("{{!-- A card --}}\n{{!-- export ssr = false --}}<p/>", where)).toThrow(message);
    expect(() => readTemplateFlags("{{#if x}}{{! export hydrate = false }}{{/if}}", where)).toThrow(message);
  });

  it("refuses anything but flag lines in a flags comment", () => {
    expect(() => readTemplateFlags("{{!--\nexport ssr = false\nShows the card\n--}}", where)).toThrow(
      'expected `export <flag> = true|false` in the flags comment, found "Shows the card"',
    );
    expect(() => readTemplateFlags("{{!-- export hydrat = false --}}", where)).toThrow('unknown flag "hydrat"');
    expect(() => readTemplateFlags("{{!-- export ssr = no --}}", where)).toThrow('flag "ssr" must be true or false, found "no"');
    expect(() => readTemplateFlags("{{!--\nexport ssr = false\nexport ssr = true\n--}}", where)).toThrow('flag "ssr" is declared twice');
  });

  it("names the file in its errors and leaves a broken template to the compiler", () => {
    expect(() => readTemplateFlags("{{!-- export nope = true --}}", where)).toThrow(/^droplets: hello\/\+droplet\.hbs: /);
    expect(readTemplateFlags("{{!-- export ssr = false --}}{{#if}}", where)).toBeUndefined();
  });
});

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type ProjectInput = { files: Record<string, string> };

async function project({ files }: ProjectInput): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "droplets-handlebars-flags-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  }
  return root;
}

const fakeEntry = 'import manifest from "virtual:droplets-manifest";\nexport default manifest;\n';

type RootInput = { root: string };

function devConfig({ root }: RootInput): InlineConfig {
  return {
    root,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null },
    plugins: [droplets({ renderers: [handlebars()] })],
  };
}

function buildConfig({ root }: RootInput): InlineConfig {
  return {
    ...devConfig({ root }),
    plugins: [
      droplets({
        adapter: { name: "fake", serverEntry: join(root, "fake-entry.js"), serverFile: "server.js", separateSsrBundle: true },
        renderers: [handlebars()],
      }),
    ],
  };
}

type ApiOfInput = { plugins: readonly Plugin[] };

function apiOf({ plugins }: ApiOfInput): DropletsPluginApi {
  return plugins.find((plugin) => plugin.name === "droplets")?.api as DropletsPluginApi;
}

describe("flags of a Handlebars droplet", () => {
  it("come from the comment the template opens with", async () => {
    const root = await project({
      files: {
        "src/droplets/card/+droplet.hbs": "{{!-- export hydrate = false; export prerender = true --}}\n<p>{{data.title}}</p>\n",
        "src/droplets/card/+droplet.ts": 'export const load = () => ({ title: "Hi" });\n',
      },
    });
    const server = await createServer(devConfig({ root }));
    try {
      expect(apiOf({ plugins: server.config.plugins }).droplets()).toMatchObject([{ id: "card", ssr: true, hydrate: false }]);
    } finally {
      await server.close();
    }
  });

  it.each(["+droplet.ts", "+droplet.server.ts"])("are ignored in %s, in a build and in vite dev", async (file) => {
    const load =
      'export const ssr = false;\nexport const hydrate = true;\nexport const prerender = true;\nexport const load = () => ({ title: "Hi" });\n';
    const root = await project({
      files: {
        "src/droplets/card/+droplet.hbs": "{{!-- export hydrate = false --}}\n<p>{{data.title}}</p>\n",
        [`src/droplets/card/${file}`]: load,
        "src/droplets/plain/+droplet.hbs": "<p>{{data.title}}</p>\n",
        [`src/droplets/plain/${file}`]: load,
        "fake-entry.js": fakeEntry,
      },
    });
    const expected = [
      { id: "card", ssr: true, hydrate: false, prerender: false },
      { id: "plain", ssr: true, hydrate: true, prerender: false },
    ];
    const server = await createServer(devConfig({ root }));
    try {
      expect(apiOf({ plugins: server.config.plugins }).droplets()).toMatchObject(expected);
    } finally {
      await server.close();
    }
    const builder = await createBuilder(buildConfig({ root }));
    expect(apiOf({ plugins: builder.config.plugins }).droplets()).toMatchObject(expected);
    await builder.buildApp();
  });
});
