/**
 * Dev only: the notifications `index.js` shows under `vite dev`, for what a
 * page cannot show by itself (a droplet's new render contract, a
 * `hooks.client.ts` edit). The dev tool shows them when it is on the page
 * (`window.DropletsDevTools.notify`); otherwise a small toast of its own, in
 * its own shadow root, out of the host's styles. One console line each,
 * either way.
 *
 * Imported by the entry client only under `import.meta.env.DEV`: none of
 * this reaches a build.
 */
import STYLES from "./dev-notify.css?inline";
import type { DevNotification, DropletsDevTools } from "./dev-tool.ts";

export type { DevNotification };

/** How long a toast without a button stays; one with a button stays until it is used or dismissed. */
const STATUS_TIMEOUT = 10_000;
/** At most this many toasts at once: the oldest goes first. */
const MAX_TOASTS = 3;

// Shared on the page by every droplets server's `index.js`, whatever its version: the shape stays positional.
type Toasts = { show(notification: DevNotification, reload: () => void): void };

/** The page's toasts: one stack for every droplets server on it, made by the first `index.js` that needs it. */
function toasts(): Toasts {
  const page = globalThis as unknown as Record<symbol, Toasts | undefined>;
  const TOASTS = Symbol.for("droplets.devToasts");
  const existing = page[TOASTS];
  if (existing) return existing;

  const host = document.createElement("droplets-dev-notifications");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLES;
  const stack = document.createElement("div");
  stack.className = "stack";
  stack.setAttribute("role", "region");
  stack.setAttribute("aria-label", "Droplets notifications");
  shadow.append(style, stack);
  let count = 0;

  const created: Toasts = {
    show(notification, reload) {
      if (!host.isConnected) (document.body ?? document.documentElement).append(host);
      // The same news again (a second edit before this one was read): replaced, never stacked twice.
      for (const old of Array.from(stack.children)) {
        if ((old as HTMLElement).dataset["key"] === notification.key) old.remove();
      }
      const id = `droplets-toast-${++count}`;
      const toast = document.createElement("div");
      toast.className = "toast";
      toast.dataset["key"] = notification.key;
      // A toast with a button asks for a decision: an alert dialog, named
      // and described by its text; one without is a polite status.
      toast.setAttribute("role", notification.reload ? "alertdialog" : "status");
      if (notification.reload) {
        toast.setAttribute("aria-labelledby", `${id}-message`);
        toast.setAttribute("aria-describedby", `${id}-detail`);
      }
      const message = document.createElement("p");
      message.className = "message";
      message.id = `${id}-message`;
      message.textContent = notification.message;
      const close = document.createElement("button");
      close.type = "button";
      close.className = "close";
      close.textContent = "×";
      close.setAttribute("aria-label", "Dismiss");
      const dismiss = () => toast.remove();
      close.addEventListener("click", dismiss);
      toast.addEventListener("keydown", (event) => {
        if (event.key === "Escape") dismiss();
      });
      toast.append(message, close);
      if (notification.detail) {
        const detail = document.createElement("p");
        detail.className = "detail";
        detail.id = `${id}-detail`;
        detail.textContent = notification.detail;
        toast.append(detail);
      }
      if (notification.reload) {
        const actions = document.createElement("div");
        actions.className = "actions";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "reload";
        button.textContent = "Reload page";
        button.addEventListener("click", () => reload());
        actions.append(button);
        toast.append(actions);
      } else {
        setTimeout(dismiss, STATUS_TIMEOUT);
      }
      stack.append(toast);
      while (stack.children.length > MAX_TOASTS) stack.firstElementChild?.remove();
    },
  };
  page[TOASTS] = created;
  return created;
}

/**
 * Shows `notification`: in the dev tool when it is on the page and takes
 * them, else as a toast. One console line either way.
 */
type NotifyInput = { notification: DevNotification; reload?: () => void };

export function notify({ notification, reload = () => globalThis.location.reload() }: NotifyInput): void {
  console.info(`[droplets] ${notification.message}${notification.detail ? ` ${notification.detail}` : ""}`);
  const tool = (globalThis as { DropletsDevTools?: DropletsDevTools }).DropletsDevTools;
  if (typeof tool?.notify === "function") {
    tool.notify(notification, reload);
    return;
  }
  if (typeof document === "undefined") return;
  toasts().show(notification, reload);
}
