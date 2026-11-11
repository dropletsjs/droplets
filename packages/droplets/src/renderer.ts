/**
 * The renderer contract: how a UI engine (Svelte, Vue, Solid, React, Preact,
 * Handlebars, Lit, …) plugs into Droplets. Core knows nothing about components;
 * it discovers files, runs loads, serves HTTP and hosts the custom element.
 * A renderer compiles the component files and renders them, on the server
 * and in the browser.
 *
 * This file is the whole contract. Everything core expects from a renderer
 * package is described here, with the Svelte renderer
 * (`@dropletsjs/renderer-svelte`) and the tiny fake renderer in
 * `@dropletsjs/droplets/testing` as the two reference implementations.
 *
 * ## What core does
 *
 * - Scans `<dropletsFolder>/<name>/` for `+droplet.<ext>` and `+error.<ext>`
 *   and picks the renderer whose `extensions` contain `<ext>`. One folder is
 *   one droplet; its id is the folder name, lowercase kebab-case. The error page is
 *   in the droplet's framework; one in another framework is ignored.
 * - Reads the build-time flags of each component (`ssr`, `hydrate`,
 *   `prerender`) through {@link DropletRenderer.readFlags}, or from the
 *   component's top-level `export const <flag> = <literal>` declarations
 *   when the renderer has no reader. Flags live in the component only: one
 *   exported from `+droplet.ts` or `+droplet.server.ts` is ignored.
 * - Runs the load chain on the server: `+droplet.server.ts` (`load`,
 *   `handleError`, `entries`, `transform`), then `+droplet.ts` (`props`
 *   schema, `load`, `handleError`), then asks the renderer's
 *   {@link RendererServerModule.render} for HTML. The result is wrapped in
 *   the custom element with the inline payloads (`data-droplet-data`,
 *   `data-droplet-context`) and served as the fragment at `/droplets/<id>`.
 * - Builds one browser bundle per droplet (`/droplets/<id>/client.js`),
 *   generated from a template that imports the component, the
 *   `+droplet.ts` module and the renderer's {@link RendererClientModule}.
 *   The custom element (core's `entry-client`) imports it on demand, runs the
 *   browser side of the load chain, and calls the module's `default` export
 *   with the host callbacks for `children`.
 * - Extracts the CSS the client build produces per droplet and serves it at
 *   `/droplets/<id>/style.css`; prerenders at build time; handles HMR.
 * - Runs script droplets itself: a `+droplet.script.ts` (or `.js`) is
 *   plain browser code, called with `(data, el)` once the element
 *   connects, and renders nothing on the server. Its renderer is built in
 *   (`script`, in `src/script/`), so `.script.ts` and `.script.js` are core's.
 *
 * ## What a renderer does
 *
 * - Supplies the Vite plugins that compile its component files, for every
 *   Vite environment core builds: `client` (browser, hydratable), `ssr` (the
 *   server renderer bundle), `server` (the adapter's entry; it may inline the
 *   SSR bundle, so it compiles components too) and the dev server. Vite 8
 *   runs plugins per environment; a plugin whose output differs between
 *   browser and server (Solid's `vite-plugin-solid`, for instance) must look
 *   at the environment, not at `vite build` vs `vite dev`.
 * - Renders a component to HTML on the server with `{ data }` (droplet) or
 *   `{ error }` (error page) plus a `children` value that outputs the
 *   marker `<div data-droplet-children style="display: contents"></div>` where
 *   the component renders its children.
 * - Mounts or hydrates a component in the browser with the same props, where
 *   `children` renders the same marker in light DOM and reports it to the
 *   host through {@link DropletChildrenHost}: `fill(marker)` once the marker
 *   is in the document, `empty(marker)` before it goes away. The host moves
 *   its children's container into the marker and back out.
 * - Unmounts an instance it mounted or hydrated.
 *
 * ## Children, in detail
 *
 * A host puts its children in one container, a direct child of the element:
 * `<djs-droplet data-droplet="hello"><div data-droplet-slot>…children…</div></djs-droplet>`,
 * in the page or appended to a fetched fragment. The element's direct
 * children are exactly that container, the payload scripts and the content
 * root; anything else is removed at connect. The component receives a
 * `children` value and renders it where it wants the host's content:
 *
 * - On the server, `children` must produce one empty element carrying
 *   `data-droplet-children` and `style="display: contents"`, the marker. Nothing
 *   else, in particular no text: the element finds it by the attribute.
 * - In the browser, `children` must render the same marker (light DOM, not
 *   shadow DOM) and call `context.children.fill(marker)` once it is connected
 *   and `context.children.empty(marker)` before it is removed. `fill` moves
 *   the host's container into the marker and shows it (with `moveBefore`, so
 *   nested droplets and iframes keep their state); `empty` moves it back
 *   under the element, hidden. Hide, never remove: when a component's `if`
 *   stops rendering its children, the container stays in the document.
 *   Calling `fill` on a marker that is not yet connected is fine: core waits
 *   for it.
 * - `empty` must run while the marker is still in the document, so the move
 *   keeps the container alive: React's layout-effect cleanup, Vue's
 *   `onBeforeUnmount` and Solid's `onCleanup` all run before the engine
 *   removes the DOM. Svelte 5 removes first, so the Svelte renderer puts an
 *   `out:` transition of zero duration on the marker, which runs before the
 *   removal, also when an ancestor block goes (`|global`). A renderer that
 *   rewrites the DOM itself (Handlebars) calls `empty` before it does.
 * - Around hydration, core does the moving: the server rendered the marker
 *   and the element put the container in it at connect, so the children show
 *   before the bundle loads; right before `hydrate()` core moves the
 *   container back out, the engine adopts an empty marker, and `fill` from
 *   the mounted hook puts it back, all in one task. `context.markers()`
 *   lists the server-rendered markers for engines that adopt nodes by hand.
 *   Before `unmount()` core empties every filled marker itself.
 *
 * ## Flags
 *
 * `ssr` (default `true`), `hydrate` (default `true`) and `prerender`
 * (default `false`) decide how a droplet is built and served; `hydrate` may
 * also be `"visible"` or `"interactive"` (see {@link HydrateMode}), and a
 * host overrides it per element with `data-hydrate`. They live in the
 * component file and nowhere else; core reads them before anything is
 * compiled. A component that is a module (`.tsx`, `.lit.ts`) is parsed and
 * its top-level `export const ssr = false` style declarations are read; a
 * flag in a comment or a string is none. A renderer whose component keeps
 * its module code in a block implements {@link DropletRenderer.readFlags}
 * and passes the block to `readExportedFlags` from
 * `@dropletsjs/droplets/vite` (Svelte's `<script module>`, Vue's plain
 * `<script>`); one whose component cannot carry exports reads its own syntax
 * (Handlebars: the comment a template opens with). A flag exported from
 * `+droplet.ts` or `+droplet.server.ts` is ignored. The
 * error page has none of its own: it is the droplet's error boundary and
 * follows the droplet's flags; core ignores any it declares, with a warning
 * in dev.
 *
 * ## CSS
 *
 * Whatever CSS the component's module graph produces in the client build
 * (a `<style>` block in a single-file component, an imported `.css` file,
 * CSS modules) is extracted per droplet by core and served at
 * `/droplets/<id>/style.css`; the custom element adds one `<link>` per
 * droplet per page. In `vite dev`, Vite injects the styles when the client
 * module loads. A droplet with `hydrate = false` still goes through the
 * client build so its CSS is extracted; its JavaScript is then dropped.
 *
 * The one exception is the error page: it renders when something went wrong,
 * possibly instead of a droplet whose stylesheet was never requested, so its
 * styles should travel with its markup. Svelte compiles `+error.svelte` with
 * `css: "injected"` and returns the `<style>` in {@link ServerRenderOutput.head};
 * core places `head` before the markup, inside the element. A renderer with
 * no such option can leave it out.
 *
 * ## Once per page, once per fragment
 *
 * - {@link DropletRenderer.clientSetup}: a module imported for its side
 *   effects by every droplet client module of that renderer, before any
 *   mount. Modules are singletons per page, so it runs once per page per
 *   origin; make it idempotent all the same (guard on `globalThis`). This is
 *   where Solid's hydration bootstrap goes (`window._$HY`), in code rather
 *   than as a `<script>` the host would have to include.
 * - {@link ServerRenderOutput.head}: HTML placed before the component's
 *   markup inside the element, once per fragment. Styles, or a `<script>`
 *   for hosts that insert fragments on the server (it will not run when a
 *   host inserts the fragment with `innerHTML`, so never rely on it alone).
 *
 * ## Hydration ids
 *
 * Core generates a short random `renderId` for every server render and hands
 * it to {@link RendererServerModule.render}; the fragment carries it as a
 * `data-render-id` attribute on the element, and the browser receives it in
 * {@link ClientRenderContext.renderId} when hydrating (a fresh one when
 * mounting). Engines that key hydration by an id (Solid's `renderId`) use it
 * on both sides so several droplets on one page never share keys. Note that
 * a prerendered droplet carries the id of its build-time render, so two
 * copies of the same prerendered droplet on one page share it.
 *
 * ## Form actions
 *
 * Both contexts carry `actionUrl(name?)`: the URL a form posts to for the
 * droplet's action `name` (`default` without one), on the droplets
 * server's location; the same string on the server, at build and in the
 * browser. Components use `actionUrl()` of `$droplets/form`; a template
 * engine offers the context's to its templates (`{{action}}`). A renderer
 * may export, from its `./form` module, its engine's way of applying
 * `enhanceDropletForm` of `@dropletsjs/droplets/enhance` to a form (an
 * action, a hook, a directive): progressive enhancement is opt-in, per
 * form, and never the renderer's to apply on its own.
 *
 * ## HMR
 *
 * In `vite dev`, what a page does when a droplet's files change is
 * `dev.strategy`. Under `"hmr"`, the default:
 *
 * - An edit to a component (or what it imports) goes through Vite's own
 *   HMR, so the renderer's plugins hot-swap it as their framework does
 *   (`vite-plugin-svelte`, `@vitejs/plugin-vue`, `vite-plugin-solid`, React
 *   Fast Refresh, Prefresh). Each droplet's client module accepts its
 *   component and error page as a last resort: an edit no framework module
 *   takes stops there, and the element remounts the droplet in place (as
 *   `"remount"` does) rather than reloading the page. A renderer without
 *   HMR therefore needs nothing.
 * - An edit to a load (`+droplet.server.ts`, `+droplet.ts`, or a server
 *   file they import) runs the loads again and hands the live instance the
 *   new data through {@link RendererClientDevModule.update}, which keeps
 *   the component's state; without it, the element remounts.
 * - A change of `ssr`, `hydrate` or `prerender` never reaches the page's
 *   instance: the element says so, and hydrates live when `hydrate` turns on.
 *
 * Under `"remount"` the element re-imports the droplet's client module with
 * a cache-busting query, refetches its data, calls
 * {@link RendererClientModule.unmount} on the old instance and
 * {@link RendererClientModule.mount} (or `hydrate`) for the new one.
 *
 * A renderer's compile settings for HMR (a refresh transform, its runtime)
 * stay in its own plugins' transforms, as with every compile setting: see
 * {@link DropletRenderer.plugins}.
 *
 * ## Example: a minimal renderer
 *
 * A fictional engine where a component module exports
 * `default(props) => string` and, optionally, `attach(element, props) => cleanup`.
 * This is what `@dropletsjs/droplets/testing` ships as `fakeRenderer()`.
 *
 * ```ts
 * // index.ts — the factory the user calls in vite.config.ts
 * import { fileURLToPath } from "node:url";
 * import type { DropletRenderer } from "@dropletsjs/droplets";
 *
 * const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
 *
 * export function fake(): DropletRenderer {
 *   return {
 *     name: "fake",
 *     extensions: [".fake.js"],
 *     // No Vite plugin: the files are plain JavaScript.
 *     server: here("./server.js"),
 *     client: here("./client.js"),
 *   };
 * }
 *
 * const MARKER = '<div data-droplet-children style="display: contents"></div>';
 *
 * // server.ts — `RendererServerModule`
 * export function render(module, props) {
 *   return module.default({ ...props, children: () => MARKER });
 * }
 *
 * // client.ts — `RendererClientModule`
 * function attach(module, target, props, context) {
 *   const marker = target.querySelector("[data-droplet-children]");
 *   if (marker) context.children.fill(marker);
 *   const cleanup = module.attach?.(target, props);
 *   return { cleanup, marker, target, context };
 * }
 * export function mount(module, target, props, context) {
 *   target.innerHTML = module.default({ ...props, children: () => MARKER });
 *   return attach(module, target, props, context);
 * }
 * export function hydrate(module, target, props, context) {
 *   // The server HTML stays; only behaviour is added.
 *   return attach(module, target, props, context);
 * }
 * export function unmount(instance) {
 *   instance.cleanup?.();
 *   if (instance.marker) instance.context.children.empty(instance.marker);
 *   instance.target.replaceChildren();
 * }
 * ```
 *
 * Usage, once published:
 *
 * ```ts
 * // vite.config.ts
 * import { droplets } from "@dropletsjs/droplets/vite";
 * import { node } from "@dropletsjs/adapter-node";
 * import { fake } from "@dropletsjs/renderer-fake";
 *
 * export default defineConfig({ plugins: [droplets({ adapter: node(), renderers: [fake()] })] });
 * ```
 *
 * ## Testing a renderer
 *
 * `@dropletsjs/droplets/testing` exports `rendererConformance()`, a vitest
 * suite that builds a small fixture app with the renderer and checks every
 * scenario above over HTTP and in happy-dom. See its documentation for the
 * fixture layout; `packages/renderers/svelte/test` is a complete example.
 *
 * @module
 */
