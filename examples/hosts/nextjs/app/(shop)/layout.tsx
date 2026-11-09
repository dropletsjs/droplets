import type { ReactNode } from "react";

const SPECULATION = JSON.stringify({
  prefetch: [{ where: { href_matches: "/product/*" }, eagerness: "moderate" }],
});

/**
 * The shop demo's root layout (the basic page has its own, in `(basic)`).
 * `/index.js` is the shop's, through this host's proxy (app/index.js/route.ts).
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/shop.css" />
        <script type="speculationrules" dangerouslySetInnerHTML={{ __html: SPECULATION }} />
        <script type="module" src="/index.js" />
      </head>
      <body className="shop">{children}</body>
    </html>
  );
}
