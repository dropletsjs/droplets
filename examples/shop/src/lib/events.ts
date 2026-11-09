import type { Cart, Filter } from "./types.ts";

// Droplets talk to each other with CustomEvents on `window`: no shared
// store, no framework bus, and the host page can listen or emit too.
// `detail` is plain data; every listener checks its shape, since anything
// on the page may dispatch the same name.

export type ShopEvents = {
  /** product-filter (and the library's own sort) → product-library with the same `scope`. */
  "shop:filter": Filter & { scope: string };
  /** The cart changed: the cart itself, a host using /api/cart/items. */
  "shop:cart-changed": { count: number; cart?: Cart };
  /** product-admin saved a product: cards and the cart may refresh. */
  "shop:product-changed": { id: string };
  /** A host's own button asks the cart drawer to open. */
  "shop:cart-open": Record<string, never>;
};

export function emit<K extends keyof ShopEvents>(name: K, detail: ShopEvents[K]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** Listens on `window`; returns the function that stops listening. */
export function on<K extends keyof ShopEvents>(name: K, handler: (detail: unknown) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => handler((event as CustomEvent).detail);
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `shop:filter`'s detail, or `null` when it is not one. */
export function readFilter(detail: unknown): (Filter & { scope: string }) | null {
  if (!isRecord(detail)) return null;
  const { q, category, sort, onSale, scope } = detail;
  if (typeof q !== "string" || typeof category !== "string" || typeof scope !== "string") return null;
  if (sort !== "new" && sort !== "price-asc" && sort !== "price-desc") return null;
  return { q: q.slice(0, 80), category, sort, onSale: onSale === true, scope };
}

/**
 * `droplets:action` on `window`: after each enhanced submit (the forms with
 * `enhanceDropletForm`, its wrappers or `data-droplets-enhance`) got its
 * result, `{ droplet, action, type, status, data }`. A submit without
 * JavaScript fires none: the page it lands on renders afresh.
 */
export type DropletAction = {
  droplet: string;
  action: string;
  type: "success" | "failure" | "redirect";
  status: number;
  data: unknown;
};

export function onDropletAction(handler: (action: DropletAction) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (!isRecord(detail)) return;
    const { droplet, action, type, status, data } = detail;
    if (typeof droplet !== "string" || typeof action !== "string" || typeof status !== "number") return;
    if (type !== "success" && type !== "failure" && type !== "redirect") return;
    handler({ droplet, action, type, status, data });
  };
  window.addEventListener("droplets:action", listener);
  return () => window.removeEventListener("droplets:action", listener);
}

/** The shop's own droplets whose actions change the cart. */
export const CART_ACTIONS = new Set(["product-library:add", "product-card:add", "product-page:add"]);
