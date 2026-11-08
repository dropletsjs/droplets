/**
 * Solid's per-page hydration state, `window._$HY`, which `hydrate()` from
 * `solid-js/web` reads. Solid expects the host page to define it with
 * `generateHydrationScript()`; a droplet is a fragment on someone else's
 * page, so this module defines it in code instead. Core imports it for its
 * side effects from every Solid droplet's client module, before anything
 * renders; it is idempotent, and leaves a `_$HY` the page already has alone.
 *
 * `events` and `completed` stay `null`: Solid's replay of the events captured
 * before hydration assumes one app whose every `data-hk` root hydrates
 * eventually. On a page of independent droplets, some of which never
 * hydrate (`hydrate = false`), a queued event would block the queue for
 * good. Solid's own replay stays off; core holds the clicks on a droplet's
 * server markup and replays them itself once it has hydrated.
 */
export type SolidHydrationState = {
  events: null;
  completed: null;
  /** Resources Solid's streaming serializes; unused here but read by `hydrate()`. */
  r: Record<string, unknown>;
  fe(): void;
  /** Set by Solid on the first event after a hydration; reset per droplet. */
  done?: boolean;
};

/** Defines `globalThis._$HY` when nothing has, and returns it. */
export function ensureHydrationState(): SolidHydrationState {
  const global = globalThis as { _$HY?: SolidHydrationState };
  global._$HY ??= { events: null, completed: null, r: {}, fe() {} };
  return global._$HY;
}

ensureHydrationState();
