---
"@dropletsjs/droplets": patch
"@dropletsjs/renderer-lit": patch
---

`rendererConformance()` of `@dropletsjs/droplets/testing` renders the server side in a worker thread of its own, so a renderer whose server build shims the DOM or defines custom elements (Lit SSR) never meets the browser bundles in happy-dom; its DOM checks look into shadow roots, attached or declarative, and through slots; its HTML checks ignore an engine's comment markers. `@dropletsjs/renderer-lit` passes it, and a Lit component in shadow DOM passes as one in light DOM does. The build's prerender pass evaluates the SSR bundle in a worker thread as well, so the bundle finds a server's globals, not the build process's. The Lit renderer attaches the declarative shadow roots `innerHTML` left inert itself, in any DOM, and no longer depends on `@webcomponents/template-shadowroot`.
