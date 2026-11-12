/**
 * An app answering from a worker thread of its own: a module graph and
 * globals the caller's process does not share, as a server's are not a
 * page's. The build's prerender pass and the conformance kit evaluate the
 * SSR bundle this way, so what the bundle installs (a DOM shim, custom
 * elements) stays with it. The thread exposes named handlers; a call is a
 * message, its result or error the answer. Requests and responses cross as
 * plain data (`plainRequest`, `plainResponse`).
 */
import { parentPort, SHARE_ENV, Worker } from "node:worker_threads";

/** A request as it crosses the thread boundary: the kit and the build send text bodies. */
export type PlainRequest = { url: string; method: string; headers: [string, string][]; body: string | null };

export type PlainResponse = { status: number; headers: [string, string][]; body: string };

type Call = { id: number; method: string; args: unknown[] };
type Answer = { id: number; result: unknown } | { id: number; error: string };

export type Handlers = Record<string, (...args: never[]) => Promise<unknown>>;

/** The thread's side: answers each call with the named handler's result. */
export function answer(handlers: Handlers): void {
  const port = parentPort;
  if (!port) throw new Error("droplets: answer() runs in a worker thread");
  port.on("message", async ({ id, method, args }: Call) => {
    try {
      const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
      if (!handler) throw new Error(`droplets: the thread has no "${method}"`);
      port.postMessage({ id, result: await handler(...(args as never[])) } satisfies Answer);
    } catch (error) {
      port.postMessage({ id, error: error instanceof Error ? error.message : String(error) } satisfies Answer);
    }
  });
}

type PlainRequestInput = { url: string; init?: RequestInit };

/** `url` and `init` as the thread takes them; a non-text body is dropped. */
export function plainRequest({ url, init }: PlainRequestInput): PlainRequest {
  const body = init?.body;
  return {
    url,
    method: init?.method ?? "GET",
    headers: [...new Headers(init?.headers)],
    body: typeof body === "string" ? body : body instanceof URLSearchParams ? body.toString() : null,
  };
}

type PlainResponseInput = { response: Response };

export async function plainResponse({ response }: PlainResponseInput): Promise<PlainResponse> {
  return { status: response.status, headers: [...response.headers], body: await response.text() };
}

type ToResponseInput = { plain: PlainResponse };

/** A `Response` again, in the caller's realm. */
export function toResponse({ plain }: ToResponseInput): Response {
  return new Response(plain.body || null, { status: plain.status, headers: plain.headers });
}

export type AppThread = {
  /** Calls the thread's handler `method`; rejects with what it threw. */
  call<T>(method: string, ...args: unknown[]): Promise<T>;
  /** As `call("request", plainRequest(...))`, answered as a `Response`. */
  request(url: string, init?: RequestInit): Promise<Response>;
  stop(): Promise<void>;
};

type ConnectInput = { file: string; workerData: unknown };

type Waiting = { resolve(result: unknown): void; reject(error: Error): void };

/**
 * Starts `file` in a worker thread. The environment is shared, so what the
 * caller sets in `process.env` holds there too.
 */
export function connect({ file, workerData }: ConnectInput): AppThread {
  const worker = new Worker(file, { workerData, env: SHARE_ENV });
  const pending = new Map<number, Waiting>();
  let next = 0;
  let failed: Error | undefined;
  worker.on("message", (message: Answer) => {
    const waiting = pending.get(message.id);
    pending.delete(message.id);
    if (!waiting) return;
    if ("error" in message) waiting.reject(new Error(message.error));
    else waiting.resolve(message.result);
  });
  worker.on("error", (error) => {
    failed = error;
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
  });
  function call<T>(method: string, ...args: unknown[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (failed) return reject(failed);
      const id = next++;
      pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
      worker.postMessage({ id, method, args } satisfies Call);
    });
  }
  return {
    call,
    request: async (url, init) => toResponse({ plain: await call<PlainResponse>("request", plainRequest({ url, init })) }),
    stop: async () => {
      await worker.terminate();
    },
  };
}
