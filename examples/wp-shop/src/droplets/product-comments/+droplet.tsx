/** @jsxImportSource solid-js */
import { createEffect, createResource, createSignal, For, on, onMount, Show } from "solid-js";
import { actionUrl } from "$droplets/form";
import { enhanceDropletForm } from "@dropletsjs/renderer-solid/form";
import { listComments, readData } from "../../lib/api.ts";
import { formatDate } from "../../lib/format.ts";
import { COMMENT_PAGE_SIZES } from "../../lib/schemas.ts";
import type { Comment, CommentOrder } from "../../lib/types.ts";
import type { DropletActions, DropletProps } from "./$types";
import "./comments.css";

// `use:` needs the directive in scope, not only in a type.
void enhanceDropletForm;

// WordPress's comments on the product post. Server-rendered, often
// prerendered (full oldest-first pages), hydrated
// when it is about to scroll into view. The render holds one page of
// comments and nothing that goes stale: after hydrating, the total comes
// from GET /api/comments and "Load more" reads the next page through GET
// `_data`. Without JavaScript: page links on the host's own URL.
export const ssr = true;
export const hydrate = "visible";
export const prerender = true;

type Page = { productId: string; order: CommentOrder; page: number; showing: number; comments: Comment[] };
type FormResult = { posted?: boolean; held?: boolean; errors?: { author?: string; body?: string } } | undefined;

export default function ProductComments(props: DropletProps) {
  // At the component's root: it runs as the droplet renders, so
  // `actionUrl()` knows the render (Comments may show later, once the data is in).
  const post = actionUrl<DropletActions>("post");
  const data = props.data;
  const page = data instanceof Promise ? createResource(() => data)[0] : () => data;
  return <Show when={page()}>{(first) => <Comments first={first()} form={props.form as FormResult} post={post} />}</Show>;
}

function Comments(props: { first: Page; form: FormResult; post: string }) {
  const post = props.post;
  const [order, setOrder] = createSignal(props.first.order);
  const [showing, setShowing] = createSignal(props.first.showing);
  const [list, setList] = createSignal(props.first.comments);
  const [loaded, setLoaded] = createSignal(props.first.page);
  const [total, setTotal] = createSignal<number | null>(null);
  const [mounted, setMounted] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const productId = props.first.productId;

  const refreshTotal = async () => {
    const meta = await listComments(productId, order(), 1, showing());
    setTotal(meta.total);
  };

  /** Page `n` of the current order and size, through the droplet's own GET `_data`. */
  const fetchPage = (n: number) => readData<Page>("product-comments", { productId, order: order(), page: n, showing: showing() });

  const loadMore = async () => {
    setBusy(true);
    try {
      const next = await fetchPage(loaded() + 1);
      const seen = new Set(list().map((c) => c.id));
      setList([...list(), ...next.comments.filter((c) => !seen.has(c.id))]);
      setLoaded(next.page);
    } finally {
      setBusy(false);
    }
  };

  const restart = async (nextOrder: CommentOrder, nextShowing: number) => {
    setOrder(nextOrder);
    setShowing(nextShowing);
    setBusy(true);
    try {
      const [first] = await Promise.all([fetchPage(1), refreshTotal()]);
      setList(first.comments);
      setLoaded(1);
    } finally {
      setBusy(false);
    }
  };

  onMount(() => {
    setMounted(true);
    void refreshTotal().catch(() => {});
  });
  // After a post (the enhanced form renders the droplet again with `form`): the new total.
  createEffect(
    on(
      () => props.form?.posted,
      (posted) => posted && void refreshTotal().catch(() => {}),
      { defer: true },
    ),
  );

  // Pages 1 to loaded() are behind or on screen; anything past them is more.
  const hasMore = () => total() !== null && total()! > loaded() * showing();
  const link = (changes: Partial<{ order: CommentOrder; page: number; showing: number }>) => {
    const query = new URLSearchParams({
      order: changes.order ?? order(),
      page: String(changes.page ?? props.first.page),
      showing: String(changes.showing ?? showing()),
    });
    return `?${query}#comments`;
  };
  const switchOrder = (event: MouseEvent, next: CommentOrder) => {
    if (!mounted()) return;
    event.preventDefault();
    if (next !== order()) void restart(next, showing());
  };

  return (
    <section class="comments" id="comments" aria-busy={busy()}>
      <header>
        <h2>
          Comments{" "}
          <Show when={total() !== null}>
            <small>({total()})</small>
          </Show>
        </h2>
        <nav class="order" aria-label="Order">
          <a
            href={link({ order: "oldest", page: 1 })}
            aria-current={order() === "oldest" ? "true" : undefined}
            onClick={(e) => switchOrder(e, "oldest")}
          >
            Oldest first
          </a>
          <a
            href={link({ order: "newest", page: 1 })}
            aria-current={order() === "newest" ? "true" : undefined}
            onClick={(e) => switchOrder(e, "newest")}
          >
            Newest first
          </a>
        </nav>
        <form method="get" class="showing" action="#comments">
          <input type="hidden" name="order" value={order()} />
          <label>
            Showing
            <select class="field" name="showing" onChange={(e) => mounted() && void restart(order(), Number(e.currentTarget.value))}>
              <For each={COMMENT_PAGE_SIZES}>
                {(size) => (
                  <option value={size} selected={size === showing()}>
                    {size}
                  </option>
                )}
              </For>
            </select>
          </label>
          <Show when={!mounted()}>
            <button type="submit" class="button">
              Show
            </button>
          </Show>
        </form>
      </header>

      <Show when={list().length} fallback={<p class="empty">No comments yet. Be the first.</p>}>
        <ol class="list">
          <For each={list()}>
            {(comment) => (
              <li>
                <p class="meta">
                  <b>{comment.author}</b> · <time datetime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
                </p>
                <p class="body">{comment.body}</p>
              </li>
            )}
          </For>
        </ol>
      </Show>

      <Show
        when={mounted()}
        fallback={
          <nav class="pager" aria-label="Comment pages">
            <Show when={props.first.page > 1}>
              <a class="button" href={link({ page: props.first.page - 1 })}>
                ‹ Previous
              </a>
            </Show>
            <Show when={props.first.comments.length === props.first.showing}>
              <a class="button" href={link({ page: props.first.page + 1 })}>
                Next ›
              </a>
            </Show>
          </nav>
        }
      >
        <Show when={hasMore()}>
          <button type="button" class="button more" disabled={busy()} onClick={() => void loadMore()}>
            Load more
          </button>
        </Show>
      </Show>

      <form method="post" action={post} class="post" use:enhanceDropletForm={{ action: "post" }}>
        <h3>Add a comment</h3>
        <Show when={props.form?.posted}>
          <p class="notice ok" role="status">
            {props.form?.held ? "Thanks, your comment waits for moderation." : "Thanks, your comment is posted."}
          </p>
        </Show>
        <label>
          Name
          <input class="field" name="author" required minlength={2} maxlength={40} autocomplete="nickname" />
        </label>
        <Show when={props.form?.errors?.author}>
          <p class="notice error" role="alert">
            {props.form?.errors?.author}
          </p>
        </Show>
        <label>
          Your comment
          <textarea class="field" name="body" required minlength={3} maxlength={1000} rows={4} />
        </label>
        <Show when={props.form?.errors?.body}>
          <p class="notice error" role="alert">
            {props.form?.errors?.body}
          </p>
        </Show>
        <label class="trap" aria-hidden="true">
          Website <input name="website" tabindex={-1} autocomplete="off" />
        </label>
        <button type="submit" class="button primary">
          Post comment
        </button>
      </form>
    </section>
  );
}
