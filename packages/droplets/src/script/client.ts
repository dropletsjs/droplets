/**
 * The browser side of script droplets. `mount` waits for the droplet's
 * `data` and calls the file's default export with `(data, el)`; `unmount`
 * runs the cleanup it returned, if any, and empties `el`. There is never
 * server markup to hydrate: `hydrate` does what `mount` does. See `./index.ts`.
 */
import type { ClientRenderContext, ComponentModule, RenderProps } from "../renderer.ts";

/**
 * A script droplet: the default export of `+droplet.script.ts`. It runs in
 * the browser only, once per element, with what the droplet's loads
 * returned and the element's content root (`el`), under which it adds
 * whatever it wants. The cleanup it may return runs when the element leaves
 * the page (or remounts under `vite dev`); `el` is emptied after it.
 *
 * `./$types` gives each script droplet `DropletScript` with its `Data`:
 * `const run: DropletScript = (data, el) => { … }; export default run;`.
 */
export type DropletScript<Data = unknown> = (data: Data, el: HTMLElement) => void | (() => void);

type Instance = { target: HTMLElement; cleanup: (() => void) | undefined };

const isThenable = (value: unknown): value is PromiseLike<unknown> => typeof (value as PromiseLike<unknown> | null)?.then === "function";

export async function mount(
  module: ComponentModule,
  target: HTMLElement,
  props: RenderProps,
  context: ClientRenderContext,
): Promise<Instance> {
  const run = module.default;
  if (typeof run !== "function") {
    throw new Error(`${context.droplet}: +droplet.script.ts must export a default function (data, el)`);
  }
  // A promise when mounting; a rejection is the droplet's error, logged by the element.
  const data = "data" in props ? await props.data : undefined;
  let returned: unknown = (run as (data: unknown, el: HTMLElement) => unknown)(data, target);
  // Typed as synchronous; an async one still gets its cleanup kept.
  if (isThenable(returned)) returned = await returned;
  return { target, cleanup: typeof returned === "function" ? (returned as () => void) : undefined };
}

/** Nothing was rendered on the server: the same as `mount`. */
export const hydrate = mount;

export function unmount(instance: unknown): void {
  const { cleanup, target } = instance as Instance;
  try {
    cleanup?.();
  } finally {
    target.replaceChildren();
  }
}
