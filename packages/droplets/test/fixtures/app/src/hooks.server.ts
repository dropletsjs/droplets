import type { Handle } from "$droplets/server";

export const handle: Handle = async ({ event, resolve }) => {
  event.locals["hooked"] = true;
  const response = await resolve(event);
  response.headers.set("x-fixture-hook", "1");
  return response;
};
