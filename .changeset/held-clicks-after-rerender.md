---
"@dropletsjs/droplets": patch
---

A click held before hydration is no longer lost when the engine renders the server markup anew instead of adopting it (Hono JSX's `hydrate` does): the element remembers the node's place under the droplet's root and replays the click on the element there, when it is the same kind of element; otherwise the click is dropped, as before.
