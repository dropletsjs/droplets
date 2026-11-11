import { fail } from "$droplets/server";
import { PRODUCT_ID, SLUG } from "../../lib/schemas.ts";
import { requireAdmin } from "../../lib/server/admin.ts";
import { ADMIN_COOKIE } from "../../lib/server/auth.ts";
import { currentCampaign, recentCampaigns, startCampaign, stopCampaign } from "../../lib/server/campaigns.ts";
import { integer, readForm, text } from "../../lib/server/forms.ts";
import { saveUpload } from "../../lib/server/images.ts";
import {
  adminList,
  adminProduct,
  archiveProduct,
  categoryExists,
  categoryList,
  createProduct,
  productsByIds,
  setStock,
  slugTaken,
  updateProduct,
  type ProductInput,
} from "../../lib/server/products.ts";
import type { Actions, LoadEvent } from "./$types";

/**
 * Without a session the droplet renders its login gate: authorization is
 * data, never a redirect (a host's server fetching this fragment must get
 * a fragment). Every action checks the session again on its own.
 */
export const load = async ({ props, locals }: LoadEvent) => {
  if (!locals.admin) return { authorized: false as const, view: props.view };
  const [campaign, products, categories] = await Promise.all([currentCampaign(), adminList(), categoryList()]);
  return {
    authorized: true as const,
    admin: locals.admin.name,
    view: props.view,
    campaign,
    products,
    categories,
    product: props.view === "edit" && props.id ? ((await adminProduct(props.id)) ?? null) : null,
    recent: props.view === "campaign" ? await recentCampaigns() : [],
  };
};

type Errors = Partial<Record<"name" | "slug" | "category" | "price" | "stock" | "description" | "details" | "image" | "form", string>>;

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/** `14`, `14.5`, `14,50` → cents; anything else `null`. */
function cents(value: string | null): number | null {
  const match = value ? /^(\d{1,5})(?:[.,](\d{1,2}))?$/.exec(value) : null;
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));
}

/** A product form, checked field by field. The values never come back in `fail()` data. */
async function productInput(form: FormData, except?: string): Promise<{ input: ProductInput } | { errors: Errors }> {
  const errors: Errors = {};
  const name = text(form, "name", 80);
  if (!name || name.length < 2) errors.name = "A name, 2 to 80 characters.";
  const slug = text(form, "slug", 80) || (name ? slugify(name) : "");
  if (!SLUG.test(slug)) errors.slug = "Lowercase letters, digits and dashes.";
  else if (await slugTaken(slug, except)) errors.slug = "Another product has this slug.";
  const category = text(form, "category", 40);
  if (!category || !(await categoryExists(category))) errors.category = "Pick a category.";
  const priceCents = cents(text(form, "price", 12));
  if (priceCents === null || priceCents < 1) errors.price = "A price above 0, like 14.00.";
  const stock = integer(form, "stock", 0, 99_999);
  if (stock === null) errors.stock = "A whole number, 0 or more.";
  const description = text(form, "description", 1000);
  if (!description || description.length < 10) errors.description = "10 to 1000 characters.";
  const details = text(form, "details", 200);
  if (details === null) errors.details = "At most 200 characters.";
  if (Object.keys(errors).length) return { errors };
  return {
    input: { name: name!, slug, category: category!, priceCents: priceCents!, stock: stock!, description: description!, details: details! },
  };
}

/** The uploaded image's key, `undefined` when none was sent, or an error. */
async function upload(form: FormData): Promise<{ key?: string } | { error: string }> {
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return {};
  const saved = await saveUpload(file);
  if ("error" in saved) return { error: saved.error === "size" ? "At most 2 MB." : "A PNG, JPEG or WebP image." };
  return { key: saved.key };
}

/** `id` from the form, when it is a product id. */
const idFrom = (form: FormData | null) => {
  const id = form && text(form, "id", 40);
  return id && PRODUCT_ID.test(id) ? id : null;
};

const date = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null);

