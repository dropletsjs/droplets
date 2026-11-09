import * as z from "zod/mini";

// Props schemas, shared by +droplet.ts files and the /api routes that take
// the same input. Neutral: they run on the server and, for droplets that
// mount in the browser, there too. Unknown keys are dropped (`z.object`
// strips), so a host may forward its whole page query to every fragment.

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PRODUCT_ID = /^p_[a-z0-9]{4,32}$/;

export const slug = z.string().check(z.maxLength(80), z.regex(SLUG));
export const productId = z.string().check(z.regex(PRODUCT_ID));

/** A query string says "on", "true" or "1"; a JSON body says `true`. */
const flag = z.pipe(
  z.unknown(),
  z.transform((value) => value === true || value === "on" || value === "true" || value === "1"),
);

/** A positive integer from a query string or a JSON body. */
const positive = (max: number) => z.coerce.number().check(z.int(), z.minimum(1), z.maximum(max));

export const SORTS = ["new", "price-asc", "price-desc"] as const;

/** The library's filter: product-filter, product-library and /api/products. */
export const filterFields = {
  q: z._default(z.string().check(z.trim(), z.maxLength(80)), ""),
  // "" is "every category", as the filter's "All" option sends it.
  category: z._default(z.union([z.literal(""), slug]), ""),
  sort: z._default(z.enum(SORTS), "new"),
  onSale: z._default(flag, false),
  /** Two filter/library pairs on one page tell their events apart by it. */
  scope: z._default(z.string().check(z.regex(/^[a-z0-9-]{1,20}$/)), "main"),
};

export const filterProps = z.object(filterFields);

export const libraryProps = z.object({
  ...filterFields,
  page: z._default(positive(1000), 1),
  pageSize: z._default(z.pipe(z.coerce.number(), z.literal([12, 24])), 12),
});

export const cardProps = z.object({ slug });

/** A product page's version: the first 10 hex characters of a hash of its data. */
export const PAGE_VERSION = /^[0-9a-f]{10}$/;

/**
 * The product page: `slug`, and `v`, the version a link was made with. The
 * build prerenders `{ slug, v }` for each product's `v` at the time; without
 * `v` the page always renders live.
 */
export const pageProps = z.object({ slug, v: z.optional(z.string().check(z.regex(PAGE_VERSION))) });

export const COMMENT_PAGE_SIZES = [10, 20, 25, 50] as const;

export const commentsProps = z.object({
  productId,
  order: z._default(z.enum(["oldest", "newest"]), "oldest"),
  page: z._default(positive(10_000), 1),
  showing: z._default(z.pipe(z.coerce.number(), z.literal(COMMENT_PAGE_SIZES)), 10),
});

export const cartProps = z.object({ variant: z._default(z.enum(["badge", "inline"]), "badge") });

export const adminProps = z.object({
  view: z._default(z.enum(["list", "new", "edit", "campaign"]), "list"),
  id: z.optional(productId),
});

/**
 * A path on the host, never a URL: starts with one `/`, no `//` or `/\`
 * (which browsers read as another origin), no control characters.
 */
export const relativePath = z.string().check(
  z.maxLength(200),
  z.regex(/^\/(?![/\\])[\x21-\x7e]*$/),
);

export const loginProps = z.object({ next: z._default(relativePath, "/admin") });

export type LibraryProps = z.output<typeof libraryProps>;
export type CommentsProps = z.output<typeof commentsProps>;
