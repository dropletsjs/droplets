import { isRecord, onDropletAction } from "./events.ts";

// The MessageBridge: messages meant for the visitor (a toast for now).
// `window.shopMessageQueue` is a small emitter with the classic
// EventEmitter interface whose event names are the message kinds; any
// droplet, or the host page, may emit into it, and the toast-center
// droplet listens:
//
//   window.shopMessageQueue?.emit("toast", { type: "success", label: "Added to cart" });
//   window.shopMessageQueue.on("toast", show);
//
// - `init` in src/hooks.client.ts installs it (`??=`): `/index.js` calls it
//   before any droplet starts, so the queue is there before the first
//   droplet hydrates, wherever the toast center sits in the page. There is
//   no buffer: a message emitted before the toast center listens is lost,
//   and that is fine; senders emit with `?.`.
// - A global that is already there but has no `on`, `off` and `emit`
//   functions is never overwritten or called: it is logged, and the toast
//   center listens on nothing (no toast shows, nothing breaks).
// - A known event's data is checked (plain data, strings capped) and
//   dropped when it is not in shape; an unknown event passes through
//   untouched for whoever listens for it. A listener that throws is
//   reported, and the other listeners still get the message.

export const TOAST_TYPES = ["success", "error", "info"] as const;
export type ToastType = (typeof TOAST_TYPES)[number];

/** A toast's label is cut to this many characters. */
export const TOAST_LABEL_MAX = 140;

export type Toast = { type: ToastType; label: string };

/** Every known event, with its data. A new kind is an entry here and a reader in `READERS`. */
export type ShopMessages = {
  /** A short notice for the visitor: the toast-center droplet shows it. */
  toast: Toast;
};

export type MessageKind = keyof ShopMessages;

/** An event name is a string of at most this many characters. */
const EVENT_MAX = 64;

/** A plain object (a literal, or JSON parsed): no class instance, no array, no DOM node. */
const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** An own data property only: nothing inherited, no getter run. */
const own = (record: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
};

/** A toast's data, or `null`: a known type, a non-empty label, cut to `TOAST_LABEL_MAX`. */
export function readToast(data: unknown): Toast | null {
  if (!isPlain(data)) return null;
  const type = own(data, "type");
  const label = own(data, "label");
  if (typeof type !== "string" || !(TOAST_TYPES as readonly string[]).includes(type)) return null;
  if (typeof label !== "string") return null;
  const text = label.trim().slice(0, TOAST_LABEL_MAX);
  return text ? { type: type as ToastType, label: text } : null;
}

const READERS: { [K in MessageKind]: (data: unknown) => ShopMessages[K] | null } = {
  toast: readToast,
};

const isKind = (event: string): event is MessageKind => Object.hasOwn(READERS, event);

/**
 * What a listener for `event` gets for `data`: a known event's data read
 * (`null` when it is not in shape), an unknown event's untouched.
 */
export function readMessage(event: string, data: unknown): { data: unknown } | null {
  if (!isKind(event)) return { data };
  const read = READERS[event](data);
  return read ? { data: read } : null;
}

type Listener = (data: unknown) => void;
type Once = Listener & { listener?: Listener };

/** Runs a listener; what it throws is reported, never passed on to the emitter or the other listeners. */
function call(listener: Listener, data: unknown): void {
  try {
    listener(data);
  } catch (error) {
    console.error("[shop] a message listener threw:", error);
  }
}

const isEvent = (event: unknown): event is string => typeof event === "string" && event.length > 0 && event.length <= EVENT_MAX;

/** `window.shopMessageQueue`: a small EventEmitter, browser code, no dependency. */
export class MessageQueue {
  readonly #listeners = new Map<string, Listener[]>();

  /** Adds `listener` for `event`. Returns the queue, so calls chain. */
  on(event: string, listener: Listener): this {
    if (!isEvent(event) || typeof listener !== "function") return this;
    this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
    return this;
  }

  addListener(event: string, listener: Listener): this {
    return this.on(event, listener);
  }

  /** `listener` for the next message of `event` only. */
  once(event: string, listener: Listener): this {
    if (typeof listener !== "function") return this;
    const once: Once = (data) => {
      this.off(event, once);
      listener(data);
    };
    once.listener = listener;
    return this.on(event, once);
  }

  /** Removes `listener` (the last one added, if it was added twice), or the `once` around it. */
  off(event: string, listener: Listener): this {
    const listeners = this.#listeners.get(event);
    if (!listeners) return this;
    const at = listeners.findLastIndex((each) => each === listener || (each as Once).listener === listener);
    if (at === -1) return this;
    const rest = listeners.toSpliced(at, 1);
    if (rest.length) this.#listeners.set(event, rest);
    else this.#listeners.delete(event);
    return this;
  }

  removeListener(event: string, listener: Listener): this {
    return this.off(event, listener);
  }

