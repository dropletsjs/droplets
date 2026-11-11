import type { Page } from "@playwright/test";
import type { DropletFacts } from "./droplet-facts.ts";

/**
 * The droplet tour's overlay, injected by the recording alone: an outline
 * that follows the droplet under the cursor, its tag on a label, and a
 * caption panel in a corner with what droplets says about it. Nothing of
 * it is in the shop or the host.
 *
 * Nothing of it leaves the viewport. The label sits above the outline,
 * below it when there is no room above, and inside its top edge when there
 * is room on neither side; it is held inside the viewport, keeps clear of
 * the caption, and a long name ends in an ellipsis. The caption takes the
 * bottom-right corner unless another corner covers clearly less of the
 * droplet and its label, and never the cursor.
 */
const OVERLAY = `
(() => {
  if (window.__dropletTour) return;
  const css = document.createElement("style");
  css.textContent = [
    ".dt-ring{position:fixed;z-index:2147483640;pointer-events:none;box-sizing:border-box;border:3px solid #1c7ed6;border-radius:10px;box-shadow:0 0 0 5px rgba(28,126,214,.22),0 8px 30px rgba(28,126,214,.25);opacity:0;transition:opacity 220ms ease-out}",
    ".dt-tag{position:fixed;z-index:2147483640;pointer-events:none;box-sizing:border-box;display:flex;height:28px;padding:3px 10px;border-radius:6px;background:#1c7ed6;color:#fff;font:600 15px/22px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;opacity:0;transition:opacity 220ms ease-out}",
    ".dt-tag span{flex:none}",
    ".dt-tag span.v{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}",
    ".dt-on{opacity:1}",
    ".dt-panel{position:fixed;z-index:2147483641;pointer-events:none;width:420px;box-sizing:border-box;padding:18px 22px 20px;border-radius:14px;background:rgba(16,20,26,.96);color:#f1f3f5;font:18px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.35);opacity:0;transform:translateY(12px);transition:opacity 260ms ease-out,transform 260ms ease-out}",
    ".dt-panel.dt-on{opacity:1;transform:none}",
    ".dt-kicker{display:flex;justify-content:space-between;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#74c0fc;margin-bottom:4px}",
    ".dt-name{font:700 25px/1.25 ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;margin-bottom:12px;word-break:break-all}",
    ".dt-rows{display:grid;grid-template-columns:auto 1fr;gap:7px 18px;margin:0}",
    ".dt-rows dt{color:#adb5bd;font-size:17px}",
    ".dt-rows dd{margin:0;font-weight:600}",
    ".dt-rows dd.off{color:#ffa94d}",
  ].join("");
  const ring = document.createElement("div");
  ring.className = "dt-ring";
  const tag = document.createElement("div");
  tag.className = "dt-tag";
  const panel = document.createElement("div");
  panel.className = "dt-panel";
  for (const node of [ring, tag, panel]) node.setAttribute("aria-hidden", "true");
  document.documentElement.append(css, ring, tag, panel);

  /** Clear of the viewport's edges; the outline around the droplet; the caption from its corner; the label from the caption. */
  const MARGIN = 8, PAD = 6, INSET = 24, GAP = 6, LABEL = 28;
  const view = () => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight });
  const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });
  const overlap = (a, b) =>
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

  let target = null;
  /** The label's width with nothing cut, measured when its text changes. */
  let natural = 0;
  /** The caption's box while it shows: the label keeps clear of it. */
  let caption = null;
  let corner = "br";
  let move = 0;
  let mouse = null;
  addEventListener("mousemove", (event) => { mouse = { x: event.clientX, y: event.clientY }; }, { capture: true, passive: true });

  /** The outline's box: around the droplet, held inside the viewport's width. */
  const ringBox = (box, w) => ({
    left: Math.max(2, box.left - PAD),
    right: Math.min(w - 2, box.right + PAD),
    top: box.top - PAD,
    bottom: box.bottom + PAD,
  });

  /**
   * The label's place: above the outline, else below it, else inside its
   * top edge; the first that fits the viewport and keeps clear of the
   * caption at full width, else the one with the most room beside it.
   */
  const placeTag = (r, w, h) => {
    const full = Math.min(natural, w - 2 * MARGIN);
    const spots = [];
    if (r.top - LABEL >= MARGIN) spots.push({ y: r.top - LABEL, at: r.left, radius: "6px 6px 6px 0" });
    if (r.bottom + LABEL <= h - MARGIN) spots.push({ y: r.bottom, at: r.left, radius: "0 6px 6px 6px" });
    spots.push({ y: Math.min(Math.max(r.top + 3, MARGIN), h - MARGIN - LABEL), at: r.left + 3, radius: "4px 0 6px 0" });
    let best = null;
    for (const spot of spots) {
      let lo = MARGIN, hi = w - MARGIN;
      if (caption && spot.y < caption.bottom + GAP && spot.y + LABEL > caption.top - GAP) {
        if (caption.left > w / 2) hi = Math.min(hi, caption.left - GAP);
        else lo = Math.max(lo, caption.right + GAP);
      }
      const width = Math.max(0, Math.min(full, hi - lo));
      const x = Math.min(Math.max(spot.at, lo), hi - width);
      const placed = { ...spot, x, width };
      if (width >= full) { best = placed; break; }
      if (!best || width > best.width) best = placed;
    }
    tag.style.left = best.x + "px";
    tag.style.top = best.y + "px";
    tag.style.maxWidth = best.width + "px";
    tag.style.borderRadius = best.x === best.at ? best.radius : "6px";
  };

  const follow = () => {
    if (target) {
      const { w, h } = view();
      const r = ringBox(target.getBoundingClientRect(), w);
      ring.style.left = r.left + "px";
      ring.style.top = r.top + "px";
      ring.style.width = r.right - r.left + "px";
      ring.style.height = r.bottom - r.top + "px";
      placeTag(r, w, h);
    }
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);

  /** The caption's box in each corner. */
  const corners = (w, h, pw, ph) => ({
    br: rect(w - INSET - pw, h - INSET - ph, pw, ph),
    bl: rect(INSET, h - INSET - ph, pw, ph),
    tr: rect(w - INSET - pw, INSET, pw, ph),
    tl: rect(INSET, INSET, pw, ph),
  });

  /**
   * The caption's corner for the droplet: bottom-right, unless another
   * covers clearly less of what shows of the droplet and of its label;
   * never one over the cursor.
   */
  const chooseCorner = () => {
    const { w, h } = view();
    const box = target.getBoundingClientRect();
    const seen = { left: Math.max(0, box.left), top: Math.max(0, box.top), right: Math.min(w, box.right), bottom: Math.min(h, box.bottom) };
    const r = ringBox(box, w);
    const label = r.top - LABEL >= MARGIN ? rect(r.left, r.top - LABEL, natural, LABEL) : rect(r.left, r.bottom, natural, LABEL);
    const pointer = mouse ? rect(mouse.x - 6, mouse.y - 6, 34, 40) : null;
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    const options = corners(w, h, pw, ph);
    const cost = (at) => overlap(at, seen) + 4 * overlap(at, label) + (pointer && overlap(at, pointer) ? 1e9 : 0);
    let best = "br";
    for (const name of ["bl", "tr", "tl"]) if (cost(options[name]) < cost(options[best])) best = name;
    return cost(options[best]) < cost(options.br) - 0.4 * pw * ph ? best : "br";
  };

  const putCaption = (name) => {
    corner = name;
    panel.style.left = name.endsWith("l") ? INSET + "px" : "auto";
    panel.style.right = name.endsWith("r") ? INSET + "px" : "auto";
    panel.style.top = name.startsWith("t") ? INSET + "px" : "auto";
    panel.style.bottom = name.startsWith("b") ? INSET + "px" : "auto";
    const { w, h } = view();
    caption = corners(w, h, panel.offsetWidth, panel.offsetHeight)[name];
  };

  /** The caption in its corner: to change corners it fades out, then in at the new one. */
  const showCaption = () => {
    const next = chooseCorner();
    const token = ++move;
    if (next === corner || !panel.classList.contains("dt-on")) {
      putCaption(next);
      panel.classList.add("dt-on");
      return;
    }
    panel.classList.remove("dt-on");
    setTimeout(() => {
      if (token !== move) return;
      putCaption(next);
      panel.classList.add("dt-on");
    }, 280);
  };

  const text = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  putCaption("br");
  caption = null;
  window.__dropletTour = {
    focus(element, facts, place) {
      target = element;
      tag.innerHTML = "<span>&lt;" + text(element.localName) + ' data-droplet="</span><span class="v">' + text(facts.droplet) + '</span><span>"&gt;</span>';
      // Measured at the left edge, unbounded; rounded up, or a fraction of a pixel short cuts the name.
      tag.style.left = "0px";
      tag.style.maxWidth = "none";
      natural = Math.ceil(tag.getBoundingClientRect().width) + 1;
      ring.classList.add("dt-on");
      tag.classList.add("dt-on");
      const rows = [
        ["Framework", facts.framework],
        ["SSR", facts.ssr],
        ["Render", facts.render],
        ["Hydrate", facts.hydrate],
        ["Actions", facts.actions],
      ];
      panel.innerHTML =
        '<div class="dt-kicker"><span>Droplet</span><span>' + text(place) + "</span></div>" +
        '<div class="dt-name">' + text(facts.droplet) + "</div>" +
        '<dl class="dt-rows">' +
        rows.map(([label, value]) => "<dt>" + label + '</dt><dd class="' + (value === "off" || value === "none" || value.startsWith("never") ? "off" : "") + '">' + text(value) + "</dd>").join("") +
        "</dl>";
      showCaption();
    },
    leave() {
      target = null;
      ring.classList.remove("dt-on");
      tag.classList.remove("dt-on");
    },
    hideCaption() {
      move++;
      panel.classList.remove("dt-on");
      caption = null;
    },
    clear() {
      this.leave();
      this.hideCaption();
    },
  };
})();
`;

