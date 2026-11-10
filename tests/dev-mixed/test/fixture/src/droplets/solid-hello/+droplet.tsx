/** @jsxImportSource solid-js */
import { createSignal, onMount } from "solid-js";

export const ssr = true;
export const hydrate = true;

function useHydrated() {
  const [hydrated, setHydrated] = createSignal(false);
  onMount(() => setHydrated(true));
  return hydrated;
}

export default function Hello(props: { data: { word: string } }) {
  const hydrated = useHydrated();
  const [count, setCount] = createSignal(0);
  return (
    <section data-testid="solid" data-hydrated={hydrated()}>
      <p data-text>Solid greets the host</p>
      <p data-word>{props.data.word}</p>
      <button type="button" onClick={() => setCount((n) => n + 1)}>{count()}</button>
    </section>
  );
}
