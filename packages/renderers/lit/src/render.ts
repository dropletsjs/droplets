/**
 * The server render, apart from where the tag prefix comes from (`server.ts`
 * reads it from the renderer's virtual module), so it can be tested on its
 * own.
 *
 * `render` of `@lit-labs/ssr` prints the host template: the component's
 * element, its shadow root as a declarative `<template shadowrootmode="open">`
 * (with the component's `static styles` as a `<style>` inside), then the
 * children marker in light DOM. `deferHydration` puts `defer-hydration` on
 * the element: it does not hydrate on its own when its class is defined,
 * only when the renderer's `hydrate` has given it its properties and removes
 * the attribute.
 *
 * Lit's server build runs on its DOM shim (`@lit-labs/ssr-dom-shim`, which
 * puts `customElements` on `globalThis`); the renderer's Vite plugin makes
 * every server build use it, Workers included (see `plugin.ts`).
 */
import type { ComponentModule, RenderProps, ServerRenderContext } from "@dropletsjs/droplets";
import { render } from "@lit-labs/ssr";
import { collectResult } from "@lit-labs/ssr/lib/render-result.js";
import { LitElement } from "lit";
import { claimTag, componentOf, tagName, type Registry } from "./tags.ts";
import { hostTemplate } from "./template.ts";

/** The registry Lit's server build installed, read when rendering (after `lit` is evaluated). */
function registry(): Registry {
  return globalThis.customElements;
}

type RenderComponentInput = { module: ComponentModule; props: RenderProps; context: ServerRenderContext; prefix: string };

export async function renderComponent({ module, props, context, prefix }: RenderComponentInput): Promise<string> {
  const { droplet, kind, actionUrl } = context;
  const component = componentOf({ module, droplet, kind, base: LitElement });
  const tag = claimTag({ registry: registry(), component, tag: tagName({ prefix, droplet, kind }) });
  return collectResult(render(hostTemplate({ tag, props, actionUrl }), { deferHydration: true }));
}
