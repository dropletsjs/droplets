import { use } from "react";
import type { DropletProps } from "@dropletsjs/renderer-react";

export const prerender = true;

export default function Docs({ data }: DropletProps<{ page: number }>) {
  const { page } = data instanceof Promise ? use(data) : data;
  // One expression for the heading: text next to an expression would get a
  // `<!-- -->` separator in the server HTML (`Page <!-- -->1`).
  return (
    <article data-testid="docs">
      <h1>{`Page ${page}`}</h1>
      <p>@HOST@</p>
    </article>
  );
}
