/**
 * What create-droplets shares with `djs add`, from the sources of
 * `@dropletsjs/droplets`: the framework catalog, the flags of a target, the
 * droplet templates and the package managers. Bundled into dist/index.js at
 * build, so the starter droplets are the ones `djs add` writes.
 */
export { FRAMEWORKS, frameworkNamed, packageName, type Framework } from "../../droplets/src/add/catalog.ts";
export { flagsFor } from "../../droplets/src/add/flags.ts";
export { dropletFiles } from "../../droplets/src/add/templates.ts";
export { detectPackageManager, PACKAGE_MANAGERS, run, type PackageManager } from "../../droplets/src/add/install.ts";
export { isValidElementName } from "../../droplets/src/core/config.ts";

declare const __VERSIONS__: Record<string, string>;

/** The version ranges a generated project asks for, baked in at build. */
export const VERSIONS: Readonly<Record<string, string>> = __VERSIONS__;

type VersionOfInput = { name: string };

/** `VERSIONS[name]`, or an error naming what the build left out. */
export function versionOf({ name }: VersionOfInput): string {
  const version = VERSIONS[name];
  if (!version) throw new Error(`create-droplets: no version for ${name}`);
  return version;
}
