/** @jsxImportSource hono/jsx */
import { use, useEffect, useState } from "hono/jsx";
import { emit } from "../../lib/events.ts";
import type { Filter } from "../../lib/types.ts";
import type { DropletProps } from "./$types";
import "./filter.css";

// A plain GET form with no `action`: without JavaScript it submits to the
// host page itself (`/gallery?category=mugs…`), and the host forwards that
// query to this droplet and the library. Hydrated (on the first
// interaction), every change emits `shop:filter` instead and the library
// refetches in place.
export const ssr = true;
export const hydrate = "interactive";

const read = (form: HTMLFormElement, scope: string): Filter & { scope: string } => {
  const fields = new FormData(form);
  const sort = String(fields.get("sort") ?? "new");
  return {
    q: String(fields.get("q") ?? "").trim().slice(0, 80),
    category: String(fields.get("category") ?? ""),
    sort: sort === "price-asc" || sort === "price-desc" ? sort : "new",
    onSale: fields.get("onSale") !== null,
    scope,
  };
};

export default function ProductFilter({ data }: DropletProps) {
  const { categories, current } = data instanceof Promise ? use(data) : data;
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const changed = (event: Event) => {
    const form = (event.currentTarget as HTMLElement).closest("form");
    if (form) emit("shop:filter", read(form, current.scope));
  };
  const submitted = (event: Event) => {
    event.preventDefault();
    changed(event);
  };
  const all = categories.reduce((n, c) => n + c.count, 0);

  return (
    <form method="get" class="filter" role="search" onSubmit={submitted}>
      <label class="search">
        <span class="visually-hidden">Search</span>
        <input class="field" type="search" name="q" value={current.q} placeholder="Search…" maxlength={80} />
      </label>

      <fieldset class="categories" onChange={changed}>
        <legend>Category</legend>
        <label>
          <input type="radio" name="category" value="" checked={current.category === ""} />
          <span>All</span> <small>{all}</small>
        </label>
        {categories.map((category) => (
          <label>
            <input type="radio" name="category" value={category.slug} checked={current.category === category.slug} />
            <span>{category.name}</span> <small>{category.count}</small>
          </label>
        ))}
      </fieldset>

      <label class="sort">
        <span>Sort</span>
        <select class="field" name="sort" onChange={changed}>
          <option value="new" selected={current.sort === "new"}>Newest</option>
          <option value="price-asc" selected={current.sort === "price-asc"}>Price, low to high</option>
          <option value="price-desc" selected={current.sort === "price-desc"}>Price, high to low</option>
        </select>
      </label>

      <label class="toggle">
        <input type="checkbox" name="onSale" value="1" checked={current.onSale} onChange={changed} />
        <span>On sale only</span>
      </label>

      {current.scope !== "main" ? <input type="hidden" name="scope" value={current.scope} /> : null}
      {/* Without JavaScript this submits the form; hydrated, every change applies at once. */}
      <button class={hydrated ? "button visually-hidden" : "button"}>Apply</button>
    </form>
  );
}
