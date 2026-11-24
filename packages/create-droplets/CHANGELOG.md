# create-droplets

## 1.0.2

### Patch Changes

- 74df471: `create-droplets` no longer refuses a folder that already has an `AGENTS.md` or a `CLAUDE.md`. An existing `AGENTS.md` keeps its text and gets the Droplets guidance appended as a `## Droplets` section; a file that has that section already is left as it is, so running it twice never adds it twice. An existing `CLAUDE.md` gets the `@AGENTS.md` line when it lacks one. Any other file that exists still stops the run before anything is written, and without a terminal a folder that is not empty is still refused. The generated `AGENTS.md`, new or appended, now links the guide for agents, https://dropletsjs.dev/llms.txt.

## 1.0.1

### Patch Changes

- The usage text and the error for a missing folder name now show `npm create droplets@latest`, so a copied command never runs an older `create-droplets` that npx has cached.

## 1.0.0

### Major Changes

- Initial release.
