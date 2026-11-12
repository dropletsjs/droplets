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
import type { DevElementInfo, DevNotification, DevToolSource, DropletsDevTools, DevStrategy } from "@dropletsjs/droplets";
import { describeMode, type DropletInfo } from "../shared.ts";
import STYLES from "./panel.css?inline";

/** What `/__droplets/devtools.json` answers: the server's droplets with their flags. */
type ServerInfo = { element: string; droplets: DropletInfo[] };

const OPEN_KEY = "droplets-devtools:tool-open";
const STRATEGIES: readonly DevStrategy[] = ["hmr", "remount", "reload", "manual"];
/** At most this many notifications at once: the oldest goes first. */
const MAX_NOTES = 3;
/** How long a notification without a button stays. */
const NOTE_TIMEOUT = 10_000;

type ElInput<K extends keyof HTMLElementTagNameMap> = {
  tag: K;
  props?: Partial<HTMLElementTagNameMap[K]>;
  children?: Array<Node | string>;
};

function el<K extends keyof HTMLElementTagNameMap>({ tag, props = {}, children = [] }: ElInput<K>): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

type BoxOfInput = { element: HTMLElement };

/** The box an element's content takes on screen: its own, or its children's when it has none (`display: contents`). */
function boxOf({ element }: BoxOfInput): DOMRect | null {
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
    // Storage blocked: the panel starts closed.
    return false;
  }
}

type WriteOpenInput = { open: boolean };

function writeOpen({ open }: WriteOpenInput): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // Storage blocked: the panel opens closed next time.
  }
}

type HighlightInput = { element: HTMLElement | null };
type RowInput = { source: DevToolSource; info: DevElementInfo };
type GroupInput = { source: DevToolSource };
type RefreshInput = { source: DevToolSource };

