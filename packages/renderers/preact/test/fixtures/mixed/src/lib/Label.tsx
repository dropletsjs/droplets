// Neutral JSX: no framework import, so each renderer compiles it for the
// droplets of its own that reach it.
export function Label({ text }: { text: string }) {
  return <b data-label={text}>{text}</b>;
}
