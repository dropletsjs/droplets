import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test as base, type Locator, type Page } from "@playwright/test";
import { framedMp4, navigationTimeline } from "./browser-frame.ts";

/** Where videos and screenshots go: gitignored, never uploaded. */
export const RECORDINGS = join(import.meta.dirname, "..", "recordings");

/** The host under test, from run.mjs. */
export const HOST = process.env["HOST_NAME"] ?? "host";

/**
 * Human pacing (run.mjs sets it for the docs' recordings): the cursor
 * glides, hovers, pauses and types as a person would. Off, the flow runs
 * as fast as the page allows.
 */
export const HUMAN = process.env["RECORD_PACE"] === "human";

const SIZE = { width: 1280, height: 800 };

/** Where the drawn cursor starts, before the first move. */
const START = { x: 1010, y: 610 };

/**
 * A cursor the video can show: an arrow that follows the mouse, and a
 * ripple on each press. Headless Chromium draws no pointer of its own. It
 * keeps its place across page loads (sessionStorage), so a new page does
 * not lose it.
 */
const CURSOR = `
addEventListener("DOMContentLoaded", () => {
  const KEY = "__recording_cursor";
  let at = null;
  try { at = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch {}
  const cursor = document.createElement("div");
  cursor.setAttribute("aria-hidden", "true");
  cursor.style.cssText = "position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;transform-origin:2px 2px;transition:scale 90ms ease-out";
  cursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 22 22" style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))"><path d="M2 2 L2 18 L7 13.5 L10.5 21 L13.5 19.6 L10 12.4 L16.5 12.4 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const place = (x, y) => { cursor.style.transform = "translate(" + x + "px," + y + "px)"; };
  place(at ? at.x : -100, at ? at.y : -100);
  document.documentElement.append(cursor);
  addEventListener("mousemove", (event) => {
    place(event.clientX, event.clientY);
    try { sessionStorage.setItem(KEY, JSON.stringify({ x: event.clientX, y: event.clientY })); } catch {}
  }, { capture: true, passive: true });
  addEventListener("mousedown", (event) => {
    cursor.style.scale = "0.85";
    const at = "left:" + event.clientX + "px;top:" + event.clientY + "px;";
    const pulse = document.createElement("div");
    pulse.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(232,89,12,.35);" + at + "transform:scale(.3);transition:transform 450ms cubic-bezier(.2,.7,.3,1),opacity 450ms ease-out";
    const ring = document.createElement("div");
    ring.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #e8590c;box-sizing:border-box;" + at + "transform:scale(.4);transition:transform 600ms cubic-bezier(.2,.7,.3,1),opacity 600ms ease-out";
    document.documentElement.append(pulse, ring);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pulse.style.transform = "scale(1.1)"; pulse.style.opacity = "0";
      ring.style.transform = "scale(1.6)"; ring.style.opacity = "0";
    }));
    setTimeout(() => { pulse.remove(); ring.remove(); }, 650);
  }, { capture: true, passive: true });
  addEventListener("mouseup", () => { cursor.style.scale = "1"; }, { capture: true, passive: true });
});
`;

/**
 * Playwright records WebM; the recordings are kept as H.264 MP4 (ffmpeg on
 * the PATH). Without ffmpeg the WebM is kept instead, with a warning.
 */
function toMp4(webm: string, mp4: string) {
  const converted = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4],
    { stdio: "inherit" },
  );
  if (converted.error || converted.status !== 0) {
    const kept = mp4.replace(/\.mp4$/, ".webm");
    copyFileSync(webm, kept);
    console.warn(`ffmpeg could not convert the video (${converted.error?.message ?? `exit ${converted.status}`}); kept ${kept}`);
  }
}

