---
"@dropletsjs/adapter-node": patch
"@dropletsjs/adapter-bun": patch
"@dropletsjs/adapter-deno": patch
---

The Node adapter (and Bun and Deno, which run on it) keeps `dist/client/droplets.json` only once it has loaded: while the file is missing or not valid JSON, the server answers with an empty manifest and reads it again on the next request, so a build that finishes after the server started needs no restart. A file that does not parse is its own error, `<path> is not valid JSON: <parse error>; did the build finish?`, no longer taken for a missing one; each failure is logged once, not per request, until a load succeeds.
