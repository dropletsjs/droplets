import { defineConfig, devices } from "@playwright/test";
import { EXAMPLES, HOST_PORT, dropletsPort } from "./e2e/examples.ts";

/**
 * The eight examples in a real browser, against their production builds: run
 * `pnpm build:examples` first (the root `pnpm test:e2e` does). Each example's
 * droplets server answers on a port of its own (8400 and up), and one host
 * page on :8100 embeds each from there (e2e/host.mjs): `/<example>/`.
 *
 * One project per example. The projects run side by side; within one, the
 * tests share that server's counter and run one at a time. The `lit`
 * project also runs lit.spec.ts.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  reporter: process.env["CI"] ? "github" : "list",
  use: { ...devices["Desktop Chrome"] },
  projects: EXAMPLES.map((example) => ({
    name: example,
    use: { baseURL: `http://localhost:${HOST_PORT}/${example}/` },
    // lit.spec.ts: what only the Lit example has, declarative shadow DOM.
    ...(example === "lit" ? {} : { testIgnore: /lit\.spec\.ts$/ }),
  })),
  webServer: [
    ...EXAMPLES.map((example) => ({
      command: "node dist/server.js",
      cwd: `../../examples/frameworks/${example}`,
      url: `http://localhost:${dropletsPort(example)}/health`,
      env: {
        PORT: String(dropletsPort(example)),
        PUBLIC_BANNER: "from the e2e run",
        API_TOKEN: "e2e-secret-value",
        // The host page posts the Lit guestbook's forms: from its origin, trusted.
        DROPLETS_TRUSTED_ORIGINS: `http://localhost:${HOST_PORT}`,
      },
    })),
    { command: "node e2e/host.mjs", url: `http://localhost:${HOST_PORT}/health` },
  ],
});
