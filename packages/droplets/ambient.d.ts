/**
 * Ambient types for droplet authors and adapter authors. Add to your tsconfig:
 *
 *   "compilerOptions": { "types": ["@dropletsjs/droplets/ambient"] }
 */

/** Where the code runs. Anywhere. */
declare module "$droplets/env" {
  /** `true` in the browser, `false` on the server. */
  export const browser: boolean;
  /** `true` under `vite dev`. */
  export const dev: boolean;
  /**
   * `true` while `vite build` prerenders droplets: requests are internal, and
   * `host` in load events is the entry's host, or a stand-in whose fields
   * other than `origin`, `pathname` and `href` stop the build. `cookies`
   * stop it too: guard them in `handle` with this flag.
   */
  export const building: boolean;
}

/**
 * Variables declared with `public: true` in `src/env.ts`: inlined at build
 * when `static`, else read at runtime (the server hands them to the page
 * as `/env.js`, which `/index.js` imports). Anywhere. Typed once the declaration is registered
 * (see `defineEnvVars`).
 */
declare module "$droplets/env/public" {
  export const env: import("@dropletsjs/droplets/env").PublicEnv;
}

/**
 * The droplets server as the browser reaches it. Anywhere: components,
 * plain modules, loads.
 *
 * ```ts
 * import { droplet } from "$droplets/drop";
 * const response = await fetch(droplet.url("/api/counter"));
 * ```
 */
declare module "$droplets/drop" {
  export const droplet: {
    /**
     * Where the page loads the droplets from (the URL it loaded `/index.js`
     * from), or on the server the request's droplet location (`location` of
     * the config, else a trusted `x-droplet-location` or forwarded header,
     * else the request's own origin). May carry a path when a proxy serves
     * the droplets under one. On the server outside a request: `location`
     * when the config sets it, else the bundle's location token, which
     * every fragment and its data replace with the request's location.
     */
    readonly origin: string;
    /** `path` on the droplets server; a relative `fetch("/api/…")` would go to the host page. */
    url(path: string): string;
  };
  export default droplet;
}

/**
 * Where a droplet's forms post, and their opt-in progressive enhancement.
 *
 * ```ts
 * import { actionUrl, enhanceDropletForm } from "$droplets/form";
 * import type { DropletActions } from "./$types";
 *
 * const url = actionUrl<DropletActions>("add"); // https://drops.example/droplets/cart?/add
 * const stop = enhanceDropletForm<DropletActions>(form, { action: "add" });
 * ```
 */
declare module "$droplets/form" {
  export type {
    ActionEnhanceOptions,
    ActionMap,
    ActionName,
    AnyEnhanceOptions,
    DropletActionDetail,
    EnhanceOptions,
    EnhanceResult,
    EnhanceSubmit,
  } from "@dropletsjs/droplets/enhance";
  export { enhanceDropletForm } from "@dropletsjs/droplets/enhance";
  export type ActionUrlOptions = {
    /** The droplet; the one rendering when absent. Required outside a render. */
    droplet?: string;
    /** Its props (strings, numbers and booleans travel in the URL); the rendering droplet's when absent. */
    props?: Record<string, unknown>;
  };
  type ActionUrlArgs<A extends import("@dropletsjs/droplets/enhance").ActionMap> = "default" extends keyof A
    ? [name?: import("@dropletsjs/droplets/enhance").ActionName<A>, options?: ActionUrlOptions]
    : [name: import("@dropletsjs/droplets/enhance").ActionName<A>, options?: ActionUrlOptions];
  /**
   * `${location}/droplets/<id>?/<name>`: the action `name` (`default`
   * without one) of the droplet rendering now, on the droplets server's
   * location (the request's resolved location on the server, the
   * URL `/index.js` came from in the browser); the same string on the
   * server, at build and in the browser. With `DropletActions` of
   * `./$types` it takes only the names `actions` exports. Throws outside a
   * render without `{ droplet }`, and for a name `actions` cannot export.
   */
  export function actionUrl<A extends import("@dropletsjs/droplets/enhance").ActionMap = import("@dropletsjs/droplets/enhance").ActionMap>(
    ...args: ActionUrlArgs<A>
  ): string;
  export default actionUrl;
}

/**
 * Every other variable declared in `src/env.ts`. Server code only: importing
 * it from code that reaches the browser fails the build.
 */
declare module "$droplets/env/private" {
  export const env: import("@dropletsjs/droplets/env").PrivateEnv;
}

/**
 * Server-only helpers: request events, the `handle` hook type, `json()`,
 * `text()`, `error()`, `redirect()`, `sequence()`. Importing this from code
 * that reaches the browser fails the build.
 */
declare module "$droplets/server" {
  export * from "@dropletsjs/droplets/server";
}

/** The project's `droplets.config.ts` default export, bundled into the server: a function is called with the build's config env, so this may be its promise. */
declare module "virtual:droplets-config" {
  const userConfig: import("@dropletsjs/droplets").DropletsConfig | Promise<import("@dropletsjs/droplets").DropletsConfig>;
  export default userConfig;
  export const tokens: import("@dropletsjs/droplets").SsrModule["tokens"];
}

/** The SSR renderer, for adapter entries that inline it. */
declare module "virtual:droplets-ssr" {
  export const renderDroplet: import("@dropletsjs/droplets").SsrModule["renderDroplet"];
  export const getDropletMeta: import("@dropletsjs/droplets").SsrModule["getDropletMeta"];
  export const loadDropletData: import("@dropletsjs/droplets").SsrModule["loadDropletData"];
  export const getHandle: import("@dropletsjs/droplets").SsrModule["getHandle"];
  export const matchApi: import("@dropletsjs/droplets").SsrModule["matchApi"];
  export const renderError: import("@dropletsjs/droplets").SsrModule["renderError"];
  export const getImportMap: import("@dropletsjs/droplets").SsrModule["getImportMap"];
  export const getHandleError: import("@dropletsjs/droplets").SsrModule["getHandleError"];
  export const validateDropletProps: import("@dropletsjs/droplets").SsrModule["validateDropletProps"];
  export const transformDroplet: import("@dropletsjs/droplets").SsrModule["transformDroplet"];
  export const getEntries: import("@dropletsjs/droplets").SsrModule["getEntries"];
  export const prerenderKeys: import("@dropletsjs/droplets").SsrModule["prerenderKeys"];
  export const publicEnv: import("@dropletsjs/droplets").SsrModule["publicEnv"];
  export const findAction: import("@dropletsjs/droplets").SsrModule["findAction"];
  export const tokenNonce: import("@dropletsjs/droplets").SsrModule["tokenNonce"];
  export const tokens: import("@dropletsjs/droplets").SsrModule["tokens"];
}

/** `dist/client/droplets.json`, for adapter entries that bundle it. */
declare module "virtual:droplets-manifest" {
  const manifest: import("@dropletsjs/droplets").DropletsManifest;
  export default manifest;
}
