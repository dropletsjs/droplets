---
"@dropletsjs/adapter-node": patch
"@dropletsjs/adapter-cloudflare": patch
---

Every file served under `/assets/*` carries `X-Content-Type-Options: nosniff` with its content type: the Node adapter (and Bun and Deno, which serve through it) sets it on each answer, the Cloudflare adapter writes it into `dist/client/_headers` for the build's files and sets it on the files the Worker serves through the binding.
