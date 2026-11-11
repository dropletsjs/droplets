/**
 * The devtools keeps its own copy of the query keys droplets reserves, so
 * the runtime exports no such check. This compares the copy with the
 * runtime's list, read from `@dropletsjs/droplets` as built
 * (`dist/runtime/form.js`, a fixed tsdown entry), and fails when they part.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { FORM_RESULT_PREFIX, isReservedQueryKey, RESERVED_QUERY_KEYS } from "../src/shared.ts";

type RuntimeForm = {
  RESERVED_QUERY_KEYS: ReadonlySet<string>;
  FORM_RESULT_PREFIX: string;
  isReservedQueryKey(input: { key: string }): boolean;
};

const entry = createRequire(import.meta.url).resolve("@dropletsjs/droplets");
const runtime = (await import(pathToFileURL(join(dirname(entry), "runtime/form.js")).href)) as RuntimeForm;

describe("the devtools' reserved query keys", () => {
  it("are the runtime's list, key for key", () => {
    expect([...RESERVED_QUERY_KEYS].sort()).toEqual([...runtime.RESERVED_QUERY_KEYS].sort());
    expect(FORM_RESULT_PREFIX).toBe(runtime.FORM_RESULT_PREFIX);
  });

  it("are told apart from props as the runtime does", () => {
    const keys = [
      ...runtime.RESERVED_QUERY_KEYS,
      `${runtime.FORM_RESULT_PREFIX}cart_abc123`,
      runtime.FORM_RESULT_PREFIX,
      "/add",
      "/",
      "page",
      "productId",
      "C",
      "cb",
      "__droplet",
      "__droplet_form",
      "__proto__",
      "constructor",
      "",
    ];
    for (const key of keys) expect(isReservedQueryKey({ key }), key).toBe(runtime.isReservedQueryKey({ key }));
  });
});
