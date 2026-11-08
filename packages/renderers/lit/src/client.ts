/**
 * The browser side of the Lit renderer.
 *
 * `hydrate` adopts the server's markup, node for node:
 *
 * 1. Declarative shadow roots the page never attached become shadow roots.
 *    The HTML parser attaches a `<template shadowrootmode>` only while it
 *    parses a document; markup inserted with `innerHTML` (core's own
 *    re-fetch after an HMR update or a form action, and many hosts) keeps
 *    it as an inert `<template>`. `hydrateShadowRoots` of
 *    `@webcomponents/template-shadowroot` attaches them; it skips its work
 *    where it believes the browser does it natively, so the templates left
 *    after it, if any, are attached here.
 * 2. The component's class is defined under the tag the server used (read
 *    from the markup). The element upgrades, and waits: it carries
 *    `defer-hydration`.
 * 3. `hydrate` of `@lit-labs/ssr-client` takes over the host template,
 *    setting `data`, `form` and `actionUrl` (or `error`) on the element.
 * 4. Removing `defer-hydration` lets `lit-element-hydrate-support` (the
 *    renderer's `clientSetup`) hydrate the element's shadow root in place
 *    on its first update.
 *
 * When the markup cannot be adopted (the tag is held by another class: an
 * edited module under `vite dev`, or another droplets server with the same
 * element name on the page), the droplet is mounted afresh instead, with a
 * warning.
 *
 * `mount` waits for a droplet's `data` (a promise when mounting) before it
 * renders, as Lit has no suspense of its own; when it rejects and the
 * droplet has an error page, that renders in its place. `unmount` clears
 * the target, Lit's record of what it rendered there included.
 */
import type { ClientRenderContext, ComponentModule, RenderProps } from "@dropletsjs/droplets";
import { hydrate as hydrateTemplate } from "@lit-labs/ssr-client";
import { hydrateShadowRoots } from "@webcomponents/template-shadowroot";
import { LitElement, render } from "lit";
import { prefix } from "virtual:droplets-renderer-lit";
import { adoptTag, claimTag, componentOf, tagName } from "./tags.ts";
import { hostTemplate } from "./template.ts";

type Instance = { target: HTMLElement };

/** Where Lit keeps the part it rendered into a container; cleared with the container. */
type LitContainer = HTMLElement & { _$litPart$?: unknown };

/** The `<template shadowrootmode>` under `root` the parser left inert, attached, the innermost first. */
export function attachShadowRoots(root: ParentNode): void {
  for (const template of Array.from(root.querySelectorAll<HTMLTemplateElement>("template[shadowrootmode]"))) {
    const host = template.parentElement;
    const mode = template.getAttribute("shadowrootmode");
    if (!host || host.shadowRoot || (mode !== "open" && mode !== "closed")) continue;
    attachShadowRoots(template.content);
    host.attachShadow({ mode, delegatesFocus: template.hasAttribute("shadowrootdelegatesfocus") }).append(template.content);
    template.remove();
  }
}

/** The renderer's own children markers in `target`: not those of a droplet nested in its children. */
function markersIn(target: HTMLElement): Element[] {
  return [...target.querySelectorAll("[data-app-children]")].filter((marker) => {
    const owner = marker.closest("[data-droplet]");
    return !owner || !target.contains(owner);
  });
}

/** What to render once a droplet's `data` settled: the droplet, its error page, or nothing. */
async function settled(
  module: ComponentModule,
  props: RenderProps,
  context: ClientRenderContext,
): Promise<{ module: ComponentModule; props: RenderProps; kind: ClientRenderContext["kind"] } | null> {
  if (!("data" in props)) return { module, props, kind: context.kind };
  try {
    return { module, props: { ...props, data: await props.data }, kind: context.kind };
  } catch (error) {
    if (!context.error) throw error;
    try {
      return { module: context.error.module, props: { error: await context.error.handle(error) }, kind: "error" };
    } catch {
      return null;
    }
  }
}

export async function mount(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): Promise<Instance> {
  const shown = await settled(module, props, context);
  if (!shown) return { target };
  const component = componentOf(shown.module, context.droplet, shown.kind, LitElement);
  const draw = () => {
    const tag = claimTag(customElements, component, tagName(prefix, context.droplet, shown.kind));
    render(hostTemplate(tag, shown.props, context.actionUrl), target);
  };
  // After the await: `actionUrl()` of `$droplets/form` knows the droplet again inside `rendering`.
  if (context.rendering) context.rendering(draw);
  else draw();
  for (const marker of markersIn(target)) context.children.fill(marker);
  return { target };
}

export function hydrate(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): Instance | Promise<Instance> {
  hydrateShadowRoots(target);
  attachShadowRoots(target);
  const component = componentOf(module, context.droplet, context.kind, LitElement);
  const element = target.firstElementChild;
  if (!element || !adoptTag(customElements, component, element.localName)) {
    if (element) {
      console.warn(
        `[droplets] ${context.droplet}: <${element.localName}> is defined by another class on this page ` +
          "(an edited module, or another droplets server with the same element name); rendering it afresh",
      );
    }
    (target as LitContainer)._$litPart$ = undefined;
    target.replaceChildren();
    return mount(module, target, props, context);
  }
  hydrateTemplate(hostTemplate(element.localName, props, context.actionUrl), target);
  element.removeAttribute("defer-hydration");
  const markers = context.markers();
  for (const marker of markers.length > 0 ? markers : markersIn(target)) context.children.fill(marker);
  return { target };
}

export function unmount(instance: unknown): void {
  const { target } = instance as Instance;
  // A later `render` into the same target must start over, not update nodes that are gone.
  delete (target as LitContainer)._$litPart$;
  target.replaceChildren();
}
