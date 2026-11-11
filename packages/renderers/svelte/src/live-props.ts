/** A Svelte droplet's props over a reactive map, for `client.ts` and `client-dev.ts`. */
import type { RenderProps } from "@dropletsjs/droplets";
import { SvelteMap } from "svelte/reactivity";

/** Each instance's props setter, for `update` in dev. */
export const setters = new WeakMap<object, (props: RenderProps) => void>();

/**
 * A droplet's props as getters over a reactive map: the component reads
 * `data` and `form` through them, so `update` changes them in place, with
 * no new instance. `extra` (the `children` snippet) stays as it is.
 */
export function liveProps(
  props: RenderProps,
  extra: Record<string, unknown>,
): { props: Record<string, unknown>; set: (props: RenderProps) => void } {
  const values = new SvelteMap<string, unknown>(Object.entries(props));
  const live: Record<string, unknown> = { ...extra };
  for (const key of ["data", "form"]) {
    Object.defineProperty(live, key, { enumerable: true, get: () => values.get(key) });
  }
  return {
    props: live,
    set(next) {
      const record = next as Record<string, unknown>;
      for (const key of ["data", "form"]) {
        if (Object.hasOwn(record, key)) values.set(key, record[key]);
        else values.delete(key);
      }
    },
  };
}

/** `instance`, its props setter kept for `update`. */
export function keep<T>(instance: T, set: (props: RenderProps) => void): T {
  if (instance && typeof instance === "object") setters.set(instance, set);
  return instance;
}
