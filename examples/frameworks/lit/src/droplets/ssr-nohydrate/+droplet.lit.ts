import { Card } from "../../lib/Card.lit.ts";

export const ssr = true;
export const hydrate = false;

// Server HTML and no JavaScript: the declarative shadow root is all there is.
export default class LitSsrNoHydrate extends Card {
  readonly mode = "ssr-nohydrate";
}
