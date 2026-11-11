`@dropletsjs/shared`: the private build, tsconfig, test and env helpers that more than one package, app or test in this repository uses.

## Rules

- The package is private: `private: true`, never published, never a dependency of a published package (devDependencies only).
  Checked by: `package.json`.
- It holds only what more than one package, app or test uses; something with one user stays in that user's folder.
- Consumers import it by package name (`@dropletsjs/shared/tsdown`), never by a `../../` path, and declare it as `"@dropletsjs/shared": "workspace:*"`.
- `examples/*` never depend on it: users copy them.
- Every export points at a source file (`.ts`, `.json`); the package has no build.
  Checked by: `package.json`.
- `tsdown.ts` imports only types from tsdown, so a filtered install without the workspace root can load it.
- `graphCheck({ client, server })` fails the build when a client entry reaches server code or a Node built-in, or when the output imports an undeclared package; each package's `tsdown.config.ts` keeps its lists in sync with its entries and server modules.
  Checked by: `packages/droplets/test/build/tsdown.test.ts`, `tests/packages/test/packed.test.ts`.
- `cssInline()` gives `?inline` CSS its file text, the same in a package's tests and its build.
  Checked by: `packages/droplets/test/build/tsdown.test.ts`.
- The code typechecks on its own with Node types.
  Checked by: `pnpm --filter @dropletsjs/shared typecheck`.

If you need the facts, read them from `README.md` (`## Facts`, one per line: grep for the subject).

Code style: `../../docs/style/code.md`.
