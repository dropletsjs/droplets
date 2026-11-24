import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeadline, isRenderTimeout, whenTimedOut, withSignal } from "../../src/runtime/render-timeout.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("createDeadline", () => {
  it("aborts after the timeout with a branded TimeoutError", () => {
    vi.useFakeTimers();
    const deadline = createDeadline({ timeout: 20 });
    vi.advanceTimersByTime(19);
    expect(deadline.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(deadline.signal.aborted).toBe(true);
    const reason: unknown = deadline.signal.reason;
    expect(reason).toBeInstanceOf(DOMException);
    expect((reason as DOMException).name).toBe("TimeoutError");
    expect((reason as DOMException).message).toBe("render.timeout (20 ms) passed");
    expect(isRenderTimeout(reason)).toBe(true);
  });

  it("never fires once cleared", () => {
    vi.useFakeTimers();
    const deadline = createDeadline({ timeout: 20 });
    deadline.clear();
    vi.advanceTimersByTime(1000);
    expect(deadline.signal.aborted).toBe(false);
  });
});

describe("isRenderTimeout", () => {
  it("knows no other reason: AbortSignal.timeout, a plain abort, a string, an author's TimeoutError", async () => {
    const timeout = AbortSignal.timeout(1);
    await new Promise((resolve) => timeout.addEventListener("abort", resolve));
    const plain = new AbortController();
    plain.abort();
    for (const reason of [
      timeout.reason,
      plain.signal.reason,
      "Client connection prematurely closed.",
      new DOMException("slow", "TimeoutError"),
      undefined,
      null,
    ]) {
      expect(isRenderTimeout(reason), String(reason)).toBe(false);
    }
  });
});

describe("withSignal", () => {
  it("copies a GET with the signal, its URL, method and headers", () => {
    const signal = new AbortController().signal;
    const request = new Request("http://drops.test/droplets/hello?who=Ada", { headers: { cookie: "a=1" } });
    const copy = withSignal({ request, signal });
    expect(copy).not.toBe(request);
    expect(copy.url).toBe(request.url);
    expect(copy.method).toBe("GET");
    expect(copy.headers.get("cookie")).toBe("a=1");
  });

  it("gives the copy an unread JSON body as a clone: the copy and the original both read it", async () => {
    const signal = new AbortController().signal;
    const request = new Request("http://drops.test/droplets/hello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ props: { who: "Ada" } }),
    });
    const copy = withSignal({ request, signal });
    expect(copy.method).toBe("POST");
    expect(await copy.json()).toEqual({ props: { who: "Ada" } });
    expect(request.bodyUsed).toBe(false);
    expect(await request.json()).toEqual({ props: { who: "Ada" } });
  });

  it("copies a POST whose body was read without it, and does not throw", async () => {
    const signal = new AbortController().signal;
    const request = new Request("http://drops.test/droplets/hello", { method: "POST", body: "who=Ada" });
    await request.text();
    const copy = withSignal({ request, signal });
    expect(copy.method).toBe("POST");
    expect(copy.url).toBe(request.url);
    expect(copy.body).toBeNull();
  });

  it("carries the deadline's branded reason through AbortSignal.any into the copy", () => {
    vi.useFakeTimers();
    const deadline = createDeadline({ timeout: 5 });
    const platform = new AbortController();
    const signal = AbortSignal.any([platform.signal, deadline.signal]);
    const copy = withSignal({ request: new Request("http://drops.test/"), signal });
    vi.advanceTimersByTime(5);
    expect(copy.signal.aborted).toBe(true);
    expect(isRenderTimeout(copy.signal.reason)).toBe(true);
  });
});

describe("whenTimedOut", () => {
  it("settles at the deadline, and at once on a signal it already aborted", async () => {
    vi.useFakeTimers();
    const deadline = createDeadline({ timeout: 5 });
    const settled = vi.fn();
    void whenTimedOut({ signal: deadline.signal }).then(settled);
    vi.advanceTimersByTime(5);
    await Promise.resolve();
    expect(settled).toHaveBeenCalledOnce();
    await expect(whenTimedOut({ signal: deadline.signal })).resolves.toBeUndefined();
  });

  it("never settles for another reason", async () => {
    const controller = new AbortController();
    const settled = vi.fn();
    void whenTimedOut({ signal: controller.signal }).then(settled);
    controller.abort("Client connection prematurely closed.");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).not.toHaveBeenCalled();
  });
});
