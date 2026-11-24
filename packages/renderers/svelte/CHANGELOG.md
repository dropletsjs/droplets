# @dropletsjs/renderer-svelte

## 1.0.2

### Patch Changes

- 1a37eb0: Every message Droplets writes, an error it throws or a warning it logs, in `vite build`, `vite dev`, the browser and the production server, now carries a stable code and a link to its page at `https://dropletsjs.dev/errors/<code>/`, which says what happened, when it happens and the fix. A thrown error has the code as `error.code`.
  
  New `errorFormat` in `droplets.config.ts`: `"agent"` (the default) writes a block of labelled lines a coding agent can read,
  
  ```txt
  droplets error load-result-not-object
    droplet: product-card
    file: +droplet.ts
    what: load must return a plain object
    fix: return an object literal from load, e.g. return { … }, or nothing
    docs: https://dropletsjs.dev/errors/load-result-not-object.md
  ```
  
  a warning starting with `droplets warning`; `"human"` writes one line ending with the link. Any other value fails the build with `error-format-invalid`. The format applies everywhere, the production server and the browser included; there is no environment variable for it.
  
  The text and shape of every message changed: a check that matches on a message's text should match on its code instead. A production server still logs errors only, with `console.error`: the coded message, then the error. What an endpoint answers (status and message) is unchanged.
- Updated dependencies [1a37eb0]
- Updated dependencies [86cf275]
- Updated dependencies [68281df]
- Updated dependencies [5ab1b57]
- Updated dependencies [fe0b550]
- Updated dependencies [0933d3f]
  - @dropletsjs/droplets@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies
  - @dropletsjs/droplets@1.0.1

## 1.0.0

### Major Changes

- Initial release.
