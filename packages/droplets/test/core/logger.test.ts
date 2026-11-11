import { afterEach, describe, expect, it, vi } from "vitest";
import { getLogLevel, logger, resolveLevel, setLogLevel } from "../../src/core/logger.ts";

describe("resolveLevel", () => {
  it.each([
    ["debug", "debug"],
    ["WARN", "warn"],
    ["Error", "error"],
    ["info", "info"],
    ["verbose", "info"],
    [undefined, "info"],
  ])("%s -> %s", (input, expected) => {
    expect(resolveLevel(input)).toBe(expected);
  });
});

describe("logger", () => {
  const previous = getLogLevel();
  afterEach(() => {
    setLogLevel(previous);
    vi.restoreAllMocks();
  });

  it("filters messages above the current level", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setLogLevel("warn");
    logger.info("framework", "hidden");
    logger.warn("drop", "shown", { a: 1 });
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[droplets:drop] shown", { a: 1 });
  });

  it("omits the meta argument when none is given", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("framework", "boom");
    expect(error).toHaveBeenCalledWith("[droplets:framework] boom");
    expect(error.mock.calls[0]).toHaveLength(1);
  });
});
