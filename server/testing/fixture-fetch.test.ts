import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureFetch } from "./fixture-fetch.ts";

describe("fixtureFetch", () => {
  const servers: Server[] = [];

  const listen = async (server: Server): Promise<string> => {
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps polling a live fixture when a reused connection would reset", async () => {
    const seen = new WeakSet<Socket>();
    let requests = 0;
    let resets = 0;
    const server = createServer((request, response) => {
      requests += 1;
      if (seen.has(request.socket)) {
        resets += 1;
        request.socket.resetAndDestroy();
        return;
      }
      seen.add(request.socket);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ sequence: requests }));
    });
    const url = await listen(server);

    for (let index = 1; index <= 4; index += 1) {
      const response = await fixtureFetch(`${url}/api/bots`);
      expect(await response.json()).toEqual({ sequence: index });
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }

    expect(server.listening).toBe(true);
    expect(requests).toBe(4);
    expect(resets).toBe(0);
  });

  it("preserves request fields and HTTP errors without retrying", async () => {
    let requests = 0;
    let received: unknown;
    const server = createServer(async (request, response) => {
      requests += 1;
      let body = "";
      for await (const chunk of request) body += chunk;
      received = { method: request.method, contentType: request.headers["content-type"], marker: request.headers["x-fixture"], body };
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"error":"fixture unavailable"}');
    });
    const url = await listen(server);

    const response = await fixtureFetch(`${url}/api/bots`, {
      method: "POST", headers: { "content-type": "application/json", "x-fixture": "synthetic" }, body: '{"name":"Fixture"}',
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "fixture unavailable" });
    expect(received).toEqual({ method: "POST", contentType: "application/json", marker: "synthetic", body: '{"name":"Fixture"}' });
    expect(requests).toBe(1);
  });

  it("propagates a connection reset after a mutation without replaying it", async () => {
    let mutations = 0;
    const server = createServer(async (request) => {
      for await (const _ of request) {}
      mutations += 1;
      request.socket.resetAndDestroy();
    });
    const url = await listen(server);

    await expect(fixtureFetch(`${url}/api/bots`, { method: "POST", body: "synthetic mutation" })).rejects.toThrow("fetch failed");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(mutations).toBe(1);
    expect(server.listening).toBe(true);
  });
});
