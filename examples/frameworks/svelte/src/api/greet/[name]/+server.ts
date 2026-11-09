import { error, json, type RequestHandler } from "$droplets/server";

/** `GET /api/greet/Ana` -> `{ "greeting": "Hello Ana!" }`. */
export const GET: RequestHandler<{ name: string }> = ({ params, locals }) => {
  if (params.name.length > 40) error(400, "That name is too long.");
  return json({ greeting: `Hello ${params.name}!`, requestId: locals.requestId });
};
