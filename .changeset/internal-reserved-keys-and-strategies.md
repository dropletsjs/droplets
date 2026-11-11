---
"@dropletsjs/droplets": patch
"@dropletsjs/devtools": patch
---

`@dropletsjs/droplets` no longer exports `DEV_STRATEGIES` (the `DevStrategy` type stays), and `@dropletsjs/droplets/enhance` no longer exports `isReservedQueryKey`. The devtools checks the reserved query keys with its own copy of the list.
