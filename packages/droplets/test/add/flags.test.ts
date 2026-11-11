import { describe, expect, it } from "vitest";
import { flagsFor, scriptFlags } from "../../src/add/flags.ts";

describe("flagsFor()", () => {
  it("full hydrates always unless told when, and never not at all", () => {
    expect(flagsFor({ target: "full" })).toEqual({ flags: { ssr: true, hydrate: true, prerender: false }, notes: [] });
    expect(flagsFor({ target: "full", hydrate: "visible" }).flags.hydrate).toBe("visible");
    expect(flagsFor({ target: "full", hydrate: "interactive" }).flags.hydrate).toBe("interactive");
    expect(() => flagsFor({ target: "full", hydrate: "none" })).toThrow(/--target ssr/);
  });

  it("ssr ships no JavaScript; asked to hydrate, it says that is full", () => {
    expect(flagsFor({ target: "ssr" })).toEqual({ flags: { ssr: true, hydrate: false, prerender: false }, notes: [] });
    expect(flagsFor({ target: "ssr", hydrate: "visible" })).toEqual({
      flags: { ssr: true, hydrate: "visible", prerender: false },
      notes: [{ level: "info", message: expect.stringContaining("--target full --hydrate visible") }],
    });
  });

  it("client renders in the browser; without hydration it warns of a blank component", () => {
    expect(flagsFor({ target: "client" })).toEqual({ flags: { ssr: false, hydrate: true, prerender: false }, notes: [] });
    expect(flagsFor({ target: "client", hydrate: "none" }).notes).toEqual([
      { level: "warn", message: expect.stringContaining("blank component") },
    ]);
    expect(flagsFor({ target: "client", hydrate: "interactive" }).notes).toEqual([
      { level: "warn", message: expect.stringContaining("mounts at once") },
    ]);
    expect(flagsFor({ target: "client", hydrate: "visible" }).notes).toEqual([]);
  });

  it("ssg prerenders and hydrates, or stays static with none", () => {
    expect(flagsFor({ target: "ssg" })).toEqual({ flags: { ssr: true, hydrate: true, prerender: true }, notes: [] });
    expect(flagsFor({ target: "ssg", hydrate: "none" })).toEqual({ flags: { ssr: true, hydrate: false, prerender: true }, notes: [] });
  });
});

describe("scriptFlags()", () => {
  it("is client only: no server render, hydrated, never prerendered", () => {
    expect(scriptFlags()).toEqual({ ssr: false, hydrate: true, prerender: false });
  });
});
