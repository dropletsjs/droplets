import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToast,
  installMessageQueue,
  isQueue,
  messageQueue,
  MessageQueue,
  type Emitter,
  onMessage,
  readToast,
  relayAdds,
  sendMessage,
  TOAST_LABEL_MAX,
} from "../src/lib/message-bridge.ts";
import { init } from "../src/hooks.client.ts";

type Page = EventTarget & { shopMessageQueue?: unknown };
let page: Page;

beforeEach(() => {
  page = new EventTarget() as Page;
  vi.stubGlobal("window", page);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const toast = { type: "success", label: "Added to cart" } as const;

/** The page's queue, installed as src/hooks.client.ts does. */
const installed = (): Emitter => {
  const queue = installMessageQueue();
  if (!queue) throw new Error("no queue installed");
  return queue;
};

describe("the message queue (an EventEmitter)", () => {
  it("hands an emit to every listener of its event, and on() chains", () => {
    const queue = new MessageQueue();
    const a = vi.fn();
    const b = vi.fn();
    expect(queue.on("toast", a).addListener("toast", b)).toBe(queue);
    expect(queue.listenerCount("toast")).toBe(2);
    expect(queue.emit("toast", toast)).toBe(true);
    expect(a).toHaveBeenCalledWith(toast);
    expect(b).toHaveBeenCalledWith(toast);
  });

  it("answers false and hands nothing on when nobody listens: there is no buffer", () => {
    const queue = new MessageQueue();
    expect(queue.emit("toast", toast)).toBe(false);
    const late = vi.fn();
    queue.on("toast", late);
    expect(late).not.toHaveBeenCalled();
  });

  it("removes a listener with off() or removeListener(), and once() fires once", () => {
    const queue = new MessageQueue();
    const kept = vi.fn();
    const gone = vi.fn();
    const one = vi.fn();
    queue.on("toast", kept).on("toast", gone).once("toast", one);
    queue.off("toast", gone);
    queue.emit("toast", toast);
    queue.emit("toast", toast);
    expect(kept).toHaveBeenCalledTimes(2);
    expect(gone).not.toHaveBeenCalled();
    expect(one).toHaveBeenCalledTimes(1);
    queue.removeListener("toast", kept);
    expect(queue.listenerCount("toast")).toBe(0);

    // A once() removed before it fired, by the listener it wraps.
    const never = vi.fn();
    queue.once("toast", never).off("toast", never);
    queue.emit("toast", toast);
    expect(never).not.toHaveBeenCalled();
  });

  it("drops a toast that is not plain data in shape", () => {
    const queue = new MessageQueue();
    const listener = vi.fn();
    queue.on("toast", listener);
    class Shaped {
      type = "success";
      label = "a class instance";
    }
    const withGetter = Object.defineProperty({ type: "info" }, "label", { get: () => "a getter", enumerable: true });
    const inherited = Object.assign(Object.create({ label: "inherited" }), { type: "info" });
    for (const bad of [
      undefined,
      null,
      "Added",
      [toast],
      new Shaped(),
      withGetter,
      inherited,
      { type: "warning", label: "unknown type" },
      { type: "success", label: 42 },
      { type: "success", label: "   " },
      { type: "success" },
    ]) {
      expect(queue.emit("toast", bad)).toBe(false);
    }
    expect(listener).not.toHaveBeenCalled();
  });

  it("caps and trims a toast's label, and keeps only its known fields", () => {
    const queue = new MessageQueue();
    const listener = vi.fn();
    queue.on("toast", listener);
    queue.emit("toast", { type: "error", label: `  ${"x".repeat(500)}  `, html: "<b>no</b>" });
    expect(listener).toHaveBeenCalledWith({ type: "error", label: "x".repeat(TOAST_LABEL_MAX) });
    expect(readToast({ type: "info", label: " Hi " })).toEqual({ type: "info", label: "Hi" });
  });

  it("passes an unknown event through untouched", () => {
    const queue = new MessageQueue();
    const listener = vi.fn();
    const data = { anything: [1, 2], at: new Date(0) };
    queue.on("shop:custom", listener).emit("shop:custom", data);
    expect(listener).toHaveBeenCalledWith(data);
    expect(listener.mock.calls[0]![0]).toBe(data);
    // A name that is no event at all is ignored.
    expect(queue.emit("", data)).toBe(false);
    expect(queue.emit("x".repeat(65), data)).toBe(false);
  });

  it("isolates a listener that throws: the others still get the message", () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const queue = new MessageQueue();
    const after = vi.fn();
    queue.on("toast", () => {
      throw new Error("boom");
    }).on("toast", after);
    expect(() => queue.emit("toast", toast)).not.toThrow();
    expect(after).toHaveBeenCalledWith(toast);
    expect(report).toHaveBeenCalledOnce();
  });
});

describe("window.shopMessageQueue", () => {
  it("is installed by init in src/hooks.client.ts, once: the second install keeps the first", () => {
    expect(messageQueue()).toBeNull();
    init();
    const first = page.shopMessageQueue;
    expect(first).toBeInstanceOf(MessageQueue);
    expect(messageQueue()).toBe(first);
    expect(installMessageQueue()).toBe(first);
    init();
    expect(page.shopMessageQueue).toBe(first);
  });

  it("is never overwritten or called when it is something else: logged, and nobody listens", () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const emit = vi.fn();
    const impostor = { on: "nope", emit };
    page.shopMessageQueue = impostor;
    expect(isQueue(impostor)).toBe(false);
    expect(() => init()).not.toThrow();
    expect(page.shopMessageQueue).toBe(impostor);
    expect(installMessageQueue()).toBeNull();
    expect(messageQueue()).toBeNull();
    expect(report).toHaveBeenCalledTimes(2);

    sendMessage("toast", toast);
    expect(emit).not.toHaveBeenCalled();
  });

  it("does nothing for a sender before it is installed", () => {
    expect(() => sendMessage("toast", toast)).not.toThrow();
    expect(page.shopMessageQueue).toBeUndefined();
  });

  it("takes what a sender emits once installed; onMessage stops when told", () => {
    const listener = vi.fn();
    const stop = onMessage(installed(), "toast", listener);
    sendMessage("toast", toast);
    expect(listener).toHaveBeenCalledWith(toast);
    stop();
    sendMessage("toast", toast);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("reads each toast again on a queue the host made, which checks nothing", () => {
    const listeners: Array<(data: unknown) => void> = [];
    const hostQueue = {
      on: (_: string, listener: (data: unknown) => void) => void listeners.push(listener),
      off: () => {},
      emit: (_: string, data: unknown) => listeners.forEach((listener) => listener(data)),
    };
    page.shopMessageQueue = hostQueue;
    const shown = vi.fn();
    onMessage(installed(), "toast", shown);
    hostQueue.emit("toast", { type: "success", label: "y".repeat(300) });
    hostQueue.emit("toast", { type: "danger", label: "no" });
    expect(shown).toHaveBeenCalledOnce();
    expect(shown).toHaveBeenCalledWith({ type: "success", label: "y".repeat(TOAST_LABEL_MAX) });
  });
});

describe("add to cart, as a toast", () => {
  it("names the product when it is known", () => {
    expect(addToast({ added: "p_abcd", count: 2 }, "Linen Notebook")).toEqual({ type: "success", label: "Linen Notebook added to your cart" });
    expect(addToast({ added: "p_abcd", name: "Clay Mug", count: 1 })).toEqual({ type: "success", label: "Clay Mug added to your cart" });
    expect(addToast({ added: "p_abcd", count: 1 })).toEqual({ type: "success", label: "Added to your cart" });
    expect(addToast({ reason: "out", productId: "p_abcd" }, "Clay Mug")).toEqual({ type: "error", label: "Sorry, Clay Mug just sold out" });
    expect(addToast({ reason: "missing" })).toEqual({ type: "error", label: "This product is no longer available" });
    expect(addToast({ reason: "whatever" })).toBeNull();
    expect(addToast("added")).toBeNull();
  });

  it("relays the product page's enhanced add (droplets:action) into the queue", () => {
    const shown = vi.fn();
    onMessage(installed(), "toast", shown);
    const stop = relayAdds(["product-page"]);
    const action = (droplet: string, type: string, data: unknown) =>
      page.dispatchEvent(new CustomEvent("droplets:action", { detail: { droplet, action: "add", type, status: 200, data } }));
    action("product-page", "success", { added: "p_abcd", name: "Clay Mug", count: 1 });
    action("product-card", "success", { added: "p_abcd", name: "Clay Mug", count: 1 });
    action("product-page", "failure", { reason: "out", productId: "p_abcd" });
    expect(shown.mock.calls).toEqual([
      [{ type: "success", label: "Clay Mug added to your cart" }],
      [{ type: "error", label: "Sorry, it just sold out" }],
    ]);
    stop();
    action("product-page", "success", { added: "p_abcd", count: 1 });
    expect(shown).toHaveBeenCalledTimes(2);
  });

  it("is relayed once init in src/hooks.client.ts ran", () => {
    init();
    const shown = vi.fn();
    onMessage(messageQueue()!, "toast", shown);
    page.dispatchEvent(new CustomEvent("droplets:action", {
      detail: { droplet: "product-page", action: "add", type: "success", status: 200, data: { added: "p_abcd", name: "Clay Mug", count: 1 } },
    }));
    expect(shown).toHaveBeenCalledWith({ type: "success", label: "Clay Mug added to your cart" });
  });
});
