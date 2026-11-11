---
"@dropletsjs/droplets": patch
---

`vite build` writes each droplet's `style.css` as a file, `dist/client/droplets/<id>/style.css`, with what `/droplets/<id>/style.css` answers; a droplet without stylesheets gets none. The route still answers it.
