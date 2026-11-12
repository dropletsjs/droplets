---
"@dropletsjs/renderer-lit": patch
---

`lit({ prefix })` accepts exactly what its message says: a lowercase letter, then lowercase letters, digits and hyphens. A `.` or `_` in the prefix, which the check let through, is refused.
