import type { Plugin as PostcssPlugin, Rule } from "postcss";
import selectorParser from "postcss-selector-parser";

export type ScopeStylesOptions = {
  /** The droplet element's tag name; every selector is nested under it. */
  element: string;
  /**
   * Which stylesheets to scope, by the file PostCSS reports. Defaults to all.
   */
  include?: (file: string | undefined) => boolean;
};

/** Selectors that mean "the document" and therefore become the element. */
const ROOT_TAGS = new Set(["html", "body"]);
const ROOT_PSEUDOS = new Set([":root", ":host"]);

function isRootLike(node: selectorParser.Node | undefined): boolean {
  if (!node) return false;
  if (node.type === "tag") return ROOT_TAGS.has(node.value.toLowerCase());
  if (node.type === "pseudo") {
    const name = node.value.toLowerCase();
    // Svelte's `:global(body)` means the document as much as `body` does.
    if (name === ":global") {
      const inner = node.nodes[0];
      return inner?.nodes.length === 1 && isRootLike(inner.first);
    }
    return ROOT_PSEUDOS.has(name) || name.startsWith(":host");
  }
  return false;
}

function isDescendantCombinator(node: selectorParser.Node | undefined): boolean {
  return node?.type === "combinator" && node.value.trim() === "";
}

/** `:global(<element>)`, which Svelte leaves alone while it hashes the rest. */
function globalElement(element: string): selectorParser.Pseudo {
  return selectorParser.pseudo({
    value: ":global",
    nodes: [selectorParser.selector({ value: "", nodes: [selectorParser.tag({ value: element })] })],
  });
}

function isElement(node: selectorParser.Node, element: string): boolean {
  if (node.type === "tag") return node.value === element;
  return node.type === "pseudo" && node.value === ":global" && String(node.nodes[0]).trim() === element;
}

/**
 * Rewrites one selector list so every selector only matches inside `element`.
 *
 * - `.p-4`            -> `<element> .p-4`
 * - `:root`, `html`,
 *   `body`, `:host`   -> `<element>` (and `html body .x` -> `<element> .x`)
 * - `<element> .x`    -> unchanged, so running twice is harmless
 *
 * With `svelte`, the element is written `:global(<element>)`: Svelte styles
 * are seen before Svelte compiles them, and Svelte drops a selector that
 * names an element its template does not have.
 */
export function scopeSelector(selector: string, element: string, svelte = false): string {
  const root = selectorParser().astSync(selector);
  const scope = () => (svelte ? globalElement(element) : selectorParser.tag({ value: element }));
  root.each((sel) => {
    const first = sel.first;
    if (!first) return;
    if (isElement(first, element)) return;
    // Whitespace after a comma lives on the next selector's first node.
    first.spaces.before = "";

    if (isRootLike(first)) {
      // `html body` and friends collapse into the element itself.
      let combinator = first.next();
      let rootLike = combinator?.next();
      while (combinator && rootLike && isDescendantCombinator(combinator) && isRootLike(rootLike)) {
        const after = rootLike.next();
        combinator.remove();
        rootLike.remove();
        combinator = after;
        rootLike = combinator?.next();
      }
      first.replaceWith(scope());
      return;
    }

    sel.prepend(selectorParser.combinator({ value: " " }));
    sel.prepend(scope());
  });
  // The parser keeps the whitespace around commas on the nodes themselves;
  // re-joining normalises it to `a, b` whatever the input looked like.
  return root.nodes.map((sel) => sel.toString().trim()).join(", ");
}

/**
 * A Svelte `<style>` on its way into the compiler: Vite's preprocessor names
 * it `<file>.svelte.vite-preprocess.css`. What the compiler emits,
 * `<file>.svelte?svelte&type=style&lang.css`, is plain CSS again.
 */
function isSvelteStyle(file: string | undefined): boolean {
  return file !== undefined && /\.svelte\.[^/\\?]+$/.test(file);
}

function insideKeyframes(rule: Rule): boolean {
  let parent = rule.parent;
  while (parent && parent.type !== "root") {
    if (parent.type === "atrule" && /keyframes$/i.test((parent as { name: string }).name)) {
      return true;
    }
    parent = parent.parent as typeof parent;
  }
  return false;
}

/**
 * PostCSS plugin: confines a stylesheet to the droplet element.
 *
 * A droplet's stylesheets land in whatever page embeds it. Nesting every
 * selector under the element keeps them, Tailwind's reset, theme variables
 * and utilities included, from touching the host page, whatever that page
 * is. `@keyframes`, `@font-face` and `@property` are left alone: they have
 * no selectors to scope.
 */
export function scopeStylesPlugin(options: ScopeStylesOptions): PostcssPlugin {
  const { element, include } = options;
  return {
    postcssPlugin: "droplets:scope-styles",
    Once(root) {
      if (include && !include(root.source?.input.file)) return;
      const svelte = isSvelteStyle(root.source?.input.file);
      root.walkRules((rule) => {
        if (insideKeyframes(rule)) return;
        rule.selectors = rule.selectors.map((selector) => scopeSelector(selector, element, svelte));
      });
    },
  };
}

scopeStylesPlugin.postcss = true as const;
