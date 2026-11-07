import { describe, expect, it } from "vitest";
import { flagsFor, scriptFlags } from "../../src/add/flags.ts";

describe("flagsFor()", () => {
  it("full hydrates always unless told when, and never not at all", () => {
    expect(flagsFor("full")).toEqual({ flags: { ssr: true, hydrate: true, prerender: false }, notes: [] });
    expect(flagsFor("full", "visible").flags.hydrate).toBe("visible");
    expect(flagsFor("full", "interactive").flags.hydrate).toBe("interactive");
    expect(() => flagsFor("full", "none")).toThrow(/--target ssr/);
  });

  it("ssr ships no JavaScript; asked to hydrate, it says that is full", () => {
    expect(flagsFor("ssr")).toEqual({ flags: { ssr: true, hydrate: false, prerender: false }, notes: [] });
    expect(flagsFor("ssr", "visible")).toEqual({
      flags: { ssr: true, hydrate: "visible", prerender: false },
      notes: [{ level: "info", message: expect.stringContaining("--target full --hydrate visible") }],
    });
  });

  it("client renders in the browser; without hydration it warns of a blank component", () => {
    expect(flagsFor("client")).toEqual({ flags: { ssr: false, hydrate: true, prerender: false }, notes: [] });
    expect(flagsFor("client", "none").notes).toEqual([{ level: "warn", message: expect.stringContaining("blank component") }]);
    expect(flagsFor("client", "interactive").notes).toEqual([{ level: "warn", message: expect.stringContaining("mounts at once") }]);
    expect(flagsFor("client", "visible").notes).toEqual([]);
  });

  it("ssg prerenders and hydrates, or stays static with none", () => {
    expect(flagsFor("ssg")).toEqual({ flags: { ssr: true, hydrate: true, prerender: true }, notes: [] });
    expect(flagsFor("ssg", "none")).toEqual({ flags: { ssr: true, hydrate: false, prerender: true }, notes: [] });
  });
});

describe("scriptFlags()", () => {
  it("runs a script droplet at once or when visible, and refuses the rest", () => {
    expect(scriptFlags()).toEqual({ ssr: true, hydrate: true, prerender: false });
    expect(scriptFlags("visible").hydrate).toBe("visible");
    expect(() => scriptFlags("none")).toThrow(/a script droplet always runs in the browser/);
    expect(() => scriptFlags("interactive")).toThrow(/use always or visible/);
  });
});
