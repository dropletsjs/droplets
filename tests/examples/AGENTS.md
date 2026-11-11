`tests/examples`: the eight `examples/frameworks/*` production builds, embedded from another origin and checked in Chromium.

## Rules

- `pnpm test:e2e` builds `examples/frameworks/*` (`pnpm build:examples`), then runs one Playwright project per example in Chromium.
  Checked by: `../../package.json`, `playwright.config.ts`.
- Every example in `examples/frameworks` is in `EXAMPLES` and passes the same checks; a change to one example's droplets belongs in all.
  Checked by: `e2e/examples.spec.ts`.
- A private variable never reaches the browser: not in a script, JSON or HTML response, nor in the page.
  Checked by: `e2e/examples.spec.ts`.
- The droplet's files and API calls go to the droplets server's location, or keep a proxy's path prefix.
  Checked by: `e2e/examples.spec.ts`.
- The examples import the packages' `dist/`: `pnpm build` first.
- A behaviour change comes with a test; a fix with a test that failed before it.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).
