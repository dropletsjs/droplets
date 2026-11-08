import type { DropletErrorProps } from "@dropletsjs/renderer-preact";

export default function DocsError({ error }: DropletErrorProps<{ message: string }>) {
  return <p data-testid="docs-error">{error.message}</p>;
}
