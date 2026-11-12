import { env } from "$droplets/env/private";
import { secretPair, type SecretPair } from "./host-identity.ts";
import { fetchProducts, type WpConfig, type WpProduct } from "./wp.ts";

// The environment side of wp.ts: where WordPress is, the two secrets, and
// the products it has now, read once per second at most.

let saidSame = false;
/** `.env.example`'s values start with this; a real deployment sets its own. */
const DEMO_SECRET = /^demo-only-/;
const refusedDemo = new Set<string>();

/**
 * A secret from the environment, or `undefined` for the demo value once the
 * server runs in production (NODE_ENV), said once in the log.
 */
function secretFromEnv(name: "WP_SHOP_HOST_SECRET" | "WP_SHOP_SERVICE_SECRET"): string | undefined {
  const value = env[name];
  if (!value || process.env.NODE_ENV !== "production" || !DEMO_SECRET.test(value)) return value;
  if (!refusedDemo.has(name)) console.error(`[wp-shop] ${name} is the demo value from .env.example: refused in production`);
  refusedDemo.add(name);
  return undefined;
}

/**
 * WP_SHOP_HOST_SECRET and WP_SHOP_SERVICE_SECRET, each when usable. Equal
 * ones are refused (no admin, no writes) and said once in the log.
 */
export function shopSecrets(): SecretPair {
  const pair = secretPair(secretFromEnv("WP_SHOP_HOST_SECRET"), secretFromEnv("WP_SHOP_SERVICE_SECRET"));
  if (pair.error && !saidSame) console.error(`[wp-shop] ${pair.error}`);
  if (pair.error) saidSame = true;
  return pair;
}

export function wpConfig(): WpConfig {
  const internalUrl = env.WP_INTERNAL_URL || "http://localhost:8008";
  return {
    internalUrl,
    publicUrl: env.WP_PUBLIC_URL || internalUrl,
    hostSecret: secretFromEnv("WP_SHOP_HOST_SECRET"),
    serviceSecret: secretFromEnv("WP_SHOP_SERVICE_SECRET"),
  };
}

/**
 * Every published product. One WordPress page fetches several fragments at
 * once (the cart, the filter, the library), each wanting the catalogue: they
 * share one read, and an answer is kept a second. A write through wp-shop
 * forgets it at once; an edit in wp-admin shows within that second.
 */
const FRESH_MS = 1000;
let latest: { at: number; products: Promise<WpProduct[]> } | null = null;

export function allProducts(): Promise<WpProduct[]> {
  if (latest && Date.now() - latest.at < FRESH_MS) return latest.products;
  const read = { at: Date.now(), products: fetchProducts(wpConfig()) };
  latest = read;
  // A failed read is not kept: the next request asks again.
  read.products.catch(() => {
    if (latest === read) latest = null;
  });
  return read.products;
}

/** After a write: the next read asks WordPress. */
export function forgetProducts(): void {
  latest = null;
}
