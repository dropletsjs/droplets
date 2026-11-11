export type LogLevel = "error" | "warn" | "info" | "debug";

/** Where a message came from: the framework itself, or user droplet code. */
export type LogSource = "framework" | "drop";

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const DEFAULT_LEVEL: LogLevel = "info";

export type ResolveLevelInput = { raw: string | undefined };

type EmitInput = { level: LogLevel; source: LogSource; message: string; meta?: unknown };

/** Reads `DROPLETS_LOG`; anything unrecognised falls back to `info`. */
export function resolveLevel({ raw }: ResolveLevelInput): LogLevel {
  const value = raw?.toLowerCase();
  return value && value in LEVELS ? (value as LogLevel) : DEFAULT_LEVEL;
}

let currentLevel = resolveLevel({ raw: typeof process === "undefined" ? undefined : process.env["DROPLETS_LOG"] });

/** Mostly for tests; production reads `DROPLETS_LOG` once at startup. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function emit({ level, source, message, meta }: EmitInput): void {
  if (LEVELS[level] > LEVELS[currentLevel]) return;
  const prefix = `[droplets:${source}]`;
  if (meta === undefined) {
    console[level](`${prefix} ${message}`);
  } else {
    console[level](`${prefix} ${message}`, meta);
  }
}

export const logger = {
  error: (source: LogSource, message: string, meta?: unknown): void => emit({ level: "error", source, message, meta }),
  warn: (source: LogSource, message: string, meta?: unknown): void => emit({ level: "warn", source, message, meta }),
  info: (source: LogSource, message: string, meta?: unknown): void => emit({ level: "info", source, message, meta }),
  debug: (source: LogSource, message: string, meta?: unknown): void => emit({ level: "debug", source, message, meta }),
};
