---
"@dropletsjs/droplets": patch
---

A form action's `redirect()` passes the same trusted-origin check for an enhanced form's JSON request as for a native post: a target off the server's own origins and `trustedOrigins` answers `400` (`{ message }` in JSON) with a warning, never a `location`. `enhanceDropletForm` follows only what the server answers, an absolute `http(s)` URL without credentials: a relative, protocol-relative (`//…`, `/\…`) or `javascript:` location is never followed. `redirectTarget` of `@dropletsjs/droplets/enhance` takes the location alone.
