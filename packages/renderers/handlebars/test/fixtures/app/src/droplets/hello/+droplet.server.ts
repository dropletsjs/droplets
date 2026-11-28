import { error, type HandleDropletError, type LoadEvent } from "$droplets/server";
import { Money } from "../../hooks.ts";

export const load = ({ props }: LoadEvent) => {
  if (props["who"] === "nobody") error(404, "Nobody is here");
  if (props["who"] === "crash") throw new Error("database password is hunter2");
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
  };
};

// Server side: nothing of the original error leaves the server.
export const handleError: HandleDropletError = () => ({ error: { message: "Sorry, ref 42" } });
