import { defineEnvVars } from "@dropletsjs/droplets/env";

/**
 * wp-shop's environment, private, read at runtime (and at build: the
 * prerender reads WordPress too). .env.example has demo values.
 */
export const variables = defineEnvVars({
  /** How wp-shop reaches WordPress's REST API, server to server: `http://wordpress`. */
  WP_INTERNAL_URL: {},
  /** WordPress's public origin: the only origin a Media Library image may come from. */
  WP_PUBLIC_URL: {},
  /** Shared with the plugin, WordPress → wp-shop: checks `x-wp-shop-user`. At least 32 bytes. */
  WP_SHOP_HOST_SECRET: {},
  /** Shared with the plugin, wp-shop → WordPress: signs `x-wp-shop-service` (the writes back). At least 32 bytes; not WP_SHOP_HOST_SECRET. */
  WP_SHOP_SERVICE_SECRET: {},
  /** The cart's SQLite file; default `wp-shop.db`. */
  WP_SHOP_DATABASE: {},
});

declare module "@dropletsjs/droplets/env" {
  interface Register {
    variables: typeof variables;
  }
}
