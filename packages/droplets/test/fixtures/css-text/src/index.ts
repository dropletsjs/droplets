// A sample for @dropletsjs/shared/tsdown, built by test/build/tsdown.test.ts.
import styles from "./styles.css?inline";

/** The stylesheet, as text. */
export const css: string = styles;

class LocalError extends Error {}

function throwLocal(): never {
  throw new LocalError("local");
}

/** Throws a class the module does not export, from a function it does not export. */
export function fail(): never {
  throwLocal();
}

export async function load(url: string): Promise<unknown> {
  if (import.meta.env.DEV) console.warn("dev only");
  return import(/* @vite-ignore */ url);
}