import type { PluginOption } from "vite";
import type { ActionUrl } from "./runtime/form.ts";

export type { ActionUrl } from "./runtime/form.ts";

type MaybePromise<T> = T | Promise<T>;

/**
 * When a droplet comes alive in the browser: `true` at once, `"visible"` as
 * it is about to scroll into view, `"interactive"` on the first pointer,
 * focus or key event on its server markup, `false` never (no bundle).
 */
export type HydrateMode = boolean | "visible" | "interactive";

/** How a component renders: read from its source before it is compiled. */
export type RenderFlags = {
  /** Render on the server. Default `true`. */
  ssr: boolean;
  /** Ship a browser bundle and hydrate (or mount), and when: see {@link HydrateMode}. Default `true`. */
  hydrate: HydrateMode;
  /** Render at build time for the prop sets `entries` lists. Default `false`. */
  prerender: boolean;
};

/** Which of the two components of a droplet is being handled. */
export type ComponentKind = "droplet" | "error";

/** What {@link DropletRenderer.readFlags} receives. */
export type ReadFlagsInput = {
  kind: ComponentKind;
  /** The component file's text. */
  source: string;
  /** The component's file name inside the droplet folder, e.g. `+droplet.vue`. */
  file: string;
  /** Absolute path of the droplet folder. */
  folder: string;
  /** The droplet id, for messages. */
  droplet: string;
};

