/**
 * The style-scoping PostCSS plugin, for projects with their own PostCSS
 * configuration. The Vite plugin adds it automatically when `css.postcss` is
 * not set in `vite.config.ts`; otherwise add it yourself:
 *
 * ```js
 * // postcss.config.js
 * import { scopeStylesPlugin } from "@dropletsjs/droplets/postcss";
 * export default { plugins: [scopeStylesPlugin({ element: "djs-droplet" })] };
 * ```
 */
export { scopeStylesPlugin, scopeSelector } from "./css/scope.ts";
export type { ScopeStylesOptions } from "./css/scope.ts";
