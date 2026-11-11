import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import type { DropletEntry } from "../../src/core/discover.ts";
import type { DropletRenderer } from "../../src/renderer.ts";
import { dropletTypesCode, syncDropletTypes } from "../../src/vite/sync-types.ts";

const entry = (name: string, extra: Partial<DropletEntry> = {}): DropletEntry => ({
  id: name,
  name,
  file: "+droplet.svelte",
  renderer: "svelte",
  hasLoad: false,
  hasServerLoad: false,
  hasError: false,
  ssr: true,
  hydrate: true,
  prerender: false,
  ...extra,
});
const svelte: DropletRenderer = {
  name: "svelte",
  extensions: [".svelte"],
  server: "/r/server.js",
  client: "/r/client.js",
  componentTypes: "@dropletsjs/renderer-svelte",
};

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("dropletTypesCode", () => {
  it("reads the droplet's own files, relative to where the types land", () => {
    const code = dropletTypesCode(
      entry("hello", { hasLoad: true, hasServerLoad: true }),
      svelte,
      "/app/.droplets/types/src/droplets/hello/$types.d.ts",
      "/app/src/droplets/hello",
    );
    expect(code).toContain('type Universal = typeof import("../../../../../src/droplets/hello/+droplet.ts");');
    expect(code).toContain('type Server = typeof import("../../../../../src/droplets/hello/+droplet.server.ts");');
    expect(code).toContain('from "@dropletsjs/renderer-svelte";');
  });

  it("has nothing to import without load files, and neutral component types without a renderer's", () => {
    const code = dropletTypesCode(entry("bare"), undefined, "/app/.droplets/types/x/$types.d.ts", "/app/x");
    expect(code).toContain("type Universal = {};");
    expect(code).toContain("type Server = {};");
    expect(code).toContain('DropletProps as ComponentProps } from "@dropletsjs/droplets";');
  });
});

describe("syncDropletTypes", () => {
  it("writes a $types.d.ts per droplet and the tsconfig, leaves unchanged files alone, removes stale ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "droplets-types-"));
    temps.push(root);
    const input = { root, dropletsRoot: resolve(root, "src/droplets"), renderers: [svelte] };

    const first = await syncDropletTypes({ ...input, entries: [entry("a"), entry("b")] });
    expect(first.written.map((file) => file.slice(root.length))).toEqual([
      "/.droplets/types/src/droplets/a/$types.d.ts",
      "/.droplets/types/src/droplets/b/$types.d.ts",
      "/.droplets/tsconfig.json",
    ]);
    expect(JSON.parse(await readFile(resolve(root, ".droplets/tsconfig.json"), "utf8"))).toEqual({
      compilerOptions: { module: "esnext", moduleResolution: "bundler", rootDirs: ["..", "./types"] },
    });

    expect((await syncDropletTypes({ ...input, entries: [entry("a"), entry("b")] })).written).toEqual([]);

    await syncDropletTypes({ ...input, entries: [entry("a")] });
    await expect(readFile(resolve(root, ".droplets/types/src/droplets/b/$types.d.ts"), "utf8")).rejects.toThrow();
    await expect(readFile(resolve(root, ".droplets/types/src/droplets/a/$types.d.ts"), "utf8")).resolves.toContain(
      "export type Data",
    );
  });
});

