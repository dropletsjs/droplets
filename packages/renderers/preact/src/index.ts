/**
 * `@dropletsjs/renderer-preact`: the Preact renderer.
 *
 * ```ts
 * // vite.config.ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { node } from "@dropletsjs/adapter-node";
 * import { preact } from "@dropletsjs/renderer-preact";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: node(), renderers: [preact()] })] });
 * ```
 *
 * `+droplet.tsx` and `+error.tsx` (or `.jsx`) default-export a Preact
 * component, compiled with Preact's automatic JSX runtime. Flags are named
 * exports of the component file: `export const prerender = true`. The
 * component receives `data` (droplet) or `error` (error page) and
 * `children`, a vnode that renders the children marker:
 * `<div>{children}</div>`.
 *
 * ```tsx
 * import { useState } from "preact/hooks";
 * import type { DropletProps } from "@dropletsjs/renderer-preact";
 *
 * export default function Hello({ data, children }: DropletProps<{ greeting: string }>) {
 *   const [clicks, setClicks] = useState(0);
 *   return <section><h1>{data.greeting}</h1><button onClick={() => setClicks(clicks + 1)}>{clicks}</button>{children}</section>;
 * }
 * ```
 *
 * The server renders with `renderToString` of `preact-render-to-string`;
 * the browser hydrates with `hydrate` (Preact adopts the server's nodes) or
 * mounts with `render`. `data` is always the value: when the element mounts
 * a droplet fresh, the renderer awaits its data first. Imported CSS reaches
 * the droplet's stylesheet through core's extraction.
 *
 * `.tsx` and `.jsx` are also React's, Solid's and Hono JSX's suffixes; next
 * to them, a component says it is Preact's by importing `preact` (or
 * `preact/hooks`, …) or with a `@jsxImportSource preact` comment, and the
 * renderer then compiles only the modules Preact droplets reach.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DropletRenderer } from "@dropletsjs/droplets";
import type { ComponentChildren } from "preact";
import { preactPlugin } from "./plugin.ts";

/** The props of `+droplet.tsx`: `data` from the loads (always the value) and the host's `children`. */
export type DropletProps<Data = unknown, Form = unknown> = {
  data: Data;
  /** After a form action, what it returned or `fail()`ed with; absent otherwise. */
  form?: Form;
  children?: ComponentChildren;
};

/** The props of `+error.tsx`: the error out of `handleError` and the host's `children`. */
export type DropletErrorProps<Err = unknown> = { error: Err; children?: ComponentChildren };

export type PreactRendererOptions = {
  /**
   * Set to `false` to compile the components yourself: they need Preact's
   * automatic JSX runtime (`jsxImportSource: "preact"`) on both sides.
   */
  plugin?: boolean;
};

// `src/` and `dist/` both sit directly under the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The Preact renderer, for `droplets({ renderers: [preact()] })`. */
export function preact({ plugin }: PreactRendererOptions = {}): DropletRenderer {
  return {
    name: "preact",
    extensions: [".tsx", ".jsx"],
    packages: ["preact", "preact-render-to-string", "@dropletsjs/renderer-preact"],
    componentTypes: "@dropletsjs/renderer-preact",
    // With React, Solid or Hono JSX next to it, core says which `.tsx` modules are Preact's.
    ...(plugin === false ? {} : { plugins: ({ include }) => [preactPlugin({ include })] }),
    server: resolve(packageRoot, "dist/server.js"),
    client: resolve(packageRoot, "dist/client.js"),
    clientDev: resolve(packageRoot, "dist/client-dev.js"),
  };
}
