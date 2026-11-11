import { afterEach, describe, expect, it } from "vitest";
import { DOCS_ORIGINS, docsOrigins } from "../src/lib/origins.ts";

describe("docsOrigins", () => {
  const before = process.env["DOCS_PORT"];
  afterEach(() => {
    if (before === undefined) delete process.env["DOCS_PORT"];
    else process.env["DOCS_PORT"] = before;
  });

  it("is DOCS_ORIGINS alone without DOCS_PORT, or with the default port", () => {
    delete process.env["DOCS_PORT"];
    expect(docsOrigins()).toEqual([...DOCS_ORIGINS]);
    process.env["DOCS_PORT"] = "4321";
    expect(docsOrigins()).toEqual([...DOCS_ORIGINS]);
  });

  it("adds the docs' dev port on localhost and 127.0.0.1", () => {
    process.env["DOCS_PORT"] = "4400";
    expect(docsOrigins()).toEqual([...DOCS_ORIGINS, "http://localhost:4400", "http://127.0.0.1:4400"]);
  });

  it("ignores a value that is not a port", () => {
    for (const value of ["", "abc", "80", "4400.5", "99999", "4400/evil"]) {
      process.env["DOCS_PORT"] = value;
      expect(docsOrigins(), value).toEqual([...DOCS_ORIGINS]);
    }
  });
});
