import type { DropletProps } from "@dropletsjs/renderer-hono-jsx";

export const prerender = true;

export default function Docs({ data }: DropletProps<{ page: number }>) {
  const { page } = data as { page: number };
  return (
    <article data-testid="docs">
      <h1>Page {page}</h1>
      <p>@HOST@</p>
    </article>
  );
}
