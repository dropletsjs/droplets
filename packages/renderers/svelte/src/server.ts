/**
 * The server side of the Svelte renderer: `svelte/server`'s `render`, with
 * `children` as the marker snippet of `children.svelte`, the same one the
 * browser renders, so hydration finds what it expects.
 */
import type {
  ComponentModule,
  RenderProps,
  ServerRenderContext,
  ServerRenderOutput,
} from "@dropletsjs/droplets";
import type { Component } from "svelte";
import { render as renderToString } from "svelte/server";
import { marker as children } from "./children.svelte";

export async function render(
  module: ComponentModule,
  props: RenderProps,
  context: ServerRenderContext,
): Promise<ServerRenderOutput> {
  const component = module.default as Component | undefined;
  if (typeof component !== "function") {
    throw new Error(`${context.droplet}: the ${context.kind} component is not a Svelte component`);
  }
  // `render()` is PromiseLike in Svelte 5: awaiting it supports components
  // that use top-level `await`, and is a no-op for synchronous ones.
  const result = await renderToString(component, { props: { ...props, children } });
  // An error page compiles with `css: "injected"`: its <style> is in `head`
  // and travels with the markup. A droplet's <svelte:head> has no place in
  // a fragment and is dropped.
  return context.kind === "error" ? { html: result.body, head: result.head } : result.body;
}