/**
 * A component module as the renderer's Vite plugin compiled it: the module
 * namespace, with the component itself normally as `default`. Flags and
 * other exports of the file are there too.
 */
export type ComponentModule = { default?: unknown } & Record<string, unknown>;

/**
 * The props core renders a component with: `data` for a droplet, with
 * `form` after a form action (the action's data; absent otherwise), `error`
 * for an error page. Pass them on as they are: a key that is absent stays
 * absent.
 */
export type RenderProps = { data: unknown; form?: unknown } | { error: unknown };

/** What the server knows about one render. */
export type ServerRenderContext = {
  droplet: string;
  kind: ComponentKind;
  /** Unique per render; the browser gets the same value when hydrating. */
  renderId: string;
  /**
   * The URL of the droplet's form action `name` (`default` without one):
   * `${location}/droplets/<id>?/<name>`, on the request's public
   * location (a trusted location header, else the request's origin; a token
   * replaced per request at build). See "Form actions" above.
   */
  actionUrl: ActionUrl;
};

/**
 * HTML, or HTML with a `head` that core places before it inside the
 * element: styles that must travel with the markup, or a bootstrap snippet.
 * Never a document `<head>`: fragments have none.
 */
export type ServerRenderOutput = string | { html: string; head?: string };

/**
 * What {@link DropletRenderer.server} exports. Runs inside the SSR bundle:
 * on Node, on Workers, anywhere the adapter targets. No Node APIs.
 */
