---
"@dropletsjs/droplets": patch
---

Under `vite dev`, the error page receives the request's props, as it does in a build; they were dropped for a failed live render and for a failed render of a listed entry.
