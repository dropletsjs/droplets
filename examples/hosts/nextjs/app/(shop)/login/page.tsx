import { pick } from "@/lib/shop";
import { Fragment, queryOf, ShopShell, shopPage, STACK, type SearchParams } from "@/lib/shop-page";

export const metadata = { title: `Log in · Droplets Shop on ${STACK}` };

export default async function Login({ searchParams }: { searchParams: SearchParams }) {
  const query = queryOf(await searchParams);
  const { toasts, cart, fragments, preloads } = await shopPage(`/login${query.size ? `?${query}` : ""}`, [
    ["login", pick(query, ["next"])],
  ]);
  return (
    <ShopShell toasts={toasts} cart={cart} preloads={preloads}>
      <div className="shop-narrow">
        <Fragment html={fragments[0]!} />
      </div>
    </ShopShell>
  );
}
