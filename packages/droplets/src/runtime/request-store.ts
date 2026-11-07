/**
 * What server code knows about the request it runs for, read by
 * `$droplets/drop` and `$droplets/form`. Kept on `globalThis` because the server, the SSR bundle
 * and, in dev, Vite's module runner may each load their own copy of this
 * module.
 *
 * Requests overlap on a server, so the value follows each one through its
 * `await`s with `AsyncLocalStorage` where the runtime has it (Node, Deno,
 * Bun, Workers with `nodejs_compat`), found through
 * `process.getBuiltinModule` so no Node import reaches the runtime. Without
 * it, the last request to start wins: right for one request at a time.
 */
const STORE = Symbol.for("droplets.request");

export type RequestInfo = {
  /** The droplets server's origin as the browser sees it: a trusted `x-host`, or the request's. */
  origin: string;
  /** `trustedOrigins` and `DROPLETS_TRUSTED_ORIGINS` for this request; empty when none is set. */
  trustedOrigins?: readonly string[];
  /** The origins this server is reached at: the request's own and a trusted `x-host`'s. */
  ownOrigins?: readonly string[];
  /**
   * The page a droplet renders on, `origin + pathname` of `event.host` (at
   * build, its tokens): what action URLs name as `__droplet_return`.
   */
  page?: string;
  /** While a droplet renders: which, with its props. What `actionUrl()` of `$droplets/form` reads. */
  render?: { droplet: string; props: Record<string, unknown> };
};

type Storage = {
  run<T>(store: RequestInfo, callback: () => T): T;
  getStore(): RequestInfo | undefined;
};

type Holder = { storage: Storage | null; current?: RequestInfo };

type BuiltinLoader = { getBuiltinModule?: (id: string) => unknown };

function holder(): Holder {
  const global = globalThis as { [STORE]?: Holder; process?: BuiltinLoader };
  if (!global[STORE]) {
    let storage: Storage | null = null;
    try {
      const hooks = global.process?.getBuiltinModule?.("node:async_hooks") as
        | { AsyncLocalStorage?: new () => Storage }
        | undefined;
      if (hooks?.AsyncLocalStorage) storage = new hooks.AsyncLocalStorage();
    } catch {
      // Not offered here: one request at a time.
    }
    global[STORE] = { storage };
  }
  return global[STORE];
}

/** Runs `callback` with `info` as the current request's. */
export function withRequestInfo<T>(info: RequestInfo, callback: () => T): T {
  const store = holder();
  if (store.storage) return store.storage.run(info, callback);
  const previous = store.current;
  store.current = info;
  // Back to what it was once the callback is done (a promise: once it
  // settles), unless another request has set its own meanwhile.
  const restore = () => {
    if (store.current === info) store.current = previous;
  };
  let result: T;
  try {
    result = callback();
  } catch (error) {
    restore();
    throw error;
  }
  if (result instanceof Promise) return result.finally(restore) as T;
  restore();
  return result;
}

/** The current request's, or `undefined` outside one (a prerender, a module's top level). */
export function requestInfo(): RequestInfo | undefined {
  const store = holder();
  return store.storage ? store.storage.getStore() : store.current;
}
