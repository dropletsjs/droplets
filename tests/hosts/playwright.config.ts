import { defineConfig, devices } from "@playwright/test";

/**
 * The shop flow against one host's compose stack, already running: `run.mjs`
 * starts it, sets `HOST_NAME` and `HOST_URL`, and stops it afterwards.
 * Each test records its own video (a context of its own, see e2e/record.ts).
 */
export default defineConfig({
  testDir: "e2e",
  // The droplet tour is a recording of its own: `run.mjs --tour` runs it alone (TOUR=1).
  ...(process.env["TOUR"] ? { testMatch: /tour\.spec\.ts$/ } : { testIgnore: /tour\.spec\.ts$/ }),
  // One shop database per stack: the tests change it, one at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // Paced as a person (RECORD_PACE=human), a recording takes longer.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env["CI"] ? "github" : "list",
  outputDir: "test-results",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env["HOST_URL"],
    // The https run (Caddy's internal CA) is the only one with a certificate.
    ignoreHTTPSErrors: true,
  },
});
