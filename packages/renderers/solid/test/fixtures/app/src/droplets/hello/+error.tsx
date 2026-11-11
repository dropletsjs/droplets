import { createSignal } from "solid-js";
import type { DropletErrorProps } from "@dropletsjs/renderer-solid";

export default function HelloError(props: DropletErrorProps<{ message: string }>) {
  const [tries, setTries] = createSignal(0);
  return (
    <>
      <p class="oops" data-testid="error">
        {props.error.message}
      </p>
      <button data-testid="retry" onClick={() => setTries(tries() + 1)}>
        {tries()}
      </button>
      <div data-testid="error-children">{props.children}</div>
    </>
  );
}
