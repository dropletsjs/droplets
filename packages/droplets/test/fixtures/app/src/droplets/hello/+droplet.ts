import { browser } from "$droplets/env";

type ServerData = { who: string; when: Date; tags: Map<string, string>; seen: Set<number>; link: URL; big: bigint };

/** What the transported values say, read through their own methods: text any engine renders. */
const kindsOf = (data: ServerData) =>
  [data.tags.get("a"), data.seen.has(1), data.link.hostname, String(data.big + 1n), data.when.toISOString()].join(" ");

export const load = ({ data }: { data: ServerData }) => {
  if (browser && data.who === "boom") throw new Error("browser boom");
  return { ...data, greeting: `Hello ${data.who}!`, kinds: kindsOf(data) };
};

export const handleError = ({ error }: { error: unknown }) => ({
  error: { message: `[hello] ${(error as { message?: string }).message ?? "?"}` },
});
