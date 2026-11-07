import type { UserConfig } from "vite";

/** Rolldown's `external`, in every shape it accepts. */
export type ExternalOption =
  | string
  | RegExp
  | Array<string | RegExp>
  | ((id: string, parentId: string | undefined, isResolved: boolean) => unknown);

type BuildLike = {
  rolldownOptions?: { external?: unknown };
  rollupOptions?: { external?: unknown };
};

function externalOf(build: BuildLike | undefined): ExternalOption[] {
  const value = build?.rolldownOptions?.external ?? build?.rollupOptions?.external;
  return value === undefined ? [] : [value as ExternalOption];
}

/**
 * The client's externals, as the user declared them for Vite:
 * `environments.client.build.rolldownOptions.external`, plus top-level
 * `build.rolldownOptions.external`, which every environment inherits.
 */
export function readClientExternal(config: UserConfig): ExternalOption[] {
  return [
    ...externalOf(config.build as BuildLike | undefined),
    ...externalOf(config.environments?.["client"]?.build as BuildLike | undefined),
  ];
}

/** Answers whether `id` is external, the way Rolldown would for a bare import. */
export function createExternalMatcher(
  options: ExternalOption[],
): ((id: string, importer?: string) => boolean) | null {
  if (options.length === 0) return null;
  return (id, importer) =>
    options.some((option) => {
      if (typeof option === "function") return Boolean(option(id, importer, false));
      const list = Array.isArray(option) ? option : [option];
      return list.some((entry) => (typeof entry === "string" ? entry === id : entry.test(id)));
    });
}

/** The plain package names, for `optimizeDeps.exclude`. */
export function namedExternals(options: ExternalOption[]): string[] {
  return options.flatMap((option) =>
    typeof option === "string"
      ? [option]
      : Array.isArray(option)
      ? option.filter((entry): entry is string => typeof entry === "string")
      : []
  );
}
