import { describe, expect, it } from "vitest";
import { readExportedFlags } from "../../src/index.ts";
import { FRAMEWORKS, frameworkNamed, kindNamed } from "../../src/add/catalog.ts";
import { flagsFor, scriptFlags } from "../../src/add/flags.ts";
import { dropletFileChoices, dropletFiles, type DropletFile } from "../../src/add/templates.ts";

const spec = (framework: string, files: DropletFile[] = [], target: Parameters<typeof flagsFor>[0] = "full") => ({
  name: "hello-world",
  framework: frameworkNamed(framework)!,
  flags: flagsFor(target, target === "full" ? "visible" : undefined).flags,
  files: new Set(files),
});

describe("dropletFiles()", () => {
  it("writes only the component when nothing else is asked for", () => {
    for (const framework of FRAMEWORKS) {
      expect(Object.keys(dropletFiles(spec(framework.name)))).toEqual([`+droplet${framework.extension}`]);
    }
  });

  it("puts the flags where each renderer reads them", () => {
    const component = (framework: string) => dropletFiles(spec(framework, [], "ssg"))[`+droplet${frameworkNamed(framework)!.extension}`]!;
    expect(component("svelte")).toMatch(/<script module lang="ts">\n  export const ssr = true;\n  export const hydrate = true;\n  export const prerender = true;\n<\/script>/);
    expect(component("vue")).toMatch(/^<script lang="ts">\nexport const ssr = true;\nexport const hydrate = true;\nexport const prerender = true;\n<\/script>/);
    expect(component("handlebars")).toMatch(/^\{\{!--\nexport ssr = true\nexport hydrate = true\nexport prerender = true\n--\}\}/);
    for (const exported of ["react", "preact", "solid", "hono-jsx", "lit"]) {
      expect(readExportedFlags(component(exported), "x")).toEqual({ ssr: true, hydrate: true, prerender: true });
    }
    expect(dropletFiles(spec("react"))["+droplet.tsx"]).toContain('export const hydrate = "visible";');
  });

  it("names the JSX import source in every .tsx file, so mixed projects can tell them apart", () => {
    for (const [framework, source] of [["react", "react"], ["preact", "preact"], ["solid", "solid-js"], ["hono-jsx", "hono/jsx"]] as const) {
      const files = dropletFiles(spec(framework, ["error"]));
      expect(files["+droplet.tsx"]).toMatch(new RegExp(`^/\\*\\* @jsxImportSource ${source} \\*/`));
      expect(files["+error.tsx"]).toMatch(new RegExp(`^/\\*\\* @jsxImportSource ${source} \\*/`));
    }
    expect(dropletFiles(spec("react"))["+droplet.tsx"]).toContain('<section className="hello-world">');
    expect(dropletFiles(spec("hono-jsx"))["+droplet.tsx"]).toContain('<section class="hello-world">');
    expect(dropletFiles(spec("preact"))["+droplet.tsx"]).toContain('<section class="hello-world">');
  });

  it("hands a Preact droplet its data as the value: the renderer awaits it, no use()", () => {
    const files = dropletFiles(spec("preact", ["server", "error"]));
    expect(files["+droplet.tsx"]).toContain("const { greeting } = data;");
    expect(files["+droplet.tsx"]).not.toMatch(/\buse\b/);
    expect(files["+error.tsx"]).toContain('<p class="error">{error.message}</p>');
  });

  it("builds data.greeting from the loads it writes, and shows handleError's message", () => {
    const both = dropletFiles(spec("react", ["server", "universal", "error"]));
    expect(both["+droplet.server.ts"]).toContain("return { who };");
    expect(both["+droplet.server.ts"]).toContain("satisfies HandleDropletError");
    expect(both["+droplet.ts"]).toContain("({ data }: DropletLoadEvent) => ({ greeting: `Hello ${data.who}!` })");
    expect(both["+droplet.tsx"]).toContain("use(data)");
    expect(both["+error.tsx"]).toContain("{error.message}");
    const server = dropletFiles(spec("react", ["server"]));
    expect(server["+droplet.server.ts"]).toContain("return { greeting: `Hello ${who}!` };");
    const error = dropletFiles(spec("react", ["error"]));
    expect(error["+error.tsx"]).toContain("Something went wrong.");
    expect(error["+error.tsx"]).not.toContain("error.message");
  });

  it("adds entries to the server load of an ssg droplet", () => {
    expect(dropletFiles(spec("vue", ["server"], "ssg"))["+droplet.server.ts"]).toContain("export const entries = () => [{}];");
    expect(dropletFiles(spec("vue", ["server"], "full"))["+droplet.server.ts"]).not.toContain("entries");
  });

  it("styles Svelte, Vue and Handlebars with a <style> block, the JSX ones from style.css", () => {
    expect(dropletFiles(spec("svelte", ["css"]))["+droplet.svelte"]).toContain("<style>\n  .hello-world {");
    expect(dropletFiles(spec("vue", ["css"]))["+droplet.vue"]).toContain("<style scoped>");
    const react = dropletFiles(spec("react", ["css"]));
    expect(react["style.css"]).toContain(".hello-world {");
    expect(react["+droplet.tsx"]).toContain('import "./style.css";');
    const handlebars = dropletFiles(spec("handlebars", ["css"]));
    expect(Object.keys(handlebars)).toEqual(["+droplet.hbs"]);
    expect(handlebars["+droplet.hbs"]).toContain("</section>\n\n<style>\n  .hello-world {");
  });

  it("writes Lit as a DropletElement class, styled in its shadow root, its children slotted", () => {
    const lit = dropletFiles(spec("lit", ["server", "error", "css"]));
    expect(Object.keys(lit)).toEqual(["+droplet.lit.ts", "+droplet.server.ts", "+error.lit.ts"]);
    expect(lit["+droplet.lit.ts"]).toContain("export default class HelloWorld extends DropletElement<DropletProps> {");
    expect(lit["+droplet.lit.ts"]).toContain("static override styles = css`\n    .hello-world {");
    expect(lit["+droplet.lit.ts"]).toContain("<h1>${this.data.greeting}</h1>\n        <slot></slot>");
    expect(lit["+error.lit.ts"]).toContain("extends DropletErrorElement<DropletErrorProps>");
    expect(lit["+error.lit.ts"]).toContain('<p class="error">${this.error.message}</p><slot></slot>');
    expect(dropletFiles(spec("lit"))["+droplet.lit.ts"]).toContain('import { html } from "lit";');
  });
});

