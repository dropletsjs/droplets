#!/usr/bin/env node
// The `create-droplets` bin. A committed launcher rather than dist/index.js
// itself, so pnpm can link the bin at install time, before `pnpm build`
// writes dist/.
await import("../dist/index.js");
