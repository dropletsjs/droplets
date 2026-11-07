/**
 * UTF-8 safe base64, on web APIs only, so the same code runs in browsers,
 * Node, Workers, Deno and Bun.
 */

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  // Chunked: spreading a large array into fromCharCode overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function decodeBase64(encoded: string): string {
  const binary = atob(encoded.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** Decodes a base64 JSON payload, such as the ones inlined into fragments. */
export function decodeBase64Json<T>(encoded: string): T {
  return JSON.parse(decodeBase64(encoded)) as T;
}
