import { fail } from "$droplets/server";
import { ANSWERS, MAX_ANSWER_ID, QUESTION, type PollFailure } from "../../lib/poll.ts";
import { readForm, text } from "../../lib/server/forms.ts";
import type { Actions, LoadEvent } from "./$types";

/** The question and the answers. The same for everyone. */
export const load = ({ setHeaders }: LoadEvent) => {
  setHeaders({ "cache-control": "public, max-age=300" });
  return { question: QUESTION, answers: [...ANSWERS].map(([id, label]) => ({ id, label })) };
};

/**
 * Stateless on purpose: the vote is checked and echoed back, never stored,
 * counted or shared with anyone else. The framework resolves the droplet
 * and `?/vote` before this runs; the body is read here, once, as a form.
 */
export const actions = {
  /** `?/vote`: one field, `answer`, an id of ANSWERS. */
  vote: async ({ request }) => {
    const form = await readForm(request);
    if (!form) return fail(400, { field: "form", code: "unreadable" } satisfies PollFailure);
    const id = text(form, "answer", MAX_ANSWER_ID);
    if (!id) return fail(422, { field: "answer", code: "missing" } satisfies PollFailure);
    if (!ANSWERS.has(id)) return fail(422, { field: "answer", code: "unknown" } satisfies PollFailure);
    // Our own key and label, not the submitted string.
    return { voted: id, label: ANSWERS.get(id)! };
  },
} satisfies Actions;
