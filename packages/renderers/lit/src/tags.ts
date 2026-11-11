/**
 * Which tag a component class renders under, on both sides. A `+droplet.lit.ts`
 * default-exports a `LitElement` class and leaves defining it to the renderer:
 * the class is registered as `<prefix>-<droplet id>` (its error page as
 * `<prefix>-<droplet id>--error`), the prefix being the droplets server's
 * element name unless `lit({ prefix })` says otherwise.
 *
 * `customElements` is one registry per page, shared by every droplets
 * server the page loads from. Two servers stay apart because their element
 * names differ (which they must anyway). Within one server, the same name
 * can still meet a second class: a component module evaluated again in
 * `vite dev` after an edit. A name is never defined twice: the new class
 * gets `<tag>--v2` (`--v3`, …), a name no kebab-case droplet id produces.
 */
import type { ComponentKind, ComponentModule } from "@dropletsjs/droplets";

/** What the renderer needs of a `CustomElementRegistry`: the page's, or Lit's server shim. */
export type Registry = {
  get(name: string): CustomElementConstructor | undefined;
  define(name: string, element: CustomElementConstructor): void;
  getName?(element: CustomElementConstructor): string | null;
};

/** A valid custom element name, as far as droplet ids and element names go: lowercase, a hyphen, no spaces. */
const VALID_TAG = /^[a-z][a-z0-9._]*(?:-[a-z0-9._]*)+$/;

/** `<prefix>-<droplet>` for a droplet, `<prefix>-<droplet>--error` for its error page. */
export function tagName(prefix: string, droplet: string, kind: ComponentKind): string {
  const tag = `${prefix}-${droplet}${kind === "error" ? "--error" : ""}`;
  if (!VALID_TAG.test(tag)) {
    throw new Error(
      `${droplet}: "${tag}" is not a valid custom element name for the Lit ${kind}; ` +
        "rename the droplet folder (lowercase letters, digits, hyphens) or set lit({ prefix })",
    );
  }
  return tag;
}

/** The component class of a Lit module, or an error that says what is expected. */
export function componentOf(
  module: ComponentModule,
  droplet: string,
  kind: ComponentKind,
  base: abstract new () => object,
): CustomElementConstructor {
  const component = module.default;
  if (typeof component !== "function" || !(component.prototype instanceof base)) {
    throw new Error(
      `${droplet}: the ${kind} component must default-export a LitElement class ` +
        "(`export default class Hello extends DropletElement { … }`); the renderer defines it",
    );
  }
  return component as CustomElementConstructor;
}

/** The tags this module defined, by class: a class is defined once, under one name. */
const claimed = new WeakMap<CustomElementConstructor, string>();

/**
 * Defines `component` under `tag`; the name the registry has it under
 * after. A class the page already defined itself (`@customElement`) keeps
 * its own name, when the registry can tell it.
 */
function define(registry: Registry, tag: string, component: CustomElementConstructor): string {
  try {
    registry.define(tag, component);
    return tag;
  } catch (error) {
    const own = registry.getName?.(component);
    if (own) return own;
    throw error;
  }
}

/**
 * The tag `component` renders under, defining it now if it is not yet:
 * `tag` when free or already its own, else the first free `tag--v<n>`.
 * For a server render and for a mount in the browser.
 */
export function claimTag(registry: Registry, component: CustomElementConstructor, tag: string): string {
  const known = claimed.get(component);
  if (known) return known;
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? tag : `${tag}--v${n}`;
    const holder = registry.get(candidate);
    if (holder && holder !== component) continue;
    const name = holder ? candidate : define(registry, candidate, component);
    claimed.set(component, name);
    return name;
  }
}

/**
 * For hydration: whether `component` is, or can now be, the class of `tag`,
 * the name the server markup was rendered with. `false` when another class
 * holds the name (an edited module in `vite dev`, or another droplets server
 * with the same element name on the page), or when `component` is defined
 * under another name already: the markup cannot be adopted then.
 */
export function adoptTag(registry: Registry, component: CustomElementConstructor, tag: string): boolean {
  const holder = registry.get(tag);
  if (holder) return holder === component;
  const known = claimed.get(component);
  if (known) return known === tag;
  const name = define(registry, tag, component);
  claimed.set(component, name);
  return name === tag;
}
