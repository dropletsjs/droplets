---
"create-droplets": patch
---

`create-droplets` no longer refuses a folder that already has an `AGENTS.md` or a `CLAUDE.md`. An existing `AGENTS.md` keeps its text and gets the Droplets guidance appended as a `## Droplets` section; a file that has that section already is left as it is, so running it twice never adds it twice. An existing `CLAUDE.md` gets the `@AGENTS.md` line when it lacks one. Any other file that exists still stops the run before anything is written, and without a terminal a folder that is not empty is still refused. The generated `AGENTS.md`, new or appended, now links the guide for agents, https://dropletsjs.dev/llms.txt.
