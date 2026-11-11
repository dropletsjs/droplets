// WordPress answers HTML where the shop wants text: `title.rendered` and
// `content.rendered` went through its filters (`wpautop` paragraphs,
// `wptexturize` quotes, entities). The shop never pastes that HTML: it takes
// the text out, and its templates escape it again like any other text.

const NAMED: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  euro: "€",
});

/** `&#8217;`, `&#x2019;`, `&rsquo;` → `’`. An unknown or invalid entity stays as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      const ok = Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return ok ? String.fromCodePoint(code) : whole;
    }
    return Object.hasOwn(NAMED, name.toLowerCase()) ? NAMED[name.toLowerCase()]! : whole;
  });
}

/** Control characters other than the line break, which nothing displays. */
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

/**
 * Rendered HTML as text: paragraphs (`</p>`, `<br>`, blank lines) kept as
 * blank lines, every tag dropped, entities decoded, spaces folded, at most
 * `max` characters. The answer was capped before this; this caps again.
 */
export function plainText(html: string, max: number): string {
  const paragraphs = html
    .slice(0, max * 4)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .split(/<\s*\/\s*p\s*>|\n\s*\n/i)
    .map((part) =>
      decodeEntities(part.replace(/<[^>]*>/g, ""))
        .replace(CONTROL, "")
        .replace(/[ \t\r\n]+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  return paragraphs.join("\n\n").slice(0, max).trim();
}

/** A one-line text (a title, a name): `plainText` without paragraphs. */
export const plainLine = (html: string, max: number) => plainText(html, max).replace(/\s+/g, " ");
