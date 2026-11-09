import { useState } from "react";
import { Droplet, DROPLETS_URL } from "./droplets.tsx";

// The Svelte example's server-rendered droplets (examples/frameworks/svelte).
const IDS = ["ssr-hydrate", "ssr-nohydrate"];

export function App() {
  const [who, setWho] = useState("React");

  return (
    <main style={{ maxWidth: "48rem", margin: "0 auto" }}>
      <h1>React app, the Svelte example's droplets</h1>
      <p>
        Droplets served from <code>{DROPLETS_URL}</code>, embedded by a React component. The first
        two fetch the server-rendered fragment; the last one is mounted client-only.
      </p>
      <label>
        Greet{" "}
        <input value={who} onChange={(event) => setWho(event.target.value)} />
      </label>

      {IDS.map((id) => (
        <Droplet key={id} id={id} props={{ who }} />
      ))}
      <Droplet id="client" mode="client" />
    </main>
  );
}
