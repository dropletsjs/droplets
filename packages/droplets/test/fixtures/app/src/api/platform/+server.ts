import { json, type RequestHandler } from "$droplets/server";

/** What the runtime handed over: on Workers, the bindings. */
export const GET: RequestHandler = ({ platform }) => json({ env: Object.keys((platform.env ?? {}) as object).sort() });
