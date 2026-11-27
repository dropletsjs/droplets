---
"@dropletsjs/droplets": patch
---

Under `vite dev`, a no-JavaScript form result that the page carries but the droplet cannot use (a bad signature or another page, expired, an action the droplet no longer exports, no `DROPLETS_SECRET`) now warns with `form-result-dropped`, naming the reason. The droplet still renders without `form`, and a production server logs nothing.
