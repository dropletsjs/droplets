import droplet from "$droplets/drop";
import type { PrivateFacts } from "./types.ts";

/**
 * The droplets server's API. `droplet.url()` points at
 * the server the droplet came from: a plain `fetch("/api/…")` would go to
 * the host page's origin instead.
 */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(droplet.url(path), init);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** The counter every droplet shares. */
export const readCounter = () => call<{ count: number }>("/api/counter").then((body) => body.count);

export const bumpCounter = (by = 1) =>
  call<{ count: number }>("/api/counter", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ by }),
  }).then((body) => body.count);

export const serverTime = () => call<{ now: string }>("/api/time").then((body) => body.now);

/** What the private variables tell, as the server reports it. */
export const privateFacts = () => call<PrivateFacts>("/api/env");
