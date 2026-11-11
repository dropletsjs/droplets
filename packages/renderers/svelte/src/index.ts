/**
 * `@dropletsjs/renderer-svelte`: the Svelte 5 renderer.
 *
 * ```ts
 * // vite.config.ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { node } from "@dropletsjs/adapter-node";
 * import { svelte } from "@dropletsjs/renderer-svelte";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: node(), renderers: [svelte()] })] });
 * ```
 *
 * `+droplet.svelte` and `+error.svelte` are compiled in runes mode with
 * `vitePreprocess()`. Flags come from a `<script module>` block:
 * `export const ssr = false`. Error pages compile with `css: "injected"`, so
 * their styles travel with their markup. The `children` prop is a snippet
 * that renders the children marker, where the element puts the host's
 * content: `{@render children?.()}`. The snippet is a Svelte component the
 * renderer ships (`children.svelte`), compiled by the same plugin.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { svelte as sveltePlugin, vitePreprocess, type Options } from "@sveltejs/vite-plugin-svelte";
import type { DropletRenderer, ReadFlagsInput, RenderFlags } from "@dropletsjs/droplets";
import { readExportedFlags } from "@dropletsjs/droplets/vite";
import type { Plugin } from "vite";
import type { Snippet } from "svelte";
import { preprocess } from "svelte/compiler";

/**
 * The flags of a component: the exports of its `<script module>` block (or
 * `<script context="module">`), and of nothing else in the file.
 */
export async function readFlags({ kind, source, file, droplet }: ReadFlagsInput): Promise<Partial<RenderFlags> | undefined> {
  let module: string | undefined;
  // Svelte's own block split: it skips HTML comments and leaves the markup and
  // styles unparsed, so a stylesheet in another language does not get in the way.
  await preprocess(
    source,
    {
      script: ({ content, attributes }) => {
        if (attributes["module"] === true || attributes["context"] === "module") {
          module = content;
        }
      },
    },
    { filename: file },
  );
  if (module === undefined) return undefined;
  const where = kind === "droplet" ? droplet : `${droplet}/${file}`;
  // TypeScript parses plain JavaScript too, whatever the block's `lang`.
  return readExportedFlags(module, where, "ts");
}

/** The props of `+droplet.svelte`: `data` from the loads (a promise when mounted, the value when hydrated) and the `children` snippet. */
export type DropletProps<Data = unknown, Form = unknown> = {
  data: Data | Promise<Data>;
  /** After a form action, what it returned or `fail()`ed with; absent otherwise. */
  form?: Form;
  children?: Snippet;
};

/** The props of `+error.svelte`: the error out of `handleError` and the `children` snippet. */
export type DropletErrorProps<Err = unknown> = { error: Err; children?: Snippet };

export type SvelteRendererOptions = {
  /**
   * Set to `false` to add `@sveltejs/vite-plugin-svelte` to your Vite config
   * yourself. Droplets need runes mode and `vitePreprocess()`; give
   * `+error.svelte` files `css: "injected"` through `dynamicCompileOptions`.
   */
  plugin?: boolean;
  /**
   * Options merged into the ones this renderer passes to
   * `@sveltejs/vite-plugin-svelte`: `compilerOptions` and `preprocess` are
   * combined, the rest replaces the defaults.
   */
  vitePlugin?: Options;
};

// `src/` and `dist/` both sit directly under the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ERROR_COMPONENT = /[\\/]\+[Ee]rror\.svelte$/;

/** What the browser side reads to know whether the components were compiled in async mode. */
const OPTIONS_ID = "virtual:droplets-renderer-svelte/options";

/** What this renderer reads of vite-plugin-svelte's `api`, which Vite types as `any`. */
type SveltePluginApi = { options?: { compilerOptions?: { experimental?: { async?: boolean } } } };

/**
 * Hands the browser side the mode the components compile in, as
 * vite-plugin-svelte resolved it (`svelte.config.js` included). The renderer
 * never turns `experimental.async` on: with it, a droplet mounted with
 * `data` still to come gets the promise and `<svelte:boundary>` catches a
 * rejected `await data`; without it, `mount` waits for the data.
 */
function optionsPlugin(): Plugin {
  let asyncMode = false;
  return {
    name: "droplets:svelte-options",
    configResolved(config) {
      const core = config.plugins.find((plugin) => plugin.name === "vite-plugin-svelte:config");
      const api = core?.api as SveltePluginApi | undefined;
      asyncMode = api?.options?.compilerOptions?.experimental?.async === true;
    },
    resolveId: (id) => (id === OPTIONS_ID ? `\0${OPTIONS_ID}` : null),
    load: (id) => (id === `\0${OPTIONS_ID}` ? `export const asyncMode = ${asyncMode};\n` : null),
  };
}

/** The Svelte renderer, for `droplets({ renderers: [svelte()] })`. */
export function svelte({ plugin, vitePlugin: user = {} }: SvelteRendererOptions = {}): DropletRenderer {
  const preprocess =
    user.preprocess === undefined
      ? vitePreprocess()
      : Array.isArray(user.preprocess)
        ? [vitePreprocess(), ...user.preprocess]
        : [vitePreprocess(), user.preprocess];
  const userDynamic = user.dynamicCompileOptions;
  const pluginOptions: Options = {
    ...user,
    compilerOptions: { runes: true, ...user.compilerOptions },
    preprocess,
    // Error pages carry their own CSS: on the server inside the markup, in
    // the browser injected when mounted, since a failed droplet's stylesheet
    // may not be the one they need.
    dynamicCompileOptions: async (data) => ({
      ...(ERROR_COMPONENT.test(data.filename) ? { css: "injected" as const } : {}),
      ...(await userDynamic?.(data)),
    }),
  };

  return {
    name: "svelte",
    extensions: [".svelte"],
    readFlags,
    packages: ["svelte", "@dropletsjs/renderer-svelte"],
    componentTypes: "@dropletsjs/renderer-svelte",
    // Rune modules only work inside Svelte.
    suffixes: [".svelte.ts", ".svelte.js"],
    plugins: [...(plugin === false ? [] : [sveltePlugin(pluginOptions)]), optionsPlugin()],
    server: resolve(packageRoot, "dist/server.js"),
    client: resolve(packageRoot, "dist/client.js"),
    clientDev: resolve(packageRoot, "dist/client-dev.js"),
  };
}
