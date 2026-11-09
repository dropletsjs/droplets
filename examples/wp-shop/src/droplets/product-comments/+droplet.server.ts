import { building } from "$droplets/env";
import { fail, type Entries } from "$droplets/server";
import { commentEntries } from "../../lib/comment-entries.ts";
import { productById } from "../../lib/server/catalogue.ts";
import { commentCounts, commentsPage, postComment } from "../../lib/server/comments.ts";
import { readForm, text } from "../../lib/server/forms.ts";
import type { Actions, LoadEvent } from "./$types";

/**
 * Prerender what is safe: oldest-first pages that are already full at
 * build, for every page size (see lib/comment-entries.ts), counted from
 * WordPress's `X-WP-Total`. Newest-first and partial pages render live.
 */
export const entries = (async () => commentEntries(await commentCounts())) satisfies Entries;

/**
 * One page of WordPress's comments on the product, and nothing that
 * changes when someone posts: the total and "load more" are not in this
 * render. The browser asks for them after hydrating.
 */
export const load = async ({ props, request, setHeaders }: LoadEvent) => {
  const comments = await commentsPage(props);
  const settled = props.order === "oldest" && comments.length === props.showing;
  if (building || request.method === "GET") {
    setHeaders({ "cache-control": settled ? "public, max-age=300" : "public, max-age=15" });
  }
  return { ...props, comments };
};

type Errors = { author?: string; body?: string };

/** What WordPress's refusal means to the visitor. */
const REFUSED: Record<string, string> = {
  flood: "You are posting comments too quickly. Wait a moment.",
  duplicate: "You have already said that.",
  closed: "Comments are closed for this product.",
  refused: "WordPress did not take the comment; please try again.",
};

export const actions = {
  /** `?/post`: author and body, posted to WordPress as a comment. A hidden `website` field catches bots. */
  post: async ({ request, props }) => {
    const form = await readForm(request);
    if (!form) return fail(400, { errors: { body: "Something went wrong; please try again." } satisfies Errors });
    if (text(form, "website", 200)) return { posted: true };

    const author = text(form, "author", 40);
    const body = text(form, "body", 1000);
    const errors: Errors = {};
    if (!author || author.length < 2) errors.author = "Your name, 2 to 40 characters.";
    if (!body || body.length < 3) errors.body = "A comment, 3 to 1000 characters.";
    if (errors.author || errors.body) return fail(400, { errors });

    if (!(await productById(props.productId))) return fail(404, { errors: { body: "This product is gone." } satisfies Errors });
    const result = await postComment(props.productId, author!, body!);
    if (!result.ok) return fail(409, { errors: { body: REFUSED[result.reason]! } satisfies Errors });
    return { posted: true, held: result.held };
  },
} satisfies Actions;
