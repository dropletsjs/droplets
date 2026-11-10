import { createResource, createSignal } from "solid-js";
import type { DropletProps } from "@dropletsjs/renderer-solid";

export const ssr = true;
export const hydrate = true;

type Data = { greeting: string };

export default function Hello(props: DropletProps<Data>) {
  const [clicks, setClicks] = createSignal(0);
  // The value when hydrating, a promise when mounted from scratch: a
  // resource of it suspends, and one that rejected reaches the error boundary.
  // `props.data` is read where Solid tracks it, so new data (a load edit
  // under `vite dev`) reaches the same instance.
  const first = props.data;
  const resource = first instanceof Promise ? createResource(() => first)[0] : undefined;
  const value = () => {
    const data = props.data;
    return data === first && resource ? resource() : data instanceof Promise ? undefined : data;
  };
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
