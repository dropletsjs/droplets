// One media range of an `Accept` header, with its weight and how precise it
// is: 0 for the full wildcard, 1 for a type wildcard, 2 for a full type.
type MediaRange = { type: string; subtype: string; q: number; precision: number };

type ParseAcceptInput = { accept: string };

function parseAccept({ accept }: ParseAcceptInput): MediaRange[] {
  const ranges: MediaRange[] = [];
  for (const part of accept.split(",")) {
    const [media = "", ...params] = part.split(";");
    const pieces = media.trim().toLowerCase().split("/");
    const [type = "", subtype = ""] = pieces;
    if (pieces.length !== 2 || type === "" || subtype === "") continue;
    let q = 1;
    for (const param of params) {
      const [name = "", value = ""] = param.split("=");
      if (name.trim().toLowerCase() !== "q") continue;
      const weight = Number(value.trim());
      // A weight outside 0..1 is no weight: the range stands as written.
      if (Number.isFinite(weight) && weight >= 0 && weight <= 1) q = weight;
    }
    ranges.push({ type, subtype, q, precision: type === "*" ? 0 : subtype === "*" ? 1 : 2 });
  }
  return ranges;
}

type MatchOfInput = { ranges: readonly MediaRange[]; type: string; subtype: string };

/** The most precise range matching `type/subtype`, or `null` when none does. */
function matchOf({ ranges, type, subtype }: MatchOfInput): MediaRange | null {
  let best: MediaRange | null = null;
  for (const range of ranges) {
    const matches = (range.type === "*" || range.type === type) && (range.subtype === "*" || range.subtype === subtype);
    if (matches && (best === null || range.precision > best.precision)) best = range;
  }
  return best;
}

export type PrefersJsonInput = { accept: string | null | undefined };

/**
 * Whether a request asks for JSON rather than HTML: `application/json` is
 * accepted through an `application/json` or `application/*` range (the full
 * wildcard alone names nothing), with a weight at least `text/html`'s. A
 * browser's navigation (`text/html, …` with the wildcard at `q=0.8`) is not;
 * `accept: application/json` (an enhanced form, any script) is.
 */
export function prefersJson({ accept }: PrefersJsonInput): boolean {
  if (!accept) return false;
  const ranges = parseAccept({ accept });
  const json = matchOf({ ranges, type: "application", subtype: "json" });
  if (json === null || json.precision === 0 || json.q === 0) return false;
  const html = matchOf({ ranges, type: "text", subtype: "html" });
  return html === null || json.q >= html.q;
}
