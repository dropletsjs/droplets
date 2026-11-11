import { describe, expect, it } from "vitest";
import {
  contractChanges,
  contractNotice,
  formatChanges,
  hydrateAction,
  readContract,
  type ContractNotice,
  type RenderContract,
} from "../../src/runtime/dev-contract.ts";

const base: RenderContract = { ssr: true, hydrate: true, prerender: false };
type FlipInput = { change: Partial<RenderContract>; from?: RenderContract };

function flip({ change, from = base }: FlipInput): ContractNotice | null {
  return contractNotice({ droplet: "counter", before: from, after: { ...from, ...change } });
}

describe("readContract", () => {
  it("takes the three flags as plain data", () => {
    expect(readContract({ value: { ssr: false, hydrate: "visible", prerender: true } })).toEqual({
      ssr: false,
      hydrate: "visible",
      prerender: true,
    });
  });

  it("refuses anything else", () => {
    expect(readContract({ value: null })).toBeNull();
    expect(readContract({ value: [] })).toBeNull();
    expect(readContract({ value: { ssr: true, hydrate: true } })).toBeNull();
    expect(readContract({ value: { ssr: "yes", hydrate: true, prerender: false } })).toBeNull();
    expect(readContract({ value: { ssr: true, hydrate: "later", prerender: false } })).toBeNull();
    // Inherited flags are not the payload's.
    const inherited = Object.create({ ssr: true, hydrate: true, prerender: false }) as object;
    expect(readContract({ value: inherited })).toBeNull();
  });
});

describe("contractChanges", () => {
  it("lists the flags that differ, in order", () => {
    const changes = contractChanges({ before: base, after: { ssr: false, hydrate: false, prerender: true } });
    expect(changes.map((change) => change.flag)).toEqual(["ssr", "hydrate", "prerender"]);
    expect(formatChanges({ changes })).toBe("ssr true → false, hydrate true → false, prerender false → true");
    expect(contractChanges({ before: base, after: { ...base } })).toEqual([]);
  });
});

describe("the notice of a new contract", () => {
  it("is nothing when nothing changed", () => {
    expect(contractNotice({ droplet: "counter", before: base, after: { ...base } })).toBeNull();
  });

  it("ssr false → true: a toast with Reload page", () => {
    expect(flip({ change: { ssr: true }, from: { ...base, ssr: false } })).toMatchObject({
      message: "counter changed its render contract: ssr false → true",
      reload: true,
      toast: true,
    });
  });

  it("ssr true → false: a toast only", () => {
    expect(flip({ change: { ssr: false } })).toMatchObject({
      message: "counter changed its render contract: ssr true → false",
      reload: false,
      toast: true,
    });
  });

  it("hydrate false → on: a toast, no button: it hydrates live", () => {
    for (const mode of [true, "visible", "interactive"] as const) {
      expect(flip({ change: { hydrate: mode }, from: { ...base, hydrate: false } })).toMatchObject({
        message: `counter changed its render contract: hydrate false → ${mode}`,
        reload: false,
        toast: true,
      });
    }
  });

  it("hydrate on → false: a toast with Reload page", () => {
    expect(flip({ change: { hydrate: false } })).toMatchObject({
      message: "counter changed its render contract: hydrate true → false",
      reload: true,
      toast: true,
    });
  });

  it("hydrate between its modes: a console line, no toast", () => {
    expect(flip({ change: { hydrate: "interactive" } })).toMatchObject({
      message: "counter changed its render contract: hydrate true → interactive",
      reload: false,
      toast: false,
    });
  });

  it("prerender either way: a toast that points to vite preview", () => {
    for (const prerender of [true, false]) {
      const notice = flip({ change: { prerender }, from: { ...base, prerender: !prerender } });
      expect(notice).toMatchObject({ reload: false, toast: true });
      expect(notice?.detail).toContain("vite preview");
    }
  });

  it("several at once: one notice, a button when any asks for one", () => {
    const notice = flip({ change: { ssr: false, hydrate: false } });
    expect(notice?.message).toBe("counter changed its render contract: ssr true → false, hydrate true → false");
    expect(notice?.reload).toBe(true);
  });
});

describe("hydrateAction: what one element does", () => {
  const modes = [true, "visible", "interactive"] as const;

  it("does nothing when its mode is the same", () => {
    expect(hydrateAction({ before: true, after: true, life: "live" })).toBe("none");
    expect(hydrateAction({ before: false, after: false, life: "static" })).toBe("none");
  });

  it("hydrates the markup there when hydrate turns on", () => {
    for (const mode of modes) expect(hydrateAction({ before: false, after: mode, life: "static" })).toBe("hydrate");
  });

  it("keeps the running component when hydrate turns off", () => {
    for (const mode of modes) {
      expect(hydrateAction({ before: mode, after: false, life: "live" })).toBe("keep");
      expect(hydrateAction({ before: mode, after: false, life: "waiting" })).toBe("keep");
    }
  });

  it("between modes: follows the new one while it waits, a note once it is live", () => {
    expect(hydrateAction({ before: "visible", after: "interactive", life: "waiting" })).toBe("rewait");
    expect(hydrateAction({ before: "interactive", after: true, life: "waiting" })).toBe("rewait");
    expect(hydrateAction({ before: true, after: "visible", life: "live" })).toBe("note");
    expect(hydrateAction({ before: "visible", after: true, life: "live" })).toBe("note");
    // Not hydrated and not waiting (it rendered nothing): it starts in the new mode.
    expect(hydrateAction({ before: true, after: "visible", life: "static" })).toBe("hydrate");
  });
});
