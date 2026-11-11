/**
 * `@dropletsjs/renderer-solid`: the Solid renderer.
 *
 * ```ts
 * // vite.config.ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { node } from "@dropletsjs/adapter-node";
 * import { solid } from "@dropletsjs/renderer-solid";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: node(), renderers: [solid()] })] });
 * ```
 *
 * `+droplet.tsx` and `+error.tsx` (or `.jsx`) default-export a Solid
 * component. `vite-plugin-solid` compiles them per Vite environment: SSR
 * output wherever the environment's consumer is the server (the `ssr` and
 * `server` builds, the dev server's SSR runner) and hydratable DOM output in
 * the browser environment, always with `hydratable: true`. Flags are named
 * exports of the component file: `export const prerender = true`. The
 * `children` prop is a JSX element that renders the children marker:
 * `<div>{props.children}</div>`.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import solidPlugin, { type Options } from "vite-plugin-solid";
import type { DropletRenderer } from "@dropletsjs/droplets";
import type { JSX } from "solid-js";

/** The props of `+droplet.tsx`: `data` from the loads (a promise when mounted, the value when hydrated) and the host's `children`. */
export type DropletProps<Data = unknown, Form = unknown> = {
  data: Data | Promise<Data>;
  /** After a form action, what it returned or `fail()`ed with; absent otherwise. */
  form?: Form;
  children?: JSX.Element;
};

/** The props of `+error.tsx`: the error out of `handleError` and the host's `children`. */
export type DropletErrorProps<Err = unknown> = { error: Err; children?: JSX.Element };

export type SolidRendererOptions = {
  /**
   * Set to `false` to add `vite-plugin-solid` to your Vite config yourself.
   * Droplets need `ssr: true`, so that components compile to SSR output in
   * server environments and to hydratable DOM output in the browser one.
   */
  plugin?: boolean;
  /**
   * Options passed to `vite-plugin-solid`. `ssr` is always `true`; keep
   * `solid.hydratable` at its default, or the server markup cannot be
   * hydrated.
   */
  vitePlugin?: Partial<Options>;
};

// `src/` and `dist/` both sit directly under the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The Solid renderer, for `droplets({ renderers: [solid()] })`. */
export function solid(options: SolidRendererOptions = {}): DropletRenderer {
  const pluginOptions: Partial<Options> = { ...options.vitePlugin, ssr: true };
  return {
    name: "solid",
    extensions: [".tsx", ".jsx"],
    packages: ["solid-js", "@dropletsjs/renderer-solid"],
    componentTypes: "@dropletsjs/renderer-solid",
    // With React next to it, core says which `.tsx` modules are Solid's.
    ...(options.plugin === false
      ? {}
      : { plugins: (scope) => [solidPlugin({ ...pluginOptions, ...(scope.include ? { include: scope.include } : {}) })] }),
    server: resolve(packageRoot, "dist/server.js"),
    client: resolve(packageRoot, "dist/client.js"),
    clientDev: resolve(packageRoot, "dist/client-dev.js"),
    // Solid's hydration state (`window._$HY`), defined once per page.
    clientSetup: resolve(packageRoot, "dist/client-setup.js"),
  };
}
