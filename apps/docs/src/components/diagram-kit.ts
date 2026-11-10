/**
 * A small drawing kit for the docs' explanatory diagrams. Each diagram is
 * laid out twice from the same content, a wide scene for the content column
 * and a narrow one for phones, and `Diagram.astro` shows the one that fits.
 * SVG text does not wrap, so `para` wraps it here from glyph widths measured
 * in Instrument Sans and JetBrains Mono (the docs' --djs-font-* faces).
 */

export type Kind = "title" | "label" | "body" | "small" | "code" | "codesm";

export type Item =
  | { t: "rect"; x: number; y: number; w: number; h: number; c: string; rx: number }
  | { t: "circle"; x: number; y: number; r: number; c: string }
  | { t: "path"; d: string; c: string; end: boolean; start: boolean }
  | { t: "text"; x: number; y: number; s: string; c: string; a: "start" | "middle" | "end" };

export type Scene = { w: number; h: number; items: Item[] };

const SIZE: Record<Kind, number> = { title: 13, label: 12, body: 11.5, small: 10.5, code: 11, codesm: 10 };
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

/** The text's width in px at `size`, a little over what the browser draws. */
export function textWidth(s: string, kind: Kind, scale = 1): number {
  const size = SIZE[kind] * scale;
  if (MONO[kind]) return s.length * 0.6 * size;
  let em = 0;
  for (const ch of s) em += glyph(ch);
  return em * size * BOLD[kind] * 1.03;
}

/** Splits `s` into lines no wider than `width`; `\n` forces a break. */
export function wrap(s: string, width: number, kind: Kind, scale = 1): string[] {
  const out: string[] = [];
  for (const paragraph of s.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, kind, scale) > width) {
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
  constructor(
    readonly w: number,
    /** Type scale: the narrow scenes set it a little over 1. */
    readonly scale = 1,
  ) {}

  size(kind: Kind): number {
    return SIZE[kind] * this.scale;
  }
  /** Line height for `kind`. */
  lh(kind: Kind): number {
    return Math.round(this.size(kind) * 1.38 * 10) / 10;
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
  /** A box with one centered label (or none). */
  box(x: number, y: number, w: number, h: number, c: string, label = "", kind: Kind = "label", ink = "", rx = 6): void {
    this.rect(x, y, w, h, c, rx);
    if (label) this.text(x + w / 2, y + h / 2 + this.size(kind) * 0.36, label, kind, ink, "middle");
  }
  /** A decision diamond centered on (cx, cy). */
  diamond(cx: number, cy: number, w: number, h: number, c: string, label = "", kind: Kind = "label", ink = ""): void {
    this.path(`M${cx} ${cy - h / 2} L${cx + w / 2} ${cy} L${cx} ${cy + h / 2} L${cx - w / 2} ${cy} Z`, c, false);
    if (label) this.text(cx, cy + this.size(kind) * 0.36, label, kind, ink, "middle");
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
    this.items.push({ t: "text", x, y, s, c: `k-${kind} ${c}`.trim(), a });
  }
  /** The height `para` takes for `s` in `width`. */
  measure(s: string, width: number, kind: Kind): number {
    const n = wrap(s, width, kind, this.scale).length;
    return Math.round(this.size(kind) + (n - 1) * this.lh(kind) + this.size(kind) * 0.3);
  }
  /** Wrapped text whose box starts at `top`; returns where the box ends. */
  para(x: number, top: number, width: number, s: string, kind: Kind, c = "", a: "start" | "middle" | "end" = "start"): number {
    const lines = wrap(s, width, kind, this.scale);
    let y = top + this.size(kind);
    lines.forEach((line, i) => {
      if (i > 0) y += this.lh(kind);
      this.text(x, Math.round(y * 10) / 10, line, kind, c, a);
    });
    return Math.round(y + this.size(kind) * 0.3);
  }
  scene(h: number): Scene {
    return { w: this.w, h: Math.ceil(h), items: this.items };
  }
}
