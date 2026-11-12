---
"@dropletsjs/adapter-node": patch
"@dropletsjs/adapter-cloudflare": patch
---

A missing file under `/assets/*` answers the same on every adapter: the text `Not Found`, `404`, `cache-control: no-store`. The Cloudflare Worker no longer passes the assets binding's own 404 page through (any other binding failure still passes through with `no-store`), and the Node adapter's 404 now carries `no-store` too, so a file missing before a build is never cached past it.
