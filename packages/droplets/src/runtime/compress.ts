/**
 * Fragments and `_data` carry `Cache-Control: no-transform`, so no proxy
 * rewrites them (an HTML rewriter appends its script after the droplet
 * element: a fragment has no `</body>`). A proxy that honours it no longer
 * compresses them either, so the server does, with gzip.
 */

/** Below this many bytes gzip's header and trailer outweigh what it saves. */
export const GZIP_MIN_BYTES = 1024;

export type AcceptsGzipInput = { header: string | null };

/**
 * Whether `Accept-Encoding` takes gzip: `gzip` (or `x-gzip`) with a weight
 * above 0, or, when neither is named, `*` with one.
 */
export function acceptsGzip({ header }: AcceptsGzipInput): boolean {
  if (!header) return false;
  let gzip: number | undefined;
  let any: number | undefined;
  for (const part of header.split(",")) {
    const [coding = "", ...params] = part.split(";");
    const name = coding.trim().toLowerCase();
    let q = 1;
    for (const param of params) {
      const [key = "", value = ""] = param.split("=");
      if (key.trim().toLowerCase() !== "q") continue;
      const weight = Number(value.trim());
      if (value.trim() !== "" && Number.isFinite(weight) && weight >= 0 && weight <= 1) q = weight;
    }
    if (name === "gzip" || name === "x-gzip") gzip = Math.max(gzip ?? 0, q);
    else if (name === "*") any = q;
  }
  return gzip !== undefined ? gzip > 0 : any !== undefined && any > 0;
}

export type WithNoTransformInput = { cacheControl: string | null };

/** `cacheControl` with `no-transform` added once (any case); `no-transform` alone when there is none. */
export function withNoTransform({ cacheControl }: WithNoTransformInput): string {
  if (!cacheControl?.trim()) return "no-transform";
  const present = cacheControl.split(",").some((directive) => directive.split("=")[0]?.trim().toLowerCase() === "no-transform");
  return present ? cacheControl : `${cacheControl}, no-transform`;
}

/** Statuses that never carry a body. */
const BODYLESS = new Set([204, 205, 304]);

type PeekInput = { body: ReadableStream<Uint8Array<ArrayBuffer>>; bytes: number };

type Peeked = { whole: Uint8Array<ArrayBuffer> } | { stream: ReadableStream<Uint8Array<ArrayBuffer>> };

/**
 * The body read until `bytes` or its end: `whole` when it ended first,
 * else a `stream` that replays what was read and goes on with the rest,
 * so a streamed answer keeps streaming.
 */
async function peek({ body, bytes }: PeekInput): Promise<Peeked> {
  const reader = body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  while (size < bytes) {
    const { done, value } = await reader.read();
    if (done) {
      const whole = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        whole.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { whole };
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { stream };
}

export type GzipAnswerInput = { request: Request; response: Response; headers: Headers };

/**
 * `response` with `headers`, its body gzipped when the request takes gzip
 * and the answer is worth it: never for HEAD, a status without a body or
 * a body that is encoded already; not under `GZIP_MIN_BYTES`, by its
 * `Content-Length` or, without one, by reading that much of it first.
 */
export async function gzipAnswer({ request, response, headers }: GzipAnswerInput): Promise<Response> {
  const init = { status: response.status, statusText: response.statusText, headers };
  const body = response.body;
  if (
    body === null ||
    request.method === "HEAD" ||
    BODYLESS.has(response.status) ||
    headers.has("content-encoding") ||
    !acceptsGzip({ header: request.headers.get("accept-encoding") })
  ) {
    return new Response(body, init);
  }
  const length = Number(headers.get("content-length") ?? Number.NaN);
  let plain: ReadableStream<Uint8Array<ArrayBuffer>> = body;
  if (Number.isSafeInteger(length) && length >= 0) {
    if (length < GZIP_MIN_BYTES) return new Response(body, init);
  } else {
    const peeked = await peek({ body, bytes: GZIP_MIN_BYTES });
    if ("whole" in peeked) return new Response(peeked.whole, init);
    plain = peeked.stream;
  }
  headers.set("content-encoding", "gzip");
  headers.delete("content-length");
  // Workers compress a body by its `Content-Encoding` unless told it is
  // encoded already, which would gzip it twice; other runtimes ignore it.
  const encoded: ResponseInit & { encodeBody: "manual" } = { ...init, encodeBody: "manual" };
  return new Response(plain.pipeThrough(new CompressionStream("gzip")), encoded);
}
