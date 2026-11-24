/**
 * The logger of `vite dev` and `vite build` (`vite/`, `core/`). Runtime code
 * reaches it only behind `import.meta.env.DEV` or through `runtime/dev-log.ts`,
 * so production bundles hold none of it: in production the runtime logs only
 * errors, with `console.error`.
 *
 * An error or a warning is a registry entry, written in the realm's
 * `errorFormat`; `info` and `debug` are progress notes, with no code.
 *
 * @module
 */
import { type AnyMessage, formatMessage, type MessageInput } from "../errors/format.ts";

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const DEFAULT_LEVEL: LogLevel = "info";

export type ResolveLevelInput = { raw: string | undefined };

type EmitInput = { level: LogLevel; text: string; meta?: unknown };

/** Reads `DEV_DROPLETS_LOG`; anything unrecognised falls back to `info`. */
export function resolveLevel({ raw }: ResolveLevelInput): LogLevel {
  const value = raw?.toLowerCase();
  return value && value in LEVELS ? (value as LogLevel) : DEFAULT_LEVEL;
}

// Read on first use, not at load: a module with no top-level work tree-shakes out of production bundles.
let currentLevel: LogLevel | undefined;

/** Mostly for tests; otherwise `DEV_DROPLETS_LOG` is read once, on the first message. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  currentLevel ??= resolveLevel({ raw: typeof process === "undefined" ? undefined : process.env["DEV_DROPLETS_LOG"] });
  return currentLevel;
}

function emit({ level, text, meta }: EmitInput): void {
  if (LEVELS[level] > LEVELS[getLogLevel()]) return;
  if (meta === undefined) {
    console[level](text);
  } else {
    console[level](text, meta);
  }
}

/** A registry entry with its parameters, and what to log after it. */
export type LogReportInput<M extends AnyMessage> = MessageInput<M> & { meta?: unknown };

export const logger = {
  /** An error or a warning, by the entry's `level`. */
  report: <M extends AnyMessage>(input: LogReportInput<M>): void =>
    emit({ level: input.message.level === "error" ? "error" : "warn", text: formatMessage(input), meta: input.meta }),
  info: (message: string, meta?: unknown): void => emit({ level: "info", text: `droplets: ${message}`, meta }),
  debug: (message: string, meta?: unknown): void => emit({ level: "debug", text: `droplets: ${message}`, meta }),
};
