/** Test stand-in for the generated `virtual:droplets` module. */
export const buildHash = "test01";
export const elementName = "djs-droplet";
export const corsCredentials: boolean = false;
export { formatAgent as errorFormatter } from "../../src/errors/format.ts";
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
/**
 * `transport` of a `src/hooks.ts`: `Point` of its own, which decodes to a
 * marked copy, and a `Date` entry that is ignored, the built-in winning.
 */
export const transport = {
  Point: { encode: () => false, decode: (json: unknown) => ({ decodedPoint: json }) },
  Date: { encode: () => false, decode: () => "the author's Date" },
};
const droplets: Record<string, unknown> = {};
export default droplets;
export const dropletsStylesById: Record<string, string[]> = {
  plain: ["assets/Badge-1.css", "assets/plain-2.css"],
};
