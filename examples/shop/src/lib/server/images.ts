import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Product images from local directories (no object store for now):
 * `SHOP_IMAGES` (default `images/`, the seeded ones, committed) and
 * `SHOP_UPLOADS` (default `.uploads/`, what the admin uploads). A key is a
 * file name of a fixed shape, never a path: `/api/images/<key>` cannot
 * reach anything else.
 */
const SEEDED = /^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/;
const UPLOADED = /^u-[0-9a-f]{32}\.(?:webp|png|jpg)$/;

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const TYPES = { webp: "image/webp", png: "image/png", jpg: "image/jpeg" } as const;
type Ext = keyof typeof TYPES;

const seededDir = () => resolve(process.env["SHOP_IMAGES"] ?? "images");
const uploadsDir = () => resolve(process.env["SHOP_UPLOADS"] ?? ".uploads");

export const isImageKey = (key: string) => SEEDED.test(key) || UPLOADED.test(key);

export async function readImage(key: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (key.length > 100 || !isImageKey(key)) return null;
  const dir = UPLOADED.test(key) ? uploadsDir() : seededDir();
  const ext = key.slice(key.lastIndexOf(".") + 1) as Ext;
  try {
    return { bytes: await readFile(join(dir, key)), type: TYPES[ext] };
  } catch {
    return null;
  }
}

/** The format the bytes say they are, whatever the upload claimed. */
export function sniffImage(bytes: Uint8Array): Ext | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (bytes.length > 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

export type UploadResult = { key: string } | { error: "type" | "size" };

/** Stores an uploaded image under the hash of its bytes; the key names it. */
export async function saveUpload(file: File): Promise<UploadResult> {
  if (file.size > MAX_UPLOAD_BYTES) return { error: "size" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImage(bytes);
  if (!ext) return { error: "type" };
  const key = `u-${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${ext}`;
  await mkdir(uploadsDir(), { recursive: true });
  await writeFile(join(uploadsDir(), key), bytes);
  return { key };
}
