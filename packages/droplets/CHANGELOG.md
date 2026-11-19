# @dropletsjs/droplets

## 1.0.2

### Patch Changes

- 86cf275: With `credentials: true` in `cors` and an `origin` other than `"*"`, the browser runtime's own requests (an enhanced form's post, `_data`, a fragment rendered again after a post) now send `credentials: "include"`, so a page on another origin gets the droplets server's cookies back and forth, as a cart or a login needs. Without `credentials`, with `cors: true`, or with an `origin` of `"*"`, they keep the browser's default, `same-origin`. The client build learns only that one boolean from `cors`; the origin list or function stays on the server. Browsers still treat the cookies as third-party when the page and the droplets server are on different sites: see Cookies across origins in the security guide.

## 1.0.1

### Patch Changes

- Fragments and `_data` answers now carry `Cache-Control: no-transform`, so proxies that rewrite HTML (Cloudflare Web Analytics' automatic setup, Email Address Obfuscation, mod_pagespeed and the like) no longer append scripts after the droplet element. The default `fragmentCacheControl` is `private, no-store, no-transform`, and `no-transform` is added, once, to any other value: your config's, a load's `setHeaders`, `handle`'s and an error answer's. Redirects, a form action's JSON, `+server.ts` routes and static files are unchanged.
  
  Since a proxy that honors `no-transform` stops compressing those answers, the server now gzips them itself when the request's `Accept-Encoding` takes gzip and the body is 1024 bytes or more, with `Vary: Accept-Encoding` on every fragment and `_data` answer; a streamed fragment stays streamed. A host that pastes fragments into its pages server-side should request them without `Accept-Encoding` or with a client that decodes gzip (nginx SSI: clear `Accept-Encoding` on the proxied location).
  
  The commands to copy in the docs and READMEs now read `npm create droplets@latest`, so npx never runs a cached older `create-droplets`.

## 1.0.0

### Major Changes

- Initial release.
