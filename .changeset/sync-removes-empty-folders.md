---
"@dropletsjs/droplets": patch
---

`djs sync`, `vite dev` and `vite build` remove the folders a stale `$types.d.ts` leaves empty under `.droplets/types/`, instead of keeping an empty folder per removed droplet.
