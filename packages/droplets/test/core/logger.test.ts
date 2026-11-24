import { afterEach, describe, expect, it, vi } from "vitest";
import { getLogLevel, logger, resolveLevel, setLogLevel } from "../../src/core/logger.ts";
import { formatAgent, formatHuman, setErrorFormatter, type AnyMessage } from "../../src/errors/format.ts";

const SLOW = { code: "test-slow", level: "warning", what: "slow", fix: "speed up" } satisfies AnyMessage;
const BROKEN = { code: "test-broken", level: "error", what: "broken", fix: "mend it" } satisfies AnyMessage;

describe("resolveLevel", () => {
  it.each([
    ["debug", "debug"],
    ["WARN", "warn"],
    ["Error", "error"],
    ["info", "info"],
    ["verbose", "info"],
    [undefined, "info"],
  ])("%s -> %s", (input, expected) => {
    expect(resolveLevel({ raw: input })).toBe(expected);
  });
});

describe("logger", () => {
  const previous = getLogLevel();
  afterEach(() => {
    setLogLevel(previous);
    setErrorFormatter(formatAgent);
    vi.restoreAllMocks();
  });

  it("filters messages above the current level", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setLogLevel("warn");
    logger.info("hidden");
    logger.report({ message: SLOW, meta: { a: 1 } });
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^droplets warning test-slow\n/), { a: 1 });
  });

  it("logs an error entry with console.error, without a meta argument when none is given", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.report({ message: BROKEN });
    expect(error.mock.calls[0]).toEqual([expect.stringMatching(/^droplets error test-broken\n/)]);
  });

  it("writes in the realm's errorFormat", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setLogLevel("warn");
    setErrorFormatter(formatHuman);
    logger.report({ message: SLOW });
    expect(warn).toHaveBeenCalledWith("droplets: slow; speed up (https://dropletsjs.dev/errors/test-slow/)");
  });

  it("prefixes progress notes, which have no code", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    setLogLevel("info");
    logger.info("build finished", { manifest: "dist/client/droplets.json" });
    expect(info).toHaveBeenCalledWith("droplets: build finished", { manifest: "dist/client/droplets.json" });
  });
});
