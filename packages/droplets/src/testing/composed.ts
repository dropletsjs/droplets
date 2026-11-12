/**
 * DOM queries as a page shows things, for the kit's checks: into every
 * shadow root, attached (open) or still declarative (a `<template
 * shadowrootmode>` in the markup, inert after `innerHTML`), and through a
 * `<slot>` to the light-DOM children it places. A selector matches one
 * element at a time (`[data-testid=count]`), never a path across trees.
 */

/** The host of each declarative shadow root entered, by its template's content: a fragment knows no host. */
const hosts = new WeakMap<Node, Element>();

function isDeclarative(element: Element): boolean {
  return element.localName === "template" && element.hasAttribute("shadowrootmode");
}

/** The element children of `node`, a declarative shadow root's template left out: it is entered from its host. */
function childrenOf(node: ParentNode): Element[] {
  return Array.from(node.children).filter((child) => !isDeclarative(child));
}

type ShadowRootOfInput = { element: Element };

/** The element's shadow root, attached or declarative; `null` without one. */
function shadowRootOf({ element }: ShadowRootOfInput): ParentNode | null {
  if (element.shadowRoot) return element.shadowRoot;
  const template = Array.from(element.children).find(isDeclarative) as HTMLTemplateElement | undefined;
  if (!template) return null;
  hosts.set(template.content, element);
  return template.content;
}

type HostOfInput = { node: Node };

/** The shadow host of the tree `node` is in; `null` in the document or a plain fragment. */
function hostOf({ node }: HostOfInput): Element | null {
  let root: Node = node;
  while (root.parentNode) root = root.parentNode;
  return (root as ShadowRoot).host ?? hosts.get(root) ?? null;
}

type AssignedInput = { slot: Element; host: Element };

/** The host's children the slot shows: those naming it, the unnamed ones for the unnamed slot. */
function assigned({ slot, host }: AssignedInput): Element[] {
  const name = slot.getAttribute("name") ?? "";
  return childrenOf(host).filter((child) => (child.getAttribute("slot") ?? "") === name);
}

type ShownInput = { element: Element };

/** `element`, then what shows under it, in tree order. */
function* shown({ element }: ShownInput): Generator<Element> {
  yield element;
  const shadow = shadowRootOf({ element });
  if (shadow) {
    for (const child of childrenOf(shadow)) yield* shown({ element: child });
    return;
  }
  if (element.localName === "slot") {
    const host = hostOf({ node: element });
    const slotted = host ? assigned({ slot: element, host }) : [];
    if (slotted.length > 0) {
      for (const child of slotted) yield* shown({ element: child });
      return;
    }
  }
  for (const child of childrenOf(element)) yield* shown({ element: child });
}

type ComposedInput = { root: ParentNode };

/** The elements under `root` as they show, `root` itself left out. */
export function* composed({ root }: ComposedInput): Generator<Element> {
  if (root.nodeType === 1) {
    const all = shown({ element: root as Element });
    all.next();
    yield* all;
    return;
  }
  for (const child of childrenOf(root)) yield* shown({ element: child });
}

type FindInput = { root: ParentNode; selector: string };

/** The first element under `root`, as it shows, matching `selector`; `null` without one. */
export function find<T extends Element = HTMLElement>({ root, selector }: FindInput): T | null {
  for (const element of composed({ root })) if (element.matches(selector)) return element as T;
  return null;
}

/** Every element under `root`, as it shows, matching `selector`. */
export function findAll<T extends Element = HTMLElement>({ root, selector }: FindInput): T[] {
  return Array.from(composed({ root })).filter((element) => element.matches(selector)) as T[];
}

type ParseInput = { html: string };

/** `html` parsed inert, in a `<template>`: no element upgrades, and a declarative shadow root stays its template. */
export function parse({ html }: ParseInput): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}