export type RendererServerModule = {
  /**
   * Renders `module`'s component with `props` plus a `children` value that
   * outputs the marker `<div data-droplet-children style="display: contents"></div>`.
   * May be async (top-level `await` in components, streaming engines
   * collected to a string).
   */
  render(module: ComponentModule, props: RenderProps, context: ServerRenderContext): MaybePromise<ServerRenderOutput>;
};

/**
 * The element's callbacks for the `children` value of a component. The
 * renderer calls them on the `[data-droplet-children]` marker its `children`
 * renders.
 */
export type DropletChildrenHost = {
  /** The marker is in the DOM (or about to be): the host's container goes in, shown. */
  fill: (marker: Element) => void;
  /** The marker is about to go, and is still in the DOM: the container comes back out, hidden. */
  empty: (marker: Element) => void;
};

/** What the browser knows about one mount or hydration. */
export type ClientRenderContext = {
  droplet: string;
  kind: ComponentKind;
  /** Where the host's children go: see the module documentation. */
  children: DropletChildrenHost;
  /** The server's id when hydrating, a fresh one when mounting. */
  renderId: string;
  /**
   * The URL of the droplet's form action `name`, on the location the page
   * loaded `/index.js` from. See "Form actions" above.
   */
  actionUrl: ActionUrl;
  /**
   * Runs `render` as this render: `actionUrl()` of `$droplets/form` knows
   * the droplet while it runs. `mount` and `hydrate` already run so; an
   * engine that renders only after an `await` (the `data` it waits for)
   * runs that render inside this. Absent where nothing calls it.
   */
  rendering?: <T>(render: () => T) => T;
  /**
   * The markers the server rendered for this component, in document order,
   * excluding those of droplets nested inside; empty when mounting. They are
   * empty elements by the time `hydrate` runs: core took the host's
   * container out. For engines that adopt server nodes by hand.
   */
  markers(): Element[];
  /**
   * Set when `mount` renders a droplet that has an error page, which is
   * when its `data` is a promise still to settle. The renderer puts the
   * component under its engine's error boundary (`<svelte:boundary>`, a
   * React error boundary, `onErrorCaptured`, Solid's `<ErrorBoundary>`):
   * what fails to render, a rejected `data` the component awaits included,
   * is replaced by `module` with `{ error: await handle(error), children }`.
   * When `handle` rejects there is nothing to show: render nothing. Errors
   * the component handles itself, or that never reach rendering (a promise
   * it ignores), are not the boundary's.
   */
  error?: {
    /** The droplet's `+error.*`, in the same framework. */
    module: ComponentModule;
    /** `handleError` of `+droplet.ts`: what the error page receives as `error`. */
    handle(error: unknown): Promise<unknown>;
  };
};

