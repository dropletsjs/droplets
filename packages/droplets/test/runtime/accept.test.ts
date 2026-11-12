import { describe, expect, it } from "vitest";
import { prefersJson } from "../../src/runtime/accept.ts";

describe("prefersJson", () => {
  it("is true for application/json alone, what enhanceDropletForm sends, and for application/*", () => {
    expect(prefersJson({ accept: "application/json" })).toBe(true);
    expect(prefersJson({ accept: "application/*" })).toBe(true);
    expect(prefersJson({ accept: "Application/JSON; charset=utf-8" })).toBe(true);
  });

  it("is false without a header, for an empty one, and for a browser's navigation", () => {
    expect(prefersJson({ accept: undefined })).toBe(false);
    expect(prefersJson({ accept: null })).toBe(false);
    expect(prefersJson({ accept: "" })).toBe(false);
    expect(prefersJson({ accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" })).toBe(false);
  });

  it("weighs q: JSON wins only when it is preferred over text/html, or equal", () => {
    expect(prefersJson({ accept: "text/html, application/json;q=0.1" })).toBe(false);
    expect(prefersJson({ accept: "text/html;q=0.5, application/json;q=0.9" })).toBe(true);
    expect(prefersJson({ accept: "application/json, text/html" })).toBe(true);
    expect(prefersJson({ accept: "text/html, application/json" })).toBe(true);
    expect(prefersJson({ accept: "application/json;q=0.5, text/*" })).toBe(false);
    expect(prefersJson({ accept: "application/json;q=0.5, */*" })).toBe(false);
  });

  it("excludes q=0 and reads the most specific range for each type", () => {
    expect(prefersJson({ accept: "application/json;q=0" })).toBe(false);
    expect(prefersJson({ accept: "application/json;q=0, application/*" })).toBe(false);
    expect(prefersJson({ accept: "application/*;q=0.2, application/json;q=0.9, text/html;q=0.5" })).toBe(true);
    expect(prefersJson({ accept: "*/*;q=0.1, text/html;q=0" })).toBe(false);
  });

  it("never selects JSON on */* alone: the request has to name it", () => {
    expect(prefersJson({ accept: "*/*" })).toBe(false);
    expect(prefersJson({ accept: "text/html;q=0.5, */*" })).toBe(false);
  });

  it("ignores a q it cannot read, and a substring that is no media range", () => {
    expect(prefersJson({ accept: "application/json;q=abc" })).toBe(true);
    expect(prefersJson({ accept: "application/json;q=2" })).toBe(true);
    expect(prefersJson({ accept: "text/application/json" })).toBe(false);
    expect(prefersJson({ accept: "application/jsonx" })).toBe(false);
  });
});
