/**
 * Once per page, before any React droplet renders: React Fast Refresh's
 * preamble, and the flag exports it should ignore.
 *
 * In `vite dev`, `@vitejs/plugin-react` wraps every component module with
 * Fast Refresh code that expects its preamble (`window.$RefreshReg$`, the
 * DevTools hook) to be installed by a `<script>` it injects into the
 * project's `index.html`. A droplet is a fragment on someone else's page,
 * so this module imports the preamble instead: `@vitejs/plugin-react/preamble`
 * is a virtual module of the plugin that holds the preamble in dev and is
 * empty in a build or when HMR is off. As a static import of a module core
 * imports first, it runs before any component module and before `react-dom`
 * is evaluated, which the DevTools hook needs.
 *
 * Fast Refresh keeps a module's state only when every export is a component
 * or unchanged. The flags (`export const prerender = true`) are unchanged
 * between edits, so they are fine as they are; they are also declared as
 * ignored exports, so that toggling one does not turn the edit into a full
 * reload (core's own update path re-mounts the droplet with the new flags
 * anyway). Any other non-component export of `+droplet.tsx` whose value
 * changes still makes Fast Refresh fall back, as it would in any React app.
 */
import "@vitejs/plugin-react/preamble";

type IgnoredExports = (info: { id: string }) => string[];

const FLAGS = ["ssr", "hydrate", "prerender"];
const COMPONENT_FILE = /[\\/]\+(?:[Dd]roplet|[Ee]rror)\.[jt]sx?(?:\?|$)/;

/** Adds the flags to the exports Fast Refresh ignores for droplet component files. Idempotent. */
export function ignoreFlagExports(): void {
  const global = globalThis as { __getReactRefreshIgnoredExports?: IgnoredExports; __dropletsReactRefresh?: true };
  if (global.__dropletsReactRefresh) return;
  global.__dropletsReactRefresh = true;
  const previous = global.__getReactRefreshIgnoredExports;
  global.__getReactRefreshIgnoredExports = (info) => {
    const own = COMPONENT_FILE.test(info.id) ? FLAGS : [];
    return previous ? [...previous(info), ...own] : own;
  };
}

// Fast Refresh runs under `vite dev` only; a production build drops the call and the function.
if (import.meta.env.DEV) ignoreFlagExports();