/**
 * What {@link DropletRenderer.client} exports. Bundled into every droplet's
 * browser entry, so it must be browser code with no Node APIs.
 */
export type RendererClientModule = {
  /**
   * Renders into an empty `target` and returns an instance handle, which
   * core keeps opaque and hands back to `unmount`. May return a promise:
   * core awaits it, and treats the droplet as live (replaying the clicks it
   * held meanwhile) only once the handle is there. A droplet's `data` is a
   * promise here (client-only, refreshed, re-mounted): the component
   * decides how to wait for it. An engine whose components cannot (a
   * template) awaits it before rendering.
   */
  mount(module: ComponentModule, target: HTMLElement, props: RenderProps, context: ClientRenderContext): MaybePromise<unknown>;
  /**
   * Like `mount`, but `target` holds the markup the server rendered (and,
   * for an error page, the `head` the renderer returned), and `data` is
   * the value the server rendered with. The engine adopts
   * it rather than replacing it; an engine without hydration keeps the HTML
   * and attaches what behaviour it can.
   */
  hydrate(module: ComponentModule, target: HTMLElement, props: RenderProps, context: ClientRenderContext): MaybePromise<unknown>;
  /** Tears down what `mount` or `hydrate` returned. Core empties the markers itself first. */
  unmount(instance: unknown): void | Promise<void>;
};

/**
 * What {@link DropletRenderer.clientDev} exports: hooks for `vite dev` that
 * a production build never contains.
 */
export type RendererClientDevModule = {
  /**
   * Renders a live instance (what `mount` or `hydrate` returned) with new
   * props, keeping it and its state: the component sees the new `data`
   * (and `form`) as a parent's new props. `data` has the same shape as the
   * instance started with: the value for a hydrated instance, a promise
   * (already settled, with React's `status` and `value` set) for a mounted
   * one. This is how a load edit reaches the page under `vite dev`. Return
   * `false` when this instance cannot take them (an error page is showing,
   * say): core then remounts, as it does for a renderer without `update`.
   */
  update(instance: unknown, props: RenderProps): MaybePromise<boolean | void>;
};

/**
 * One UI engine. Created by a factory the user calls in `vite.config.ts`:
 * `droplets({ renderers: [svelte(), vue()] })`.
 */
