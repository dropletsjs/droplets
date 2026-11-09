import { json, type RequestHandler } from "$droplets/server";
import { privateFacts } from "../../lib/server/facts.ts";

/** `GET /api/env` -> what the private variables tell, never their values. */
export const GET: RequestHandler = () => json(privateFacts());
