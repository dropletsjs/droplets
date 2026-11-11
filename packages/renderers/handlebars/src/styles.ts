/**
 * `<style>` blocks in a droplet template, as Svelte and Vue have them:
 *
 * ```hbs
 * <section class="card">…</section>
 *
 * <style>
 *   .card { font-family: system-ui, sans-serif; }
 * </style>
 * <style src="./theme.css"></style>
 * ```
 *
 * The plugin takes them out of the template before compiling it and imports
 * them instead, in order: an inline block as a CSS module of its own
 * (`<template>?droplets-style=<n>&lang.css`), a `src` block as that file.
 * They are then the droplet's CSS like any other, extracted, scoped to the
 * element and served in its stylesheet; nothing of them stays in the HTML.
 *
 * A block must be static: at the top of the template, outside `{{#…}}`
 * blocks, with no `{{…}}` in it. Partials have none: they are registered
 * for every droplet.
 */
import Handlebars from "handlebars";

export type StyleBlock = { kind: "inline"; css: string; lang: string } | { kind: "src"; src: string };

const STYLE = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi;
const OPEN = /<style\b/i;
const ATTRIBUTE = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/** The query an inline block's CSS module carries. */
export const STYLE_QUERY = "droplets-style";

/** The id of inline block `index` of `file`: a `.css` id, so Vite's CSS pipeline takes it. */
export function styleId(file: string, index: number, lang: string): string {
  return `${file}?${STYLE_QUERY}=${index}&lang.${lang}`;
}

/** `{ index }` for an inline block's id, `undefined` for anything else. */
export function parseStyleId(id: string): { file: string; index: number } | undefined {
  const [file = "", query = ""] = id.split("?");
  const index = new URLSearchParams(query).get(STYLE_QUERY);
  return index === null ? undefined : { file, index: Number(index) };
}

function attributes(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name = "", double, single, bare] of source.matchAll(ATTRIBUTE)) {
    found.set(name.toLowerCase(), double ?? single ?? bare ?? "");
  }
  return found;
}

/** Offsets of each line start, for Handlebars' line and column positions. */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return starts;
}

/**
 * The template without its `<style>` blocks, and the blocks. Each block is
 * replaced by as many line breaks as it spans, so the compiler's positions
 * still point at the right lines. Throws for a block that is not static.
 */
export function extractStyles(source: string, where: string): { template: string; styles: StyleBlock[] } {
  if (!OPEN.test(source)) return { template: source, styles: [] };
  let program: hbs.AST.Program;
  try {
    program = Handlebars.parse(source);
  } catch {
    // The compiler reports a broken template, with its position.
    return { template: source, styles: [] };
  }

  const starts = lineStarts(source);
  const offset = (position: hbs.AST.Position) => {
    const start = starts[position.line - 1];
    if (start === undefined) throw new Error(`droplets: ${where}: no line ${position.line}`);
    return start + position.column;
  };
  const topLevel = new Set(program.body.filter((node) => node.type === "ContentStatement"));

  // Anywhere but plain text at the top, a <style> cannot be taken out.
  class Nested extends Handlebars.Visitor {
    override ContentStatement(node: hbs.AST.ContentStatement): void {
      if (!topLevel.has(node) && OPEN.test(node.value)) {
        throw new Error(
          `droplets: ${where}:${node.loc.start.line}: a <style> block goes at the top of the template, outside {{#…}} blocks`,
        );
      }
    }
  }
  new Nested().accept(program);

  const styles: StyleBlock[] = [];
  const cuts: [number, number][] = [];
  for (const node of topLevel) {
    const start = offset(node.loc.start);
    const text = source.slice(start, offset(node.loc.end));
    let matched = 0;
    for (const match of text.matchAll(STYLE)) {
      matched++;
      const [whole, attrs = "", css = ""] = match;
      const found = attributes(attrs);
      const src = found.get("src");
      if (src !== undefined) {
        if (css.trim()) throw new Error(`droplets: ${where}: <style src="${src}"> takes its CSS from the file; leave the block empty`);
        styles.push({ kind: "src", src });
      } else {
        styles.push({ kind: "inline", css, lang: found.get("lang") ?? "css" });
      }
      cuts.push([start + match.index, start + match.index + whole.length]);
    }
    // An opening tag without its closing one here: `{{…}}` inside the block split it.
    if ((text.match(/<style\b/gi) ?? []).length !== matched) {
      throw new Error(`droplets: ${where}:${node.loc.start.line}: a <style> block cannot contain {{…}}: CSS is static`);
    }
  }

  let template = source;
  for (const [from, to] of cuts.toReversed()) {
    const lines = source.slice(from, to).split("\n").length - 1;
    template = template.slice(0, from) + "\n".repeat(lines) + template.slice(to);
  }
  return { template, styles };
}
