import type { ClientInit } from "@dropletsjs/droplets";
import { installMessageQueue, relayAdds } from "./lib/message-bridge.ts";

// Called by `/index.js` once, synchronously, before any droplet starts:
// the page's `window.shopMessageQueue` (lib/message-bridge.ts) is there
// before the first droplet hydrates, whatever the order of the page.
export const init: ClientInit = () => {
  installMessageQueue();
  // The product page ships no JavaScript to send its own toast: its
  // enhanced add, relayed from `droplets:action`.
  relayAdds(["product-page"]);
};
