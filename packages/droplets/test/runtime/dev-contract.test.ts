import { describe, expect, it } from "vitest";
import {
  contractChanges,
  contractNotice,
  formatChanges,
  hydrateAction,
  readContract,
  type RenderContract,
} from "../../src/runtime/dev-contract.ts";

const base: RenderContract = { ssr: true, hydrate: true, prerender: false };
const flip = (change: Partial<RenderContract>, from: RenderContract = base) => contractNotice("counter", from, { ...from, ...change });

describe("readContract", () => {
  it("takes the three flags as plain data", () => {
    expect(readContract({ ssr: false, hydrate: "visible", prerender: true })).toEqual({ ssr: false, hydrate: "visible", prerender: true });
  });

  it("refuses anything else", () => {
    expect(readContract(null)).toBeNull();
    expect(readContract([])).toBeNull();
    expect(readContract({ ssr: true, hydrate: true })).toBeNull();
    expect(readContract({ ssr: "yes", hydrate: true, prerender: false })).toBeNull();
    expect(readContract({ ssr: true, hydrate: "later", prerender: false })).toBeNull();
    // Inherited flags are not the payload's.
    const inherited = Object.create({ ssr: true, hydrate: true, prerender: false }) as object;
    expect(readContract(inherited)).toBeNull();
  });
});

describe("contractChanges", () => {
  it("lists the flags that differ, in order", () => {
    const changes = contractChanges(base, { ssr: false, hydrate: false, prerender: true });
    expect(changes.map((change) => change.flag)).toEqual(["ssr", "hydrate", "prerender"]);
    expect(formatChanges(changes)).toBe("ssr true → false, hydrate true → false, prerender false → true");
    expect(contractChanges(base, { ...base })).toEqual([]);
  });
});

describe("the notice of a new contract", () => {
  it("is nothing when nothing changed", () => {
    expect(contractNotice("counter", base, { ...base })).toBeNull();
  });

  it("ssr false → true: a toast with Reload page", () => {
    expect(flip({ ssr: true }, { ...base, ssr: false })).toMatchObject({
      message: "counter changed its render contract: ssr false → true",
      reload: true,
      toast: true,
    });
  });

  it("ssr true → false: a toast only", () => {
    expect(flip({ ssr: false })).toMatchObject({
      message: "counter changed its render contract: ssr true → false",
      reload: false,
      toast: true,
    });
  });

  it("hydrate false → on: a toast, no button: it hydrates live", () => {
    for (const mode of [true, "visible", "interactive"] as const) {
      expect(flip({ hydrate: mode }, { ...base, hydrate: false })).toMatchObject({
        message: `counter changed its render contract: hydrate false → ${mode}`,
        reload: false,
        toast: true,
      });
    }
  });

  it("hydrate on → false: a toast with Reload page", () => {
    expect(flip({ hydrate: false })).toMatchObject({
      message: "counter changed its render contract: hydrate true → false",
      reload: true,
      toast: true,
    });
  });

  it("hydrate between its modes: a console line, no toast", () => {
    expect(flip({ hydrate: "interactive" })).toMatchObject({
      message: "counter changed its render contract: hydrate true → interactive",
      reload: false,
      toast: false,
    });
  });

  it("prerender either way: a toast that points to vite preview", () => {
    for (const prerender of [true, false]) {
      const notice = flip({ prerender }, { ...base, prerender: !prerender });
      expect(notice).toMatchObject({ reload: false, toast: true });
      expect(notice?.detail).toContain("vite preview");
    }
  });

  it("several at once: one notice, a button when any asks for one", () => {
    const notice = flip({ ssr: false, hydrate: false });
    expect(notice?.message).toBe("counter changed its render contract: ssr true → false, hydrate true → false");
    expect(notice?.reload).toBe(true);
  });
});

describe("hydrateAction: what one element does", () => {
  const modes = [true, "visible", "interactive"] as const;

  it("does nothing when its mode is the same", () => {
    expect(hydrateAction(true, true, "live")).toBe("none");
    expect(hydrateAction(false, false, "static")).toBe("none");
  });

  it("hydrates the markup there when hydrate turns on", () => {
    for (const mode of modes) expect(hydrateAction(false, mode, "static")).toBe("hydrate");
  });

  it("keeps the running component when hydrate turns off", () => {
    for (const mode of modes) {
      expect(hydrateAction(mode, false, "live")).toBe("keep");
      expect(hydrateAction(mode, false, "waiting")).toBe("keep");
    }
  });

  it("between modes: follows the new one while it waits, a note once it is live", () => {
    expect(hydrateAction("visible", "interactive", "waiting")).toBe("rewait");
    expect(hydrateAction("interactive", true, "waiting")).toBe("rewait");
    expect(hydrateAction(true, "visible", "live")).toBe("note");
    expect(hydrateAction("visible", true, "live")).toBe("note");
    // Not hydrated and not waiting (it rendered nothing): it starts in the new mode.
    expect(hydrateAction(true, "visible", "static")).toBe("hydrate");
  });
});
