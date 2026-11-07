/**
 * The server side of script droplets: nothing. The server registry never
 * imports a `+droplet.script.ts` (it is browser code), so `module` is an
 * empty stand-in; the fragment is the element with its data payload and an
 * empty content root. See `./index.ts`.
 */
import type { ServerRenderOutput } from "../renderer.ts";

export function render(): ServerRenderOutput {
  return "";
}
