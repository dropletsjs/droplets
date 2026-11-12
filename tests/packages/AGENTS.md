`tests/packages`: the published packages as `npm pack` writes them, checked against each package's `tsdown.config.ts`, and the ranges the examples ask for them at.

## Rules

- A file the code resolves by path in `dist/` is a tsdown `entry`, so it ships at a fixed path with its `.d.ts`.
  Checked by: `test/packed.test.ts`.
- Client entries never reach server code (`*.server.*`, `server/`, a server entry) or a Node built-in, through any chain of imports.
  Checked by: `test/packed.test.ts`.
- A package imports only what its `package.json` declares: dependencies, peers, Node built-ins, virtual ids.
  Checked by: `test/packed.test.ts`.
- `import.meta.env.DEV` stays literal in `dist/`, so the consumer's Vite strips dev code.
  Checked by: `test/packed.test.ts`.
- No source maps ship, and no JavaScript or `.d.ts` imports a `.css` file.
  Checked by: `test/packed.test.ts`.
- Every published package built by tsdown is in `PACKAGES`.
- Every example under `examples/` declares the published ranges: `@dropletsjs/*` at `^<the packages' version>`, the pnpm catalog's tools at the catalog's literal range (the workspace examples; the hosts bring their own toolchains), and no `workspace:` or `catalog:` range anywhere.
  Checked by: `test/examples.test.ts`.
- The suite packs the packages' `dist/`: `pnpm build` first, then `pnpm test:integration`.
- A behaviour change comes with a test; a fix with a test that failed before it.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).
