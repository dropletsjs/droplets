---
"@dropletsjs/droplets": patch
---

`PORT` is read only as an integer from 0 to 65535: `-1`, `1.5` or `70000` no longer reach the server, the config's own port stands instead, and `vite dev` warns once naming the value.
