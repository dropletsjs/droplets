// The error code pages, src/content/docs/errors/<code>.md and the index
// errors/index.md, written from the registry of @dropletsjs/droplets before
// astro runs (`pnpm docs:dev`, `pnpm docs:build`). They are generated, never
// committed: the registry is the one source.
//
//   node scripts/errors.mjs
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as registry from "@dropletsjs/droplets/errors";

const OUT = fileURLToPath(new URL("../src/content/docs/errors/", import.meta.url));

/** Every entry of the registry, by code. */
export function errorEntries() {
  return Object.values(registry)
    .filter(
      (value) =>
        value && typeof value === "object" && typeof value.code === "string" && (value.level === "error" || value.level === "warning"),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** What each code's page adds to its entry: `when` and `see`. */
export function errorPageNotes() {
  return Object.assign(
    {},
    ...Object.entries(registry)
      .filter(([name]) => name.endsWith("_PAGES"))
      .map(([, pages]) => pages),
  );
}

// Every parameter reads as `{name}`.
const placeholders = new Proxy({}, { get: (_, name) => `{${String(name)}}` });
const textOf = (text) => (typeof text === "function" ? text(placeholders) : text);

/** `<` and `>` outside code spans would be read as HTML. */
const escapeHtml = (text) =>
  text
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 ? part : part.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")))
    .join("");

const yamlString = (text) => JSON.stringify(text);

function page({ entry, notes }) {
  const what = textOf(entry.what);
  const fix = textOf(entry.fix);
  const example = registry.formatAgent({ code: entry.code, level: entry.level, what, fix });
  return [
    "---",
    `title: ${yamlString(entry.code)}`,
    `description: ${yamlString(`A droplets ${entry.level}: ${what}`)}`,
    "---",
    "",
    `**Level:** ${entry.level}. Parameters in braces, such as \`{droplet}\`, stand for the values of the message at hand.`,
    "",
    "## What happened",
    "",
    escapeHtml(what),
    "",
    "## When it happens",
    "",
    escapeHtml(notes.when),
    "",
    "## Fix",
    "",
    escapeHtml(fix),
    "",
    "## The message",
    "",
    'With `errorFormat: "agent"` (the default); the droplet and the file come when they are known:',
    "",
    "```txt",
    example,
    "```",
    "",
    ...(notes.see ? ["## See also", "", `[${notes.see.replace(/^\//, "").replace(/\/(#.*)?$/, "")}](${notes.see})`, ""] : []),
  ].join("\n");
}

function index({ entries }) {
  const rows = entries.map(
    (entry) =>
      `| [\`${entry.code}\`](/errors/${entry.code}/) | ${entry.level} | ${escapeHtml(textOf(entry.what)).replaceAll("|", "\\|").replaceAll("\n", " ")} |`,
  );
  return [
    "---",
    'title: "Error codes"',
    `description: ${yamlString(`Every error and warning Droplets writes, ${entries.length} codes, each with what happened, when, and the fix.`)}`,
    "---",
    "",
    "Every message Droplets writes, an error it throws or a warning it logs, in",
    "`vite build`, `vite dev`, the browser or the production server, carries one",
    "of these codes and links its page. [`errorFormat`](/guides/configuration/#error-format)",
    "picks how the message reads. A thrown error has the code as `error.code`.",
    "",
    "| Code | Level | What happened |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

/** Every page, by file name under errors/. Throws for a code without its notes. */
export function errorPages() {
  const entries = errorEntries();
  const notes = errorPageNotes();
  const pages = new Map([["index.md", index({ entries })]]);
  for (const entry of entries) {
    const note = notes[entry.code];
    if (!note) throw new Error(`errors: ${entry.code} has no page notes (when) in its registry file`);
    pages.set(`${entry.code}.md`, page({ entry, notes: note }));
  }
  return pages;
}

/** The slugs, index first, for the sidebar. */
export function errorSlugs() {
  return ["errors", ...errorEntries().map((entry) => `errors/${entry.code}`)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pages = errorPages();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await Promise.all([...pages].map(([file, text]) => writeFile(`${OUT}${file}`, text)));
  console.log(`[errors] ${pages.size - 1} error code pages written to src/content/docs/errors/`);
}
