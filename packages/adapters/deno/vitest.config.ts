import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// The repository's .env.local, when there is one (`DENO`: a deno binary off the
// PATH); variables already set win.
const envLocal = new URL("../../../.env.local", import.meta.url);
if (existsSync(envLocal)) process.loadEnvFile(envLocal);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
