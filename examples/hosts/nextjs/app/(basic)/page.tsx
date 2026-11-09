import { fragment } from "@/lib/droplets";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The Svelte example's droplets (examples/frameworks/svelte), one per mode.
const IDS = ["client", "ssr-hydrate", "ssr-nohydrate"];

/**
 * A server component: it runs on the Next server, fetches the fragments and
 * emits them as HTML. The droplets hydrate on their own in the browser.
 */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const who = typeof params.who === "string" ? params.who : "Next.js";

  const fragments = await Promise.all(
    IDS.map((id) => fragment(id, { who })),
  );

  return (
    <main style={{ maxWidth: "48rem", margin: "0 auto" }}>
      <h1>Next.js page, three Svelte droplets</h1>
      <p>
        Fragments fetched in a server component and rendered on the server. Try{" "}
        <a href="/?who=Next">?who=Next</a>, or the <a href="/gallery">shop demo</a>.
      </p>
      {/*
        Trusted markup from our own droplets server. The droplets hydrate
        themselves and may change their markup before React compares it.
      */}
      <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: fragments.join("") }} />
    </main>
  );
}
