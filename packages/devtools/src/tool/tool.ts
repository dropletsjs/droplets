/**
 * The Droplets dev tool: one floating panel per page, under `vite dev`.
 *
 * Each droplets server's `index.js` imports this module (for
 * `dev.injectTool` or `index.js?injectTool=true`) and registers with
 * `window.DropletsDevTools`; the first module to run creates the tool, so a
 * host page that embeds droplets from several servers still gets one panel,
 * with a group per server. The panel lives in a shadow root, out of the
 * host's styles and out of theirs.
 */
import type { DevElementInfo, DevNotification, DevToolSource, DropletsDevTools } from "@dropletsjs/droplets";
import { describeMode, type DropletInfo } from "../shared.ts";

/** What `/__droplets/devtools.json` answers: the server's droplets with their flags. */
type ServerInfo = { element: string; droplets: DropletInfo[] };

const OPEN_KEY = "droplets-devtools:tool-open";
const STRATEGIES = ["hmr", "remount", "reload", "manual"] as const;
/** At most this many notifications at once: the oldest goes first. */
const MAX_NOTES = 3;
/** How long a notification without a button stays. */
const NOTE_TIMEOUT = 10_000;

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.root { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--fg); --fg: #1d2330; --muted: #5d6677; --bg: #ffffff; --line: #d9dee7; --accent: #2a62d8; --warn: #a3520c; --ok: #1d7a46; --err: #b42318; }
@media (prefers-color-scheme: dark) { .root { --fg: #e6e9ef; --muted: #9aa3b2; --bg: #1b1f27; --line: #343b48; --accent: #7aa2f7; --warn: #e0a65b; --ok: #6cc896; --err: #f27f73; } }
button, select { font: inherit; color: inherit; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); cursor: pointer; box-shadow: 0 2px 8px rgb(0 0 0 / 0.15); }
.pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.pill .dot.changed { background: var(--warn); }
.panel { position: absolute; right: 0; bottom: 40px; width: min(420px, calc(100vw - 32px)); max-height: min(70vh, 560px); overflow: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); box-shadow: 0 8px 28px rgb(0 0 0 / 0.2); }
.panel[hidden] { display: none; }
.group + .group { border-top: 1px solid var(--line); }
.ghead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px 6px; }
.origin { font-weight: 600; margin-right: auto; overflow-wrap: anywhere; }
.ghead label { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); }
.ghead select, .act { padding: 2px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); cursor: pointer; }
ul { list-style: none; margin: 0; padding: 0 12px 10px; }
li { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 6px 0; border-top: 1px dashed var(--line); }
li:first-child { border-top: 0; }
.id { padding: 0; border: 0; background: none; color: var(--accent); cursor: pointer; text-align: left; font-weight: 600; }
.meta { grid-column: 1; color: var(--muted); }
.side { grid-row: 1 / span 2; grid-column: 2; display: flex; align-items: center; gap: 6px; }
.state { padding: 1px 6px; border-radius: 999px; border: 1px solid currentColor; font-size: 11px; }
.state.hydrated, .state.mounted { color: var(--ok); }
.state.waiting, .state.loading { color: var(--accent); }
.state.error { color: var(--err); }
.state.static, .state.empty { color: var(--muted); }
.changed { color: var(--warn); font-weight: 600; }
.none { padding: 0 12px 10px; color: var(--muted); }
.box { position: fixed; pointer-events: none; z-index: 2147483645; border: 2px solid var(--accent); border-radius: 4px; background: color-mix(in srgb, var(--accent) 12%, transparent); }
.box[hidden] { display: none; }
.notes { position: fixed; left: 16px; bottom: 16px; display: grid; gap: 8px; width: min(380px, calc(100vw - 32px)); }
.notes:empty { display: none; }
.note { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; padding: 10px 10px 10px 12px; border: 1px solid var(--line);
  border-left: 3px solid var(--accent); border-radius: 8px; background: var(--bg); box-shadow: 0 6px 20px rgb(0 0 0 / 0.18); }
.note .message { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.note .detail { grid-column: 1; margin: 0; color: var(--muted); }
.note .actions { grid-column: 1 / -1; display: flex; gap: 8px; }
.note .reload { padding: 3px 10px; border: 1px solid var(--accent); border-radius: 6px; background: var(--accent); color: var(--bg); cursor: pointer; }
.note .close { grid-column: 2; grid-row: 1; align-self: start; padding: 0 6px; border: 0; background: none; color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** The box an element's content takes on screen: its own, or its children's when it has none (`display: contents`). */
function boxOf(element: HTMLElement): DOMRect | null {
  const own = element.getBoundingClientRect();
  if (own.width > 0 || own.height > 0) return own;
  const rects = Array.from(element.querySelectorAll<HTMLElement>("*"))
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width > 0 || rect.height > 0);
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return new DOMRect(left, top, Math.max(...rects.map((r) => r.right)) - left, Math.max(...rects.map((r) => r.bottom)) - top);
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // Storage blocked: the panel opens closed next time.
  }
}

