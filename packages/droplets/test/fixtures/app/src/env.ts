import { defineEnvVars } from "@dropletsjs/droplets/env";

export const variables = defineEnvVars({
  FIXTURE_SECRET: {},
  FIXTURE_STATIC: { static: true },
  PUBLIC_FIXTURE_NAME: { public: true, static: true },
  PUBLIC_FIXTURE_RUNTIME: { public: true },
});

declare module "@dropletsjs/droplets/env" {
  interface Register {
    variables: typeof variables;
  }
}
