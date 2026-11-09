import { pick } from "@/lib/shop";
import { Fragment, queryOf, ShopShell, shopPage, STACK, type SearchParams } from "@/lib/shop-page";

export const metadata = { title: `Admin · Droplets Shop on ${STACK}` };

export default async function Admin({ searchParams }: { searchParams: SearchParams }) {
  const query = queryOf(await searchParams);
  const { toasts, cart, fragments, preloads } = await shopPage(`/admin${query.size ? `?${query}` : ""}`, [
    ["product-admin", pick(query, ["view", "id"])],
  ]);
  return (
    <ShopShell toasts={toasts} current="/admin" cart={cart} preloads={preloads}>
      <Fragment html={fragments[0]!} />
    </ShopShell>
  );
}
