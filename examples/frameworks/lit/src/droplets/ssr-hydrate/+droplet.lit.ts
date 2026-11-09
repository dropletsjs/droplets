import { Card } from "../../lib/Card.lit.ts";

export const ssr = true;
export const hydrate = true;

// Rendered on the server into a declarative shadow root, then adopted in
// the browser as it is. `data` is what the server load returns (lib/server/facts.ts).
export default class LitSsrHydrate extends Card {
  readonly mode = "ssr-hydrate";
}