function createTool(): DropletsDevTools {
  const sources = new Map<string, DevToolSource>();
  const servers = new Map<string, ServerInfo>();

  const host = document.createElement("droplets-devtools");
  const shadow = host.attachShadow({ mode: "open" });
  const box = el("div", { className: "box", hidden: true });
  const panel = el("section", { className: "panel", hidden: !readOpen() });
  panel.setAttribute("aria-label", "Droplets");
  const pill = el("button", { className: "pill", type: "button" });
  pill.setAttribute("aria-expanded", String(!panel.hidden));
  pill.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    pill.setAttribute("aria-expanded", String(!panel.hidden));
    writeOpen(!panel.hidden);
    render();
  });
  const notes = el("div", { className: "notes" });
  notes.setAttribute("role", "region");
  notes.setAttribute("aria-label", "Droplets notifications");
  shadow.append(el("style", { textContent: STYLES }), box, el("div", { className: "root" }, [notes, panel, pill]));
  let noteCount = 0;

  /** A notification above the pill, the panel open or not; the same `key` replaces the one before. */
  const notify = (notification: DevNotification, reload: () => void) => {
    for (const old of Array.from(notes.children)) {
      if ((old as HTMLElement).dataset["key"] === notification.key) old.remove();
    }
    const id = `droplets-note-${++noteCount}`;
    const note = el("div", { className: "note" });
    note.dataset["key"] = notification.key;
    // With a button it asks for a decision: an alert dialog; without, a polite status.
    note.setAttribute("role", notification.reload ? "alertdialog" : "status");
    const message = el("p", { className: "message", id: `${id}-message`, textContent: notification.message });
    const close = el("button", { className: "close", type: "button", textContent: "×" });
    close.setAttribute("aria-label", "Dismiss");
    const dismiss = () => note.remove();
    close.addEventListener("click", dismiss);
    note.addEventListener("keydown", (event) => {
      if (event.key === "Escape") dismiss();
    });
    note.append(message, close);
    if (notification.detail) note.append(el("p", { className: "detail", id: `${id}-detail`, textContent: notification.detail }));
    if (notification.reload) {
      note.setAttribute("aria-labelledby", `${id}-message`);
      if (notification.detail) note.setAttribute("aria-describedby", `${id}-detail`);
      const button = el("button", { className: "reload", type: "button", textContent: "Reload page" });
      button.addEventListener("click", () => reload());
      note.append(el("div", { className: "actions" }, [button]));
    } else {
      setTimeout(dismiss, NOTE_TIMEOUT);
    }
    notes.append(note);
    while (notes.children.length > MAX_NOTES) notes.firstElementChild?.remove();
  };

  const highlight = (element: HTMLElement | null) => {
    const rect = element ? boxOf(element) : null;
    box.hidden = !rect;
    if (rect) Object.assign(box.style, { left: `${rect.left - 2}px`, top: `${rect.top - 2}px`, width: `${rect.width + 4}px`, height: `${rect.height + 4}px` });
  };

  const row = (source: DevToolSource, info: DevElementInfo): HTMLLIElement => {
    const droplet = servers.get(source.origin)?.droplets.find((d) => d.id === info.droplet);
    const mode = droplet ? describeMode({ ...droplet, hydrate: info.hydrate }).label : "";
    const id = el("button", { className: "id", type: "button", textContent: info.droplet, title: "Scroll to it" });
    id.addEventListener("click", () => {
      info.element.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => highlight(info.element), 400);
    });
    const remount = el("button", { className: "act", type: "button", textContent: "Remount" });
    remount.addEventListener("click", () => source.remount(info.element));
    const item = el("li", {}, [
      id,
      el("span", { className: "side" }, [
        ...(info.changed ? [el("span", { className: "changed", textContent: "changed" })] : []),
        el("span", { className: `state ${info.state}`, textContent: info.state }),
        remount,
      ]),
      el("span", { className: "meta", textContent: [mode, droplet?.renderer].filter(Boolean).join(" · ") }),
    ]);
    item.addEventListener("mouseenter", () => highlight(info.element));
    item.addEventListener("mouseleave", () => highlight(null));
    return item;
  };

  const group = (source: DevToolSource): HTMLElement => {
    const select = el("select", {}, STRATEGIES.map((s) => el("option", { value: s, textContent: s, selected: s === source.strategy() })));
    select.addEventListener("change", () => source.setStrategy(select.value as (typeof STRATEGIES)[number]));
    const reload = el("button", { className: "act", type: "button", textContent: "Reload page" });
    reload.addEventListener("click", () => source.reload());
    const elements = source.elements();
    return el("div", { className: "group" }, [
      el("div", { className: "ghead" }, [
        el("span", { className: "origin", textContent: source.origin.replace(/^https?:\/\//, "") }),
        el("label", {}, ["On change", select]),
        reload,
      ]),
      elements.length
        ? el("ul", {}, elements.map((info) => row(source, info)))
        : el("p", { className: "none", textContent: "No droplets from this server on the page." }),
    ]);
  };

  function render(): void {
    const all = Array.from(sources.values());
    const count = all.reduce((n, source) => n + source.elements().length, 0);
    const changed = all.some((source) => source.elements().some((info) => info.changed));
    pill.replaceChildren(el("span", { className: changed ? "dot changed" : "dot" }), `Droplets · ${count}`);
    pill.title = changed ? "A droplet changed; remount it or reload the page" : "Droplets dev tool";
    if (!panel.hidden) panel.replaceChildren(...all.map(group));
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  };

  /** The server's droplets and flags; asked again when something changed, the flags may have. */
  const refresh = async (source: DevToolSource) => {
    try {
      const response = await fetch(`${source.origin}/__droplets/devtools.json`, { cache: "no-store" });
      if (response.ok) servers.set(source.origin, (await response.json()) as ServerInfo);
    } catch {
      // The tool still lists the elements, without their flags.
    }
    schedule();
  };

  (document.body ?? document.documentElement).append(host);
  return {
    notify,
    register(source) {
      sources.set(source.origin, source);
      let pending: ReturnType<typeof setTimeout> | undefined;
      source.subscribe(() => {
        schedule();
        clearTimeout(pending);
        pending = setTimeout(() => void refresh(source), 150);
      });
      void refresh(source);
    },
  };
}

const page = globalThis as { DropletsDevTools?: DropletsDevTools };
page.DropletsDevTools ??= createTool();
