---
"@dropletsjs/renderer-vue": patch
---

The `<style data-droplets-vue>` elements an error page's CSS adds to the document head are counted per mounted instance and removed when the last Vue droplet instance using them unmounts, instead of staying for the life of the page.
