import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { acceptsGzip, GZIP_MIN_BYTES, gzipAnswer, withNoTransform } from "../../src/runtime/compress.ts";

const GZIP = new Request("http://drops.test/droplets/hello", { headers: { "accept-encoding": "gzip, deflate, br" } });

type AnswerInput = { body: BodyInit | null; status?: number; headers?: Record<string, string>; request?: Request };

function answer({ body, status = 200, headers = {}, request = GZIP }: AnswerInput): Promise<Response> {
  const response = new Response(body, { status, headers: { "content-type": "text/html", ...headers } });
  return gzipAnswer({ request, response, headers: new Headers(response.headers) });
}

describe("acceptsGzip", () => {
  it("takes gzip, x-gzip and the wildcard by their weight", () => {
    for (const header of ["gzip", "GZIP", "deflate, gzip;q=0.5", "x-gzip", "*", "br;q=1, *;q=0.1", "gzip;q=1.5", "gzip;q="]) {
      expect(acceptsGzip({ header }), header).toBe(true);
    }
  });

  it("refuses no header, another coding alone, and a weight of 0", () => {
    for (const header of [null, "", "identity", "br, deflate", "gzip;q=0", "gzip; q=0.000", "*;q=0", "gzip;q=0, *"]) {
      expect(acceptsGzip({ header }), String(header)).toBe(false);
    }
  });
});

describe("withNoTransform", () => {
  it("adds no-transform once, in any case, and stands alone without a value", () => {
    expect(withNoTransform({ cacheControl: "private, no-store" })).toBe("private, no-store, no-transform");
    expect(withNoTransform({ cacheControl: "public, No-Transform, max-age=60" })).toBe("public, No-Transform, max-age=60");
    expect(withNoTransform({ cacheControl: null })).toBe("no-transform");
    expect(withNoTransform({ cacheControl: " " })).toBe("no-transform");
  });
});

describe("gzipAnswer", () => {
  const big = `<p>${"droplet ".repeat(400)}</p>`;

  it("gzips a body over the threshold, without Content-Length, to the same bytes", async () => {
    const res = await answer({ body: big, headers: { "content-length": String(big.length) } });
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("content-length")).toBeNull();
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(big);
  });

  it("sends a body under the threshold plain, by Content-Length or by reading it", async () => {
    const small = "x".repeat(GZIP_MIN_BYTES - 1);
    for (const headers of [{ "content-length": String(small.length) }, {}] as Record<string, string>[]) {
      const res = await answer({ body: small, headers });
      expect(res.headers.get("content-encoding"), JSON.stringify(headers)).toBeNull();
      expect(await res.text()).toBe(small);
    }
  });

  it("sends it plain without gzip in Accept-Encoding, for HEAD, without a body or already encoded", async () => {
    const plain = new Request(GZIP.url);
    const refused = new Request(GZIP.url, { headers: { "accept-encoding": "gzip;q=0, br" } });
    const head = new Request(GZIP.url, { method: "HEAD", headers: { "accept-encoding": "gzip" } });
    for (const request of [plain, refused, head]) {
      expect((await answer({ body: big, request })).headers.get("content-encoding"), request.method).toBeNull();
    }
    expect((await answer({ body: null, status: 204 })).headers.get("content-encoding")).toBeNull();
    const encoded = await answer({ body: big, headers: { "content-encoding": "br" } });
    expect(encoded.headers.get("content-encoding")).toBe("br");
    expect(await encoded.text()).toBe(big);
  });

  it("keeps a streamed body streaming: answered before it ends, whole once it does", async () => {
    const encoder = new TextEncoder();
    let finish = (): void => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("<p>"));
        controller.enqueue(encoder.encode("a".repeat(GZIP_MIN_BYTES)));
        finish = () => {
          controller.enqueue(encoder.encode("</p>"));
          controller.close();
        };
      },
    });
    const res = await answer({ body });
    expect(res.headers.get("content-encoding")).toBe("gzip");
    finish();
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(`<p>${"a".repeat(GZIP_MIN_BYTES)}</p>`);
  });
});
