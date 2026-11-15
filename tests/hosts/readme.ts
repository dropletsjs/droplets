/**
 * The parts of the READMEs that list the host examples, written from
 * examples/hosts/hosts.json, so a count or a table is never edited by hand:
 *
 *   pnpm --filter @dropletsjs/tests-hosts readme           # rewrite them
 *   pnpm --filter @dropletsjs/tests-hosts readme --check   # exit 1 if one is stale
 *
 * Each part sits between `<!-- hosts:<name> -->` and `<!-- /hosts:<name> -->`
 * in its file; `test/manifest.test.ts` fails when one is stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  capitalize,
  EXAMPLES,
  type Host,
  HOSTS,
  hostsByLanguage,
  inWords,
  languageOf,
  RUN_HOSTS,
  SHOP_FLOW_HOSTS,
} from "@dropletsjs/shared/hosts";

const ROOT = join(import.meta.dirname, "..", "..");
const SITE = "https://dropletsjs.dev";

/** The hosts that run a flow of their own, by name: "WordPress, htmx and Static HTML". */
function listed(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const OWN_FLOWS = listed(RUN_HOSTS.filter((host) => host.runner.flow === "own").map((host) => host.name));

const COUNT = `${capitalize(inWords(EXAMPLES.length))} host examples, by language; ${inWords(SHOP_FLOW_HOSTS.length)} run the shared shop flow, and ${OWN_FLOWS} have flows of their own.`;

/** The hosts with a docs page and no example, a sentence each. */
const GUIDES = HOSTS.filter((host) => !host.example).map(
  (host) => `[${host.name}](${SITE}/${host.docs}/) is a guide, with no example: ${host.stack}.`,
);

/** The examples in `examples/hosts/README.md`, by language, folders relative to it. */
function examplesTable(): string {
  const rows = hostsByLanguage(EXAMPLES).flatMap(({ language, hosts }) =>
    hosts.map((host) => `| ${language.label} | [\`${host.id}\`](./${host.id}) | ${host.stack} | ${host.how} |`),
  );
  return ["| Language | Folder | Stack | Pattern |", "| -------- | ------ | ----- | ------- |", ...rows].join("\n");
}

function shopAt(): string {
  const rows = RUN_HOSTS.map(
    (host) => `| \`${host.id}\` | http://localhost:${8000 + host.runner.offset}${host.runner.page ?? "/gallery"} |`,
  );
  return ["| Folder | Opens at |", "| ------ | -------- |", ...rows].join("\n");
}

/** The screenshot the recordings table shows: the cart for the shop flow, a flow's last one otherwise. */
function shotOf(host: (typeof RUN_HOSTS)[number]): string {
  return host.runner.shots?.at(-1) ?? "2-cart";
}

function recordings(): string {
  const rows = RUN_HOSTS.map(
    (host) =>
      `| \`${host.id}\` | [${host.id}.mp4](../../apps/docs/public/hosts/${host.id}.mp4) | ![The shop on ${host.name}](../../apps/docs/public/hosts/${host.id}/${shotOf(host)}.webp) |`,
  );
  return ["| Host | Video | A screenshot from its flow |", "| ---- | ----- | -------------------------- |", ...rows].join("\n");
}

function docsUrl(host: Host): string {
  return `${SITE}/${host.docs}/`;
}

/** The root README's line per language, each name linking to its docs page. */
function wall(): string {
  return hostsByLanguage()
    .map(({ language, hosts }) => `- **${language.label}**: ${hosts.map((host) => `[${host.name}](${docsUrl(host)})`).join(", ")}`)
    .join("\n");
}

function rootTable(): string {
  const rows = EXAMPLES.map((host) => `| [${host.id}](./examples/hosts/${host.id}) | ${languageOf(host)} | ${host.stack} | ${host.how} |`);
  return ["| Host | Language | Stack | Pattern |", "| ---- | -------- | ----- | ------- |", ...rows].join("\n");
}

function examplesReadmeTable(): string {
  const rows = EXAMPLES.map((host) => `| [\`${host.id}\`](./hosts/${host.id}) | ${languageOf(host)} | ${host.how} |`);
  return ["| Host | Language | Pattern |", "| ---- | -------- | ------- |", ...rows].join("\n");
}

/** File → part name → its text. */
export const PARTS: Record<string, Record<string, string>> = {
  "examples/hosts/README.md": {
    count: COUNT,
    examples: examplesTable(),
    "shop-at": shopAt(),
    recordings: recordings(),
  },
  "examples/README.md": {
    table: examplesReadmeTable(),
  },
  "README.md": {
    wall: wall(),
    count: [COUNT, ...GUIDES].join(" "),
    table: rootTable(),
  },
};

/** `text` with every part in it replaced by its current version; throws on a part the file lacks. */
export function withParts({ file, text }: { file: string; text: string }): string {
  let result = text;
  for (const [name, part] of Object.entries(PARTS[file] ?? {})) {
    const pattern = new RegExp(`(<!-- hosts:${name} -->\\n)[\\s\\S]*?(\\n<!-- /hosts:${name} -->)`);
    if (!pattern.test(result)) throw new Error(`${file}: no <!-- hosts:${name} --> … <!-- /hosts:${name} --> block`);
    result = result.replace(pattern, (_, start: string, end: string) => `${start}${part}${end}`);
  }
  return result;
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const stale: string[] = [];
  for (const file of Object.keys(PARTS)) {
    const path = join(ROOT, file);
    const text = readFileSync(path, "utf8");
    const next = withParts({ file, text });
    if (next === text) continue;
    stale.push(file);
    if (!check) writeFileSync(path, next);
  }
  if (check && stale.length) {
    console.error(`stale: ${stale.join(", ")}; run pnpm --filter @dropletsjs/tests-hosts readme`);
    process.exit(1);
  }
  console.log(stale.length ? `${check ? "stale" : "written"}: ${stale.join(", ")}` : "up to date");
}
