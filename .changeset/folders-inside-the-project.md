---
"@dropletsjs/droplets": patch
---

`dropletsFolder` and `apiFolder` must stay inside the project: a value with a `..` above the root (`../elsewhere`) fails config resolution with an error naming the option and the value, instead of silently dropping the `..`.
