/**
 * The files `djs add` writes for a droplet: the component in its framework,
 * with the flags where that framework's renderer reads them, and the
 * optional server load, universal load, error page and stylesheet.
 *
 * With a load, the component shows `data.greeting`, which the loads build
 * from a `who` prop; without one it shows its name. Every component reads
 * its types from the generated `./$types`, so `djs sync` runs after.
 */
import { kebabCase, pascalCase } from "case-anything";
import type { Framework } from "./catalog.ts";
import type { Flags } from "./flags.ts";

export type DropletFile = "server" | "universal" | "error" | "css";

export const DROPLET_FILES: readonly { value: DropletFile; label: string; hint: string }[] = [
  { value: "server", label: "+droplet.server.ts", hint: "a server load: secrets, databases, locals" },
  { value: "universal", label: "+droplet.ts", hint: "a props schema and a load that runs on both sides" },
  { value: "error", label: "+error", hint: "the error page, in the same framework" },
  { value: "css", label: "styles", hint: "a stylesheet scoped to the droplet" },
];

export type DropletSpec = {
  /** The folder name: `hello-world` (its id is the kebab case of it). */
  name: string;
  framework: Framework;
  flags: Flags;
  files: ReadonlySet<DropletFile>;
};

type Context = DropletSpec & {
  /** `hello-world`: the class on the root element. */
  className: string;
  /** `HelloWorld`: the component's function name. */
  component: string;
  /** A load builds `data.greeting`. */
  hasData: boolean;
  /** The error page has `handleError`'s `{ message }`. */
  hasMessage: boolean;
};

type DropletFileChoicesInput = { framework: Pick<Framework, "name"> };

type FlagLineInput = { name: string; value: string };

type FlagLinesInput = { flags: Flags; form: (line: FlagLineInput) => string };

type HeadingInput = { context: Pick<Context, "hasData" | "name">; value: string };

type StylesheetInput = Pick<Context, "className">;

type StyleBlockInput = { context: Pick<Context, "files" | "className">; tag: string };

const CSS_FILE = "style.css";

/** Every file of the droplet, by name inside its folder. */
export function dropletFiles(spec: DropletSpec): Record<string, string> {
  const context: Context = {
    ...spec,
    className: kebabCase(spec.name),
    component: pascalCase(spec.name),
    hasData: spec.files.has("server") || spec.files.has("universal"),
    hasMessage: spec.files.has("server") && spec.files.has("error"),
  };
  const { extension } = spec.framework;
  const script = spec.framework.name === "script";
  if (script && spec.files.has("error")) {
    throw new Error("a script droplet has no error page: it renders nothing, on either side");
  }
  const files: Record<string, string> = { [`+droplet${extension}`]: component(context) };
  if (spec.files.has("server")) files["+droplet.server.ts"] = serverModule(context);
  if (spec.files.has("universal")) files["+droplet.ts"] = universalModule(context);
  if (spec.files.has("error")) files[`+error${extension}`] = errorComponent(context);
  // Svelte, Vue and Handlebars take a <style> block, Lit `static styles`; the JSX ones and scripts import a file.
  if (spec.files.has("css") && (spec.framework.jsxImportSource || script)) files[CSS_FILE] = stylesheet(context);
  return files;
}

/** The optional files a droplet of `framework` can have: a script droplet has no error page. */
export function dropletFileChoices({ framework }: DropletFileChoicesInput): readonly (typeof DROPLET_FILES)[number][] {
  return framework.name === "script" ? DROPLET_FILES.filter((file) => file.value !== "error") : DROPLET_FILES;
}

function serverModule(context: Context): string {
  const lines: string[] = [];
  if (context.hasMessage) lines.push('import type { HandleDropletError } from "$droplets/server";');
  lines.push('import type { LoadEvent } from "./$types";', "");
  lines.push(
    "/** Runs on the server for every request: read secrets, databases and `locals` here. */",
    "export const load = ({ props }: LoadEvent) => {",
    '  const who = typeof props["who"] === "string" ? props["who"] : "world";',
    context.files.has("universal") ? "  return { who };" : "  return { greeting: `Hello ${who}!` };",
    "};",
  );
  if (context.hasMessage) {
    lines.push(
      "",
      "/** What the error page shows when a load throws. Server only: the original error never reaches the page. */",
      "export const handleError = (() => ({",
      '  error: { message: "Something went wrong." },',
      "})) satisfies HandleDropletError;",
    );
  }
  if (context.flags.prerender) {
    lines.push("", "/** The renders made at build time, one per event: `{ props, host }`. */", "export const entries = () => [{}];");
  }
  return `${lines.join("\n")}\n`;
}

