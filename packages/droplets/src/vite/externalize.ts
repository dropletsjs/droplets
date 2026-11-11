import type { Plugin } from "vite";
import type { PluginState } from "./state.ts";
import { VIRTUAL_CLIENT } from "./virtual.ts";

type NormalizePathInput = { value: string };

function normalizePath({ value }: NormalizePathInput): string {
  return value.replace(/\\/g, "/");
}

type IsBareSpecifierInput = { value: string };

function isBareSpecifier({ value }: IsBareSpecifierInput): boolean {
  return !/^(\.{1,2}\/|\/|https?:\/\/|data:|file:)/.test(value);
}

/**
 * Vite rewrites bare imports to `/@id/<pkg>` in dev, so externalised packages
 * need both spellings in the import map for the browser to resolve them.
 */
type WithViteIdAliasesInput = { importMap: Readonly<Record<string, string>> | undefined };

export function withViteIdAliases({ importMap }: WithViteIdAliasesInput): Record<string, string> | undefined {
  if (!importMap) return undefined;
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(importMap)) {
    entries.push([key, value]);
    if (!key.startsWith("/@id/") && isBareSpecifier({ value: key })) {
      entries.push([`/@id/${key}`, value]);
    }
  }
  return Object.fromEntries(entries);
}

/**
 * Vite applies `build.rolldownOptions.external` to builds only. This applies
 * the client's externals in dev too, so droplet modules import the same
 * things in both. Only imports reached from a droplet entry are externalised;
 * the rest of the project keeps normal dependency pre-bundling.
 */
export function externalizePlugin(state: PluginState): Plugin {
  const dropletGraph = new Set<string>();

  const cleanId = (id: string) => id.replace(/[#?].*$/, "").replace(/\\/g, "/");

  const isDropletEntry = (id: string) => normalizePath({ value: id }).includes(VIRTUAL_CLIENT);

  const inDropletGraph = (importer?: string | undefined) => {
    if (!importer) return false;
    const cleaned = cleanId(importer);
    return isDropletEntry(cleaned) || dropletGraph.has(cleaned);
  };

  return {
    name: "droplets:dev-externalize-client-deps",
    enforce: "pre",
    apply: "serve",
    async resolveId(source, importer, options) {
      const isExternal = state.clientExternal;
      if (!isExternal || !source || options?.ssr) return null;
      if (this.environment.config.consumer === "server") return null;

      const reachedFromDroplet = inDropletGraph(importer);
      if (isBareSpecifier({ value: source }) && isExternal(source, importer)) {
        if (!reachedFromDroplet) return null;
        state.seenExternals.add(source);
        return { id: source, external: true };
      }
      if (!reachedFromDroplet) return null;

      // Walk the graph forward so transitive imports stay externalised too.
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (resolved?.id) dropletGraph.add(cleanId(resolved.id));
      if (importer) dropletGraph.add(cleanId(importer));
      return null;
    },
  };
}
