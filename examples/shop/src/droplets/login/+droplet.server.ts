import { fail, redirect } from "$droplets/server";
import { ADMIN_COOKIE, ADMIN_COOKIE_OPTIONS } from "../../lib/server/auth.ts";
import { newSession, verifyLogin } from "../../lib/server/admin.ts";
import { readForm, text } from "../../lib/server/forms.ts";
import type { Actions, LoadEvent } from "./$types";

export const load = ({ props, locals }: LoadEvent) => ({ next: props.next, admin: locals.admin?.name ?? null });

export const actions = {
  /**
   * `?/login`: user and password, compared in constant time. Success sets
   * the signed `shop_admin` cookie and redirects to `next` (a path on the
   * host: `props.next` went through the schema, never the form body).
   * Failure says so, without echoing what was typed.
   */
  login: async ({ request, props, cookies }) => {
    const form = await readForm(request);
    const user = form && text(form, "user", 100);
    const password = form && form.get("password");
    if (!user || typeof password !== "string" || password.length > 200 || !verifyLogin(user, password)) {
      return fail(401, { message: "Wrong user or password." });
    }
    const session = newSession();
    if (!session) return fail(503, { message: "Logging in is turned off on this server (no SHOP_SECRET)." });
    cookies.set(ADMIN_COOKIE, session, ADMIN_COOKIE_OPTIONS);
    redirect(303, props.next);
  },

  /** `?/logout`: the cookie goes, back to the gallery. */
  logout: ({ cookies }) => {
    cookies.delete(ADMIN_COOKIE, { path: "/" });
    redirect(303, "/gallery");
  },
} satisfies Actions;