describe("dropletFiles() for a script droplet", () => {
  const script = (files: DropletFile[] = [], hydrate: "always" | "visible" = "always") => ({
    name: "page-views",
    framework: kindNamed("script")!,
    flags: scriptFlags(hydrate),
    files: new Set(files),
  });

  it("writes +droplet.script.ts, typed by ./$types, with no ssr flag", () => {
    const files = dropletFiles(script());
    expect(Object.keys(files)).toEqual(["+droplet.script.ts"]);
    const code = files["+droplet.script.ts"]!;
    expect(code).toContain('import type { DropletScript } from "./$types";');
    expect(code).toContain("const run: DropletScript = (_data, el) => {");
    expect(code).toContain('heading.textContent = "page-views";');
    expect(code).toContain("export default run;");
    expect(readExportedFlags(code, "x")).toEqual({});
  });

  it("writes hydrate only when visible, data from the loads, and styles from style.css", () => {
    const files = dropletFiles(script(["server", "universal", "css"], "visible"));
    expect(Object.keys(files).sort()).toEqual(["+droplet.script.ts", "+droplet.server.ts", "+droplet.ts", "style.css"]);
    const code = files["+droplet.script.ts"]!;
    expect(readExportedFlags(code, "x")).toEqual({ hydrate: "visible" });
    expect(code).toContain('import "./style.css";');
    expect(code).toContain("heading.textContent = data.greeting;");
  });

  it("has no error page", () => {
    expect(() => dropletFiles(script(["error"]))).toThrow(/no error page/);
    expect(dropletFileChoices(kindNamed("script")!).map((f) => f.value)).toEqual(["server", "universal", "css"]);
  });
});
