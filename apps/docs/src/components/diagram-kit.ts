/**
 * A small drawing kit for the docs' explanatory diagrams. Each diagram is
 * laid out twice from the same content, a wide scene for the content column
 * and a narrow one for phones, and `Diagram.astro` shows the one that fits.
 * Both are drawn at the size they are shown, so the type sizes below are the
 * sizes a reader sees. SVG text does not wrap, so `para` wraps it here from
 * glyph widths measured in Instrument Sans and JetBrains Mono (the docs'
 * --djs-font-* faces).
 */

export type Kind = "title" | "label" | "body" | "small" | "code" | "codesm";

export type Item =
  | { t: "rect"; x: number; y: number; w: number; h: number; c: string; rx: number }
  | { t: "circle"; x: number; y: number; r: number; c: string }
  | { t: "path"; d: string; c: string; end: boolean; start: boolean }
  | { t: "text"; x: number; y: number; s: string; c: string; a: "start" | "middle" | "end"; kind: Kind };

/** `nodes`: the boxes and decisions drawn, which `Diagram.astro` bounds. */
export type Scene = { w: number; h: number; items: Item[]; nodes: number };

/** The scene widths: the wide one fits the narrowest desktop column at 1:1, the narrow one a phone. */
export const WIDE = 620;
export const NARROW = 360;

export const SIZE: Record<Kind, number> = { title: 15, label: 14, body: 13, small: 12.5, code: 13, codesm: 12.5 };
const MONO: Record<Kind, boolean> = { title: false, label: false, body: false, small: false, code: true, codesm: true };
const BOLD: Record<Kind, number> = { title: 1.05, label: 1.03, body: 1, small: 1, code: 1, codesm: 1 };

function glyph(ch: string): number {
  if (ch === " ") return 0.2;
  if ("ilj.,:;'|!I`".includes(ch)) return 0.27;
  if ("ftr()[]{}".includes(ch)) return 0.42;
  if ("mwMW@".includes(ch)) return 0.97;
  if (/[A-Z]/.test(ch)) return 0.74;
  if (/[0-9]/.test(ch)) return 0.67;
  return 0.58;
}

/** The text's width in px, a little over what the browser draws. */
export function textWidth(s: string, kind: Kind): number {
  const size = SIZE[kind];
  if (MONO[kind]) return s.length * 0.6 * size;
  let em = 0;
  for (const ch of s) em += glyph(ch);
  return em * size * BOLD[kind] * 1.03;
}