function universalModule(context: Context): string {
  const lines: string[] = ['import type { DropletLoadEvent } from "./$types";', ""];
  lines.push(
    "/**",
    " * Runs on the server before rendering and in the browser before hydrating",
    " * or mounting. `export const props = <schema>` (zod, valibot, …) checks the",
    " * caller's props before any load.",
    " */",
  );
  if (context.files.has("server")) {
    lines.push("export const load = ({ data }: DropletLoadEvent) => ({ greeting: `Hello ${data.who}!` });");
  } else {
    lines.push(
      "export const load = ({ props }: DropletLoadEvent) => {",
      '  const who = typeof props["who"] === "string" ? props["who"] : "world";',
      "  return { greeting: `Hello ${who}!` };",
      "};",
    );
  }
  return `${lines.join("\n")}\n`;
}

/** `export const ssr = true;` lines, `prerender` only when on. */
function flagLines({ flags, form }: FlagLinesInput): string[] {
  const lines = [form({ name: "ssr", value: JSON.stringify(flags.ssr) }), form({ name: "hydrate", value: JSON.stringify(flags.hydrate) })];
  if (flags.prerender) lines.push(form({ name: "prerender", value: "true" }));
  return lines;
}

function constant({ name, value }: FlagLineInput): string {
  return `export const ${name} = ${value};`;
}

function component(context: Context): string {
  switch (context.framework.name) {
    case "svelte":
      return svelteComponent(context);
    case "vue":
      return vueComponent(context);
    case "solid":
      return solidComponent(context);
    case "handlebars":
      return handlebarsComponent(context);
    case "react":
    case "preact":
    case "hono-jsx":
      return hooksComponent(context);
    case "lit":
      return litComponent(context);
    case "script":
      return scriptComponent(context);
    default: {
      const unreachable: never = context.framework.name;
      return unreachable;
    }
  }
}

function errorComponent(context: Context): string {
  switch (context.framework.name) {
    case "script":
      throw new Error("a script droplet has no error page");
    case "svelte":
      return svelteError(context);
    case "vue":
      return vueError(context);
    case "solid":
      return solidError(context);
    case "handlebars":
      return handlebarsError(context);
    case "react":
    case "preact":
    case "hono-jsx":
      return hooksError(context);
    case "lit":
      return litError(context);
    default: {
      const unreachable: never = context.framework.name;
      return unreachable;
    }
  }
}

function heading({ context, value }: HeadingInput): string {
  return context.hasData ? value : context.name;
}

const MESSAGE = "Something went wrong.";

function stylesheet({ className }: StylesheetInput): string {
  return `.${className} {\n  font-family: system-ui, sans-serif;\n}\n`;
}

/** A `<style>` block for the formats that have one: Svelte, Vue, Handlebars. */
function styleBlock({ context, tag }: StyleBlockInput): string[] {
  if (!context.files.has("css")) return [];
  return [
    "",
    `<${tag}>`,
    ...stylesheet(context)
      .trimEnd()
      .split("\n")
      .map((line) => `  ${line}`),
    "</style>",
  ];
}

function svelteComponent(context: Context): string {
  return [
    '<script module lang="ts">',
    ...flagLines({ flags: context.flags, form: constant }).map((line) => `  ${line}`),
    "</script>",
    "",
    '<script lang="ts">',
    '  import type { DropletProps } from "./$types";',
    "",
    `  let { ${context.hasData ? "data, " : ""}children }: DropletProps = $props();`,
    "</script>",
    "",
    `<section class="${context.className}">`,
    ...(context.hasData ? ["  {#await data then { greeting }}", "    <h1>{greeting}</h1>", "  {/await}"] : [`  <h1>${context.name}</h1>`]),
    "  {@render children?.()}",
    "</section>",
    ...styleBlock({ context, tag: "style" }),
    "",
  ].join("\n");
}

function svelteError(context: Context): string {
  return [
    '<script lang="ts">',
    '  import type { DropletErrorProps } from "./$types";',
    "",
    `  let { ${context.hasMessage ? "error, " : ""}children }: DropletErrorProps = $props();`,
    "</script>",
    "",
    `<p class="error">${context.hasMessage ? "{error.message}" : MESSAGE}</p>`,
    "{@render children?.()}",
    "",
  ].join("\n");
}

