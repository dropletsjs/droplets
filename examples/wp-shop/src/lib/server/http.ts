import { error } from "$droplets/server";
import type * as z from "zod/mini";

// Reading /api input: the query through a schema, JSON bodies through
// plain JSON.parse with a size cap. A body is data: it is checked field by
// field and never merged into anything.

/** The query string through a props schema, or a 400 naming the first problem. */
export async function query<S extends z.ZodMiniType>(url: URL, schema: S): Promise<z.output<S>> {
  type T = z.output<S>;
  const input: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (key.length > 40 || value.length > 200) error(400, "Query too long.");
    input[key] = value;
  }
  const result = await schema["~standard"].validate(input);
  if (result.issues) {
    const [issue] = result.issues;
    const path = (issue?.path ?? []).map((p) => String(typeof p === "object" ? p.key : p)).join(".");
    error(400, `${path || "query"}: ${issue?.message ?? "invalid"}`);
  }
  return result.value as T;
}

/** A JSON object body of at most `max` bytes, or a 400/413/415. */
export async function jsonBody(request: Request, max = 16 * 1024): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) error(415, "Send JSON.");
  const raw = await request.text();
  if (raw.length > max) error(413, "Body too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    error(400, "Invalid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) error(400, "Send a JSON object.");
  return parsed as Record<string, unknown>;
}

/** An own property of a parsed body: never one inherited from Object.prototype. */
export const field = (body: Record<string, unknown>, name: string): unknown =>
  Object.hasOwn(body, name) ? body[name] : undefined;
