/** A Solid droplet's props over a signal, for `client.ts` and `client-dev.ts`. */
import type { RenderProps } from "@dropletsjs/droplets";
import { createSignal, type JSX } from "solid-js";

/** What `mount` and `hydrate` return: Solid's dispose function. */
export type Handle = () => void;

/** Each handle's props setter, for `update` in dev. */
export const setters = new WeakMap<Handle, (props: RenderProps) => void>();

export type LiveProps = { props: Record<string, unknown>; set: (props: RenderProps) => void };

type LivePropsInput = { props: RenderProps; children: () => JSX.Element };

/**
 * The component's props as getters over one signal: a component reading
 * `props.data` follows it, and `update` sets it without a new instance.
 */
export function liveProps({ props, children }: LivePropsInput): LiveProps {
  const [current, setCurrent] = createSignal(props, { equals: false });
  const live: Record<string, unknown> = { children };
  for (const key of Object.keys(props)) {
    Object.defineProperty(live, key, { enumerable: true, get: () => (current() as Record<string, unknown>)[key] });
  }
  if (!("form" in props) && "data" in props) {
    Object.defineProperty(live, "form", { enumerable: true, get: () => (current() as Record<string, unknown>)["form"] });
  }
  return { props: live, set: (next) => setCurrent(() => next) };
}
