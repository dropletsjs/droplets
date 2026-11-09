import { defineEnvVars } from "@dropletsjs/droplets/env";

/**
 * Every environment variable the droplets read, one of each kind. Values
 * come from .env files and the environment.
 */
export const variables = defineEnvVars({
  /** Private, read at runtime. Set it in .env.local or the environment. */
  API_TOKEN: {},
  /** Private, inlined at build, into server code only. */
  BUILD_CHANNEL: { static: true },
  /** Public, inlined at build. */
  PUBLIC_SITE_NAME: { public: true, static: true },
  /** Public, read at runtime: the server hands it to the page with /index.js. */
  PUBLIC_BANNER: { public: true },
});

declare module "@dropletsjs/droplets/env" {
  interface Register {
    variables: typeof variables;
  }
}
