// `pnpm dev` and the docs' local runs: makes sure .env.local (gitignored)
// holds a DROPLETS_SECRET, generating a random one the first time. The
// deployed Worker reads its own from a Worker secret; nothing is committed.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../.env.local", import.meta.url));
const current = existsSync(file) ? readFileSync(file, "utf8") : "";
if (!/^DROPLETS_SECRET=.{32,}$/m.test(current)) {
  const line = `DROPLETS_SECRET=${randomBytes(32).toString("base64url")}\n`;
  writeFileSync(file, current && !current.endsWith("\n") ? `${current}\n${line}` : `${current}${line}`, { mode: 0o600 });
  console.log("apps/demo: wrote a development DROPLETS_SECRET to .env.local");
}
