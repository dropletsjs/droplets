import { createResource, createSignal } from "solid-js";
import type { DropletProps } from "@dropletsjs/renderer-solid";

export const ssr = true;
export const hydrate = true;

type Data = { greeting: string };

export default function Hello(props: DropletProps<Data>) {
  const [clicks, setClicks] = createSignal(0);
  // The value when hydrating, a promise when mounted from scratch: a
  // resource of it suspends, and one that rejected reaches the error boundary.
  const data = props.data;
  const value = data instanceof Promise ? createResource(() => data)[0] : () => data;
  return (
    <section>
      <h1 data-testid="greeting">{value()?.greeting}</h1>
      <button data-testid="count" onClick={() => setClicks(clicks() + 1)}>
        {clicks()}
      </button>
      <div data-testid="children">{props.children}</div>
    </section>
  );
}