function vueComponent(context: Context): string {
  return [
    '<script lang="ts">',
    ...flagLines({ flags: context.flags, form: constant }),
    "</script>",
    "",
    '<script setup lang="ts">',
    'import { DropletChildren } from "@dropletsjs/renderer-vue/children";',
    'import type { DropletProps } from "./$types";',
    "",
    ...(context.hasData
      ? [
          "const props = defineProps<DropletProps>();",
          "// A value when hydrating, a promise when the element mounts it fresh: <Suspense> waits.",
          "const { greeting } = await props.data;",
        ]
      : ["defineProps<DropletProps>();"]),
    "</script>",
    "",
    "<template>",
    `  <section class="${context.className}">`,
    `    <h1>${heading({ context, value: "{{ greeting }}" })}</h1>`,
    "    <DropletChildren />",
    "  </section>",
    "</template>",
    ...styleBlock({ context, tag: "style scoped" }),
    "",
  ].join("\n");
}

function vueError(context: Context): string {
  return [
    '<script setup lang="ts">',
    'import { DropletChildren } from "@dropletsjs/renderer-vue/children";',
    'import type { DropletErrorProps } from "./$types";',
    "",
    "defineProps<DropletErrorProps>();",
    "</script>",
    "",
    "<template>",
    `  <p class="error">${context.hasMessage ? "{{ error.message }}" : MESSAGE}</p>`,
    "  <DropletChildren />",
    "</template>",
    "",
  ].join("\n");
}

/**
 * React, Preact and Hono JSX: the same component, different attributes.
 * React and Hono JSX wait for a promise of `data` with `use`; the Preact
 * renderer awaits it before it renders, so `data` is always the value.
 */
function hooksComponent(context: Context): string {
  const source = context.framework.jsxImportSource;
  if (source === undefined) throw new Error(`droplets: ${context.framework.name} has no jsxImportSource`);
  const classAttribute = context.framework.name === "react" ? "className" : "class";
  const waits = context.hasData && context.framework.name !== "preact";
  return [
    `/** @jsxImportSource ${source} */`,
    ...(waits ? [`import { use } from "${source}";`] : []),
    ...(context.files.has("css") ? [`import "./${CSS_FILE}";`] : []),
    'import type { DropletProps } from "./$types";',
    "",
    ...flagLines({ flags: context.flags, form: constant }),
    "",
    `export default function ${context.component}({ ${context.hasData ? "data, " : ""}children }: DropletProps) {`,
    ...(waits
      ? [
          "  // A value when hydrating, a promise when the element mounts it fresh: `use` suspends on it.",
          "  const { greeting } = data instanceof Promise ? use(data) : data;",
        ]
      : context.hasData
        ? ["  // Always the value: when the element mounts it fresh, the renderer waits for it first.", "  const { greeting } = data;"]
        : []),
    "  return (",
    `    <section ${classAttribute}="${context.className}">`,
    `      <h1>${heading({ context, value: "{greeting}" })}</h1>`,
    "      {children}",
    "    </section>",
    "  );",
    "}",
    "",
  ].join("\n");
}

function hooksError(context: Context): string {
  const source = context.framework.jsxImportSource;
  if (source === undefined) throw new Error(`droplets: ${context.framework.name} has no jsxImportSource`);
  const classAttribute = context.framework.name === "react" ? "className" : "class";
  return [
    `/** @jsxImportSource ${source} */`,
    'import type { DropletErrorProps } from "./$types";',
    "",
    `export default function ${context.component}Error({ ${context.hasMessage ? "error, " : ""}children }: DropletErrorProps) {`,
    "  return (",
    "    <>",
    `      <p ${classAttribute}="error">${context.hasMessage ? "{error.message}" : MESSAGE}</p>`,
    "      {children}",
    "    </>",
    "  );",
    "}",
    "",
  ].join("\n");
}

function solidComponent(context: Context): string {
  return [
    "/** @jsxImportSource solid-js */",
    ...(context.hasData ? ['import { createResource } from "solid-js";'] : []),
    ...(context.files.has("css") ? [`import "./${CSS_FILE}";`] : []),
    'import type { DropletProps } from "./$types";',
    "",
    ...flagLines({ flags: context.flags, form: constant }),
    "",
    `export default function ${context.component}(props: DropletProps) {`,
    ...(context.hasData
      ? [
          "  // A value when hydrating, a promise when the element mounts it fresh: a resource of it suspends.",
          "  const data = props.data;",
          "  const value = data instanceof Promise ? createResource(() => data)[0] : () => data;",
        ]
      : []),
    "  return (",
    `    <section class="${context.className}">`,
    `      <h1>${heading({ context, value: "{value()?.greeting}" })}</h1>`,
    "      {props.children}",
    "    </section>",
    "  );",
    "}",
    "",
  ].join("\n");
}

