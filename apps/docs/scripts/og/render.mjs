// Draws the share image (og:image, twitter:image) in the docs' dark tokens
// and fonts, from the title and the ogImage text in site.mjs, and writes it as
// public/og.png in Playwright's Chromium.
//
//   node apps/docs/scripts/og/render.mjs [out.png]
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { ogImage, title } from "../../site.mjs";

const require = createRequire(import.meta.url);
const font = (file) => readFileSync(require.resolve(file)).toString("base64");
const INTER = font("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");
const MONO = font("@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2");
const DROP = readFileSync(new URL("../../public/favicon.svg", import.meta.url), "utf8").match(/ d="([^"]+)"/)[1];

const out = process.argv[2] ?? fileURLToPath(new URL(`../../public/${ogImage.file}`, import.meta.url));
const { width, height, tagline, frameworks } = ogImage;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face{font-family:"Inter Variable";font-weight:100 900;src:url(data:font/woff2;base64,${INTER}) format("woff2")}
@font-face{font-family:"JetBrains Mono Variable";font-weight:100 800;src:url(data:font/woff2;base64,${MONO}) format("woff2")}
html,body{margin:0}
body{width:${width}px;height:${height}px;box-sizing:border-box;padding:72px 80px 64px;background:#111417;color:#e8ecef;
  font-family:"Inter Variable",sans-serif;display:flex;flex-direction:column;position:relative;overflow:hidden}
.mark{position:absolute;right:-120px;top:130px;width:420px;height:420px;opacity:.1}
.brand{display:flex;align-items:center;gap:22px}
.brand svg{width:76px;height:76px}
h1{margin:0;font-size:104px;font-weight:650;letter-spacing:-.025em;line-height:1}
p{margin:44px 0 0;max-width:780px;text-wrap:balance;font-size:42px;line-height:1.3;font-weight:450;color:#c1c8ce;letter-spacing:-.01em}
ul{margin:auto 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:12px;max-width:960px}
li{font:500 21px/1 "JetBrains Mono Variable",monospace;color:#a9bbe3;border:1px solid #2a3036;background:#181c20;border-radius:4px;padding:10px 14px}
.site{position:absolute;right:80px;top:72px;font:500 22px/1 "JetBrains Mono Variable",monospace;color:#9aa4ae}
</style></head><body>
<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><path d="${DROP}" fill="#ff5f24"/></svg>
<div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="${DROP}" fill="#ff5f24"/></svg><h1>${esc(title)}</h1></div>
<p>${esc(tagline)}</p>
<ul>${frameworks.map((name) => `<li>${esc(name)}</li>`).join("")}</ul>
<div class="site">dropletsjs.dev</div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(out, await page.screenshot({ type: "png" }));
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
