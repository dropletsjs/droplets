/**
 * The pages allowed to embed the demo's droplets and post to them: the docs
 * site, and the docs on their local dev and preview servers. Nothing else:
 * no `*`, no pattern. Exact origins, compared as such.
 */
export const DOCS_ORIGINS = [
  "https://dropletsjs.dev",
  "http://localhost:4321",
  "http://127.0.0.1:4321",
] as const;

/**
 * DOCS_ORIGINS, plus the docs' dev server when it runs on another port:
 * `pnpm docs:dev --port 4400` starts the demo's dev server with
 * `DOCS_PORT=4400` (apps/docs/scripts/dev.mjs), and this adds
 * `http://localhost:4400` and `http://127.0.0.1:4400`. Nothing else sets
 * DOCS_PORT, so the builds, the Worker and the Node server trust
 * DOCS_ORIGINS alone. A value that is not a port is ignored.
 */
export function docsOrigins(): string[] {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const port = Number(env?.["DOCS_PORT"]);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535 || port === 4321) return [...DOCS_ORIGINS];
  return [...DOCS_ORIGINS, `http://localhost:${port}`, `http://127.0.0.1:${port}`];
}
