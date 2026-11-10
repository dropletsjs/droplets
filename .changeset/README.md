# Changesets

This folder holds pending release notes. Run `pnpm changeset` to add one;
`pnpm version-packages` folds them into each package's `CHANGELOG.md` and
bumps the versions, and `pnpm release` builds and publishes to npm.

- The 15 public packages (the core, the devtools, the four adapters, the eight
  renderers and `create-droplets`) are one `fixed` group: they always share
  a version.
- Private packages (the examples, the tests, the docs) are never versioned
  or tagged (`privatePackages` in `config.json`).
- Pre mode is on with the `alpha` tag (`pre.json`): versions come out as
  `1.0.0-alpha.N` and publish under the `alpha` dist-tag, so
  `npm create droplets@alpha` and `npm i @dropletsjs/droplets@alpha` pick
  them up. `pnpm changeset pre exit` ends it before the first stable release.
