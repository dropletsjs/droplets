/** @jsxImportSource react */
import { useEffect, useState } from "react";

export const ssr = true;
export const hydrate = true;

function useHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

export default function Hello({ data }: { data: { word: string } }) {
  const hydrated = useHydrated();
  const [count, setCount] = useState(0);
  return (
    <section data-testid="react" data-hydrated={hydrated}>
      <p data-text>React greets the host</p>
      <p data-word>{data.word}</p>
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        {count}
      </button>
    </section>
  );
}
