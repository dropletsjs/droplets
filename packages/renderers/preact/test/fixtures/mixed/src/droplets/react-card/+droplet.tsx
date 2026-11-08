/** @jsxImportSource react */
import { useState } from "react";
import { Label } from "../../lib/Label.tsx";

export default function ReactCard() {
  const [clicks, setClicks] = useState(0);
  return (
    <section className="react-card">
      <Label text="react" />
      <button onClick={() => setClicks(clicks + 1)}>{clicks}</button>
    </section>
  );
}
