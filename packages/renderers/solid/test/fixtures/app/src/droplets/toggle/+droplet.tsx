import { createSignal, Show } from "solid-js";
import type { DropletProps } from "@dropletsjs/renderer-solid";

// Not part of the conformance scenarios: a <Show> around the host's
// children, for the browser check of the hide/show contract.
export default function Toggle(props: DropletProps) {
  const [open, setOpen] = createSignal(true);
  return (
    <section data-testid="toggle">
      <button data-testid="toggle-button" onClick={() => setOpen(!open())}>
        {open() ? "close" : "open"}
      </button>
      <Show when={open()}>
        <div data-testid="toggle-children">{props.children}</div>
      </Show>
    </section>
  );
}
