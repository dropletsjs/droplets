---
"@dropletsjs/droplets": patch
---

Server files are recognised in any case: a `Server/` or `SERVER/` folder and a `db.SERVER.ts` name are server code like `server/` and `*.server.*`, refused in a client bundle by `vite build` and `vite dev`.