/** A seeded generator (mulberry32): the same seed, the same pauses and paths. */
function seeded(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

type Point = { x: number; y: number };

/** Where in the element the cursor goes, as fractions of its box (0.5, 0.5 is its center). */
export type Spot = { x: number; y: number };

export type Recorder = {
  /** Whether this recording is paced as a person would use the page. */
  readonly human: boolean;
  /** A number in [min, max) from this recording's seeded generator. */
  random(min: number, max: number): number;
  /** Moves the cursor to the element, then clicks it. */
  click(target: Locator): Promise<void>;
  /** Moves the cursor to a field, clicks it and types the value. */
  fill(target: Locator, value: string): Promise<void>;
  /** Moves the cursor onto the element (scrolled into view first) and leaves it there. */
  hover(target: Locator, spot?: Spot): Promise<void>;
  /** Scrolls the element into view: smoothly when human. */
  reveal(target: Locator): Promise<void>;
  /** Human only: down through the whole page at a reading pace, a pause at the bottom, and back up. */
  scrollThrough(): Promise<void>;
  /** A full-viewport screenshot in recordings/<recording>/<name>.png. */
  shot(name: string): Promise<string>;
  /** A pause the video can show: at least `ms`, and 0.5–1.25 s when human. */
  beat(ms?: number): Promise<void>;
};

/**
 * The cursor and the pauses, as a person would move: a curved, eased path
 * at a human speed, a short hover before each click, a pause between
 * actions (longer after a page change, so the viewer sees it) and typing
 * one key at a time. Fast mode keeps the old straight moves and no pauses.
 */
function recorder(page: Page, dir: string, human: boolean, seed: string, pageChanged: () => number): Recorder {
  const rng = seeded(seed);
  const random = (min: number, max: number) => min + (max - min) * rng();
  let cursor: Point | null = null;
  /** When the last action ended: the pause before the next one counts from there. */
  let idleSince = Date.now();

  /** Before an action: 0.5–1.25 s since the last one, at least about 1 s since the page changed. */
  const settle = async () => {
    const changed = pageChanged();
    let wait = random(500, 1250) - (Date.now() - idleSince);
    if (changed > idleSince) wait = Math.max(wait, random(950, 1150) - (Date.now() - changed));
    await sleep(wait);
  };
  const done = () => {
    idleSince = Date.now();
  };

  /** The page's own scroll, smooth, until it rests. */
  const reveal = async (target: Locator) => {
    if (!human) {
      await target.scrollIntoViewIfNeeded();
      return;
    }
    const moved = await target.evaluate(
      (element) =>
        new Promise<boolean>((resolve) => {
          const box = element.getBoundingClientRect();
          const view = innerHeight;
          const tall = box.height > view * 0.7;
          if (box.top >= 70 && (tall ? box.top < view * 0.45 : box.bottom <= view - 20)) return resolve(false);
          const top = tall ? scrollY + box.top - 90 : scrollY + box.top + box.height / 2 - view / 2;
          scrollTo({ top: Math.max(0, top), behavior: "smooth" });
          let last = -1;
          let still = 0;
          const tick = () => {
            if (Math.abs(scrollY - last) < 0.5) {
              if (++still > 6) return resolve(true);
            } else {
              still = 0;
              last = scrollY;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          setTimeout(() => resolve(true), 2500);
        }),
    );
    if (moved) await sleep(random(250, 450));
  };

  /** A point inside the element's box, in the viewport. */
  const spotIn = async (target: Locator, spot?: Spot): Promise<{ point: Point; offset: Point }> => {
    const box = await target.boundingBox();
    if (!box) throw new Error("the cursor's target has no box");
    const fx = spot?.x ?? 0.5 + random(-0.18, 0.18);
    const fy = spot?.y ?? 0.5 + random(-0.18, 0.18);
    const offset = { x: Math.round(box.width * fx), y: Math.round(box.height * fy) };
    const point = {
      x: Math.min(SIZE.width - 4, Math.max(4, box.x + offset.x)),
      y: Math.min(SIZE.height - 4, Math.max(4, box.y + offset.y)),
    };
    return { point, offset: { x: point.x - box.x, y: point.y - box.y } };
  };

  /** Along a gently curved, eased path, at a human speed (about 0.3–0.85 s). */
  const glide = async (to: Point) => {
    if (!cursor) {
      cursor = START;
      await page.mouse.move(START.x, START.y);
      await sleep(random(300, 500));
    }
    const from = cursor;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 3) return;
    const duration = Math.min(850, Math.max(300, 220 + distance * 0.5)) * random(0.9, 1.12);
    // The bend: off the straight line, to one side, less near the end.
    const bend = distance * random(0.06, 0.2) * (rng() < 0.5 ? -1 : 1);
    const nx = -dy / distance;
    const ny = dx / distance;
    const c1 = { x: from.x + dx * 0.3 + nx * bend, y: from.y + dy * 0.3 + ny * bend };
    const c2 = { x: from.x + dx * 0.78 + nx * bend * 0.45, y: from.y + dy * 0.78 + ny * bend * 0.45 };
    const steps = Math.max(10, Math.round(duration / 16));
    const start = Date.now();
    for (let i = 1; i <= steps; i++) {
      const t = easeInOut(i / steps);
      const u = 1 - t;
      const x = u ** 3 * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * to.x;
      const y = u ** 3 * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * to.y;
      await page.mouse.move(x, y);
      await sleep(start + (i * duration) / steps - Date.now());
    }
    cursor = to;
  };

  const moveTo = async (target: Locator, spot?: Spot) => {
    await reveal(target);
    if (!human) {
      const box = await target.boundingBox();
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
      return undefined;
    }
    const { point, offset } = await spotIn(target, spot);
    await glide(point);
    return offset;
  };

  return {
    human,
    random,
    async click(target) {
      if (!human) {
        await moveTo(target);
        await page.waitForTimeout(150);
        await target.click();
        return;
      }
      await settle();
      const position = await moveTo(target);
      await sleep(random(200, 400));
      await target.click(position ? { position } : {});
      done();
    },
    async fill(target, value) {
      if (!human) {
        await moveTo(target);
        await target.click();
        await target.fill("");
        await target.pressSequentially(value, { delay: 40 });
        return;
      }
      await settle();
      const position = await moveTo(target);
      await sleep(random(180, 380));
      await target.click(position ? { position } : {});
      await sleep(random(150, 300));
      // What the field held goes the way a person replaces it: all selected, typed over.
      await page.keyboard.press("ControlOrMeta+A");
      for (const char of value) {
        await page.keyboard.type(char);
        await sleep(random(60, 190));
      }
      if ((await target.inputValue()) !== value) await target.fill(value);
      done();
    },
    async hover(target, spot) {
      if (human) await settle();
      await moveTo(target, spot);
      done();
    },
    reveal,
    async scrollThrough() {
      if (!human) return;
      await settle();
      const scroll = (to: "top" | "bottom", speed: number) =>
        page.evaluate(
          ({ to, speed }) =>
            new Promise<void>((resolve) => {
              const start = scrollY;
              const end = to === "top" ? 0 : document.documentElement.scrollHeight - innerHeight;
              const duration = Math.max(600, (Math.abs(end - start) / speed) * 1000);
              const began = performance.now();
              const step = (now: number) => {
                const t = Math.min(1, (now - began) / duration);
                const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
                scrollTo(0, start + (end - start) * eased);
                if (t < 1) requestAnimationFrame(step);
                else resolve();
              };
              requestAnimationFrame(step);
            }),
          { to, speed },
        );
      await scroll("bottom", random(650, 760));
      await sleep(random(1100, 1500));
      await scroll("top", random(1600, 1900));
      done();
    },
    async shot(name) {
      const path = join(dir, `${name}.png`);
      await page.screenshot({ path });
      return path;
    },
    beat: (ms = 500) => (human ? sleep(Math.max(ms, random(500, 1250))) : page.waitForTimeout(ms)),
  };
}

/**
 * `page` in a context of its own that records a video (saved as
 * recordings/<recording>.mp4 when the test ends, inside a drawn browser
 * window whose address bar follows the page: browser-frame.ts) and draws
 * the cursor;
 * `rec` moves it. `recording` names the files (the host by default) and
 * seeds the pacing; `human` paces it as a person.
 */
export const test = base.extend<{ recording: string; human: boolean; page: Page; rec: Recorder }>({
  recording: [HOST, { option: true }],
  human: [HUMAN, { option: true }],
  page: async ({ browser, baseURL, recording, human }, use, info) => {
    const dir = join(RECORDINGS, recording);
    mkdirSync(dir, { recursive: true });
    const raw = join(info.outputDir, "video");
    const context = await browser.newContext({
      baseURL,
      viewport: SIZE,
      ignoreHTTPSErrors: true,
      recordVideo: { dir: raw, size: SIZE },
    });
    await context.addInitScript(CURSOR);
    const page = await context.newPage();
    // The video starts with the page: its URLs from here, for the window drawn around it.
    const stops = navigationTimeline(page);
    await use(page);
    // The last frame stays a moment before the video ends.
    if (human) await sleep(1200);
    await context.close();
    const video = page.video();
    if (video) {
      const webm = join(raw, "flow.webm");
      await video.saveAs(webm);
      const mp4 = join(RECORDINGS, `${recording}.mp4`);
      if (!(await framedMp4(browser, webm, mp4, stops, SIZE.width, SIZE.height, join(raw, "frame")))) {
        console.warn("could not draw the browser window around the video; keeping it without");
        toMp4(webm, mp4);
      }
      rmSync(raw, { recursive: true, force: true });
    }
  },
  rec: async ({ page, recording, human }, use) => {
    // When the page last changed (a load, or a same-document navigation).
    let changed = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) changed = Date.now();
    });
    await use(recorder(page, join(RECORDINGS, recording), human, recording, () => changed));
  },
});

export { expect } from "@playwright/test";
