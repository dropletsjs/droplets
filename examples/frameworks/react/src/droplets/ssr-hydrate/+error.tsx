/** @jsxImportSource react */
// `error` is what handleError in +droplet.server.ts returns.
import type { DropletErrorProps } from "./$types";

export default function SsrHydrateError({ error }: DropletErrorProps) {
  return (
    <section className="card">
      <p className="card-error">Oops</p>
      <p className="card-summary">{error.message}</p>
    </section>
  );
}
