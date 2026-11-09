#!/bin/sh
# The container's start: the build happens here, not in `docker build`,
# because the prerender reads WordPress (one product page per product, the
# full oldest-first comment pages) and WordPress is only up now.
#
#   1. wait until WordPress answers the product route (the plugin is active);
#   2. `vite build`: the bundles and the prerendered pages, from WordPress's REST API;
#   3. serve dist/server.js.
#
# A restart builds again, from what WordPress has then.
set -eu
cd "$(dirname "$0")/.."
node scripts/wait-for-wordpress.mjs
node node_modules/vite/bin/vite.js build
exec node dist/server.js
