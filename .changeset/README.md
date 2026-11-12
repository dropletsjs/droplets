# Changesets

This folder holds pending release notes. Run `pnpm changeset` to add one;
`pnpm version-packages` folds them into each package's `CHANGELOG.md` and
bumps the versions, and `pnpm release` builds and publishes to npm.

- The public packages (the core, the devtools, the four adapters, the eight
  renderers and `create-droplets`) are one `fixed` group: they always share
  a version.
- Private packages (the examples, the tests, the docs) are never versioned
  or tagged (`privatePackages` in `config.json`).
- The first release is `1.0.0`: every `CHANGELOG.md` starts there, with no
  changeset behind it, and every later entry comes from a changeset. There
  is no pre mode: releases publish under the `latest` dist-tag, so
  `npm create droplets` and `npm i @dropletsjs/droplets` pick them up.
