/** How a droplet of this example is built: one droplet per mode. */
export type Mode = "client" | "ssr-hydrate" | "ssr-nohydrate";

/** What the private variables tell, never their values. */
export type PrivateFacts = {
  apiToken: "set" | "not set";
  channel: string;
};

/** What the server-rendered droplets load (`lib/server/facts.ts`). */
export type Facts = PrivateFacts & {
  who: string;
  count: number;
  renderedAt: string;
  requestId: string;
};
