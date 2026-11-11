// Writes the text in data/products.json and data/comments.json with a local LLM.
//
//   LLM_URL=http://localhost:8000 LLM_MODEL=<model> node scripts/generate-data.mjs
//
// A development tool, run once: the JSON it writes is committed, and
// `pnpm seed` reads that, never the LLM. It talks to a local OpenAI-compatible
// server (json_schema answers, ~10 items per request). LLM_URL is the server's
// base URL (without /v1) and LLM_MODEL the model it serves; both are required.
//
// The catalogue itself (slugs, names, categories, prices, images) is kept as
// it is in data/products.json; only the words change. A description is two or
// three paragraphs separated by a blank line; details are short facts joined
// by " · ". Each comment carries `daysAgo`, so the seed spreads them over
// months, oldest first.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

// The repository's .env.local, when there is one; variables already set win.
const envLocal = new URL("../../../.env.local", import.meta.url);
if (existsSync(envLocal)) process.loadEnvFile(envLocal);

const LLM_URL = process.env.LLM_URL?.replace(/\/+$/, "");
const MODEL = process.env.LLM_MODEL;
if (!LLM_URL || !MODEL) {
  console.error(
    "generate-data needs a local OpenAI-compatible server. Set both:\n" +
      "  LLM_URL    the server's base URL, without /v1 (e.g. http://localhost:8000)\n" +
      "  LLM_MODEL  the model it serves",
  );
  process.exit(1);
}
const out = new URL("../data/", import.meta.url);

