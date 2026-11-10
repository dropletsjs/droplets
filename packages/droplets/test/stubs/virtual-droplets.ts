/** Test stand-in for the generated `virtual:droplets` module. */
export const buildHash = "test01";
export const elementName = "djs-droplet";
export const devStrategy: "hmr" | "remount" | "reload" | "manual" = "remount";
export const devInjectTool: boolean = false;
export const devToolUrl: string | null = null;
export const dropletsById: Record<string, boolean> = { hello: true, clock: true, plain: true };
export const dropletsHydrateById: Record<string, boolean> = { hello: true, plain: true };
export const dropletsServerLoadById: Record<string, boolean> = { hello: true };
export const api: unknown[] = [];
export const hooks: Record<string, unknown> = {};
/** Server build: the exports of `src/importmap.server.ts`, or `{}`. */
export const importMapModule: Record<string, unknown> = {};
const droplets: Record<string, unknown> = {};
export default droplets;
export const dropletsStylesById: Record<string, string[]> = {
  plain: ["assets/Badge-1.css", "assets/plain-2.css"],
};
