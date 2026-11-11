/** Test stand-in for the generated `virtual:droplets` module. */
export const buildHash = "test01";
export const elementName = "djs-droplet";
export const dropletsById: Record<string, boolean> = { hello: true, clock: true, plain: true, beacon: true };
export const dropletsHydrateById: Record<string, boolean> = { hello: true, plain: true, beacon: true };
export const dropletsServerLoadById: Record<string, boolean> = { hello: true };
/** `beacon` is a `+droplet.script.ts`: it only runs in the browser. */
export const dropletsScriptById: Record<string, boolean> = { beacon: true };
export const api: unknown[] = [];
export const hooks: Record<string, unknown> = {};
/** Server build: the exports of `src/importmap.server.ts`, or `{}`. */
export const importMapModule: Record<string, unknown> = {};
export const publicEnvNames: string[] = [];
export const tokenNonce = "";
const droplets: Record<string, unknown> = {};
export default droplets;
export const dropletsStylesById: Record<string, string[]> = {
  plain: ["assets/Badge-1.css", "assets/plain-2.css"],
};
