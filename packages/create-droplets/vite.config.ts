import { builtinModules } from "node:module";
import { defineConfig } from "vite";
import { workspaceVersions } from "./versions.ts";

// One file, dist/index.js: the shared modules of @dropletsjs/droplets
// (src/add) and what they import are bundled in, so `npm create droplets`
// downloads this package and @clack/prompts only.
export default defineConfig({
  define: { __VERSIONS__: JSON.stringify(workspaceVersions()) },
  build: {
    ssr: "src/index.ts",
    outDir: "dist",
    target: "node22",
    minify: false,
    rolldownOptions: {
      external: [/^@clack\//, ...builtinModules, /^node:/],
      output: { entryFileNames: "index.js", banner: "#!/usr/bin/env node" },
    },
  },
  ssr: { noExternal: true },
});
