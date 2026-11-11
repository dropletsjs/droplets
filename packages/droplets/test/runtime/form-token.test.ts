import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/core/logger.ts";
import {
  FORM_RESULT_MAX_LENGTH,
  FORM_RESULT_TTL_MS,
  formSecret,
  mintFormResult,
  readFormResult,
  resetFormSecretWarnings,
} from "../../src/runtime/form-token.server.ts";

const SECRET = "test-secret-0123456789abcdef-0123456789";
const SCOPE = { droplet: "guestbook", build: "abc123", page: "https://shop.test/p/1" };
const NOW = 1_800_000_000_000;

const b64url = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const unb64url = (text: string) => Buffer.from(text, "base64url").toString("utf8");

const mint = async (data: unknown = { message: "Thanks, Ana" }, extra: Partial<{ action: string; status: number; now: number }> = {}) =>
  (await mintFormResult(SECRET, SCOPE, { action: extra.action ?? "default", status: extra.status ?? 200, data }, extra.now ?? NOW)).value;

const read = (value: unknown, scope = SCOPE, now = NOW) => readFormResult(SECRET, scope, value, now);

afterEach(() => {
  vi.restoreAllMocks();
  resetFormSecretWarnings();
});

describe("the no-JavaScript form result", () => {
  it("round-trips status, action and data, as null-prototype plain data", async () => {
    const value = await mint({ message: "Thanks, Ana", fields: [{ name: "x" }] }, { action: "add", status: 422 });
    expect(value).toMatch(/^[\w-]+\.[\w-]{43}$/);
    const result = await read(value);
    expect(result).toEqual({ action: "add", status: 422, data: { message: "Thanks, Ana", fields: [{ name: "x" }] } });
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.getPrototypeOf((result ?? expect.unreachable("a form result")).data)).toBeNull();
    // The payload is the documented JSON, nothing more.
    expect(JSON.parse(unb64url(value.split(".")[0] ?? expect.unreachable("a payload")))).toEqual({
      status: 422,
      data: { message: "Thanks, Ana", fields: [{ name: "x" }] },
      exp: NOW + FORM_RESULT_TTL_MS,
      action: "add",
    });
  });

  it("carries no data key when the action returned none", async () => {
    const value = (await mintFormResult(SECRET, SCOPE, { action: "default", status: 200 }, NOW)).value;
    const result = await read(value);
    expect(result).toEqual({ action: "default", status: 200 });
    expect(Object.hasOwn(result ?? expect.unreachable("a form result"), "data")).toBe(false);
  });

  it("ignores a tampered payload: the MAC is checked before anything is parsed", async () => {
    const value = await mint();
    const [payload, mac] = value.split(".") as [string, string];
    const body = JSON.parse(unb64url(payload)) as Record<string, unknown>;
    const parse = vi.spyOn(JSON, "parse");
    for (const changed of [
      { ...body, status: 500 },
      { ...body, action: "leave" },
      { ...body, data: { message: "Call 555" } },
    ]) {
      expect(await read(`${b64url(JSON.stringify(changed))}.${mac}`)).toBeNull();
    }
    // Garbage that is not JSON is never handed to JSON.parse either.
    expect(await read(`${b64url("{not json")}.${mac}`)).toBeNull();
    expect(parse).not.toHaveBeenCalled();
  });

  it("ignores a tampered MAC", async () => {
    const value = await mint();
    const [payload, mac] = value.split(".") as [string, string];
    const flipped = `${mac.slice(0, 10)}${mac[10] === "A" ? "B" : "A"}${mac.slice(11)}`;
    expect(await read(`${payload}.${flipped}`)).toBeNull();
    expect(await read(`${payload}.${"A".repeat(43)}`)).toBeNull();
  });

  it("is bound to its droplet, its build and its page", async () => {
    const value = await mint();
    expect(await read(value, { ...SCOPE, droplet: "cart" })).toBeNull();
    expect(await read(value, { ...SCOPE, build: "def456" })).toBeNull();
    // Minted for page A, presented on page B of a trusted origin: refused.
    for (const page of ["https://shop.test/p/2", "https://shop.test/p/1/", "https://shop.test/p", "https://other.test/p/1"]) {
      expect(await read(value, { ...SCOPE, page }), page).toBeNull();
    }
    expect(await read(value, { ...SCOPE })).not.toBeNull();
    // A secret that differs is a MAC that differs.
    expect(await readFormResult(`${SECRET}-other`, SCOPE, value, NOW)).toBeNull();
  });

  it("expires after five minutes, and refuses one minted far in the future", async () => {
    const value = await mint();
    expect(await read(value, SCOPE, NOW + FORM_RESULT_TTL_MS - 1)).not.toBeNull();
    expect(await read(value, SCOPE, NOW + FORM_RESULT_TTL_MS)).toBeNull();
    // Signed with the real secret, but valid until an hour from now: refused.
    const ahead = await mint(undefined, { now: NOW + 60 * 60 * 1000 });
    expect(await read(ahead)).toBeNull();
  });

  it("refuses statuses and action names it would never mint", async () => {
    expect(await read(await mint({}, { status: 302 }))).toBeNull();
    expect(await read(await mint({}, { status: 600 }))).toBeNull();
    expect(await read(await mint({}, { action: "__proto__" }))).toBeNull();
    expect(await read(await mint({}, { action: "a b" }))).toBeNull();
  });

  it("drops the data, keeping status and action, past 2 KB; refuses a longer value", async () => {
    const big = { message: "x".repeat(3000) };
    const minted = await mintFormResult(SECRET, SCOPE, { action: "add", status: 409, data: big }, NOW);
    expect(minted.dropped).toBe(true);
    expect(minted.value.length).toBeLessThanOrEqual(FORM_RESULT_MAX_LENGTH);
    expect(await read(minted.value)).toEqual({ action: "add", status: 409 });

    const value = await mint();
    expect(await read(`${"A".repeat(FORM_RESULT_MAX_LENGTH)}${value}`)).toBeNull();
    expect(await read(`${value}${"A".repeat(FORM_RESULT_MAX_LENGTH)}`)).toBeNull();
  });

  it("refuses anything that is not one base64url payload and a 32-byte MAC", async () => {
    const value = await mint();
    const [payload, mac] = value.split(".") as [string, string];
    for (const bad of [
      undefined,
      42,
      "",
      value.replace(".", ""),
      `${payload}.${mac}.x`,
      `${payload}=.${mac}`,
      `${payload}.${mac}=`,
      `${payload}.${mac.slice(1)}`,
      `${payload}+.${mac}`,
    ]) {
      expect(await read(bad), String(bad)).toBeNull();
    }
  });

  it("takes __proto__ keys as nothing: no prototype, no pollution", async () => {
    const data = JSON.parse('{"message":"hi","__proto__":{"polluted":1},"nested":{"__proto__":{"polluted":2}}}') as unknown;
    const result = await read(await mint(data));
    expect(result).not.toBeNull();
    const form = (result ?? expect.unreachable("a form result")).data as Record<string, unknown>;
    expect(form["message"]).toBe("hi");
    expect(Object.hasOwn(form, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(form)).toBeNull();
    expect(Object.getPrototypeOf(form["nested"])).toBeNull();
    expect(Object.keys(form["nested"] as object)).toEqual([]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.assign({}, form)).not.toHaveProperty("polluted");
  });
});

describe("DROPLETS_SECRET", () => {
  it("needs 32 bytes, and says so once", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(formSecret(SECRET)).toBe(SECRET);
    expect(formSecret(undefined)).toBeNull();
    expect(formSecret("")).toBeNull();
    expect(formSecret("x".repeat(31))).toBeNull();
    expect(formSecret("x".repeat(31))).toBeNull();
    // Bytes, not characters: 32 bytes in 16 characters.
    expect(formSecret("é".repeat(16))).toBe("é".repeat(16));
    expect(formSecret(`${"é".repeat(15)}x`)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((call) => call[1])).toEqual([
      expect.stringContaining("DROPLETS_SECRET is not set"),
      expect.stringContaining("DROPLETS_SECRET is shorter than 32 bytes"),
    ]);
    // Both say what to set it to.
    for (const call of warn.mock.calls) expect(String(call[1])).toContain("openssl rand -base64 32");
  });
});
