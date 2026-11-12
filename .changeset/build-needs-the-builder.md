---
"@dropletsjs/droplets": patch
---

A build through Vite's plain `build()` fails at once with `droplets: vite build (the builder) is required; build() alone builds one environment; use createBuilder() or the vite build command`, instead of quietly building the client environment alone.