async function ask(prompt, schema) {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    const response = await fetch(`${LLM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You write copy for a small, cheerful online design shop. Plain, friendly English for shoppers. No emoji, no superlatives, no marketing clichés.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.8,
        chat_template_kwargs: { enable_thinking: false },
        response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema } },
      }),
    });
    if ((response.status === 503 || response.status === 429) && attempt < 5) {
      console.log(`  server busy (${response.status}), retrying`);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (!response.ok) throw new Error(`LLM ${response.status}: ${await response.text()}`);
    const body = await response.json();
    console.log(`  ${((Date.now() - started) / 1000).toFixed(1)} s, ${body.usage?.completion_tokens} tokens`);
    return JSON.parse(body.choices[0].message.content);
  }
}

/** A small seeded PRNG, so a rerun picks the same authors, tones and dates. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const textSchema = (slugs) => ({
  type: "object",
  additionalProperties: false,
  required: ["products"],
  properties: {
    products: {
      type: "array",
      minItems: slugs.length,
      maxItems: slugs.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slug", "paragraphs", "details"],
        properties: {
          slug: { type: "string", enum: slugs },
          paragraphs: { type: "array", minItems: 2, maxItems: 3, items: { type: "string", minLength: 80, maxLength: 300 } },
          details: { type: "array", minItems: 4, maxItems: 5, items: { type: "string", minLength: 3, maxLength: 34 } },
        },
      },
    },
  },
});

const commentSchema = (count) => ({
  type: "object",
  additionalProperties: false,
  required: ["comments"],
  properties: {
    comments: {
      type: "array",
      minItems: count,
      maxItems: count,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["body"],
        properties: { body: { type: "string", minLength: 30, maxLength: 320 } },
      },
    },
  },
});

/** Comments per product: five popular ones with 30 to 50, the rest under 15, several under 10. */
const COMMENT_COUNTS = {
  "clay-cylinder-mug": 43,
  "speckled-temple-cup": 6,
  "double-wall-tumbler": 2,
  "matte-black-travel-cup": 14,
  "ocean-wave-mug": 34,
  "linen-notebook": 5,
  "brass-pen-holder": 31,
  "minimalist-desk-lamp": 3,
  "bamboo-organizer": 8,
  "concrete-tray": 1,
  "canvas-urban-tote": 38,
  "navy-nylon-backpack": 9,
  "olive-leather-pouch": 0,
  "denim-bifold-wallet": 7,
  "linen-market-bag": 12,
  "soy-vanilla-candle": 50,
  "ceramic-blue-vase": 4,
  "linen-square-cushion": 2,
  "terracotta-plant-pot": 6,
  "wax-dipped-tealight": 3,
};

const AUTHORS = [
  "Elena",
  "Kai",
  "Sofia M.",
  "Raj",
  "Mina",
  "Liam",
  "Anika",
  "Luca",
  "Chloe",
  "Mateo",
  "Yuki",
  "Amara",
  "Jonas",
  "Priya",
  "Oskar",
  "Fatima",
  "Noah B.",
  "Ines",
  "Tomasz",
  "Leila",
  "Hugo",
  "Sana",
  "Ewan",
  "Marta",
  "Kofi",
  "Ingrid",
  "Diego",
  "Aiko",
  "Bram",
  "Zara",
  "Felix",
  "Nadia",
  "Theo",
  "Camille",
  "Arjun",
  "Greta",
  "Rafael",
  "Hana",
  "Malik",
  "Freya",
  "Sven",
  "Lucia",
  "Omar",
  "Bea",
  "Dmitri",
  "Ava",
  "Kenji",
  "Rosa",
  "Emil",
  "Tara",
  "mugcollector",
  "Jo from Leeds",
  "plantmum_k",
  "deskgeek",
  "Annie R.",
  "Paolo",
  "Siobhan",
  "Viktor",
  "Lena",
  "Mohammed",
  "Clara",
  "Pieter",
  "Ngozi",
  "Ruth",
  "Andrei",
  "Mei",
  "Gabriel",
  "Astrid",
  "Tomás",
  "Ola",
  "Yara",
  "Niko",
  "Helen W.",
  "Ben",
  "Isla",
  "Farid",
  "Julia",
  "Sam K.",
  "Ewa",
  "Ali",
  "cozy_corner",
  "Daniel",
  "Maya",
];

/** Praise most of the time, some mixed, a little mild critique. */
const TONES = [
  ["praise", 0.58, "happy: what they like, in concrete terms"],
  ["mixed", 0.26, "mixed: likes it overall, with one small reservation"],
  ["critique", 0.16, "mildly critical: a fair, polite complaint (size, colour, shipping, a small flaw), never angry"],
];
const toneOf = (r) => {
  let x = r();
  for (const [name, p, hint] of TONES) if ((x -= p) < 0) return { name, hint };
  return { name: TONES[0][0], hint: TONES[0][2] };
};

/** The product's age in days at seed time, as scripts/seed.ts sets it (before lifting it for comments). */
const ageOf = (i) => (i % 5 === 2 ? 3 + i / 5 : 20 + i * 6);

const started = Date.now();
const data = JSON.parse(await readFile(new URL("products.json", out), "utf8"));
const products = data.products;

// 1. Descriptions and details, ten products per request.
const textTimes = [];
for (let from = 0; from < products.length; from += 10) {
  const batch = products.slice(from, from + 10);
  console.log(`descriptions: ${from + 1}-${from + batch.length}`);
  const t = Date.now();
  const { products: written } = await ask(
    `Rewrite the shop text for these ${batch.length} products. Keep each product as it is (same object, same price), only write better words.

${batch.map((p) => `- slug "${p.slug}": ${p.name}, category ${p.category}, €${(p.priceCents / 100).toFixed(2)}. Current text: ${p.description} Facts: ${p.details}`).join("\n")}

For each product, in the same order:
- paragraphs: 2 or 3 short paragraphs (each 2 or 3 sentences, 100 to 280 characters). The first says what it is and how it looks and feels; the second how it is used day to day; an optional third how it is made, or a gift idea. Consumer-friendly, concrete, no exclamation marks, no repeated openings across products.
- details: 4 or 5 very short facts (each under 34 characters), such as material, size or capacity, weight, care, origin. Keep the facts already given (capacity, size, material) consistent; use metric units with the imperial one in brackets where it helps, like "350 ml (12 oz)".`,
    textSchema(batch.map((p) => p.slug)),
  );
  textTimes.push((Date.now() - t) / 1000);
  for (const w of written) {
    const product = products.find((p) => p.slug === w.slug);
    if (!product) throw new Error(`unknown slug ${w.slug}`);
    product.description = w.paragraphs.map((s) => s.trim()).join("\n\n");
    product.details = w.details.map((s) => s.trim().replaceAll("·", "-")).join(" · ");
    if (product.description.length > 1000 || product.details.length > 200) throw new Error(`${w.slug}: text too long`);
  }
  const missing = batch.filter((p) => !written.some((w) => w.slug === p.slug));
  if (missing.length) throw new Error(`no text for ${missing.map((p) => p.slug).join(", ")}`);
}

// 2. Comments: authors, tones and dates are picked here; the LLM writes the bodies, ten per request.
const comments = [];
const commentTimes = [];
for (const [i, product] of products.entries()) {
  const count = COMMENT_COUNTS[product.slug] ?? 0;
  if (!count) continue;
  const r = random(i * 7919 + 17);
  const pool = [...AUTHORS].sort(() => r() - 0.5);
  // New products: comments in their first days. Older ones: up to seven months, more in recent weeks.
  const span = i % 5 === 2 ? ageOf(i) - 0.5 : Math.min(210, Math.max(ageOf(i), 40 + count * 3.5));
  const days = Array.from({ length: count }, () => 0.2 + span * r() ** 1.3).sort((a, b) => b - a);
  const plan = days.map((daysAgo, k) => ({ author: pool[k % pool.length], tone: toneOf(r), daysAgo: Math.round(daysAgo * 1000) / 1000 }));
  const written = [];
  for (let done = 0; done < count; done += 10) {
    const chunk = plan.slice(done, done + 10);
    console.log(`comments: ${product.slug} ${done + chunk.length}/${count}`);
    const t = Date.now();
    const { comments: batch } = await ask(
      `Write ${chunk.length} customer comments for the product page of "${product.name}" (€${(product.priceCents / 100).toFixed(2)}).
Product text: ${product.description.replaceAll("\n\n", " ")}
Facts: ${product.details}

One comment per line below, in this order; each is written by that customer, in the given tone:
${chunk.map((c, k) => `${k + 1}. ${c.author}, ${Math.round(c.daysAgo)} days ago: ${c.tone.hint}`).join("\n")}
${
  written.length
    ? `\nEarlier comments already say these things, so bring up other details (use, gifts, packaging, how it ages, colour in real light, size against expectations):\n${written
        .slice(-12)
        .map((b) => `- ${b.slice(0, 90)}`)
        .join("\n")}\n`
    : ""
}
Each body is 1 to 3 sentences, 40 to 280 characters, sounds like a real customer, mentions something specific to this product. Vary length and openings; do not start with the author's name; no emoji, no exclamation marks in more than one comment, no star ratings.`,
      commentSchema(chunk.length),
    );
    commentTimes.push((Date.now() - t) / 1000);
    batch.forEach((c, k) => {
      written.push(c.body.trim());
      comments.push({ product: product.slug, author: chunk[k].author, body: c.body.trim(), daysAgo: chunk[k].daysAgo });
    });
  }
}

await writeFile(new URL("products.json", out), `${JSON.stringify(data, null, 2)}\n`);
await writeFile(new URL("comments.json", out), `${JSON.stringify(comments, null, 2)}\n`);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
console.log(
  `text: ${textTimes.length} requests, ${sum(textTimes).toFixed(0)} s; comments: ${commentTimes.length} requests, ${sum(commentTimes).toFixed(0)} s`,
);
console.log(`${products.length} products, ${comments.length} comments in ${((Date.now() - started) / 1000).toFixed(0)} s`);
