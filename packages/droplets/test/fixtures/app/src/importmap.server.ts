import type { ImportMapHandler } from "$droplets/server";

/** Maps every external to a CDN, pinned to a version on purpose. */
export const importmap: ImportMapHandler = ({ externals }) => ({
  imports: Object.fromEntries(
    externals.map((name) => [name, `https://cdn.test/npm/${name}@0.0.1/+esm`]),
  ),
});
