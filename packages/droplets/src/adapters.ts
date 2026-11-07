import type { EnvironmentOptions } from "vite";
import type { ResolvedDropletsConfig } from "./core/config.ts";

/**
 * An adapter decides what `vite build` emits for the runtime that will host
 * the droplets server. The browser bundles and the SSR renderer are the same
 * everywhere; only the thin entry around them differs. Adapters live in their
 * own packages (`@dropletsjs/adapter-node`, `@dropletsjs/adapter-cloudflare`).
 */
export type DropletsAdapter = {
  /** Shown in build logs and error messages. */
  name: string;
  /**
   * Absolute path of the entry Vite bundles as the server. It imports
   * `virtual:droplets-config` for the user's config and either imports the
   * SSR bundle at runtime (Node) or inlines it via `virtual:droplets-ssr`
   * (Workers). `virtual:droplets-manifest` is the client manifest, as JSON.
   */
  serverEntry: string;
  /** File name of the emitted server bundle, inside the output directory. */
  serverFile: string;
  /**
   * Whether the SSR renderer is also emitted on its own as
   * `server/entry-server.js`. Node imports it at runtime; an adapter whose
   * entry inlines it can skip the extra bundle.
   */
  separateSsrBundle: boolean;
  /**
   * Bare specifiers to bundle into the server rather than import at runtime,
   * or `true` to bundle everything (for platforms without `node_modules`).
   */
  noExternal?: Array<string | RegExp> | true;
  /** Extra Vite options merged into the `server` build environment last. */
  environment?: EnvironmentOptions;
  /**
   * Runs once everything is built. Adapters use it to write the files their
   * platform expects next to the output, such as a wrangler config.
   */
  afterBuild?: (context: AdapterBuildContext) => void | Promise<void>;
  /**
   * Serves the build for `vite preview`. Without it, preview only warns.
   * Returns anything with a `fetch(request)` method, such as a Hono app.
   */
  preview?: (context: AdapterPreviewContext) => Promise<{ fetch: (request: Request) => Promise<Response> | Response }>;
};

export type AdapterBuildContext = {
  /** The Vite project root. */
  root: string;
  /** Where the build landed; `dist` unless `build.outDir` was changed. */
  outDir: string;
  /** Absolute path of the emitted `droplets.json`. */
  manifestPath: string;
  /** Absolute path of the emitted server bundle. */
  serverPath: string;
};

export type AdapterPreviewContext = {
  root: string;
  outDir: string;
  config: ResolvedDropletsConfig;
};
