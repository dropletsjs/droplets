import { dirname, resolve } from "node:path";
import type { AcceptedPlugin, Plugin as PostcssPlugin, ProcessOptions, Root } from "postcss";
import postcssrc from "postcss-load-config";
import { isCSSRequest, type Plugin, searchForWorkspaceRoot, type UserConfig } from "vite";
import { fileExists } from "../core/fs.ts";
import { logger } from "../core/logger.ts";
import { scopeStylesPlugin } from "../css/scope.ts";
import type { PluginState } from "./state.ts";

/** The plugin's `css` option. */
export type DropletsCssOptions = {
  /**
   * The stylesheet every droplet shares, relative to the project root. It
   * comes first in each droplet's `style.css`, and `/index.css` serves it
   * too. Default: `./src/app.css` when it exists; `false` for none.
   */
  path?: string | false;
  /**
   * Confine every stylesheet of the build to the droplet element by prefixing
   * its selectors with it (`:root`, `html` and `body` become the element):
   * the shared one, the ones droplets import, CSS modules, and Svelte and
   * Vue component styles. They land in host pages; this keeps them off the
   * rest of the page. Default: `true`.
   */
  scoped?: boolean;
  /**
   * Add `@tailwindcss/vite` when the Vite config does not have it already.
   * Needs `tailwindcss` and `@tailwindcss/vite` installed. Tailwind added by
   * hand works without this. Default: `false`.
   */
  tailwind?: boolean;
  /**
   * Keep Tailwind's preflight, its reset. `false` leaves it out, for host
   * pages that bring their own: `@import "tailwindcss"` becomes its theme
   * and utilities, and `@import "tailwindcss/preflight.css"` goes. That is
   * done in the stylesheets Vite processes; an import Tailwind resolves
   * inside one of them is out of reach, and a warning says so. No effect
   * without Tailwind. Default: `true`.
   *
   * ```ts
   * export default defineConfig(({ command }) => ({
   *   plugins: [droplets({ css: { tailwind: true, twPreflight: command === "serve" } })],
   * }));
   * ```
   */
  twPreflight?: boolean;
};

export type ResolvedCss = {
  path?: string;
  scoped: boolean;
  tailwind: boolean;
  twPreflight: boolean;
};

export const DEFAULT_CSS_PATH = "./src/app.css";

type ResolveCssInput = { options?: DropletsCssOptions | undefined; root: string };

/** Fills in the `css` defaults; `./src/app.css` only when it exists. */
export async function resolveCss({ options = {}, root }: ResolveCssInput): Promise<ResolvedCss> {
  const path =
    options.path === false
      ? undefined
      : (options.path ?? ((await fileExists({ path: resolve(root, DEFAULT_CSS_PATH) })) ? DEFAULT_CSS_PATH : undefined));
  return {
    ...(path ? { path } : {}),
    scoped: options.scoped ?? true,
    tailwind: options.tailwind ?? false,
    twPreflight: options.twPreflight ?? true,
  };
}

/** Whether Tailwind compiles this project's CSS, by either plugin. */
export function tailwindActive(state: PluginState): boolean {
  return state.tailwind.user || state.tailwind.ours;
}

