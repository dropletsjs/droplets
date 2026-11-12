/** @jsxImportSource solid-js */
import { createEffect, createSignal, For, on, onCleanup, onMount, type Accessor, type Setter } from "solid-js";
import { messageQueue, onMessage, type Toast } from "../../lib/message-bridge.ts";
import type { DropletProps } from "./$types";
import "./toasts.css";

// The toasts. This droplet listens on `window.shopMessageQueue` (the
// MessageBridge, lib/message-bridge.ts), which `init` in
// src/hooks.client.ts installs before any droplet starts: any droplet or
// the host page emits "toast" into it, and this shows it. Client-only,
// nothing to render on the server; it hydrates on load, anywhere in the
// page (the hosts put it first in the body). It subscribes as soon as this
// module runs, before the component mounts: a toast emitted in between
// waits in `items`. One emitted before the droplet loaded has no listener
// and is lost (senders emit with `?.`).
//
// - a stack in the bottom corner (the top on a phone), three at most, the
//   oldest dropped;
// - each goes after 3.5 s, paused while the pointer or the focus is on it,
//   and has a close button;
// - the same toast twice in a row is one, with a counter, its time restarted;
// - `role="status"` (polite), an error `role="alert"`; no motion when the
//   visitor asks for less.
export const ssr = false;
export const hydrate = true;

const TOAST_MS = 3500;
const MAX_VISIBLE = 3;

type Item = Toast & { id: number; count: Accessor<number>; setCount: Setter<number> };

let seq = 0;
const [items, setItems] = createSignal<Item[]>([]);

function show(toast: Toast) {
  const last = items().at(-1);
  if (last && last.type === toast.type && last.label === toast.label) {
    last.setCount((n) => n + 1);
    return;
  }
  const [count, setCount] = createSignal(1);
  setItems((list) => [...list, { ...toast, id: ++seq, count, setCount }].slice(-MAX_VISIBLE));
}

const dismiss = (id: number) => setItems((list) => list.filter((item) => item.id !== id));

// At module evaluation: the listener is there before the first render.
const queue = messageQueue();
if (!queue && typeof window !== "undefined" && (window as { shopMessageQueue?: unknown }).shopMessageQueue === undefined) {
  console.error("[shop] no window.shopMessageQueue: src/hooks.client.ts installs it; no toast shows.");
}
const stop = queue ? onMessage(queue, "toast", show) : () => {};
import.meta.hot?.dispose(stop);

export default function ToastCenter(_: DropletProps) {
  return (
    <section class="toasts" aria-label="Notifications">
      <ol>
        <For each={items()}>{(item) => <ToastView item={item} />}</For>
      </ol>
    </section>
  );
}

function ToastView(props: { item: Item }) {
  const item = props.item;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startedAt = 0;
  let left = TOAST_MS;
  let held = 0; // the pointer and the focus, each holding it open

  const run = () => {
    clearTimeout(timer);
    startedAt = Date.now();
    timer = setTimeout(() => dismiss(item.id), left);
  };
  const hold = () => {
    if (held++ === 0) {
      clearTimeout(timer);
      left = Math.max(0, left - (Date.now() - startedAt));
    }
  };
  const release = () => {
    if (held > 0 && --held === 0) run();
  };

  onMount(run);
  // The same toast again: its full time, from now.
  createEffect(
    on(
      item.count,
      () => {
        left = TOAST_MS;
        if (held === 0) run();
      },
      { defer: true },
    ),
  );
  onCleanup(() => clearTimeout(timer));

  const error = item.type === "error";
  return (
    <li
      class={`toast toast-${item.type}`}
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      aria-atomic="true"
      onPointerEnter={hold}
      onPointerLeave={release}
      onFocusIn={hold}
      onFocusOut={release}
    >
      <span class="toast-icon" aria-hidden="true">
        {error ? "!" : item.type === "success" ? "✓" : "i"}
      </span>
      <p class="toast-label">
        {item.label}
        {item.count() > 1 ? (
          <span class="toast-count">
            <span class="visually-hidden">, {item.count()} times</span>
            <span aria-hidden="true">×{item.count()}</span>
          </span>
        ) : null}
      </p>
      <button type="button" class="toast-close" aria-label="Dismiss" onClick={() => dismiss(item.id)}>
        ×
      </button>
    </li>
  );
}
