import { useState } from "preact/hooks";
import { Label } from "../../lib/Label.tsx";

export default function PreactCard() {
  const [clicks, setClicks] = useState(0);
  return (
    <section class="preact-card">
      <Label text="preact" />
      <button onClick={() => setClicks(clicks + 1)}>{clicks}</button>
    </section>
  );
}
