/** @jsxImportSource solid-js */
// `error` is what handleError in +droplet.server.ts returns.
import type { DropletErrorProps } from "./$types";

export default function SsrHydrateError(props: DropletErrorProps) {
  return (
    <section class="card">
      <p class="card-error">Oops</p>
      <p class="card-summary">{props.error.message}</p>
    </section>
  );
}
