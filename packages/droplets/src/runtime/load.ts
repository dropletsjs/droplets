/**
 * The load and `handleError` contracts of a droplet, and what the component
 * gets out of them, shared by the server and the browser: no Node APIs, no
 * engine code.
 */

/**
 * The props of a droplet component: `data` from the loads, and `children`,
 * whatever the renderer uses to render the children marker in light DOM (a
 * Svelte snippet, a Vue component, a React node…). The element moves the
 * host's `<div data-droplet-slot>` container into the marker; it stays empty
 * when the host has none. Renderer packages export a
 * version with `Children` filled in, e.g. `DropletProps` from
 * `@dropletsjs/renderer-svelte` types `children` as a `Snippet`.
 *
 * `form` is the result of the form action the request ran: the data it
 * returned, or the data of its `fail()`; it is absent when none ran.
 *
 * `data` is the value the server rendered with when the component hydrates,
 * and a promise of it when it mounts in the browser (client-only, refreshed,
 * re-mounted): the component waits as its framework lets it. A rejection
 * that reaches rendering shows `+error.*`; one the component handles is its
 * own.
 */
export type DropletProps<Data = unknown, Children = unknown, Form = unknown> = {
  data: Data | Promise<Data>;
  /** After a form action, what it returned or `fail()`ed with; absent otherwise. */
  form?: Form;
  children?: Children;
};

/** The props of an error page: the error out of `handleError`, and the same `children`. */
export type DropletErrorProps<Err = unknown, Children = unknown> = { error: Err; children?: Children };

/**
 * What `+error.*` receives when a load failed with nothing to say: a
 * `throw undefined`, or no `handleError` to turn the error into something.
 */
export class DropletRenderError extends Error {
  constructor(message = "Internal Error") {
    super(message);
    this.name = "DropletRenderError";
  }
}

const UNHANDLED = Symbol.for("droplets.unhandled");

/**
 * A failure the droplet cannot show: it has no error page, or its
 * `handleError` threw. The server answers it as any unexpected error,
 * through `handleError` in `hooks.server.ts`.
 */
export class UnhandledDropletError extends Error {
  readonly [UNHANDLED] = true;

  constructor(droplet: string, reason: string, cause: unknown) {
    super(`${droplet}: ${reason}`, { cause });
    this.name = "UnhandledDropletError";
  }
}

/** Checked by brand: the server bundle and the framework may hold separate copies. */
export function isUnhandled(value: unknown): value is UnhandledDropletError {
  return typeof value === "object" && value !== null && UNHANDLED in value;
}

/**
 * A load returns a plain object, or nothing. A `Response` (`json()`,
 * `text()`) belongs in `+server.ts`; anything else cannot be serialized for
 * the browser.
 */
export function checkLoadResult(droplet: string, file: string, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (typeof Response !== "undefined" && value instanceof Response) {
    throw new Error(
      `${droplet}: load in ${file} returned a Response; a load returns a plain object (json() and text() are for +server.ts)`,
    );
  }
  const proto = typeof value === "object" ? Object.getPrototypeOf(value) : undefined;
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`${droplet}: load in ${file} must return a plain object, e.g. return { … }`);
  }
  return value;
}

/**
 * A load's result with its promises resolved: the value, then each of its
 * own fields that is a promise, one level deep and in parallel. What the
 * server renders with, and what hydration renders with, so both see the same
 * values. A rejection rejects the whole, as a load that threw. Own
 * enumerable string keys only; a field is a promise when it has a `then`.
 */
export async function settle(value: unknown): Promise<unknown> {
  const resolved: unknown = await value;
  if (typeof resolved !== "object" || resolved === null) return resolved;
  const entries = Object.entries(resolved);
  if (!entries.some(([, field]) => isPromiseLike(field))) return resolved;
  // Every field to the end, so none rejects later with nobody listening;
  // then the first rejection as it was thrown (`error()` stays an answer).
  const results = await Promise.allSettled(entries.map(([, field]) => field));
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  return Object.fromEntries(
    entries.map(([key], index) => [key, (results[index] as PromiseFulfilledResult<unknown>).value]),
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null &&
    typeof (value as { then?: unknown }).then === "function";
}

export type HandleDropletErrorFn = (input: { error: unknown }) => unknown;

/**
 * One link of the `handleError` chain. Without a `handleError` the error
 * passes through, as `({ error = new DropletRenderError() }) => ({ error })`.
 */
export async function runHandleError(
  droplet: string,
  file: string,
  handleError: unknown,
  error: unknown,
): Promise<unknown> {
  if (typeof handleError !== "function") return error ?? new DropletRenderError();
  const result: unknown = await (handleError as HandleDropletErrorFn)({ error });
  if (typeof result !== "object" || result === null || !("error" in result)) {
    throw new Error(`${droplet}: handleError in ${file} must return { error }`);
  }
  return (result as { error: unknown }).error;
}

/**
 * The error as it leaves the server, inlined or as `_data`: JSON, with
 * `Error` instances reduced to their name and message. The server renders
 * `+error.*` from the same value, so hydration sees what SSR saw.
 * Never `undefined`, so the envelope keeps its `error` key.
 */
export function toWireError(error: unknown): unknown {
  const json = JSON.stringify(error, (_key, value: unknown) =>
    value instanceof Error ? { name: value.name, message: value.message } : value
  );
  return json === undefined ? null : JSON.parse(json);
}
