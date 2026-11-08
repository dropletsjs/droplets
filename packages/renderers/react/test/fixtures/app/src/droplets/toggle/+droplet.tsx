import { useState } from "react";
import type { DropletProps } from "@dropletsjs/renderer-react";

// Not part of the conformance scenarios: a branch around the host's
// children, for the browser check of the hide/show contract.
export default function Toggle({ children }: DropletProps) {
  const [open, setOpen] = useState(true);
  return (
    <section data-testid="toggle">
      <button data-testid="toggle-button" onClick={() => setOpen((o) => !o)}>
        {open ? "close" : "open"}
      </button>
      {open ? <div data-testid="toggle-children">{children}</div> : null}
    </section>
  );
}
