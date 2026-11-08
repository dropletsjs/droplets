import type { DropletProps } from "@dropletsjs/renderer-solid";

export const prerender = true;

export default function Docs(props: DropletProps<{ page: number }>) {
  // One expression for the heading: text next to an expression would get
  // Solid's hydration markers (`Page <!--$-->1<!--/-->`) in the HTML.
  return (
    <article data-testid="docs">
      <h1>{`Page ${props.data.page}`}</h1>
      <p>@HOST@</p>
    </article>
  );
}
