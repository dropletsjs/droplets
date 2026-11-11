import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "@playwright/test";

/**
 * A browser window drawn around a recording, after the fact: a title bar
 * with the traffic lights, a tab with the page's title and an address bar
 * with its URL, which follows every navigation. The page's own layout is
 * untouched: the bar is rendered as images, one per stretch of the run on
 * one URL, and laid over the video's padded top by ffmpeg.
 */

/** The bar's height above the page, in the video's pixels. */
export const BAR = 92;

/** One stretch of the run: from `at` (ms into the video), this URL and title. */
export type Stop = { at: number; url: string; title: string };

/**
 * The page's navigations as the video shows them: each main-frame
 * navigation from its commit, its title once the page has one.
 */
export function navigationTimeline(page: Page): Stop[] {
  const start = Date.now();
  const stops: Stop[] = [{ at: 0, url: "", title: "New Tab" }];
  const titled = (stop: Stop) => {
    page.title().then(
      (title) => {
        if (title) stop.title = title;
      },
      () => {},
    );
  };
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const stop = { at: Date.now() - start, url: frame.url(), title: "" };
    stops.push(stop);
    // A same-document navigation sets its title a moment later.
    setTimeout(() => titled(stop), 400);
  });
  page.on("domcontentloaded", () => titled(stops.at(-1)!));
  page.on("load", () => titled(stops.at(-1)!));
  return stops;
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** What the address bar shows: the URL without its scheme, as a browser does. */
const shown = (url: string) => (url === "about:blank" ? "" : url.replace(/^https?:\/\//, ""));

function barHtml(width: number, { url, title }: Stop): string {
  const secure = url.startsWith("https:");
  return `<!doctype html><html><head><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: ${width}px; height: ${BAR}px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #dfe1e5; overflow: hidden; }
  .strip { position: relative; height: 42px; }
  .lights { position: absolute; left: 18px; top: 15px; display: flex; gap: 8px; }
  .lights i { width: 13px; height: 13px; border-radius: 50%; }
  .tab { position: absolute; left: 84px; bottom: 0; width: 300px; height: 34px; padding: 0 12px 0 14px; display: flex; align-items: center; gap: 9px;
         background: #fff; border-radius: 10px 10px 0 0; font-size: 15px; color: #202124; }
  .tab b { flex: 1; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tab .x { color: #5f6368; font-size: 17px; }
  .fav { width: 16px; height: 16px; border-radius: 4px; background: #6b4eff; transform: rotate(45deg) scale(.75); }
  .plus { position: absolute; left: 396px; top: 11px; color: #5f6368; font-size: 20px; }
  .tools { height: ${BAR - 42}px; background: #fff; border-bottom: 1px solid #d3d6db; display: flex; align-items: center; gap: 18px; padding: 0 16px; }
  .tools .icon { color: #5f6368; font-size: 20px; width: 20px; text-align: center; }
  .tools .icon.off { color: #b4b8bd; }
  .address { flex: 1; height: 36px; border-radius: 18px; background: #f1f3f4; display: flex; align-items: center; gap: 10px; padding: 0 16px; }
  .address span { color: #5f6368; font-size: 15px; }
  .address em { font-style: normal; font-size: 19px; color: #202124; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: .1px; }
  </style></head><body>
  <div class="strip">
    <div class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
    <div class="tab">${url ? '<span class="fav"></span>' : ""}<b>${escapeHtml(title || shown(url) || "New Tab")}</b><span class="x">×</span></div>
    <div class="plus">+</div>
  </div>
  <div class="tools">
    <span class="icon">←</span><span class="icon off">→</span><span class="icon">↻</span>
    <div class="address"><span>${secure ? "🔒" : "ⓘ"}</span><em>${escapeHtml(shown(url))}</em></div>
    <span class="icon">⋮</span>
  </div>
  </body></html>`;
}

/**
 * `webm` with the window drawn around it, as H.264 MP4 at `mp4`. False
 * when ffmpeg could not (the caller keeps the plain video then).
 */
export async function framedMp4(
  browser: Browser,
  webm: string,
  mp4: string,
  stops: Stop[],
  width: number,
  height: number,
  work: string,
): Promise<boolean> {
  mkdirSync(work, { recursive: true });
  // Stops that change nothing on the bar, or last no time, are dropped.
  const kept: Stop[] = [];
  for (const stop of stops) {
    const last = kept.at(-1);
    if (last && stop.at - last.at < 40) kept.pop();
    const before = kept.at(-1);
    if (before && before.url === stop.url && before.title === stop.title) continue;
    kept.push(stop);
  }
  const page = await browser.newPage({ viewport: { width, height: BAR } });
  const list: string[] = [];
  for (const [index, stop] of kept.entries()) {
    const file = join(work, `bar-${index}.png`);
    await page.setContent(barHtml(width, stop));
    await page.screenshot({ path: file });
    const next = kept[index + 1];
    list.push(`file '${file}'`, `duration ${(((next?.at ?? stop.at + 3_600_000) - stop.at) / 1000).toFixed(3)}`);
  }
  await page.close();
  // The concat demuxer takes the last file's duration only when it is listed once more.
  list.push(list.at(-2)!);
  const bars = join(work, "bars.txt");
  writeFileSync(bars, `${list.join("\n")}\n`);
  const converted = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      webm,
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      bars,
      "-filter_complex",
      `[0:v]pad=${width}:${height + BAR}:0:${BAR}:color=white[page];[1:v]fps=25,format=rgba[bar];[page][bar]overlay=0:0:shortest=1,format=yuv420p[v]`,
      "-map",
      "[v]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mp4,
    ],
    { stdio: "inherit" },
  );
  return !converted.error && converted.status === 0;
}
