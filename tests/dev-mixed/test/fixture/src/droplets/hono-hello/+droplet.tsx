/** @jsxImportSource hono/jsx */
import { useEffect, useState } from "hono/jsx";

export const ssr = true;
export const hydrate = true;

export default function Hello({ data }: { data: { word: string } }) {
  const [count, setCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <section data-testid="hono" data-hydrated={String(hydrated)}>
      <p data-text>Hono greets the host</p>
      <p data-word>{data.word}</p>
      <button type="button" onClick={() => setCount((n) => n + 1)}>{count}</button>
    </section>
  );
}
