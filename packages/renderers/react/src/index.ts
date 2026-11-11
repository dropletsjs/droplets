/**
 * `@dropletsjs/renderer-react`: the React 19 renderer.
 *
 * ```ts
 * // vite.config.ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { node } from "@dropletsjs/adapter-node";
 * import { react } from "@dropletsjs/renderer-react";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: node(), renderers: [react()] })] });
 * ```
 *
 * `+droplet.tsx` and `+error.tsx` (or `.jsx`) default-export a React
 * component, compiled by `@vitejs/plugin-react`. Flags are named exports of
 * the component file: `export const prerender = true`. The component
 * receives `data` (droplet) or `error` (error page) and `children`, a React
 * element that renders the children marker: `<div>{children}</div>`.
 *
 * ```tsx
 * import type { DropletProps } from "@dropletsjs/renderer-react";
 *
 * export const prerender = true;
 *
 * export default function Hello({ data, children }: DropletProps<{ greeting: string }>) {
 *   return <section><h1>{data.greeting}</h1>{children}</section>;
 * }
 * ```
 *
 * The server renders with `renderToString`; the browser hydrates with
 * `hydrateRoot` (the host's container leaves the server-rendered marker
 * while React compares the DOM and comes back once it is committed) or
 * mounts with `createRoot`. Imported CSS reaches the droplet's stylesheet through
 * core's extraction. In `vite dev`, React Fast Refresh works on the host's
 * page too: the renderer installs its preamble itself. It compiles React's
 * modules alone, never a Vue `<script lang="ts">` next to them.
 *
 * `.tsx` and `.jsx` are also Solid's, Preact's and Hono JSX's suffixes; next
 * to them, a component is React's when it imports `react` or names it in a
 * `@jsxImportSource` comment.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import reactPlugin, { type Options } from "@vitejs/plugin-react";
import type { DropletRenderer } from "@dropletsjs/droplets";
import type { ReactNode } from "react";
import { reactRefreshPlugin } from "./refresh.ts";

/** The props of `+droplet.tsx`: `data` from the loads (a promise when mounted, the value when hydrated) and the host's `children`. */
export type DropletProps<Data = unknown, Form = unknown> = {
  data: Data | Promise<Data>;
  /** After a form action, what it returned or `fail()`ed with; absent otherwise. */
  form?: Form;
  children?: ReactNode;
};

/** The props of `+error.tsx`: the error out of `handleError` and the host's `children`. */
export type DropletErrorProps<Err = unknown> = { error: Err; children?: ReactNode };

export type ReactRendererOptions = {
  /**
   * Set to `false` to add `@vitejs/plugin-react` to your Vite config
   * yourself. The renderer still needs it there: its Fast Refresh preamble
   * comes from the plugin.
   */
  plugin?: boolean;
  /** Options passed to `@vitejs/plugin-react`. */
  vitePlugin?: Options;
};

// `src/` and `dist/` both sit directly under the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The React renderer, for `droplets({ renderers: [react()] })`. */
export function react({ plugin, vitePlugin }: ReactRendererOptions = {}): DropletRenderer {
  return {
    name: "react",
    extensions: [".tsx", ".jsx"],
    packages: ["react", "react-dom", "@dropletsjs/renderer-react"],
    componentTypes: "@dropletsjs/renderer-react",
    // With Solid, Preact or Hono JSX next to it, core says which `.tsx`
    // modules are React's, and they compile for `react` whatever JSX source
    // tsconfig.json names (a project that started with Preact says `preact`).
    // Fast Refresh compiles those alone: never another renderer's modules.
    ...(plugin === false
      ? {}
      : {
          plugins: ({ include }) => [
            reactPlugin({
              ...(include ? { jsxImportSource: "react" } : {}),
              ...vitePlugin,
              ...(include ? { include } : {}),
            }),
            reactRefreshPlugin({ vitePlugin, include }),
          ],
        }),
    server: resolve(packageRoot, "dist/server.js"),
    client: resolve(packageRoot, "dist/client.js"),
    clientDev: resolve(packageRoot, "dist/client-dev.js"),
    // Fast Refresh's preamble, and the flags it should ignore, once per page.
    clientSetup: resolve(packageRoot, "dist/client-setup.js"),
  };
}
