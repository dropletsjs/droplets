import { Card } from "../../lib/Card.lit.ts";

// Nothing on the server: the element mounts it in the browser, and the
// card fetches what it shows from /api.
export const ssr = false;
export const hydrate = true;

export default class LitClient extends Card {
  readonly mode = "client";
}
