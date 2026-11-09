import { defineEnvVars } from "@dropletsjs/droplets/env";

/**
 * The shop's environment, private and read at runtime. .env has demo
 * values for `pnpm dev` and `pnpm start`; a deployment sets its own.
 */
export const variables = defineEnvVars({
  /** The one admin's user name. */
  ADMIN_USER: {},
  /** The one admin's password; login is refused while it is unset. */
  ADMIN_PASSWORD: {},
  /** Signs the `shop_admin` cookie (HMAC-SHA256); at least 32 characters. */
  SHOP_SECRET: {},
});

declare module "@dropletsjs/droplets/env" {
  interface Register {
    variables: typeof variables;
  }
}
