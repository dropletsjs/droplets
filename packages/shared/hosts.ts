/**
 * The host examples (`examples/hosts/hosts.json`), as the runner, the docs
 * and the READMEs read them. A host's id is its folder, its runner key,
 * its compose project (`droplets-<id>`) and its recordings' name.
 */
import manifest from "../../examples/hosts/hosts.json" with { type: "json" };

export type Pattern = "server-include" | "proxy" | "browser" | "cms";

export type Language = { id: string; label: string };

export type HostRunner = {
  /** The host's port is 8000 plus this, or `HOSTS_PORT_BASE` plus this. */
  offset: number;
  /** `"shop"`: the shared `e2e/shop.spec.ts`; `"own"`: a flow of its own. */
  flow: "shop" | "own";
  /** The one spec the runner runs; without it, every spec (each skips the hosts it is not for). */
  spec?: string;
  /** Left out of a run that names no host. */
  byName?: boolean;
  /** The page the runner waits for, `/gallery` by default. */
  page?: string;
  /** The flow's screenshots, when not the shop flow's. */
  shots?: string[];
  /** Which droplets server the browser reaches itself, on `DROPLETS_URL`. */
  direct?: "svelte" | "shop";
};

export type Host = {
  id: string;
  name: string;
  language: string;
  pattern: Pattern;
  /** A planned host is reserved here and shown nowhere. */
  status: "built" | "planned";
  /** The docs page's slug, without slashes around it. */
  docs: string;
  stack: string;
  /** How it embeds, one line of Markdown. */
  how: string;
  /** Whether `examples/hosts/<id>` exists; a docs-only host has none. */
  example: boolean;
  /** How `pnpm test:hosts` runs it; `null` when it does not. */
  runner: HostRunner | null;
};

type Manifest = { languages: Language[]; patterns: Record<Pattern, string>; hosts: Host[] };

const data = manifest as Manifest;

export const LANGUAGES: readonly Language[] = data.languages;
export const PATTERNS: Readonly<Record<Pattern, string>> = data.patterns;

/** Every host, planned ones included, in the manifest's order. */
export const ALL_HOSTS: readonly Host[] = data.hosts;

/** The hosts that exist: the ones every list, count and table shows. */
export const HOSTS: readonly Host[] = data.hosts.filter((host) => host.status === "built");

/** The hosts with a folder in `examples/hosts/`. */
export const EXAMPLES: readonly Host[] = HOSTS.filter((host) => host.example);

/** The hosts `pnpm test:hosts` runs. */
export const RUN_HOSTS: readonly (Host & { runner: HostRunner })[] = HOSTS.filter(
  (host): host is Host & { runner: HostRunner } => host.runner !== null,
);

/** The hosts that run the shared shop flow (`e2e/shop.spec.ts`). */
export const SHOP_FLOW_HOSTS: readonly Host[] = RUN_HOSTS.filter((host) => host.runner.flow === "shop");

export type LanguageGroup = { language: Language; hosts: Host[] };

/** The built hosts by language, in the manifest's order; a language without one is left out. */
export function hostsByLanguage(hosts: readonly Host[] = HOSTS): LanguageGroup[] {
  return LANGUAGES.map((language) => ({ language, hosts: hosts.filter((host) => host.language === language.id) })).filter(
    (group) => group.hosts.length > 0,
  );
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty"];

/** `n` in words, as prose writes a count: "eleven", "twenty-one". */
export function inWords(n: number): string {
  if (n < 13) return WORDS[n] ?? String(n);
  if (n < 20) return `${["thir", "four", "fif", "six", "seven", "eigh", "nine"][n - 13]}teen`;
  const tens = TENS[Math.floor(n / 10)];
  if (!tens) return String(n);
  return n % 10 ? `${tens}-${WORDS[n % 10]}` : tens;
}

/** `word` with a capital first letter, for the start of a sentence. */
export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The language's label for a host. */
export function languageOf(host: Host): string {
  return LANGUAGES.find((language) => language.id === host.language)?.label ?? host.language;
}