const TAILWIND_IMPORT = /@import\s+(["'])tailwindcss\1([^;]*);/g;
const PREFLIGHT_IMPORT = /@import\s+(["'])tailwindcss\/preflight(?:\.css)?\1[^;]*;[ \t]*\n?/g;

/**
 * A stylesheet's Tailwind imports without the preflight: `tailwindcss`
 * becomes its theme and utilities, with whatever options it carried
 * (`prefix(tw)`, `important`, `source(…)`), and the preflight's own import
 * goes. `null` when there is nothing to change.
 */
type WithoutPreflightInput = { code: string };

export function withoutPreflight({ code }: WithoutPreflightInput): string | null {
  if (!code.includes("tailwindcss")) return null;
  const result = code
    .replace(PREFLIGHT_IMPORT, "")
    .replace(TAILWIND_IMPORT, (_match, _quote: string, options: string) =>
      [
        "@layer theme, base, components, utilities;",
        `@import "tailwindcss/theme.css" layer(theme)${options};`,
        `@import "tailwindcss/utilities.css" layer(utilities)${options};`,
      ].join("\n"),
    );
  return result === code ? null : result;
}

/**
 * Whether compiled CSS still has Tailwind's preflight: its box-sizing rule
 * for `*`, `::before`, `::after` and `::backdrop`, in whatever spelling
 * Tailwind's optimizer left it.
 */
type HasPreflightInput = { root: Root };

export function hasPreflight({ root }: HasPreflightInput): boolean {
  let found = false;
  root.walkRules((rule) => {
    const selectors = new Set(rule.selectors.map((s) => s.replace(/\s+/g, "").replace(/::(before|after)\b/g, ":$1")));
    if (
      ["*", ":after", ":before", "::backdrop"].every((s) => selectors.has(s)) &&
      rule.some((node) => node.type === "decl" && node.prop === "box-sizing" && node.value === "border-box")
    ) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

/** Vite's `css` option, as `createCssConfig` returns it. */
export type CssConfig = NonNullable<UserConfig["css"]>;

/** The files postcss-load-config reads, in its order, besides a `postcss` key in `package.json`. */
const POSTCSS_CONFIG_FILES = [
  ".postcssrc",
  ...["json", "yaml", "yml", "js", "mjs", "cjs", "ts", "mts", "cts"].map((extension) => `.postcssrc.${extension}`),
  ...["js", "mjs", "cjs", "ts", "mts", "cts"].map((extension) => `postcss.config.${extension}`),
];

type FindPostcssConfigFileInput = { dir: string; stopDir: string };

/** The PostCSS config file postcss-load-config would find from `dir`, for naming it; `null` when there is none. */
async function findPostcssConfigFile({ dir, stopDir }: FindPostcssConfigFileInput): Promise<string | null> {
  for (let at = dir; ; at = dirname(at)) {
    for (const name of POSTCSS_CONFIG_FILES) {
      if (await fileExists({ path: resolve(at, name) })) return resolve(at, name);
    }
    if (at === stopDir || dirname(at) === at) return null;
  }
}

type LoadedPostcss = { options: ProcessOptions; plugins: AcceptedPlugin[] };

type LoadPostcssConfigInput = { searchPath: string; root: string };

/**
 * The project's PostCSS config file, found as Vite finds it (from
 * `searchPath` up to the workspace root), since Vite reads none once the
 * plugin sets `css.postcss` inline. `null` when there is none; a file that
 * fails to load throws, naming it.
 */
async function loadPostcssConfig({ searchPath, root }: LoadPostcssConfigInput): Promise<LoadedPostcss | null> {
  const stopDir = searchForWorkspaceRoot(root);
  try {
    const { options, plugins } = await postcssrc({}, searchPath, { stopDir });
    return { options, plugins: plugins as AcceptedPlugin[] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("No PostCSS Config found")) return null;
    const file = (await findPostcssConfigFile({ dir: searchPath, stopDir })) ?? searchPath;
    throw new Error(`droplets: the PostCSS config ${file} failed to load: ${message}`);
  }
}

type CreateCssConfigInput = { userConfig: UserConfig; state: PluginState; root: string };

/**
 * Adds the framework's PostCSS steps after the user's own: scoping, and
 * with `twPreflight: false` a warning for a preflight that got through.
 * The user's come from `css.postcss` when it is inline, else from the
 * project's PostCSS config file (searched from `css.postcss` when that is
 * a directory, else from the root), with its options. `undefined` when
 * there is nothing to add.
 */
export async function createCssConfig({ userConfig, state, root }: CreateCssConfigInput): Promise<CssConfig | undefined> {
  const plugins: PostcssPlugin[] = [];
  if (!state.css.twPreflight) {
    const warned = new Set<string>();
    plugins.push({
      postcssPlugin: "droplets:preflight-check",
      Once(root) {
        const file = root.source?.input.file ?? "a stylesheet";
        if (warned.has(file) || !hasPreflight({ root })) return;
        warned.add(file);
        logger.warn(
          "framework",
          `${file} still has Tailwind's preflight with css.twPreflight off: it is imported where Vite does not see it; import "tailwindcss/theme.css" and "tailwindcss/utilities.css" there instead`,
        );
      },
    });
  }
  if (state.css.scoped) plugins.push(scopeStylesPlugin({ element: state.config.element }));
  if (!plugins.length) return undefined;

  const existing = userConfig.css?.postcss;
  const own =
    typeof existing === "object"
      ? { options: existing, plugins: existing.plugins ?? [] }
      : await loadPostcssConfig({ searchPath: typeof existing === "string" ? resolve(root, existing) : root, root });
  return { postcss: { ...own?.options, plugins: [...(own?.plugins ?? []), ...plugins] } };
}

const TAILWIND_PLUGIN = "@tailwindcss/vite";

type Hook = (this: unknown, ...args: unknown[]) => unknown;

type GatedInput = { plugin: Plugin; state: PluginState };

/** A Tailwind plugin that only does its work when `css.tailwind` adds Tailwind. */
function gated({ plugin, state }: GatedInput): Plugin {
  const wrapped: Plugin = { ...plugin, name: plugin.name.replace(TAILWIND_PLUGIN, "droplets:tailwind") };
  const record = wrapped as unknown as Record<string, unknown>;
  for (const key of ["configResolved", "transform"] as const) {
    const hook = record[key];
    if (typeof hook === "function") {
      record[key] = function (this: unknown, ...args: unknown[]) {
        if (state.tailwind.ours) return (hook as Hook).apply(this, args);
      };
    } else if (hook && typeof hook === "object" && "handler" in hook) {
      const handler = (hook as { handler: Hook }).handler;
      record[key] = {
        ...hook,
        handler(this: unknown, ...args: unknown[]) {
          if (state.tailwind.ours) return handler.apply(this, args);
        },
      };
    }
  }
  return wrapped;
}

type IsModuleNotFoundInput = { error: unknown };

function isModuleNotFound({ error }: IsModuleNotFoundInput): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

/**
 * Tailwind for `css.tailwind`. Whether it runs is decided once the config is
 * resolved: never beside the user's own `@tailwindcss/vite`, which is
 * detected by its plugin names, and never without `css.tailwind`. Tailwind
 * is an optional peer dependency, loaded only when installed.
 */
export async function tailwindPlugins(state: PluginState): Promise<Plugin[]> {
  let plugins: Plugin[] | null = null;
  try {
    const { default: tailwindcss } = await import("@tailwindcss/vite");
    plugins = tailwindcss() as Plugin[];
  } catch (error) {
    if (!isModuleNotFound({ error })) throw error;
  }

  const control: Plugin = {
    name: "droplets:tailwind",
    enforce: "pre",
    configResolved(config) {
      state.tailwind.user = config.plugins.some((plugin) => plugin.name.startsWith(TAILWIND_PLUGIN));
      state.tailwind.ours = state.css.tailwind && !state.tailwind.user;
      if (state.tailwind.ours && !plugins) {
        throw new Error("droplets: css.tailwind needs Tailwind installed: pnpm add -D tailwindcss @tailwindcss/vite (or npm install -D …)");
      }
    },
    // Ahead of Tailwind's compile, whoever added Tailwind: once compiled and
    // optimized, the preflight is merged with the project's own base styles.
    transform: {
      order: "pre",
      handler(code, id) {
        if (state.css.twPreflight || !tailwindActive(state) || !isCSSRequest(id)) return;
        const rewritten = withoutPreflight({ code });
        return rewritten === null ? undefined : { code: rewritten, map: null };
      },
    },
  };
  // In front of Tailwind's own, so the decision is made before they run.
  return [control, ...(plugins ?? []).map((plugin) => gated({ plugin, state }))];
}
