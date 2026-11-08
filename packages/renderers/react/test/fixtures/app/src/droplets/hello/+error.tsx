import { useState } from "react";
import type { DropletErrorProps } from "@dropletsjs/renderer-react";
import "./error.css";

export default function HelloError({ error, children }: DropletErrorProps<{ message: string }>) {
  const [tries, setTries] = useState(0);
  return (
    <>
      <p className="oops" data-testid="error">{error.message}</p>
      <button data-testid="retry" onClick={() => setTries((n) => n + 1)}>
        {tries}
      </button>
      <div data-testid="error-children">{children}</div>
    </>
  );
}
