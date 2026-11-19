/**
 * The deadline of a droplet's loads and render (`render.timeout`): an abort
 * signal of our own whose reason carries a brand, so the app and the SSR
 * bundle, each with its own copy of this module, tell it from a client that
 * went away or an author's own timeout.
 *
 * @module
 */

const RENDER_TIMEOUT = Symbol.for("droplets.render-timeout");

/** Whether `value` is the reason our deadline aborted with. */
export function isRenderTimeout(value: unknown): boolean {
  // Node's disconnect reason is a string: `in` needs an object.
  return typeof value === "object" && value !== null && RENDER_TIMEOUT in value;
}

type CreateDeadlineInput = { timeout: number };

export type Deadline = { signal: AbortSignal; clear(): void };

/**
 * A signal that aborts after `timeout` ms with a `TimeoutError`, the name
 * `fetch` and database drivers reject with for `AbortSignal.timeout`.
 * `clear()` stops the timer, so it never fires after the answer.
 */
export function createDeadline({ timeout }: CreateDeadlineInput): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const reason = new DOMException(`render.timeout (${timeout} ms) passed`, "TimeoutError");
    Object.defineProperty(reason, RENDER_TIMEOUT, { value: true });
    controller.abort(reason);
  }, timeout);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

type WithSignalInput = { request: Request; signal: AbortSignal };

/**
 * `request` with `signal`. An unread body goes to the copy as a clone, so
 * the load and whoever holds the original (`handle` after `resolve`,
 * `transform`) can each read it; one already read (the render after a form
 * action) cannot be copied, and the copy has none.
 */
export function withSignal({ request, signal }: WithSignalInput): Request {
  if (!request.bodyUsed) return new Request(request.clone(), { signal });
  return new Request(request.url, { method: request.method, headers: request.headers, signal });
}

type WhenTimedOutInput = { signal: AbortSignal };

/** Settles when `signal` aborts with our deadline's reason; never for any other. */
export function whenTimedOut({ signal }: WhenTimedOutInput): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      if (isRenderTimeout(signal.reason)) resolve();
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        if (isRenderTimeout(signal.reason)) resolve();
      },
      { once: true },
    );
  });
}
