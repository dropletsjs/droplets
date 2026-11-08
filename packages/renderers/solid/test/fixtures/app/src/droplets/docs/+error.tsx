import type { DropletErrorProps } from "@dropletsjs/renderer-solid";

export default function DocsError(props: DropletErrorProps<{ message: string }>) {
  return <p data-testid="docs-error">{props.error.message}</p>;
}
