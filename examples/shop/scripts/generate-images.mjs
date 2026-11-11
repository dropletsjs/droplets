// Writes images/<slug>.webp for every product in data/products.json, with
// a ComfyUI server (Z-Image Turbo, 8 steps, cfg 1, 1024²), then cwebp to
// ~800 px.
//
//   node scripts/generate-images.mjs          (skips images that exist)
//   COMFY_URL=http://localhost:8188 node scripts/generate-images.mjs
//
// COMFY_URL is the ComfyUI server (default http://localhost:8188). The model
// files are the ones in ComfyUI's models folders; COMFY_UNET, COMFY_CLIP and
// COMFY_VAE override their names.
//
// A development tool, run once: the images are committed and served by
// /api/images/:key. Needs `cwebp` on the PATH.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

// The repository's .env.local, when there is one; variables already set win.
const envLocal = new URL("../../../.env.local", import.meta.url);
if (existsSync(envLocal)) process.loadEnvFile(envLocal);

const COMFY_URL = (process.env.COMFY_URL || "http://localhost:8188").replace(/\/+$/, "");
const UNET = process.env.COMFY_UNET || "zImageTurbo_turbo.safetensors";
const CLIP = process.env.COMFY_CLIP || "qwen_3_4b.safetensors";
const VAE = process.env.COMFY_VAE || "ae.safetensors";
const root = new URL("../", import.meta.url);
const images = new URL("images/", root);
const { products } = JSON.parse(await readFile(new URL("data/products.json", root), "utf8"));

const graph = (prompt, seed) => ({
  unet: { class_type: "UNETLoader", inputs: { unet_name: UNET, weight_dtype: "default" } },
  sampling: { class_type: "ModelSamplingAuraFlow", inputs: { model: ["unet", 0], shift: 3 } },
  clip: { class_type: "CLIPLoader", inputs: { clip_name: CLIP, type: "lumina2" } },
  vae: { class_type: "VAELoader", inputs: { vae_name: VAE } },
  positive: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: prompt } },
  negative: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["positive", 0] } },
  latent: { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
  sampler: {
    class_type: "KSampler",
    inputs: {
      model: ["sampling", 0],
      positive: ["positive", 0],
      negative: ["negative", 0],
      latent_image: ["latent", 0],
      seed,
      steps: 8,
      cfg: 1,
      sampler_name: "res_multistep",
      scheduler: "simple",
      denoise: 1,
    },
  },
  decode: { class_type: "VAEDecode", inputs: { samples: ["sampler", 0], vae: ["vae", 0] } },
  save: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: "droplets-shop" } },
});

async function render(prompt, seed) {
  const queued = await fetch(`${COMFY_URL}/api/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph(prompt, seed), client_id: "droplets-shop" }),
  });
  if (!queued.ok) throw new Error(`queue ${queued.status}: ${await queued.text()}`);
  const { prompt_id: id } = await queued.json();
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const history = await (await fetch(`${COMFY_URL}/api/history/${id}`)).json();
    const entry = history[id];
    if (!entry) continue;
    if (entry.status?.status_str === "error") throw new Error(JSON.stringify(entry.status.messages).slice(0, 500));
    const image = entry.outputs?.save?.images?.[0];
    if (!image) continue;
    const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type });
    return Buffer.from(await (await fetch(`${COMFY_URL}/api/view?${query}`)).arrayBuffer());
  }
  throw new Error("timed out");
}

await mkdir(images, { recursive: true });
const started = Date.now();
for (const [i, product] of products.entries()) {
  const target = new URL(`${product.slug}.webp`, images);
  if (existsSync(target)) continue;
  const prompt = `Professional e-commerce product photo: ${product.imagePrompt} Centered, the whole object in frame, on a clean bright white background with a soft shadow, soft studio light, high detail.`;
  const t = Date.now();
  const png = await render(prompt, 1000 + i);
  const tmp = new URL(`${product.slug}.png`, images);
  await writeFile(tmp, png);
  execFileSync("cwebp", ["-quiet", "-resize", "800", "0", "-q", "74", "-m", "6", tmp.pathname, "-o", target.pathname]);
  await rm(tmp);
  console.log(`${product.slug}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s`);
