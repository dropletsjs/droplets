import type { LoadEvent } from "$droplets/server";

// No error page: a failing load renders nothing. `ok` is a promise: the
// server settles it before it renders and inlines the data.
export const load = ({ props }: LoadEvent) => {
  if (props["crash"] !== undefined) throw new Error("bare crashed");
  if (props["late"] !== undefined) return { ok: Promise.reject(new Error("bare failed late")) };
  return { ok: Promise.resolve(true) };
};
