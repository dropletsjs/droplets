/**
 * `src/hooks.client.ts`: the app's own setup, run by `/index.js` first
 * thing in the browser. Only a project that has the file imports this
 * module; without one `/index.js` is unchanged.
 */

/**
 * The `init` export of `src/hooks.client.ts`. `/index.js` calls it once,
 * synchronously, before it defines the droplet element, so before any
 * droplet hydrates or mounts: setup that must come before everything else,
 * such as a gtag setup or a page-wide global. Browser only, with the DOM
 * and nothing from the server: no request, no props, no load data.
 *
 * It may be async, but Droplets never waits for it: `/index.js` calls it
 * and carries on at once, and a promise it returns only has its rejection
 * logged. When it throws, the error is logged and the droplets start all
 * the same.
 *
 * ```ts
 * // src/hooks.client.ts
 * import type { ClientInit } from "@dropletsjs/droplets";
 *
 * export const init: ClientInit = () => {
 *   window.shopMessageQueue ??= new MessageQueue();
 * };
 * ```
 */
export type ClientInit = () => void | Promise<void>;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  typeof (value as { then?: unknown }).then === "function";

/**
 * Calls `init` of `src/hooks.client.ts` (`file`, for the messages) and
 * returns at once. Never throws, so the droplets start in every case. A
 * file without `init` runs nothing.
 */
export function runClientInit(hooks: { readonly init?: unknown }, file: string): void {
  const init = hooks.init;
  if (init === undefined) return;
  if (typeof init !== "function") {
    console.error(`[droplets] init in ${file} is not a function; starting the droplets without it`);
    return;
  }
  try {
    const result: unknown = init();
    // Not waited for: the droplets start now. A rejection is still reported.
    if (isThenable(result)) {
      Promise.resolve(result).then(undefined, (error: unknown) => {
        console.error(`[droplets] init() in ${file} returned a promise that rejected; init is not waited for`, error);
      });
    }
  } catch (error) {
    console.error(`[droplets] init() in ${file} failed; starting the droplets anyway`, error);
  }
}