/** The overlay on the current page (again after each navigation). */
export async function installOverlay(page: Page): Promise<void> {
  await page.evaluate(OVERLAY);
}

/** Outlines the page's `index`-th droplet element and shows its facts. */
export async function focusDroplet(page: Page, element: string, index: number, facts: DropletFacts, place: string): Promise<void> {
  await page.evaluate(
    ({ element, index, facts, place }) => {
      const node = document.querySelectorAll(`${element}[data-droplet]`)[index];
      (window as unknown as { __dropletTour: { focus(e: Element, f: unknown, p: string): void } }).__dropletTour.focus(node!, facts, place);
    },
    { element, index, facts, place },
  );
}

/** Hides the outline, keeping the caption: the cursor is on its way to the next droplet. */
export async function leaveDroplet(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __dropletTour?: { leave(): void } }).__dropletTour?.leave());
}

/** Hides the caption, keeping the outline: the cursor works inside the droplet. */
export async function hideCaption(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __dropletTour?: { hideCaption(): void } }).__dropletTour?.hideCaption());
}

/** Hides the outline and the caption. */
export async function clearOverlay(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __dropletTour?: { clear(): void } }).__dropletTour?.clear());
}

/**
 * The overlay as it shows now, for the tour's checks: whether the label
 * lies inside the viewport, whether its name is cut short, and whether
 * it overlaps the caption.
 */
export async function overlayLayout(page: Page): Promise<{ tagInside: boolean; cut: boolean; clash: boolean }> {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    const tag = document.querySelector(".dt-tag.dt-on")?.getBoundingClientRect();
    const name = document.querySelector(".dt-tag.dt-on .v");
    const cut = !!name && name.scrollWidth > name.clientWidth;
    const panel = document.querySelector(".dt-panel.dt-on")?.getBoundingClientRect();
    const tagInside = !tag || (tag.left >= 0 && tag.top >= 0 && tag.right <= w && tag.bottom <= h);
    const clash =
      !!tag &&
      !!panel &&
      Math.min(tag.right, panel.right) > Math.max(tag.left, panel.left) &&
      Math.min(tag.bottom, panel.bottom) > Math.max(tag.top, panel.top);
    return { tagInside, cut, clash };
  });
}
