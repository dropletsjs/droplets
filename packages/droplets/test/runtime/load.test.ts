import { describe, expect, it } from "vitest";
import { settle } from "../../src/runtime/load.ts";

describe("settle", () => {
  it("resolves the value, then its promise fields, one level deep", async () => {
    const nested = Promise.resolve("deep");
    const result = await settle(Promise.resolve({ a: 1, b: Promise.resolve(2), c: { nested } }));
    expect(result).toEqual({ a: 1, b: 2, c: { nested } });
  });

  it("returns values without promise fields as they are", async () => {
    const plain = { a: 1 };
    expect(await settle(plain)).toBe(plain);
    expect(await settle(undefined)).toBeUndefined();
    expect(await settle(null)).toBeNull();
  });

  it("rejects with the first rejection as thrown, after every field settled", async () => {
    const order: string[] = [];
    const answer = { status: 404 };
    const late = new Promise((_, reject) => setTimeout(() => {
      order.push("late");
      reject(new Error("late"));
    }, 5));
    await expect(settle({ first: Promise.reject(answer), late })).rejects.toBe(answer);
    // `late` was listened to: no unhandled rejection, and it was awaited.
    expect(order).toEqual(["late"]);
  });
});
