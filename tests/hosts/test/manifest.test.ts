/**
 * examples/hosts/hosts.json against what it describes: one entry per host
 * folder, each built host's compose port, docs page and spec where the
 * manifest says, and the READMEs' generated parts current (`readme.ts`).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALL_HOSTS, HOSTS, LANGUAGES, PATTERNS, RUN_HOSTS } from "@dropletsjs/shared/hosts";
import { describe, expect, it } from "vitest";
import { PARTS, withParts } from "../readme.ts";

const root = resolve(import.meta.dirname, "../../..");
const hosts = join(root, "examples", "hosts");

const folders = readdirSync(hosts, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe("examples/hosts/hosts.json", () => {
  it("has one built entry with an example for every folder, and a folder for each", () => {
    const withFolder = HOSTS.filter((host) => host.example)
      .map((host) => host.id)
      .sort();
    expect(withFolder).toEqual(folders);
  });

  it("reserves a planned host's id and port without a folder", () => {
    const planned = ALL_HOSTS.filter((host) => host.status === "planned").map((host) => host.id);
    expect(planned.filter((id) => folders.includes(id))).toEqual([]);
  });

  it("gives every host its own id and every runner its own port offset", () => {
    const ids = ALL_HOSTS.map((host) => host.id);
    expect(new Set(ids).size).toBe(ids.length);
    const offsets = ALL_HOSTS.flatMap((host) => (host.runner ? [host.runner.offset] : []));
    expect(new Set(offsets).size).toBe(offsets.length);
    expect(offsets.filter((offset) => !(Number.isInteger(offset) && offset > 0 && offset < 100))).toEqual([]);
  });

  it("names only languages and patterns it defines", () => {
    const languages = new Set(LANGUAGES.map((language) => language.id));
    expect(ALL_HOSTS.filter((host) => !languages.has(host.language) || !(host.pattern in PATTERNS)).map((host) => host.id)).toEqual([]);
  });

  it("publishes each built host on 8000 plus its offset by default", () => {
    const wrong = RUN_HOSTS.filter((host) => {
      const compose = readFileSync(join(hosts, host.id, "docker-compose.yml"), "utf8");
      return !compose.includes(`\${WEB_PORT:-${8000 + host.runner.offset}}`);
    }).map((host) => host.id);
    expect(wrong).toEqual([]);
  });

  it("has a docs page for each built host", () => {
    const docs = join(root, "apps", "docs", "src", "content", "docs");
    const missing = HOSTS.filter((host) => !existsSync(join(docs, `${host.docs}.mdx`)) && !existsSync(join(docs, `${host.docs}.md`))).map(
      (host) => host.docs,
    );
    expect(missing).toEqual([]);
  });

  it("names a spec that exists for each host that runs one", () => {
    const missing = RUN_HOSTS.filter((host) => host.runner.spec && !existsSync(join(import.meta.dirname, "..", host.runner.spec))).map(
      (host) => host.runner.spec,
    );
    expect(missing).toEqual([]);
  });

  it("is what the READMEs' generated parts say (pnpm --filter @dropletsjs/tests-hosts readme)", () => {
    for (const file of Object.keys(PARTS)) {
      const text = readFileSync(join(root, file), "utf8");
      expect(withParts({ file, text }), file).toBe(text);
    }
  });
});