function createTool(): DropletsDevTools {
  const sources = new Map<string, DevToolSource>();
  const servers = new Map<string, ServerInfo>();

  const host = document.createElement("droplets-devtools");
  const shadow = host.attachShadow({ mode: "open" });
  const box = el({ tag: "div", props: { className: "box", hidden: true } });
  const panel = el({ tag: "section", props: { className: "panel", hidden: !readOpen() } });
  panel.setAttribute("aria-label", "Droplets");
  const pill = el({ tag: "button", props: { className: "pill", type: "button" } });
  pill.setAttribute("aria-expanded", String(!panel.hidden));
  pill.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    pill.setAttribute("aria-expanded", String(!panel.hidden));
    writeOpen({ open: !panel.hidden });
    render();
  });
  const notes = el({ tag: "div", props: { className: "notes" } });
  notes.setAttribute("role", "region");
  notes.setAttribute("aria-label", "Droplets notifications");
  shadow.append(
    el({ tag: "style", props: { textContent: STYLES } }),
    box,
    el({ tag: "div", props: { className: "root" }, children: [notes, panel, pill] }),
  );
  let noteCount = 0;

  /** A notification above the pill, the panel open or not; the same `key` replaces the one before. */
  function notify(notification: DevNotification, reload: () => void): void {
    for (const old of Array.from(notes.children)) {
      if ((old as HTMLElement).dataset["dropletKey"] === notification.key) old.remove();
    }
    const id = `droplets-note-${++noteCount}`;
    const note = el({ tag: "div", props: { className: "note" } });
    note.dataset["dropletKey"] = notification.key;
    // With a button it asks for a decision: an alert dialog; without, a polite status.
    note.setAttribute("role", notification.reload ? "alertdialog" : "status");
    const message = el({ tag: "p", props: { className: "message", id: `${id}-message`, textContent: notification.message } });
    const close = el({ tag: "button", props: { className: "close", type: "button", textContent: "×" } });
    close.setAttribute("aria-label", "Dismiss");
    const dismiss = () => note.remove();
    close.addEventListener("click", dismiss);
    note.addEventListener("keydown", (event) => {
      if (event.key === "Escape") dismiss();
    });
    note.append(message, close);
    if (notification.detail) {
      note.append(el({ tag: "p", props: { className: "detail", id: `${id}-detail`, textContent: notification.detail } }));
    }
    if (notification.reload) {
      note.setAttribute("aria-labelledby", `${id}-message`);
      if (notification.detail) note.setAttribute("aria-describedby", `${id}-detail`);
      const button = el({ tag: "button", props: { className: "reload", type: "button", textContent: "Reload page" } });
      button.addEventListener("click", () => reload());
      note.append(el({ tag: "div", props: { className: "actions" }, children: [button] }));
    } else {
      setTimeout(dismiss, NOTE_TIMEOUT);
    }
    notes.append(note);
    while (notes.children.length > MAX_NOTES) notes.firstElementChild?.remove();
  }

  function highlight({ element }: HighlightInput): void {
    const rect = element ? boxOf({ element }) : null;
    box.hidden = !rect;
    if (rect)
      Object.assign(box.style, {
        left: `${rect.left - 2}px`,
        top: `${rect.top - 2}px`,
        width: `${rect.width + 4}px`,
        height: `${rect.height + 4}px`,
      });
  }

  function row({ source, info }: RowInput): HTMLLIElement {
    const droplet = servers.get(source.origin)?.droplets.find((d) => d.id === info.droplet);
    const mode = droplet ? describeMode({ droplet: { ...droplet, hydrate: info.hydrate } }).label : "";
    const id = el({ tag: "button", props: { className: "id", type: "button", textContent: info.droplet, title: "Scroll to it" } });
    id.addEventListener("click", () => {
      info.element.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => highlight({ element: info.element }), 400);
    });
    const remount = el({ tag: "button", props: { className: "act", type: "button", textContent: "Remount" } });
    remount.addEventListener("click", () => source.remount(info.element));
    const item = el({
      tag: "li",
      children: [
        id,
        el({
          tag: "span",
          props: { className: "side" },
          children: [
            ...(info.changed ? [el({ tag: "span", props: { className: "changed", textContent: "changed" } })] : []),
            el({ tag: "span", props: { className: `state ${info.state}`, textContent: info.state } }),
            remount,
          ],
        }),
        el({ tag: "span", props: { className: "meta", textContent: [mode, droplet?.renderer].filter(Boolean).join(" · ") } }),
      ],
    });
    item.addEventListener("mouseenter", () => highlight({ element: info.element }));
    item.addEventListener("mouseleave", () => highlight({ element: null }));
    return item;
  }

  function group({ source }: GroupInput): HTMLElement {
    const select = el({
      tag: "select",
      children: STRATEGIES.map((s) => el({ tag: "option", props: { value: s, textContent: s, selected: s === source.strategy() } })),
    });
    select.addEventListener("change", () => source.setStrategy(select.value as DevStrategy));
    const reload = el({ tag: "button", props: { className: "act", type: "button", textContent: "Reload page" } });
    reload.addEventListener("click", () => source.reload());
    const elements = source.elements();
    return el({
      tag: "div",
      props: { className: "group" },
      children: [
        el({
          tag: "div",
          props: { className: "ghead" },
          children: [
            el({ tag: "span", props: { className: "origin", textContent: source.origin.replace(/^https?:\/\//, "") } }),
            el({ tag: "label", children: ["On change", select] }),
            reload,
          ],
        }),
        elements.length
          ? el({ tag: "ul", children: elements.map((info) => row({ source, info })) })
          : el({ tag: "p", props: { className: "none", textContent: "No droplets from this server on the page." } }),
      ],
    });
  }

  function render(): void {
    const all = Array.from(sources.values());
    const count = all.reduce((n, source) => n + source.elements().length, 0);
    const changed = all.some((source) => source.elements().some((info) => info.changed));
    pill.replaceChildren(el({ tag: "span", props: { className: changed ? "dot changed" : "dot" } }), `Droplets · ${count}`);
    pill.title = changed ? "A droplet changed; remount it or reload the page" : "Droplets dev tool";
    if (!panel.hidden) panel.replaceChildren(...all.map((source) => group({ source })));
  }

  let queued = false;
  function schedule(): void {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  }

  /** The server's droplets and flags; asked again when something changed, the flags may have. */
  async function refresh({ source }: RefreshInput): Promise<void> {
    try {
      const response = await fetch(`${source.origin}/__droplets/devtools.json`, { cache: "no-store" });
      if (response.ok) servers.set(source.origin, (await response.json()) as ServerInfo);
    } catch {
      // The tool still lists the elements, without their flags.
    }
    schedule();
  }

  (document.body ?? document.documentElement).append(host);
  return {
    notify,
    register(source) {
      sources.set(source.origin, source);
      let pending: ReturnType<typeof setTimeout> | undefined;
      source.subscribe(() => {
        schedule();
        clearTimeout(pending);
        pending = setTimeout(() => void refresh({ source }), 150);
      });
      void refresh({ source });
    },
  };
}

const page = globalThis as { DropletsDevTools?: DropletsDevTools };
page.DropletsDevTools ??= createTool();
