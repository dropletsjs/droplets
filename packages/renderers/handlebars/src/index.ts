/**
 * `@dropletsjs/renderer-handlebars`: the Handlebars renderer.
 *
 * ```ts
 * // vite.config.ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { node } from "@dropletsjs/adapter-node";
 * import { handlebars } from "@dropletsjs/renderer-handlebars";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: node(), renderers: [handlebars()] })] });
 * ```
 *
 * `+droplet.hbs` and `+error.hbs` are precompiled at build; only
 * `handlebars/runtime` ships. A template's context is `{ data }` for a
 * droplet and `{ error }` for an error page, like the props of the other
 * engines: `{{data.title}}`, `{{error.message}}`. `{{{children}}}` renders
 * the children marker, where the host's content goes. `@droplet`, `@kind`
 * and `@renderId` are data variables of the render.
 *
 * `+droplet.hbs` declares its flags in a comment, the first thing in it:
 *
 * ```hbs
 * {{!--
 * export hydrate = false
 * export prerender = true
 * --}}
 * ```
 *
 * or on one line: `{{!-- export hydrate = false; export prerender = true --}}`.
 *
 * That comment is the only place for them. `+error.hbs` follows the
 * droplet's flags: core ignores any it declares. Partials live in
 * `src/partials/*.hbs` and helpers are the exports of `src/handlebars.ts`,
 * on the server and in the browser.
 *
 * `<style>` blocks, inline or `<style src="./x.css">`, are taken out of the
 * template and become the droplet's stylesheet (see `styles.ts`).
 *
 * There is no client behaviour: `hydrate` keeps the server HTML and wires
 * the host's children; `hydrate = false` is the lean choice for a droplet
 * that has neither children nor a browser `load`.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DropletRenderer } from "@dropletsjs/droplets";
import { readFlags } from "./flags.ts";
import { handlebarsPlugin, type HandlebarsRendererOptions } from "./plugin.ts";

export type { HandlebarsRendererOptions, PrecompileOptions } from "./plugin.ts";

/** The context of `+droplet.hbs`: `{{data.…}}`, and `{{form.…}}` after a form action. */
export type DropletContext<Data = unknown, Form = unknown> = { data: Data; form?: Form };

/** The context of `+error.hbs`: `{{error.…}}`. */
export type DropletErrorContext<Err = unknown> = { error: Err };

/** The shape of `src/handlebars.ts`: named exports that are helper functions. */
export type HandlebarsHelpers = Record<string, (...args: never[]) => unknown>;

// `src/` and `dist/` both sit directly under the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The Handlebars renderer, for `droplets({ renderers: [handlebars()] })`. */
export function handlebars(options: HandlebarsRendererOptions = {}): DropletRenderer {
  return {
    name: "handlebars",
    extensions: [".hbs"],
    packages: ["handlebars", "@dropletsjs/renderer-handlebars"],
    plugins: [handlebarsPlugin(options)],
    server: resolve(packageRoot, "dist/server.js"),
    client: resolve(packageRoot, "dist/client.js"),
    clientDev: resolve(packageRoot, "dist/client-dev.js"),
    readFlags,
  };
}
