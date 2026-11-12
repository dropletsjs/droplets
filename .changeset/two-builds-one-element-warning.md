---
"@dropletsjs/droplets": patch
---

Under `vite dev`, a second `/index.js` of one server from another build warns once in the console when it finds the element name already defined, naming the element and both builds: the first build's code runs every element on the page. Production stays as it was.