export const actions = {
  /** `?/create`: a new product, multipart with its image. */
  create: async (event) => {
    const denied = requireAdmin(event);
    if (denied) return denied;
    const form = await readForm(event.request);
    if (!form) return fail(400, { errors: { form: "Unreadable form." } satisfies Errors });
    const checked = await productInput(form);
    if ("errors" in checked) return fail(400, { errors: checked.errors });
    // The image is stored only once the rest of the form is valid.
    const image = await upload(form);
    if ("error" in image) return fail(400, { errors: { image: image.error } satisfies Errors });
    if (!image.key) return fail(400, { errors: { image: "A product needs an image." } satisfies Errors });
    return { saved: await createProduct(checked.input, image.key) };
  },

  /** `?/update`: id plus the product form; the image only when a new one is sent. */
  update: async (event) => {
    const denied = requireAdmin(event);
    if (denied) return denied;
    const form = await readForm(event.request);
    const id = idFrom(form);
    if (!form || !id) return fail(400, { errors: { form: "No such product." } satisfies Errors });
    const checked = await productInput(form, id);
    if ("errors" in checked) return fail(400, { errors: checked.errors });
    const image = await upload(form);
    if ("error" in image) return fail(400, { errors: { image: image.error } satisfies Errors });
    if (!(await updateProduct(id, checked.input, image.key))) return fail(404, { errors: { form: "No such product." } satisfies Errors });
    return { saved: id };
  },

  /** `?/delete`: archives the product (carts and comments keep their rows). */
  delete: async (event) => {
    const denied = requireAdmin(event);
    if (denied) return denied;
    const id = idFrom(await readForm(event.request));
    if (!id || !(await archiveProduct(id))) return fail(404, { errors: { form: "No such product." } satisfies Errors });
    return { deleted: id };
  },

  /** `?/stock`: id and the new stock. The video's step 3: 12 → 0. */
  stock: async (event) => {
    const denied = requireAdmin(event);
    if (denied) return denied;
    const form = await readForm(event.request);
    const id = idFrom(form);
    const stock = form && integer(form, "stock", 0, 99_999);
    if (!id || stock === null) return fail(400, { errors: { stock: "A whole number, 0 or more." } satisfies Errors, id });
    if (!(await setStock(id, stock))) return fail(404, { errors: { form: "No such product." } satisfies Errors });
    return { saved: id, stock };
  },

  /** `?/campaignSave`: starts a campaign (the one running stops). */
  campaignSave: async (event) => {
    const denied = requireAdmin(event);
    if (denied) return denied;
    const form = await readForm(event.request);
    if (!form) return fail(400, { errors: { form: "Unreadable form." } });
    const errors: Record<string, string> = {};
    const name = text(form, "name", 60);
    if (!name || name.length < 2) errors["name"] = "A name, 2 to 60 characters.";
    const pct = integer(form, "pct", 1, 90);
    if (pct === null) errors["pct"] = "A discount from 1 to 90 %.";
    const scope = text(form, "scope", 10) === "selected" ? "selected" : "all";
    const picked = form
      .getAll("productIds")
      .filter((v): v is string => typeof v === "string" && PRODUCT_ID.test(v))
      .slice(0, 200);
    const productIds = scope === "selected" ? (await productsByIds(picked)).map((p) => p.id) : [];
    if (scope === "selected" && !productIds.length) errors["productIds"] = "Pick at least one product.";
    const startsAt = date(text(form, "startsAt", 10)) ?? new Date().toISOString().slice(0, 10);
    const endsRaw = text(form, "endsAt", 10);
    const endsAt = endsRaw ? date(endsRaw) : null;
    if (endsRaw && (!endsAt || endsAt <= startsAt)) errors["endsAt"] = "An end after the start, or none.";
    if (Object.keys(errors).length) return fail(400, { errors });
    const today = new Date().toISOString().slice(0, 10);
    const id = await startCampaign({
      name: name!,
      pct: pct!,
      scope,
      productIds,
      // Today starts now; another day at midnight UTC.
      startsAt: startsAt === today ? new Date().toISOString() : `${startsAt}T00:00:00.000Z`,
      endsAt: endsAt ? `${endsAt}T00:00:00.000Z` : null,
    });
    return { campaign: id };
  },

  /** `?/campaignStop`: id of the running campaign. */
  campaignStop: async (event) => {
    const denied = requireAdmin(event);
    if (denied) return denied;
    const form = await readForm(event.request);
    const id = form && text(form, "id", 40);
    if (!id || !/^c_[a-z0-9]{1,32}$/.test(id) || !(await stopCampaign(id))) {
      return fail(404, { errors: { form: "No running campaign with that id." } });
    }
    return { stopped: id };
  },

  /** `?/logout`: the cookie goes, and this render already shows the gate. */
  logout: ({ cookies, locals }) => {
    cookies.delete(ADMIN_COOKIE, { path: "/" });
    locals.admin = null;
    return { loggedOut: true };
  },
} satisfies Actions;
