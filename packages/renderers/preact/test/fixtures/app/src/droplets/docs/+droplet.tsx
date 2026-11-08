import type { DropletProps } from "@dropletsjs/renderer-preact";

export const prerender = true;

export default function Docs({ data }: DropletProps<{ page: number }>) {
  // One expression for the heading: the server prints `Page 1` as one text
  // node, which hydration would otherwise adopt for two (`Page `, `1`).
  return (
    <article data-testid="docs">
      <h1>{`Page ${data.page}`}</h1>
      <p>@HOST@</p>
    </article>
  );
}
