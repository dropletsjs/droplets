---
"@dropletsjs/droplets": patch
"@dropletsjs/devtools": patch
---

`DEV_STRATEGIES` and `isReservedQueryKey` are internal: `@dropletsjs/droplets` exports the `DevStrategy` type alone, `@dropletsjs/droplets/enhance` does not export the reserved query keys, and the devtools checks them with its own copy of the list.
