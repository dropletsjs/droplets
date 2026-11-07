import { json, type RequestHandler } from "$droplets/server";

// A form post that signs in: the Origin check and cookies, end to end.
export const POST: RequestHandler = async ({ request, cookies }) => {
  const user = String((await request.formData()).get("user") ?? "");
  cookies.set("session", user, { path: "/" });
  return json({ user });
};

export const GET: RequestHandler = ({ cookies }) => json({ session: cookies.get("session") ?? null });
