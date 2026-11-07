import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runClientInit, type ClientInit } from "../../src/runtime/client-init.ts";

const FILE = "src/hooks.client.ts";

describe("runClientInit", () => {
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls init once, synchronously", () => {
    const init = vi.fn();
    expect(runClientInit({ init }, FILE)).toBeUndefined();
    expect(init).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("logs an init that throws, and returns", () => {
    const failure = new Error("boom");
    expect(() => runClientInit({ init: () => { throw failure; } }, FILE)).not.toThrow();
    expect(error).toHaveBeenCalledWith("[droplets] init() in src/hooks.client.ts failed; starting the droplets anyway", failure);
  });

  it("does not wait for a promise init returns, and logs its rejection", async () => {
    let fail!: (reason: unknown) => void;
    const promise = new Promise((_, reject) => (fail = reject));
    const then = vi.spyOn(promise, "then");
    expect(runClientInit({ init: () => promise }, FILE)).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
    const failure = new Error("later");
    fail(failure);
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "[droplets] init() in src/hooks.client.ts returned a promise that rejected; init is not waited for",
        failure,
      ),
    );
    expect(then).toHaveBeenCalled();
  });

  it("calls an async init and carries on at once, logging what it throws later", async () => {
    const steps: string[] = [];
    const init: ClientInit = async () => {
      steps.push("started");
      await Promise.resolve();
      steps.push("after await");
      throw new Error("async boom");
    };
    runClientInit({ init }, FILE);
    steps.push("carried on");
    expect(steps).toEqual(["started", "carried on"]);
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "[droplets] init() in src/hooks.client.ts returned a promise that rejected; init is not waited for",
        expect.objectContaining({ message: "async boom" }),
      ),
    );
    expect(steps).toEqual(["started", "carried on", "after await"]);
  });

  it("says nothing about a promise that resolves", async () => {
    runClientInit({ init: () => Promise.resolve("ignored") }, FILE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(error).not.toHaveBeenCalled();
  });

  it("runs nothing for a file without init, and refuses an init that is not a function", () => {
    runClientInit({}, FILE);
    expect(error).not.toHaveBeenCalled();
    runClientInit({ init: "soon" }, FILE);
    expect(error).toHaveBeenCalledWith("[droplets] init in src/hooks.client.ts is not a function; starting the droplets without it");
  });
});
