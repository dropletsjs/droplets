---
"@dropletsjs/droplets": patch
---

A prerendered render of an `ssr = false` droplet carries its context in the inline `script[data-droplet-context]`, as every fragment with server markup does, instead of the `data-context` attribute: the carrier is decided by whether the answer has markup, not by the `ssr` flag.
