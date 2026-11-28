import { env } from "$droplets/env/private";
import { error, redirect, type HandleDropletError, type LoadEvent } from "$droplets/server";
import { Money } from "../../hooks.ts";

export const load = async ({ props, locals, fetch }: LoadEvent) => {
  if (props["who"] === "nobody") error(404, "Nobody is here");
  if (props["who"] === "away") redirect(303, "/elsewhere");
  if (props["who"] === "crash") throw new Error("database password is hunter2");
  // A relative URL is this server's: answered in-process, through handle.
  const fetched = props["who"] === "fetched" ? await (await fetch("/api/whoami?from=hello")).json() : undefined;
  return {
    who: typeof props["who"] === "string" ? props["who"] : "world",
    // The built-in transports: they reach the browser's load as themselves.
    when: new Date("2026-01-02T03:04:05.000Z"),
    tags: new Map([["a", "alpha"]]),
    seen: new Set([1]),
    link: new URL("https://shop.example/x"),
    big: 41n,
    // A type of the app's own, carried by transport in src/hooks.ts.
    price: new Money(1250, "EUR"),
    hooked: locals["hooked"] === true,
    secret: env.FIXTURE_SECRET ?? null,
    flag: env.FIXTURE_STATIC,
    ...(fetched === undefined ? {} : { fetched }),
  };
};

// Server side: nothing of the original error leaves the server.
export const handleError: HandleDropletError = () => ({ error: { message: "Sorry, ref 42" } });