/** Splits `s` into lines no wider than `width`; `\n` forces a break. */
export function wrap(s: string, width: number, kind: Kind): string[] {
  const out: string[] = [];
  for (const paragraph of s.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, kind) > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export class Draw {
  items: Item[] = [];
  nodes = 0;
  constructor(readonly w: number) {}

  size(kind: Kind): number {
    return SIZE[kind];
  }
  /** Line height for `kind`. */
  lh(kind: Kind): number {
    return Math.round(SIZE[kind] * 1.38 * 10) / 10;
  }
  rect(x: number, y: number, w: number, h: number, c: string, rx = 6): void {
    this.items.push({ t: "rect", x, y, w, h, c, rx });
  }
  /** Where the next item goes: pass it to `rectUnder` to draw a box behind what follows. */
  mark(): number {
    return this.items.length;
  }
  /** A box drawn behind everything added since `mark`, once its height is known. */
  rectUnder(mark: number, x: number, y: number, w: number, h: number, c: string, rx = 6): void {
    this.items.splice(mark, 0, { t: "rect", x, y, w, h, c, rx });
  }
  /** Counts a node drawn from plain shapes, such as a box with wrapped text. */
  node(): void {
    this.nodes++;
  }
  /** A node: a box with one centered label (or none). */
  box(x: number, y: number, w: number, h: number, c: string, label = "", kind: Kind = "label", ink = "", rx = 6): void {
    this.nodes++;
    this.rect(x, y, w, h, c, rx);
    if (label) this.text(x + w / 2, y + h / 2 + SIZE[kind] * 0.36, label, kind, ink, "middle");
  }
  /** A node with a title and a wrapped line under it, both centered; returns its bottom. */
  card(
    x: number,
    y: number,
    w: number,
    c: string,
    title: string,
    titleKind: Kind,
    sub: string,
    subKind: Kind = "small",
    ink = "",
    minH = 0,
  ): number {
    this.nodes++;
    const mark = this.mark();
    let bottom = this.para(x + w / 2, y + 10, w - 20, title, titleKind, ink, "middle");
    if (sub) bottom = this.para(x + w / 2, bottom + 4, w - 20, sub, subKind, "", "middle");
    const h = Math.max(bottom - y + 10, minH);
    this.rectUnder(mark, x, y, w, h, c);
    return y + h;
  }
  /** The height `card` takes, to line up a row of cards. */
  cardHeight(w: number, title: string, titleKind: Kind, sub: string, subKind: Kind = "small"): number {
    return 10 + this.measure(title, w - 20, titleKind) + (sub ? 4 + this.measure(sub, w - 20, subKind) : 0) + 10;
  }
  /** A decision diamond centered on (cx, cy). */
  diamond(cx: number, cy: number, w: number, h: number, c: string, label = "", kind: Kind = "label", ink = ""): void {
    this.nodes++;
    this.path(`M${cx} ${cy - h / 2} L${cx + w / 2} ${cy} L${cx} ${cy + h / 2} L${cx - w / 2} ${cy} Z`, c, false);
    if (label) {
      const lines = wrap(label, w * 0.62, kind);
      const top = cy - ((lines.length - 1) * this.lh(kind)) / 2 + SIZE[kind] * 0.36;
      lines.forEach((line, i) => {
        this.text(cx, Math.round((top + i * this.lh(kind)) * 10) / 10, line, kind, ink, "middle");
      });
    }
  }
  circle(x: number, y: number, r: number, c: string): void {
    this.items.push({ t: "circle", x, y, r, c });
  }
  path(d: string, c = "arrow", end = true, start = false): void {
    this.items.push({ t: "path", d, c, end, start });
  }
  line(x1: number, y1: number, x2: number, y2: number, c = "arrow", end = true, start = false): void {
    this.path(`M${x1} ${y1} L${x2} ${y2}`, c, end, start);
  }
  /** One line of text with its baseline at `y`. */
  text(x: number, y: number, s: string, kind: Kind, c = "", a: "start" | "middle" | "end" = "start"): void {
    this.items.push({ t: "text", x, y, s, c: `k-${kind} ${c}`.trim(), a, kind });
  }
  /**
   * What moves along an arrow: text on a patch of the page's background, so
   * it reads where it crosses a line. `top` is the patch's top.
   */
  tag(x: number, top: number, s: string, kind: Kind = "small", c = "ink", a: "start" | "middle" | "end" = "start"): number {
    const lines = s.split("\n");
    const w = Math.max(...lines.map((line) => textWidth(line, kind))) + 8;
    const h = SIZE[kind] + (lines.length - 1) * this.lh(kind) + 8;
    const left = a === "start" ? x - 4 : a === "middle" ? x - w / 2 : x - w + 4;
    this.rect(Math.round(left), top, Math.round(w), Math.round(h), "mask", 3);
    lines.forEach((line, i) => {
      this.text(x, Math.round((top + 4 + SIZE[kind] * 0.82 + i * this.lh(kind)) * 10) / 10, line, kind, c, a);
    });
    return top + h;
  }
  /** The height `para` takes for `s` in `width`. */
  measure(s: string, width: number, kind: Kind): number {
    const n = wrap(s, width, kind).length;
    return Math.round(SIZE[kind] + (n - 1) * this.lh(kind) + SIZE[kind] * 0.3);
  }
  /** Wrapped text whose box starts at `top`; returns where the box ends. */
  para(x: number, top: number, width: number, s: string, kind: Kind, c = "", a: "start" | "middle" | "end" = "start"): number {
    const lines = wrap(s, width, kind);
    let y = top + SIZE[kind];
    lines.forEach((line, i) => {
      if (i > 0) y += this.lh(kind);
      this.text(x, Math.round(y * 10) / 10, line, kind, c, a);
    });
    return Math.round(y + SIZE[kind] * 0.3);
  }
  scene(h: number): Scene {
    return { w: this.w, h: Math.ceil(h), items: this.items, nodes: this.nodes };
  }
}

export type SequenceStep = { from: number; to: number; text: string; res?: boolean } | { self: number; text: string };

/**
 * A sequence diagram, time running down: one lane per party, each step an
 * arrow labelled with what it carries (dashed for an answer), or a box on
 * one lane for what that party does in between.
 */
export function sequence(d: Draw, heads: { name: string; cls: string; ink: string }[], steps: SequenceStep[]): Scene {
  const lane = (d.w - 16) / heads.length;
  const lanes = heads.map((_, i) => Math.round(8 + lane * (i + 0.5)));
  const hw = Math.round(lane - 14);
  const lifelines = d.mark();
  heads.forEach((h, i) => {
    d.box(lanes[i]! - hw / 2, 8, hw, 36, h.cls, h.name, textWidth(h.name, "label") <= hw - 10 ? "label" : "small", h.ink);
  });
  let y = 62;
  for (const step of steps) {
    if ("self" in step) {
      const x = lanes[step.self]!;
      const bw = Math.min(hw, Math.round(textWidth(step.text, "small") + 20));
      d.node();
      const mark = d.mark();
      const bottom = d.para(x, y + 6, bw - 14, step.text, "small", "ink", "middle");
      d.rectUnder(mark, x - bw / 2, y, bw, bottom - y + 6, "drop", 5);
      y = bottom + 24;
      continue;
    }
    const x1 = lanes[step.from]!;
    const x2 = lanes[step.to]!;
    // A label may run past the next lane: the lifelines are faint enough to read across.
    const x = Math.min(x1, x2) + 10;
    const lines = step.text.split("\n").flatMap((line) => wrap(line, d.w - 8 - x, "small"));
    lines.forEach((line, i) => {
      d.text(x, y + SIZE.small + i * d.lh("small"), line, "small", "ink");
    });
    const ay = y + SIZE.small + (lines.length - 1) * d.lh("small") + 12;
    d.line(x1, ay, x2 + (x2 > x1 ? -2 : 2), ay, step.res ? "arrow dashed" : "arrow");
    y = ay + 18;
  }
  lanes.forEach((x) => {
    d.items.splice(lifelines, 0, { t: "path", d: `M${x} 44 L${x} ${y - 6}`, c: "life", end: false, start: false });
  });
  return d.scene(y);
}
