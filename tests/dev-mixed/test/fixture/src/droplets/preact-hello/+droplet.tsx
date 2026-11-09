/** @jsxImportSource preact */
import { useEffect, useState } from "preact/hooks";

export const ssr = true;
export const hydrate = true;

function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

export default function Hello() {
  const hydrated = useHydrated();
  const [count, setCount] = useState(0);
  return (
    <section data-testid="preact" data-hydrated={hydrated}>
      <p data-text>Preact greets the host</p>
      <button type="button" onClick={() => setCount((n) => n + 1)}>{count}</button>
    </section>
  );
}
