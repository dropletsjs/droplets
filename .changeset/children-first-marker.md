---
"@dropletsjs/droplets": patch
---

A component that renders its children in more than one place gets the host's container in the first marker in document order, whichever marker it reported first, instead of the last one reported; when that marker empties, the container moves to the next known one, else waits under the element as before.