describe("./$types, as TypeScript reads them", () => {
  /** A project under this package, so `@dropletsjs/droplets` resolves to it by name. */
  async function project(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(resolve(import.meta.dirname, "../fixtures"), ".types-"));
    temps.push(root);
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(resolve(root, path)), { recursive: true });
      await writeFile(resolve(root, path), text);
    }
    return root;
  }

  function diagnostics(root: string, files: string[]): string[] {
    const program = ts.createProgram(
      files.map((file) => resolve(root, file)),
      {
        strict: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowImportingTsExtensions: true,
        skipLibCheck: true,
        rootDirs: [root, resolve(root, ".droplets/types")],
      },
    );
    return ts
      .getPreEmitDiagnostics(program)
      .map((d) => `${d.file ? `${d.file.fileName.slice(root.length)}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1} ` : ""}${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  }

  it("types props from the schema, data from the loads, and the error page from handleError", async () => {
    const root = await project({
      "src/droplets/card/+droplet.ts": [
        'import type { DropletLoadEvent } from "./$types";',
        "type Out = { who: string; page: number };",
        "export const props = {",
        '  "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }),',
        "    types: undefined as unknown as { input: unknown; output: Out } },",
        "} as const;",
        "export const load = ({ data, props }: DropletLoadEvent) => ({ ...data, label: `${props.who} ${props.page}` });",
        "export const handleError = () => ({ error: { reason: \"oops\" } });",
      ].join("\n"),
      "src/droplets/card/+droplet.server.ts": [
        'import { fail, redirect } from "@dropletsjs/droplets/server";',
        'import type { Actions, LoadEvent } from "./$types";',
        "export const load = ({ props }: LoadEvent) => ({ who: props.who.toUpperCase(), page: props.page + 1 });",
        "export const actions = {",
        "  default: async ({ request, props }) => {",
        '    const name = (await request.formData()).get("name");',
        '    if (typeof name !== "string") return fail(422, { missing: true as const });',
        "    return { thanks: `${name} ${props.who}` };",
        "  },",
        '  leave: () => redirect(303, "/bye"),',
        "  quiet: () => {},",
        "} satisfies Actions;",
      ].join("\n"),
      "src/droplets/card/check.ts": [
        'import type { ActionData, Data, DropletErrorProps, DropletProps, Props, ServerData } from "./$types";',
        "type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;",
        "const yes = <T extends true>() => {};",
        "yes<Same<Props, { who: string; page: number }>>();",
        "yes<Same<ServerData, { who: string; page: number }>>();",
        "yes<Same<Data, { label: string; who: string; page: number }>>();",
        "yes<Same<DropletProps[\"data\"], Data | Promise<Data>>>();",
        "yes<Same<DropletErrorProps[\"error\"], { reason: string }>>();",
        "yes<Same<ActionData, { missing: true } | { thanks: string } | undefined>>();",
        "yes<Same<NonNullable<DropletProps[\"form\"]>, { missing: true } | { thanks: string }>>();",
        "// @ts-expect-error: `who` is a string once the schema ran",
        "export const wrong: Props = { who: 1, page: 1 };",
      ].join("\n"),
      "src/droplets/bare/check.ts": [
        'import type { ActionData, Data, Props } from "./$types";',
        "const data: Data = undefined;",
        "const form: ActionData = undefined;",
        "const props: Props = { anything: 1 };",
        "export { data, form, props };",
      ].join("\n"),
    });
    await syncDropletTypes({
      root,
      dropletsRoot: resolve(root, "src/droplets"),
      renderers: [],
      entries: [entry("card", { hasLoad: true, hasServerLoad: true }), entry("bare")],
    });
    expect(diagnostics(root, ["src/droplets/card/check.ts", "src/droplets/bare/check.ts"])).toEqual([]);
  });

  it("types actionUrl and the enhance options by the droplet's own actions", async () => {
    const root = await project({
      "src/droplets/card/+droplet.server.ts": [
        'import { fail, redirect } from "@dropletsjs/droplets/server";',
        'import type { Actions } from "./$types";',
        "export const actions = {",
        "  default: async ({ request }) => {",
        '    const name = (await request.formData()).get("name");',
        '    if (typeof name !== "string") return fail(422, { missing: true as const });',
        "    return { thanks: name };",
        "  },",
        '  leave: () => redirect(303, "/bye"),',
        "  add: () => ({ added: 1 }),",
        "} satisfies Actions;",
      ].join("\n"),
      "src/droplets/card/check.ts": [
        'import { actionUrl, enhanceDropletForm, type EnhanceOptions, type EnhanceResult } from "$droplets/form";',
        'import type { ActionData, DropletActions } from "./$types";',
        "type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;",
        "const yes = <T extends true>() => {};",
        "yes<Same<DropletActions, { default: { missing: true } | { thanks: string }; leave: never; add: { added: number } }>>();",
        "yes<Same<ActionData, { missing: true } | { thanks: string } | { added: number } | undefined>>();",
        "actionUrl<DropletActions>();",
        'actionUrl<DropletActions>("add", { props: { page: 1 } });',
        "// @ts-expect-error: card exports no action `nope`",
        'actionUrl<DropletActions>("nope");',
        'actionUrl("anything");',
        "declare const form: HTMLFormElement;",
        "const stop: () => void = enhanceDropletForm<DropletActions>(form, {",
        '  action: "add",',
        "  onResult: async ({ type, data, update }) => {",
        '    if (type !== "redirect") yes<Same<typeof data, { added: number }>>();',
        "    await update();",
        "  },",
        "});",
        "enhanceDropletForm<DropletActions>(form, {",
        "  onSubmit: ({ formData, cancel }) => {",
        '    if (!formData.get("name")) cancel();',
        "  },",
        "  onResult: (result) => {",
        '    if (result.type !== "redirect") yes<Same<typeof result.data, { missing: true } | { thanks: string } | { added: number }>>();',
        "    else yes<Same<typeof result.location, string>>();",
        "  },",
        "});",
        "// @ts-expect-error: card exports no action `nope`",
        'enhanceDropletForm<DropletActions>(form, { action: "nope" });',
        "enhanceDropletForm(form);",
        "export const options: EnhanceOptions<DropletActions, \"add\"> = { action: \"add\", onResult: ({ data }) => void data };",
        "export type Result = EnhanceResult<DropletActions[\"add\"]>;",
        "export { stop };",
      ].join("\n"),
      "src/droplets/bare/check.ts": [
        'import { actionUrl } from "$droplets/form";',
        'import type { DropletActions } from "./$types";',
        "// @ts-expect-error: bare exports no actions, so no default either",
        "actionUrl<DropletActions>();",
      ].join("\n"),
    });
    await syncDropletTypes({
      root,
      dropletsRoot: resolve(root, "src/droplets"),
      renderers: [],
      entries: [entry("card", { hasServerLoad: true }), entry("bare")],
    });
    const ambient = resolve(import.meta.dirname, "../../ambient.d.ts");
    expect(diagnostics(root, [ambient, "src/droplets/card/check.ts", "src/droplets/bare/check.ts"])).toEqual([]);
  });

  it("types a script droplet's (data, el) by its loads, with an optional cleanup", async () => {
    const root = await project({
      "src/droplets/tracker/+droplet.server.ts": [
        'import type { LoadEvent } from "./$types";',
        "export const load = (_event: LoadEvent) => ({ views: 3, page: \"home\" });",
      ].join("\n"),
      "src/droplets/tracker/+droplet.script.ts": [
        'import type { Data, DropletScript } from "./$types";',
        "type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;",
        "const yes = <T extends true>() => {};",
        "yes<Same<Data, { views: number; page: string }>>();",
        "const run: DropletScript = (data, el) => {",
        "  el.textContent = `${data.page}: ${data.views.toFixed(0)}`;",
        "  return () => el.replaceChildren();",
        "};",
        "export const quiet: DropletScript = (data) => void data.views;",
        "// @ts-expect-error: `views` is a number",
        "export const wrong: DropletScript = (data) => void data.views.toUpperCase();",
        "export default run;",
      ].join("\n"),
    });
    await syncDropletTypes({
      root,
      dropletsRoot: resolve(root, "src/droplets"),
      renderers: [],
      entries: [entry("tracker", { file: "+droplet.script.ts", renderer: "script", hasServerLoad: true })],
    });
    expect(diagnostics(root, ["src/droplets/tracker/+droplet.script.ts"])).toEqual([]);
  });
});
