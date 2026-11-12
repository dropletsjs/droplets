import type { Handle } from "$droplets/server";

declare module "@dropletsjs/droplets/server" {
  interface Locals {
    requestId: string;
  }
}

/**
 * Runs for every request except the health check and the build's files
 * (`/index.js`, `/index.css`, `/env.js`, `/assets/*`). Whatever lands in
 * `event.locals` reaches `+droplet.server.ts` and `+server.ts` handlers.
 */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.requestId = crypto.randomUUID().slice(0, 8);

  const response = await resolve(event);
  response.headers.set("x-request-id", event.locals.requestId);
  return response;
};
