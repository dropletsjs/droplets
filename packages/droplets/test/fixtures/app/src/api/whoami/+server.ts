import { json, type RequestHandler } from "$droplets/server";

// What an internal request arrives with: `event.fetch`, end to end.
export const GET: RequestHandler = ({ request, url, locals }) =>
  json({ url: url.href, hooked: locals["hooked"] === true, cookie: request.headers.get("cookie") });
