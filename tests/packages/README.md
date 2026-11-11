# tests/packages

The fourteen published packages as npm packs them (`npm pack`, unpacked into
a temporary folder), checked against each package's `tsdown.config.ts` (its
entries, copies and `graphCheck` lists):

- every entry the code resolves by path is at its fixed place in `dist/`,
  with its `.d.ts`, and every `exports` and `bin` target is there;
- from each client entry, following its imports through the shared chunks,
  no file is server code (`*.server.*`, a `server/` folder, a server entry)
  and none imports a Node built-in;
- the output imports only the package's dependencies and peers;
- no source maps; the `.d.ts` keep their JSDoc and never mention `*.css`;
- `import.meta.env.DEV`, `import.meta.hot` and `@vite-ignore` survive the
  minifier, for the consumer's Vite.

```bash
pnpm build                                        # the packages first
pnpm --filter @dropletsjs/tests-packages test     # or: pnpm test, with everything else
```
