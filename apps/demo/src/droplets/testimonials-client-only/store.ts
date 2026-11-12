import { fetchRandomTestimonials } from "../../lib/testimonials-api.ts";
import type { Testimonial } from "../../lib/testimonials.ts";

// One IndexedDB database per page origin: the host page's, since the
// droplet runs in it. One record, the last list fetched.
const DB = "djs-demo-testimonials";
const STORE = "lists";
const KEY = "random";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then((db) =>
    new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close()),
  );
}

export async function readStored(): Promise<Testimonial[] | null> {
  const value = await run<unknown>("readonly", (store) => store.get(KEY));
  return Array.isArray(value) ? (value as Testimonial[]) : null;
}

/** Ten random ones from the API, kept for the next visit (a page that refuses IndexedDB still gets them). */
export async function fetchAndStore(): Promise<Testimonial[]> {
  const testimonials = await fetchRandomTestimonials();
  await run("readwrite", (store) => store.put(testimonials, KEY)).catch(() => undefined);
  return testimonials;
}

/** Refresh: IndexedDB cleared, then fetched and kept anew. */
export async function refetch(): Promise<Testimonial[]> {
  await run("readwrite", (store) => store.clear()).catch(() => undefined);
  return fetchAndStore();
}
