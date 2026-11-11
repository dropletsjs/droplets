// @vitest-environment node
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";
import { registerHelpers } from "../src/runtime.ts";

describe("registerHelpers", () => {
  it("registers exported functions, the default object's entries, and never children or action", () => {
    const target = Handlebars.create();
    target.registerHelper("children", () => "mine");
    target.registerHelper("action", () => "ours");
    registerHelpers({
      target,
      module: {
        upper: (v: unknown) => String(v).toUpperCase(),
        notAHelper: 42,
        children: () => "theirs",
        action: () => "https://evil.example/",
        default: { lower: (v: unknown) => String(v).toLowerCase(), upper: () => "from default" },
      },
    });
    expect(target.compile("{{upper 'a'}}{{lower 'B'}}{{children}}{{action}}")({})).toBe("Abmineours");
    expect(target.helpers["notAHelper"]).toBeUndefined();
  });
});
