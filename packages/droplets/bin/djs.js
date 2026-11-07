#!/usr/bin/env node
// The `djs` bin. A committed launcher rather than dist/cli.js itself, so
// pnpm can link the bin at install time, before `pnpm build` writes dist/.
await import("../dist/cli.js");
