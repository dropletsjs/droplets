import { fail, redirect, type Actions } from "$droplets/server";

// Runs again after each action, for the render that shows its `form`.
export const load = () => ({ count: 1 });

export const actions = {
  // `POST /droplets/guestbook` with a form: a name, or a 422 asking for one.
  default: async ({ request }) => {
    const name = (await request.formData()).get("name");
    if (typeof name !== "string" || name === "") return fail(422, { message: "A name, please" });
    return { message: `Thanks, ${name}` };
  },
  // `?/leave`
  leave: () => redirect(303, "/bye"),
  // `?/echo`: the query the action saw, as it came.
  echo: ({ request }) => ({ message: new URL(request.url).search }),
} satisfies Actions;
