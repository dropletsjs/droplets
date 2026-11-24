import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { freePort } from "../vitest.ts";

const held: Server[] = [];

afterEach(async () => {
  await Promise.all(held.splice(0).map((server) => new Promise((done) => server.close(done))));
});

type HoldInput = { port: number; host: string };

/** Listens on `host:port` alone, as an editor's or a tool's local server does; false when it cannot. */
function hold({ port, host }: HoldInput): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen(port, host, () => {
      held.push(server);
      done(true);
    });
  });
}

describe("freePort", () => {
  it("never gives a port another server holds on 127.0.0.1 or ::1 alone", async () => {
    // macOS hands out ports in order: the ones after a probe are those the next probes get.
    const start = await freePort();
    const taken = new Set<number>();
    for (let port = start + 1; port <= Math.min(start + 20, 65_535); port++) {
      if (await hold({ port, host: port % 2 === 0 ? "::1" : "127.0.0.1" })) taken.add(port);
    }
    for (let i = 0; i < 5; i++) expect(taken).not.toContain(await freePort());
  });
});