function solidError(context: Context): string {
  return [
    "/** @jsxImportSource solid-js */",
    'import type { DropletErrorProps } from "./$types";',
    "",
    `export default function ${context.component}Error(props: DropletErrorProps) {`,
    "  return (",
    "    <>",
    `      <p class="error">${context.hasMessage ? "{props.error.message}" : MESSAGE}</p>`,
    "      {props.children}",
    "    </>",
    "  );",
    "}",
    "",
  ].join("\n");
}

function handlebarsComponent(context: Context): string {
  return [
    "{{!--",
    ...flagLines({ flags: context.flags, form: ({ name, value }) => `export ${name} = ${value}` }),
    "--}}",
    `<section class="${context.className}">`,
    `  <h1>${heading({ context, value: "{{data.greeting}}" })}</h1>`,
    "  {{{children}}}",
    "</section>",
    ...styleBlock({ context, tag: "style" }),
    "",
  ].join("\n");
}

/**
 * A script droplet: plain browser code, called once per element with the
 * loads' `data` and the element. Only `hydrate = "visible"` is written:
 * it has no `ssr`, and `true` is the default.
 */
function scriptComponent(context: Context): string {
  return [
    ...(context.files.has("css") ? [`import "./${CSS_FILE}";`] : []),
    'import type { DropletScript } from "./$types";',
    "",
    ...(context.flags.hydrate === "visible" ? ['export const hydrate = "visible";', ""] : []),
    "/**",
    " * Runs in the browser only, once per element: `data` is what the loads",
    " * returned, `el` the droplet's element; add anything under it. The cleanup",
    " * it returns (optional) runs when the element leaves the page.",
    " */",
    `const run: DropletScript = (${context.hasData ? "data" : "_data"}, el) => {`,
    '  const heading = document.createElement("h1");',
    `  heading.className = ${JSON.stringify(context.className)};`,
    `  heading.textContent = ${context.hasData ? "data.greeting" : JSON.stringify(context.name)};`,
    "  el.append(heading);",
    "  return () => heading.remove();",
    "};",
    "",
    "export default run;",
    "",
  ].join("\n");
}

function handlebarsError(context: Context): string {
  return [`<p class="error">${context.hasMessage ? "{{error.message}}" : MESSAGE}</p>`, "{{{children}}}", ""].join("\n");
}

/**
 * Lit: a `LitElement` class the renderer defines, its styles inside its
 * shadow root, the host's children through a `<slot>`. `data` is always a
 * value: the renderer waits for it.
 */
function litComponent(context: Context): string {
  const styled = context.files.has("css");
  return [
    `import { ${styled ? "css, " : ""}html } from "lit";`,
    'import { DropletElement } from "@dropletsjs/renderer-lit/element";',
    'import type { DropletProps } from "./$types";',
    "",
    ...flagLines({ flags: context.flags, form: constant }),
    "",
    `export default class ${context.component} extends DropletElement<DropletProps> {`,
    ...(styled
      ? [
          "  static override styles = css`",
          ...stylesheet(context)
            .trimEnd()
            .split("\n")
            .map((line) => `    ${line}`),
          "  `;",
          "",
        ]
      : []),
    "  override render() {",
    "    return html`",
    `      <section class="${context.className}">`,
    `        <h1>${heading({ context, value: "${this.data.greeting}" })}</h1>`,
    "        <slot></slot>",
    "      </section>",
    "    `;",
    "  }",
    "}",
    "",
  ].join("\n");
}

function litError(context: Context): string {
  return [
    'import { html } from "lit";',
    'import { DropletErrorElement } from "@dropletsjs/renderer-lit/element";',
    'import type { DropletErrorProps } from "./$types";',
    "",
    `export default class ${context.component}Error extends DropletErrorElement<DropletErrorProps> {`,
    "  override render() {",
    `    return html\`<p class="error">${context.hasMessage ? "${this.error.message}" : MESSAGE}</p><slot></slot>\`;`,
    "  }",
    "}",
    "",
  ].join("\n");
}
