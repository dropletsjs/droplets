---
"@dropletsjs/adapter-cloudflare": patch
---

`vite build` warns once, and never fails, when the wrangler config's `compatibility_flags` has no `nodejs_compat` (or the older `nodejs_compat_v2`): without it the Worker has no `AsyncLocalStorage`, and requests that overlap share one request store.