export type DropletRenderer = {
  /** Unique among the configured renderers; shown in errors and the devtools. */
  name: string;
  /**
   * File suffixes after `+droplet` / `+error`, with the dot: `[".svelte"]`,
   * `[".vue"]`, `[".tsx", ".jsx"]`, `[".hbs"]`. Two renderers may claim the
   * same suffix only when both list their {@link DropletRenderer.packages}
   * (React and Solid both take `.tsx`). `.ts`, `.js`, `.server.ts` and
   * `.server.js` are core's own (`+droplet.ts`, `+droplet.server.ts`), and
   * so are `.script.ts` and `.script.js` (script droplets, built in): none
   * can be claimed.
   */
  extensions: string[];
  /**
   * The engine's own packages, and the renderer package itself:
   * `["react", "react-dom", "@dropletsjs/renderer-react"]`. An
   * entry may name a subpath when the engine is part of a larger package:
   * `"hono/jsx"` owns `hono/jsx/*`, not the rest of `hono`. A droplet of
   * another renderer that imports one of them, directly or through a shared
   * module, fails the build. When two renderers claim one
   * extension, a component goes to the renderer whose package it imports
   * (or names in a `@jsxImportSource` comment).
   */
  packages?: string[];
  /**
   * Suffixes of other files that belong to the engine, beyond its component
   * extensions: `[".svelte.ts", ".svelte.js"]` for Svelte's rune modules. A
   * droplet of another renderer that imports one fails the build.
   */
  suffixes?: string[];
  /**
   * The module whose `DropletProps<Data>` and `DropletErrorProps<Err>` types
   * a component takes, with the framework's own `children`: what the
   * generated `./$types` hands each droplet of this renderer. Without it,
   * the framework-neutral ones from `@dropletsjs/droplets`.
   */
  componentTypes?: string;
  /**
   * Vite plugins that compile the component files, added to the user's Vite
   * config by core. Created once, when `droplets()` is called; they run in
   * every environment (`client`, `ssr`, `server`, and the dev server).
   *
   * A function receives a {@link RendererScope}: when another renderer
   * claims one of this renderer's extensions, `scope.include` matches the
   * modules this renderer must compile, and the plugins must leave every
   * other module alone (pass it as the plugin's `include`).
   *
   * Whatever a renderer compiles with its own settings stays in its own
   * transform: a plugin that switches on a JSX setting in Vite's shared
   * `oxc` options reaches every other compiler that reads them (React's Fast
   * Refresh did, in Vue's `<script lang="ts">`). Compile the renderer's
   * modules with explicit options instead, as the Hono JSX and Preact plugins
   * and React's Fast Refresh do.
   */
  plugins?: PluginOption[] | ((scope: RendererScope) => PluginOption[]);
  /**
   * Absolute path of a module exporting {@link RendererServerModule}. Core
   * imports it by path from the generated server registry, so it is bundled
   * with the SSR renderer; it may import the engine's packages.
   */
  server: string;
  /**
   * Absolute path of a module exporting {@link RendererClientModule}. Core
   * imports it by path from every generated droplet client module.
   */
  client: string;
  /**
   * Absolute path of a module imported for its side effects by every droplet
   * client module of this renderer, before anything renders. Once per page.
   */
  clientSetup?: string;
  /**
   * Absolute path of a module exporting {@link RendererClientDevModule},
   * imported next to {@link DropletRenderer.client} under `vite dev` and in
   * builds that are not for production (`NODE_ENV` other than
   * `production`, as under vitest); a production build leaves it out. It
   * may import the client module for what both need.
   */
  clientDev?: string;
  /**
   * Reads the build-time flags of a component from its source. Return only
   * the flags the file declares; core fills in the defaults. Without it,
   * core parses the component as a module and reads its top-level
   * `export const` flags.
   */
  readFlags?: (input: ReadFlagsInput) => MaybePromise<Partial<RenderFlags> | undefined>;
};

/**
 * What a {@link DropletRenderer.plugins} function receives. Two renderers
 * that claim one extension (React and Solid, `.tsx`) cannot both compile
 * every such file: core then marks each module reached from a droplet with
 * that droplet's renderer (a `?droplets-renderer=<name>` query), so a shared
 * `lib/Button.tsx` is compiled once per renderer that uses it.
 */
export type RendererScope = {
  /**
   * Set when another renderer claims one of this renderer's extensions:
   * matches the ids of the modules this renderer compiles. Unset, the
   * renderer compiles every file with its extensions, as usual.
   */
  include?: RegExp;
};

/** The query core marks a module with, when renderers share an extension. */
export const RENDERER_QUERY = "droplets-renderer";

/** Ids marked for `name`: `…/Button.tsx?droplets-renderer=solid`. */
export function rendererScopeFilter(name: string): RegExp {
  return new RegExp(`[?&]${RENDERER_QUERY}=${escapeRegExp({ text: name })}(?:&|$)`);
}