  /**
   * Hands `data` to `event`'s listeners, each isolated; `true` when there
   * were some. A known event's data out of shape is dropped (`false`).
   */
  emit(event: string, data?: unknown): boolean {
    if (!isEvent(event)) return false;
    const listeners = this.#listeners.get(event);
    if (!listeners?.length) return false;
    const message = readMessage(event, data);
    if (!message) return false;
    for (const listener of listeners) call(listener, message.data);
    return true;
  }

  listenerCount(event: string): number {
    return this.#listeners.get(event)?.length ?? 0;
  }
}

/** What the shop calls on the global: `on`, `off` and `emit`. */
export type Emitter = Pick<MessageQueue, "on" | "off" | "emit">;

/** A value the shop will call as the page's queue: `on`, `off` and `emit` are functions. */
export function isQueue(value: unknown): value is Emitter {
  if (typeof value !== "object" || value === null) return false;
  try {
    const queue = value as Record<string, unknown>;
    return typeof queue["on"] === "function" && typeof queue["off"] === "function" && typeof queue["emit"] === "function";
  } catch {
    return false;
  }
}

type Page = { shopMessageQueue?: unknown };

/**
 * `init` of src/hooks.client.ts: `window.shopMessageQueue`, created when it
 * is not there. Something else under that name is left alone, logged, and
 * `null` returned.
 */
export function installMessageQueue(): Emitter | null {
  if (typeof window === "undefined") return null;
  const page = window as unknown as Page;
  page.shopMessageQueue ??= new MessageQueue();
  if (isQueue(page.shopMessageQueue)) return page.shopMessageQueue;
  console.error("[shop] window.shopMessageQueue is not a message queue (on, off, emit): it is left alone, and no toast shows.");
  return null;
}

/**
 * The page's `window.shopMessageQueue`, as src/hooks.client.ts installed it,
 * for a listener; never created here. `null` when there is none, or the
 * global is not a queue.
 */
export function messageQueue(): Emitter | null {
  if (typeof window === "undefined") return null;
  const queue = (window as unknown as Page).shopMessageQueue;
  return isQueue(queue) ? queue : null;
}

/**
 * `window.shopMessageQueue?.emit(kind, data)`, typed: nothing happens
 * before src/hooks.client.ts installed the queue, or when the global is not
 * one. A no-op on the server.
 */
export function sendMessage<K extends MessageKind>(kind: K, data: ShopMessages[K]): void {
  if (typeof window === "undefined") return;
  const queue = (window as unknown as Page).shopMessageQueue;
  if (!isQueue(queue)) return;
  try {
    queue.emit(kind, data);
  } catch (error) {
    console.error("[shop] emitting on window.shopMessageQueue threw:", error);
  }
}

/**
 * Listens for a known message on `queue`, each one read again here (the
 * queue may be one the host made). Returns the function that stops.
 */
export function onMessage<K extends MessageKind>(queue: Emitter, kind: K, handler: (data: ShopMessages[K]) => void): () => void {
  const listener = (data: unknown) => {
    const read = READERS[kind](data);
    if (read) handler(read as ShopMessages[K]);
  };
  try {
    queue.on(kind, listener);
  } catch (error) {
    console.error("[shop] listening on window.shopMessageQueue threw:", error);
  }
  return () => {
    try {
      queue.off(kind, listener);
    } catch (error) {
      console.error("[shop] leaving window.shopMessageQueue threw:", error);
    }
  };
}

export const MessageBridge = { install: installMessageQueue, queue: messageQueue, send: sendMessage, on: onMessage } as const;

// ---- Add to cart, as a toast ---------------------------------------------

/**
 * The toast for an `?/add` result (`{ added, name, count }`, or `fail()`'s
 * `{ reason, productId? }`), with the product's name when it is known.
 * `null` for anything else.
 */
export function addToast(result: unknown, name?: string): Toast | null {
  if (!isPlain(result)) return null;
  const known = own(result, "name");
  const product = name ?? (typeof known === "string" ? known : undefined);
  if (typeof own(result, "added") === "string") {
    return { type: "success", label: product ? `${product} added to your cart` : "Added to your cart" };
  }
  const reason = own(result, "reason");
  if (reason === "out") return { type: "error", label: product ? `Sorry, ${product} just sold out` : "Sorry, it just sold out" };
  if (reason === "missing") return { type: "error", label: "This product is no longer available" };
  if (reason === "invalid") return { type: "error", label: "That could not be added to the cart" };
  return null;
}

/**
 * A droplet that ships no JavaScript of its own (product-page, a template
 * that `/index.js` enhances) cannot send: its enhanced `?/add` is relayed
 * from `droplets:action` instead, set up by src/hooks.client.ts. Returns
 * the function that stops.
 */
export function relayAdds(droplets: readonly string[]): () => void {
  return onDropletAction(({ droplet, action, type, data }) => {
    if (action !== "add" || !droplets.includes(droplet) || type === "redirect") return;
    const toast = addToast(data);
    if (toast) sendMessage("toast", toast);
  });
}
