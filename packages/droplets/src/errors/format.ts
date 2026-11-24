/**
 * Every message the framework writes, an error it throws or a warning it
 * logs, comes from an entry of the registry (`errors/*.ts`): a stable code,
 * what happened and the fix, with a page at dropletsjs.dev/errors/<code>.
 * `errorFormat` picks how it reads: `agent`, a block of labelled lines, or
 * `human`, one line.
 *
 * Each realm sets its formatter once: the plugin when it loads the config,
 * `createDropletsApp`, the SSR bundle and the browser registry from the
 * build. Anything that runs before, or with no config at all, writes the
 * agent format.
 *
 * @module
 */

export type ErrorLevel = "error" | "warning";

/** See `DropletsConfig["errorFormat"]`. */
export type ErrorFormat = "agent" | "human";

/** The values `errorFormat` takes. */
export const ERROR_FORMATS = ["agent", "human"] as const;

type Text<P> = string | ((params: P) => string);

/** One registry entry: `what` and `fix` take the message's parameters. */
export type Message<P> = {
  readonly code: string;
  readonly level: ErrorLevel;
  readonly what: Text<P>;
  readonly fix: Text<P>;
};

/** Any entry, whatever its parameters. */
export type AnyMessage = Message<never>;

/** What a page of dropletsjs.dev/errors says beyond the entry. */
export type ErrorPage = {
  /** When the message comes: which command or request, on which side. */
  readonly when: string;
  /** A root-relative docs path that explains more, `/guides/security/#trusting-any-location`. */
  readonly see?: string;
};

export type ErrorPages = Readonly<Record<string, ErrorPage>>;

type ParamsOf<M> = M extends { what: (params: infer P) => string } ? P : M extends { fix: (params: infer P) => string } ? P : undefined;

/** A message with its parameters, and the droplet and file it is about when known. */
export type MessageInput<M extends AnyMessage> = {
  message: M;
  droplet?: string | undefined;
  file?: string | undefined;
} & (ParamsOf<M> extends undefined ? { params?: undefined } : { params: ParamsOf<M> });

/** A message with its text filled in, what a formatter writes. */
export type Report = {
  code: string;
  level: ErrorLevel;
  what: string;
  fix: string;
  droplet?: string | undefined;
  file?: string | undefined;
};

export type Formatter = (report: Report) => string;

/** Where every code has its page. */
export const ERRORS_URL = "https://dropletsjs.dev/errors/";

/** Labelled lines, the page's Markdown twin last. */
export function formatAgent({ code, level, what, fix, droplet, file }: Report): string {
  const field = (name: string, value: string) => `  ${name}: ${value.replaceAll("\n", "\n    ")}`;
  return [
    `droplets ${level} ${code}`,
    ...(droplet === undefined ? [] : [field("droplet", droplet)]),
    ...(file === undefined ? [] : [field("file", file)]),
    field("what", what),
    field("fix", fix),
    field("docs", `${ERRORS_URL}${code}.md`),
  ].join("\n");
}

/** One line: where, what, the fix, the page. */
export function formatHuman({ code, what, fix, droplet, file }: Report): string {
  const where = [droplet, file].filter((part) => part !== undefined).map((part) => `${part}: `);
  return `droplets: ${where.join("")}${what}; ${fix} (${ERRORS_URL}${code}/)`;
}

let formatter: Formatter = formatAgent;

/** The realm's formatter: `formatterOf` on the server and in the plugin, the build's choice in the browser. */
export function setErrorFormatter(next: Formatter): void {
  formatter = next;
}

export type FormatterOfInput = { format: ErrorFormat };

export function formatterOf({ format }: FormatterOfInput): Formatter {
  return format === "human" ? formatHuman : formatAgent;
}

type TextOfInput<P> = { text: Text<P>; params: P };

function textOf<P>({ text, params }: TextOfInput<P>): string {
  return typeof text === "function" ? text(params) : text;
}

/** The message as the realm's `errorFormat` writes it. */
export function formatMessage<M extends AnyMessage>(input: MessageInput<M>): string {
  const { message, droplet, file } = input;
  const params = input.params as never;
  return formatter({
    code: message.code,
    level: message.level,
    what: textOf({ text: message.what, params }),
    fix: textOf({ text: message.fix, params }),
    droplet,
    file,
  });
}

/** An `Error` carrying the message's `code`. */
export type DropletsError = Error & { code: string };

export type DropletsErrorInput<M extends AnyMessage> = MessageInput<M> & { cause?: unknown };

/** The `Error` to throw for a message: formatted, with `code`, and `cause` when given. */
export function dropletsError<M extends AnyMessage>(input: DropletsErrorInput<M>): DropletsError {
  const error = new Error(formatMessage(input), input.cause === undefined ? undefined : { cause: input.cause });
  return Object.assign(error, { code: input.message.code });
}
