---
"@dropletsjs/droplets": patch
---

With `credentials: true` in `cors` and an `origin` other than `"*"`, the browser runtime's own requests (an enhanced form's post, `_data`, a fragment rendered again after a post) now send `credentials: "include"`, so a page on another origin gets the droplets server's cookies back and forth, as a cart or a login needs. Without `credentials`, with `cors: true`, or with an `origin` of `"*"`, they keep the browser's default, `same-origin`. The client build learns only that one boolean from `cors`; the origin list or function stays on the server. Browsers still treat the cookies as third-party when the page and the droplets server are on different sites: see Cookies across origins in the security guide.
