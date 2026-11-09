import { fail, type Actions } from "$droplets/server";

/** Runs again after each action, for the render that shows its `form`. */
export const load = () => ({ signedAt: new Date().toISOString() });

export const actions = {
  /** `POST /droplets/guestbook` with a form: a name, or a 422 asking for one. */
  default: async ({ request }) => {
    const name = (await request.formData()).get("name");
    if (typeof name !== "string" || name.trim() === "") return fail(422, { message: "A name, please." });
    return { message: `Thanks, ${name.trim().slice(0, 40)}!` };
  },
} satisfies Actions;
