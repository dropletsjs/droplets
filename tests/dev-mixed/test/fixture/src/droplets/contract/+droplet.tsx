/** @jsxImportSource react */
import { useEffect, useState } from "react";

export const ssr = true;
export const hydrate = false;
export const prerender = false;

export default function Contract() {
  const [hydrated, setHydrated] = useState(false);
  const [count, setCount] = useState(0);
  useEffect(() => setHydrated(true), []);
  return (
    <section data-testid="contract" data-hydrated={hydrated}>
      <p data-text>The contract</p>
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        {count}
      </button>
    </section>
  );
}
