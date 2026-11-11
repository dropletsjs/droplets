// Draws the docs-home tour's poster: a wireframe of the shop's gallery on a
// WordPress page, its droplets outlined and named. Writes tour-poster.svg
// next to this file, with the docs' own fonts embedded; render.mjs turns it
// into public/hosts/tour.webp. The play button is the page's own <button>
// (src/components/DropletTour.astro), so the poster has none.
//
//   node apps/docs/scripts/poster/gen.mjs && node apps/docs/scripts/poster/render.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const font = (file) => readFileSync(require.resolve(file)).toString("base64");
const INTER = font("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");
const MONO = font("@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2");

// The dark set of src/styles/tokens.css: the poster is the same in both themes.
const T = {
  s100: "#111417", s200: "#181c20", s300: "#20252a",
  line: "#2a3036", lineStrong: "#69737d", ink: "#e8ecef",
  accent2: "#a9bbe3",
};
const W = 1034, H = 720;
const TITLE = "Wireframe of the shop's gallery on a WordPress page, its droplets outlined";
// JetBrains Mono's advance, in em: the labels are sized from it.
const MONO_ADV = 0.6;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const text = (x, y, s, { size = 14, weight = 400, fill = T.ink, cls = "sans", anchor = "start" } = {}) =>
  `<text x="${x}" y="${y}" class="${cls}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;

const rect = (x, y, w, h, { r = 0, fill = "none", stroke, sw = 1, op = 1 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ""}${op !== 1 ? ` opacity="${op}"` : ""}/>`;

const bar = (x, y, w, h = 10, fill = T.line) => rect(x, y, w, h, { r: h / 2, fill });

/** The dev tool's label, `<djs-shop data-droplet="…">` on an accent-2 tab. */
function tag(name, x, y, size, { alignEnd = false } = {}) {
  const s = `<djs-shop data-droplet="${name}">`;
  const pad = Math.round(size * 0.7);
  const w = Math.round(s.length * size * MONO_ADV + pad * 2);
  const h = Math.round(size * 1.75);
  const x0 = alignEnd ? x - w : x;
  return {
    h,
    svg: rect(x0, y, w, h, { r: 3, fill: T.accent2 }) +
      text(x0 + pad, y + h / 2 + size * 0.36, s, { size, weight: 600, fill: T.s100, cls: "mono" }),
  };
}

const dropletBox = (x, y, w, h) =>
  rect(x, y, w, h, { r: 6, fill: T.accent2, op: 0.06 }) + rect(x, y, w, h, { r: 6, stroke: T.accent2, sw: 1.75 });

const fx = 40, fy = 32, fw = W - 80, fh = 656;
const L = 72, R = W - 72;
const cartTag = tag("shopping-cart", R, 78, 12, { alignEnd: true });
const filterTag = tag("product-filter", L, 238, 12);
const libX = L + 324;
const libTag = tag("product-library", libX, 238, 12);
const fwLabel = (x, y, s, anchor) => text(x, y, s, { size: 26, weight: 650, fill: T.accent2, anchor });
const hostLabel = (x, y, s, anchor = "end") => text(x, y, s, { size: 11, fill: T.lineStrong, cls: "mono", anchor });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(TITLE)}">
<title>${esc(TITLE)}</title>
<style>
@font-face{font-family:"Inter Variable";font-weight:100 900;src:url(data:font/woff2;base64,${INTER}) format("woff2")}
@font-face{font-family:"JetBrains Mono Variable";font-weight:100 800;src:url(data:font/woff2;base64,${MONO}) format("woff2")}
.sans{font-family:"Inter Variable",sans-serif}
.mono{font-family:"JetBrains Mono Variable",monospace}
</style>
<rect width="${W}" height="${H}" fill="${T.s100}"/>
${rect(fx, fy, fw, fh, { r: 12, fill: T.s200, stroke: T.line })}
<circle cx="${fx + 20}" cy="${fy + 17}" r="4.5" fill="${T.line}"/><circle cx="${fx + 36}" cy="${fy + 17}" r="4.5" fill="${T.line}"/><circle cx="${fx + 52}" cy="${fy + 17}" r="4.5" fill="${T.line}"/>
${text(fx + 76, fy + 21, "WordPress page · /gallery", { size: 12, fill: T.lineStrong, cls: "mono" })}
<line x1="${fx}" x2="${fx + fw}" y1="${fy + 34}" y2="${fy + 34}" stroke="${T.line}"/>
${bar(L, 104, 150, 14)}
${[0, 1, 2, 3].map((i) => bar(400 + i * 64, 106, 46, 10)).join("")}
${hostLabel(L, 136, "header (WordPress)", "start")}
${cartTag.svg}
${dropletBox(R - 120, 78 + cartTag.h, 120, 34)}
${text(R - 60, 78 + cartTag.h + 23, "React", { size: 17, weight: 650, fill: T.accent2, anchor: "middle" })}
<line x1="${fx}" x2="${fx + fw}" y1="144" y2="144" stroke="${T.line}"/>
${rect(L, 156, R - L, 62, { r: 8, fill: T.s300 })}
${bar(L + 24, 172, 300, 14, "#323a41")}${bar(L + 24, 196, 210, 8, "#2c3339")}
${hostLabel(R - 16, 191, "hero (WordPress)")}
${filterTag.svg}
${dropletBox(L, 238 + filterTag.h, 280, 664 - 238 - filterTag.h)}
${fwLabel(L + 20, 304, "Hono JSX", "start")}
${bar(L + 20, 330, 240, 22, "#232930")}
${[0, 1, 2, 3, 4].map((i) => bar(L + 20, 376 + i * 30, 140 - (i % 3) * 24, 9, "#232930")).join("")}
${bar(L + 20, 540, 240, 22, "#232930")}
${libTag.svg}
${dropletBox(libX, 238 + libTag.h, R - libX, 664 - 238 - libTag.h)}
${fwLabel(R - 20, 304, "Svelte", "end")}
${[0, 1, 2, 3].map((i) => rect(libX + 20 + i * 136, 330, 122, 196, { r: 8, stroke: "#262c33", fill: "#1c2126" })).join("")}
</svg>
`;

const out = fileURLToPath(new URL("tour-poster.svg", import.meta.url));
writeFileSync(out, svg);
console.log(`wrote ${out}`);
