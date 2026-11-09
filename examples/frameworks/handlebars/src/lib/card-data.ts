import { env } from "$droplets/env/public";
import { MODES } from "./modes.ts";
import type { Facts, Mode } from "./types.ts";

/**
 * What a Handlebars card shows, worked out in `+droplet.ts`: a template
 * reads data, it cannot import modules. Runs on the server and, for a
 * droplet rendered in the browser, there too.
 */
export const cardData = (mode: Mode, data: Facts) => ({
  ...data,
  mode,
  title: MODES[mode].title,
  summary: MODES[mode].summary,
  site: env.PUBLIC_SITE_NAME,
  banner: env.PUBLIC_BANNER ?? "not set",
  private: `${data.apiToken}, channel ${data.channel}`,
  rendered: mode === "client" ? "in the browser, data from _data" : `on the server, ${data.renderedAt}`,
});
