// Renders tour-poster.svg (gen.mjs) in Chromium, the fonts it embeds
// included, and writes it as public/hosts/tour.webp. The browser encodes the
// WebP too: a canvas's toDataURL, so no image library is needed.
//
//   node apps/docs/scripts/poster/render.mjs [out.webp]
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const svg = new URL("tour-poster.svg", import.meta.url);
const out = process.argv[2] ?? fileURLToPath(new URL("../../public/hosts/tour.webp", import.meta.url));
const [width, height] = [1034, 720];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(svg.href);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: "png" });

  await page.goto("about:blank");
  const webp = await page.evaluate(async ({ src, width, height }) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas.toDataURL("image/webp", 0.85).split(",")[1];
  }, { src: `data:image/png;base64,${png.toString("base64")}`, width, height });
  writeFileSync(out, Buffer.from(webp, "base64"));
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
