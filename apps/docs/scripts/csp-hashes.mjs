// Checks the CSP in apps/docs/public/_headers against the built site: every inline
// <script> in apps/docs/dist must have its sha256 in script-src. Prints the set the
// build needs and exits 1 when _headers is missing one (or lists a stale one).
//
// It also checks the one other origin the pages load from, the demo server
// of the live droplets (DEMO_PUBLIC_URL, default https://demo.dropletsjs.dev):
// it must be in script-src, style-src, connect-src and form-action; and
// Cloudflare Web Analytics' beacon, which must be in script-src alone. No
// directive may name any other host, scheme or wildcard (data: only where
// it is today, in img-src and font-src).
// Run after `pnpm docs:build`:  pnpm docs:check-csp
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const docs = fileURLToPath(new URL("..", import.meta.url));
const dist = join(docs, "dist");

// A real tag follows `>`; `<script` text inside code samples' data-code=""
// attributes does not, so it is skipped.
const inline = /(?<=>)<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/g;

// Only scripts the browser runs need a hash: no type, a JavaScript type or
// `module`. The payloads inside a live droplet's fragment
// (`<script type="application/text" data-droplet-payload="data">`) are data: CSP does
// not apply to them, and they change with every build of the demo.
const runs = (attributes) => {
  const type = /\stype=(["']?)([^"'\s>]*)\1/i.exec(attributes)?.[2]?.toLowerCase() ?? "";
  return type === "" || type === "module" || /^(text|application)\/(java|ecma)script$/.test(type);
};

const needed = new Set();
for (const entry of await readdir(dist, { recursive: true })) {
  if (!entry.endsWith(".html")) continue;
  const html = await readFile(join(dist, entry), "utf8");
  for (const [, attributes, body] of html.matchAll(inline)) {
    if (!body || !runs(attributes)) continue;
    needed.add(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  }
}

const headers = await readFile(join(docs, "public", "_headers"), "utf8");
const listed = new Set(headers.match(/'sha256-[A-Za-z0-9+/=]+'/g) ?? []);
const missing = [...needed].filter((h) => !listed.has(h));
const stale = [...listed].filter((h) => !needed.has(h));

console.log(`script-src hashes the build needs (${needed.size}):\n${[...needed].join(" ")}`);
if (missing.length) console.error(`\nMissing from _headers:\n${missing.join("\n")}`);
if (stale.length) console.error(`\nIn _headers but no longer in the build:\n${stale.join("\n")}`);

// The demo origin and the beacon, each in exactly the directives that need it.
const demo = new URL(process.env.DEMO_PUBLIC_URL || "https://demo.dropletsjs.dev").origin;
// The path ends in `/`: the beacon the zone injects is beacon.min.js/v<version>.
const BEACON = "https://static.cloudflareinsights.com/beacon.min.js/";
const SOURCES = new Map([
  [demo, ["script-src", "style-src", "connect-src", "form-action"]],
  [BEACON, ["script-src"]],
]);
const DATA_OK = ["img-src", "font-src"];
const csp = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1] ?? "";
const directives = new Map(
  csp
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .filter(([name]) => name)
    .map(([name, ...values]) => [name, values]),
);
const problems = [];
for (const [source, names] of SOURCES) {
  for (const name of names) {
    if (!directives.get(name)?.includes(source)) problems.push(`${name} does not allow ${source}`);
  }
}
for (const [name, values] of directives) {
  for (const value of values) {
    // Keywords and hashes are quoted; anything unquoted is a source.
    if (value.startsWith("'")) continue;
    if (SOURCES.get(value)?.includes(name)) continue;
    if (value === "data:" && DATA_OK.includes(name)) continue;
    if (name === "upgrade-insecure-requests") continue;
    problems.push(`${name} allows ${value}`);
  }
}
if (!csp) problems.push("no Content-Security-Policy in _headers");
console.log(`\nThe live droplets' origin: ${demo}`);
if (problems.length) console.error(`\nCSP sources out of place:\n${problems.join("\n")}`);
process.exit(missing.length || stale.length || problems.length ? 1 : 0);
