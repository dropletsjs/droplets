---
"@dropletsjs/adapter-node": patch
---

`node dist/server` without the extension and `node` given a symlink to `dist/server.js` now listen: the Node adapter compares the file Node was given with its own module as real paths. Importing the file still does not listen.
