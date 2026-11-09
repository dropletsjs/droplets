/** @jsxImportSource preact */
// `error` is what handleError in +droplet.server.ts returns.
import type { DropletErrorProps } from "./$types";

export default function SsrHydrateError({ error }: DropletErrorProps) {
  return (
    <section class="card">
      <p class="card-error">Oops</p>
      <p class="card-summary">{error.message}</p>
    </section>
  );
}
