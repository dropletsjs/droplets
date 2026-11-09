import { error, type RequestHandler } from "$droplets/server";
import { readImage } from "../../../lib/server/images.ts";

/**
 * `GET /api/images/:key`: a product image from the local image folders.
 * The key is a file name of a fixed shape (lib/server/images.ts), never a
 * path. Seeded keys are per product, uploaded ones the hash of their bytes:
 * a day of caching for the first, forever for the second.
 */
export const GET: RequestHandler<{ key: string }> = async ({ params }) => {
  const image = await readImage(params.key);
  if (!image) error(404, "No such image.");
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "content-type": image.type,
      "content-length": String(image.bytes.length),
      "cache-control": params.key.startsWith("u-") ? "public, max-age=31536000, immutable" : "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
};