/** Identity helper, for type checking and completion in a renderer package. */
export function defineRenderer(renderer: DropletRenderer): DropletRenderer {
  return renderer;
}

/** `true`, `false`, or `"visible"`/`"interactive"` in either quotes; `undefined` for anything else. */
export function parseHydrateMode(value: string): HydrateMode | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  const quoted = value.match(/^(["'])(visible|interactive)\1$/);
  return quoted ? (quoted[2] as "visible" | "interactive") : undefined;
}

/** The defaults over what a reader returned. */
export function withFlagDefaults(flags: Partial<RenderFlags> | undefined): RenderFlags {
  return {
    ssr: flags?.ssr ?? true,
    hydrate: flags?.hydrate ?? true,
    prerender: flags?.prerender ?? false,
  };
}

/** Suffixes core owns next to a component; never a renderer's. */
export const CORE_SUFFIXES = new Set([".ts", ".js", ".server.ts", ".server.js", ".d.ts"]);

/**
 * The built-in renderer of script droplets: a `+droplet.script.ts` (or
 * `.js`) whose default export runs in the browser with `(data, el)`. Core
 * adds it to every renderer list; no other renderer may take its name or
 * its suffixes.
 */
export const SCRIPT_RENDERER = "script";
/** What a script droplet's file ends in, after `+droplet`. */
export const SCRIPT_SUFFIXES: readonly string[] = [".script.ts", ".script.js"];

/**
 * Checks a renderer list: unique names, extensions that start with a dot,
 * are not core's, and are claimed once, or by renderers that all list their
 * packages. Throws with a clear message. Returns the renderers by extension.
 */
export function validateRenderers(renderers: DropletRenderer[]): Map<string, DropletRenderer[]> {
  const names = new Set<string>();
  const byExtension = new Map<string, DropletRenderer[]>();
  for (const renderer of renderers) {
    if (!renderer || typeof renderer.name !== "string" || !renderer.name) {
      throw new Error("droplets: every renderer needs a name");
    }
    if (names.has(renderer.name)) {
      if (renderer.name === SCRIPT_RENDERER) {
        throw new Error(`droplets: "${SCRIPT_RENDERER}" is the built-in renderer of +droplet.script.ts; name yours otherwise`);
      }
      throw new Error(`droplets: two renderers are named "${renderer.name}"`);
    }
    names.add(renderer.name);
    if (!Array.isArray(renderer.extensions) || renderer.extensions.length === 0) {
      throw new Error(`droplets: renderer "${renderer.name}" lists no extensions`);
    }
    for (const extension of renderer.extensions) {
      if (!extension.startsWith(".") || extension.length < 2) {
        throw new Error(`droplets: renderer "${renderer.name}": extension "${extension}" must start with a dot`);
      }
      if (CORE_SUFFIXES.has(extension)) {
        throw new Error(`droplets: renderer "${renderer.name}" cannot claim "${extension}"; +droplet${extension} is a load file`);
      }
      if (SCRIPT_SUFFIXES.includes(extension) && renderer.name !== SCRIPT_RENDERER) {
        throw new Error(
          `droplets: renderer "${renderer.name}" cannot claim "${extension}"; +droplet${extension} is a script droplet, built in`,
        );
      }
      const others = byExtension.get(extension) ?? [];
      const unpackaged = [...others, renderer].find((r) => !r.packages?.length);
      const [other] = others;
      if (other !== undefined && unpackaged) {
        throw new Error(
          `droplets: renderers "${other.name}" and "${renderer.name}" both claim ${extension}, ` +
            `and "${unpackaged.name}" lists no packages to tell its components apart; keep one of them`,
        );
      }
      byExtension.set(extension, [...others, renderer]);
    }
    for (const field of ["server", "client"] as const) {
      if (typeof renderer[field] !== "string" || !renderer[field]) {
        throw new Error(`droplets: renderer "${renderer.name}" needs a ${field} module path`);
      }
    }
  }
  return byExtension;
}

type SharingRenderersInput = { renderers: DropletRenderer[] };

/** The names of the renderers that share an extension with another one. */
export function sharingRenderers({ renderers }: SharingRenderersInput): Set<string> {
  const shared = new Set<string>();
  for (const group of validateRenderers(renderers).values()) {
    if (group.length > 1) for (const renderer of group) shared.add(renderer.name);
  }
  return shared;
}

type EscapeRegExpInput = { text: string };

function escapeRegExp({ text }: EscapeRegExpInput): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether `source` imports `pkg` (or a subpath of it), or names it in a
 * `@jsxImportSource` comment. A text scan: components are matched to a
 * renderer before anything is compiled.
 */
export function importsPackage(source: string, pkg: string): boolean {
  const name = escapeRegExp({ text: pkg });
  const specifier = `(["'])${name}(?:/[^"']*)?\\1`;
  return (
    new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*)${specifier}`).test(source) ||
    new RegExp(`@jsxImportSource\\s+${name}(?:/\\S*)?(?=[\\s*]|$)`).test(source)
  );
}

type PickRendererInput = { candidates: DropletRenderer[]; source: string; file: string; fallback?: DropletRenderer | undefined };

/**
 * The renderer of a component whose extension several renderers claim: the
 * one whose package it imports. `fallback` (the droplet's renderer, for an
 * error page) when none or several match and it is among them; else an
 * error that says what to add.
 */
export function pickRenderer({ candidates, source, file, fallback }: PickRendererInput): DropletRenderer {
  const [only] = candidates;
  if (only !== undefined && candidates.length === 1) return only;
  const matching = candidates.filter((r) => r.packages?.some((pkg) => importsPackage(source, pkg)));
  const [match] = matching;
  if (match !== undefined && matching.length === 1) return match;
  if (fallback && candidates.includes(fallback) && (matching.length === 0 || matching.includes(fallback))) {
    return fallback;
  }
  const two = candidates.length === 2;
  const names = listOf({ items: candidates.map((r) => r.name), word: "and" });
  const hints = listOf({
    items: candidates.map((r) => {
      const pkg = r.packages?.[0];
      if (pkg === undefined) throw new Error(`droplets: renderer "${r.name}" shares an extension and lists no packages`);
      return pkg;
    }),
    word: "or",
  });
  const imports =
    matching.length === 0
      ? two
        ? "imports neither"
        : "imports none of them"
      : two
        ? "imports from both"
        : `imports from ${listOf({ items: matching.map((r) => r.name), word: "and" })}`;
  throw new Error(
    `droplets: ${file}: ${names} ${two ? "both" : "all"} handle this file and it ${imports}; ` +
      `import from ${hints}, or add a /** @jsxImportSource <package> */ comment`,
  );
}

type ListOfInput = { items: string[]; word: "and" | "or" };

/** `a and b`, `a, b and c`. */
function listOf({ items, word }: ListOfInput): string {
  return items.length <= 2 ? items.join(` ${word} `) : `${items.slice(0, -1).join(", ")} ${word} ${items.at(-1)}`;
}

/** Package hints for the extensions the first-party renderers handle. */
const KNOWN_RENDERERS: Record<string, { pkg: string; factory: string }> = {
  ".svelte": { pkg: "@dropletsjs/renderer-svelte", factory: "svelte()" },
  ".vue": { pkg: "@dropletsjs/renderer-vue", factory: "vue()" },
  ".hbs": { pkg: "@dropletsjs/renderer-handlebars", factory: "handlebars()" },
  ".handlebars": { pkg: "@dropletsjs/renderer-handlebars", factory: "handlebars()" },
  ".tsx": { pkg: "@dropletsjs/renderer-react (or -preact, -solid, -hono-jsx)", factory: "react() (or preact(), solid(), honoJsx())" },
  ".jsx": { pkg: "@dropletsjs/renderer-react (or -preact, -solid, -hono-jsx)", factory: "react() (or preact(), solid(), honoJsx())" },
  ".lit.ts": { pkg: "@dropletsjs/renderer-lit", factory: "lit()" },
  ".lit.js": { pkg: "@dropletsjs/renderer-lit", factory: "lit()" },
};

type NoRendererMessageInput = { file: string; extension: string };

/** The message for a component file no configured renderer handles. */
export function noRendererMessage({ file, extension }: NoRendererMessageInput): string {
  const last = extension.slice(extension.lastIndexOf("."));
  const known = (Object.hasOwn(KNOWN_RENDERERS, extension) ? KNOWN_RENDERERS[extension] : undefined) ?? KNOWN_RENDERERS[last];
  return known
    ? `${file}: no renderer for ${extension}; install ${known.pkg} and add ${known.factory} to renderers`
    : `${file}: no renderer for ${extension}; add a renderer that handles it to renderers`;
}
