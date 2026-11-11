/**
 * `@dropletsjs/renderer-hono-jsx`: the Hono JSX renderer.
 *
 * ```ts
 * // vite.config.ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { node } from "@dropletsjs/adapter-node";
 * import { honoJsx } from "@dropletsjs/renderer-hono-jsx";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: node(), renderers: [honoJsx()] })] });
 * ```
 *
 * `+droplet.tsx` and `+error.tsx` (or `.jsx`) default-export a component
 * written with `hono/jsx`, the JSX Hono ships: no other package to install.
 * The renderer compiles them for `hono/jsx` on the server and for
 * `hono/jsx/dom` in the browser, where `hono/jsx` itself (hooks, `use`,
 * `Suspense`, `ErrorBoundary`) resolves to its DOM build. Flags are named
 * exports of the component file: `export const prerender = true`. The
 * component receives `data` (droplet) or `error` (error page) and
 * `children`, an element that renders the children marker:
 * `<div>{children}</div>`.
 *
 * ```tsx
 * import type { DropletProps } from "@dropletsjs/renderer-hono-jsx";
 *
 * export default function Hello({ data, children }: DropletProps<{ greeting: string }>) {
 *   return <section><h1>{data.greeting}</h1>{children}</section>;
 * }
 * ```
 *
 * `hono/jsx/dom` has no hydration: "hydrating" renders the component again
 * in place of the server's markup, within the same task. What the server
 * rendered shows until the bundle loads; state typed into it before then
 * (an input's value, focus) does not survive.
 *
 * `.tsx` and `.jsx` are also React's and Solid's suffixes; next to them, a
 * component says it is Hono's by importing `hono/jsx` or with a
 * `@jsxImportSource hono/jsx` comment.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DropletRenderer } from "@dropletsjs/droplets";
import type { Child } from "hono/jsx";
import { honoJsxPlugin } from "./plugin.ts";

/** The props of `+droplet.tsx`: `data` from the loads (a promise when mounted, the value otherwise) and the host's `children`. */
export type DropletProps<Data = unknown, Form = unknown> = {
  data: Data | Promise<Data>;
  /** After a form action, what it returned or `fail()`ed with; absent otherwise. */
  form?: Form;
  children?: Child;
};

/** The props of `+error.tsx`: the error out of `handleError` and the host's `children`. */
export type DropletErrorProps<Err = unknown> = { error: Err; children?: Child };

export type HonoJsxRendererOptions = {
  /**
   * Set to `false` to compile the components yourself. The server build
   * then needs `hono/jsx` as the JSX import source, and the browser build
   * `hono/jsx/dom`, with `hono/jsx` resolving to `hono/jsx/dom` there.
   */
  plugin?: boolean;
};

// `src/` and `dist/` both sit directly under the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The Hono JSX renderer, for `droplets({ renderers: [honoJsx()] })`. */
export function honoJsx(options: HonoJsxRendererOptions = {}): DropletRenderer {
  return {
    name: "hono-jsx",
    extensions: [".tsx", ".jsx"],
    // `hono/jsx`, not `hono`: the server side of every droplet runs on Hono.
    packages: ["hono/jsx", "@dropletsjs/renderer-hono-jsx"],
    componentTypes: "@dropletsjs/renderer-hono-jsx",
    // With React or Solid next to it, core says which `.tsx` modules are Hono's.
    ...(options.plugin === false ? {} : { plugins: (scope) => [honoJsxPlugin(scope.include)] }),
    server: resolve(packageRoot, "dist/server.js"),
    client: resolve(packageRoot, "dist/client.js"),
    clientDev: resolve(packageRoot, "dist/client-dev.js"),
  };
}
