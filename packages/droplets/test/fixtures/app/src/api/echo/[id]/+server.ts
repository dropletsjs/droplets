import { json, type RequestHandler } from "$droplets/server";

export const GET: RequestHandler<{ id: string }> = ({ params, locals, url }) =>
  json({ id: params.id, hooked: locals["hooked"] === true, q: url.searchParams.get("q") });
