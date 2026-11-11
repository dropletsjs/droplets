/** A Svelte droplet's props over a reactive map, for `client.ts` and `client-dev.ts`. */
import type { RenderProps } from "@dropletsjs/droplets";
import { SvelteMap } from "svelte/reactivity";

type SetProps = (props: RenderProps) => void;

type LivePropsInput = {
  props: RenderProps;
  /** Props that stay as they are: the `children` snippet. */
  extra: Record<string, unknown>;
};

type LiveProps = { props: Record<string, unknown>; set: SetProps };

type KeepInput<T> = { instance: T; set: SetProps };

const LIVE_KEYS = ["data", "form"];

/** Each instance's props setter, for `update` in dev. */
export const setters = new WeakMap<object, SetProps>();

/**
 * A droplet's props as getters over a reactive map: the component reads
 * `data` and `form` through them, so `update` changes them in place, with
 * no new instance.
 */
export function liveProps({ props, extra }: LivePropsInput): LiveProps {
  const values = new SvelteMap<string, unknown>(Object.entries(props));
  const live: Record<string, unknown> = { ...extra };
  for (const key of LIVE_KEYS) {
    Object.defineProperty(live, key, { enumerable: true, get: () => values.get(key) });
  }
  return {
    props: live,
    set(next) {
      const record: Readonly<Record<string, unknown>> = next;
      for (const key of LIVE_KEYS) {
        if (Object.hasOwn(record, key)) values.set(key, record[key]);
        else values.delete(key);
      }
    },
  };
}

/** `instance`, its props setter kept for `update`. */
export function keep<T>({ instance, set }: KeepInput<T>): T {
  if (instance && typeof instance === "object") setters.set(instance, set);
  return instance;
}
