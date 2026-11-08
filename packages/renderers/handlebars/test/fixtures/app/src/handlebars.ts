/** Helpers, registered on the server and in the browser under their export names. */
export const upper = (value: unknown) => String(value).toUpperCase();

export function repeat(value: unknown, times: unknown) {
  return String(value).repeat(Number(times));
}
