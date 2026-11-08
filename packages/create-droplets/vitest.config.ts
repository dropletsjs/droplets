import { defineConfig } from "vitest/config";
import { workspaceVersions } from "./versions.ts";

export default defineConfig({
  define: { __VERSIONS__: JSON.stringify(workspaceVersions()) },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
