/**
 * The poll's question and its answers, by id. A Map: an id from a form is
 * looked up as a key, never as a property, so `__proto__`, `constructor` or
 * `toString` are simply not answers.
 */
export const QUESTION = "Which framework would you write your next droplet in?";

export const ANSWERS: ReadonlyMap<string, string> = new Map([
  ["svelte", "Svelte"],
  ["vue", "Vue"],
  ["react", "React"],
  ["solid", "Solid"],
  ["hono-jsx", "Hono JSX"],
  ["handlebars", "Handlebars"],
]);

/** The longest answer id: a longer field is not read as one. */
export const MAX_ANSWER_ID = Math.max(...[...ANSWERS.keys()].map((id) => id.length));

/** What `fail()` sends back: a code for the component to word, never the submitted value. */
export type PollFailure = { field: "answer"; code: "missing" | "unknown" } | { field: "form"; code: "unreadable" };
