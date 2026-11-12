import { Card } from "../../lib/Card.lit.ts";

export const ssr = true;
export const hydrate = true;

// Rendered on the server into a declarative shadow root, then adopted in
// the browser as it is. `data` is what `load` in +droplet.ts returns.
export default class LitSsrHydrate extends Card {
  readonly mode = "ssr-hydrate";
}
