import { afterEach, describe, expect, it } from "vitest";
import {
  dropletsError,
  formatAgent,
  formatHuman,
  formatMessage,
  formatterOf,
  setErrorFormatter,
  type AnyMessage,
} from "../../src/errors/format.ts";

const TIMED_OUT = {
  code: "test-timed-out",
  level: "warning",
  what: ({ timeout }: { timeout: number }) => `answered 504 after ${timeout} ms`,
  fix: "raise render.timeout",
} satisfies AnyMessage;

const PLAIN = { code: "test-plain", level: "error", what: "it broke", fix: "mend it" } satisfies AnyMessage;

afterEach(() => setErrorFormatter(formatAgent));

describe("formatAgent", () => {
  it("writes labelled lines, the droplet and the file only when known, and the page's Markdown twin", () => {
    expect(
      formatMessage({ message: TIMED_OUT, params: { timeout: 50 }, droplet: "cart", file: "src/droplets/cart/+droplet.server.ts" }),
    ).toBe(`droplets warning test-timed-out
  droplet: cart
  file: src/droplets/cart/+droplet.server.ts
  what: answered 504 after 50 ms
  fix: raise render.timeout
  docs: https://dropletsjs.dev/errors/test-timed-out.md`);
    expect(formatMessage({ message: PLAIN })).toBe(`droplets error test-plain
  what: it broke
  fix: mend it
  docs: https://dropletsjs.dev/errors/test-plain.md`);
  });

  it("indents the lines after the first of a field", () => {
    expect(formatAgent({ code: "x", level: "error", what: "a\nb", fix: "c" })).toContain("  what: a\n    b\n  fix: c");
  });
});

describe("formatHuman", () => {
  it("writes one line that ends with the page", () => {
    setErrorFormatter(formatHuman);
    expect(formatMessage({ message: TIMED_OUT, params: { timeout: 50 }, droplet: "cart" })).toBe(
      "droplets: cart: answered 504 after 50 ms; raise render.timeout (https://dropletsjs.dev/errors/test-timed-out/)",
    );
    expect(formatMessage({ message: PLAIN })).toBe("droplets: it broke; mend it (https://dropletsjs.dev/errors/test-plain/)");
  });
});

describe("formatterOf", () => {
  it("picks the formatter of an errorFormat", () => {
    expect(formatterOf({ format: "agent" })).toBe(formatAgent);
    expect(formatterOf({ format: "human" })).toBe(formatHuman);
  });
});

describe("dropletsError", () => {
  it("is an Error with the code, the formatted message and the cause", () => {
    const cause = new Error("inner");
    const error = dropletsError({ message: PLAIN, droplet: "cart", cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("test-plain");
    expect(error.message).toBe(formatMessage({ message: PLAIN, droplet: "cart" }));
    expect(error.cause).toBe(cause);
  });

  it("is written in the realm's format", () => {
    setErrorFormatter(formatHuman);
    expect(dropletsError({ message: PLAIN }).message).toBe("droplets: it broke; mend it (https://dropletsjs.dev/errors/test-plain/)");
  });
});
