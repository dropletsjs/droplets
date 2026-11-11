import type { Component, Snippet } from "svelte";

/** A mounted droplet's component under `<svelte:boundary>`, with its error page as the fallback. */
declare const Boundary: Component<{
  component: Component<Record<string, unknown>>;
  props: Record<string, unknown>;
  errorComponent: Component<Record<string, unknown>>;
  handle: (error: unknown) => Promise<unknown>;
  children: Snippet;
}>;
export default Boundary;
