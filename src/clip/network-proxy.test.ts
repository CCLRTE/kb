import { afterEach, describe, expect, test } from "bun:test";
import { createServer as createHttpServer, request as requestHttp } from "node:http";
import {
  Socket,
  connect as connectTcp,
  createServer as createTcpServer,
  type Server as TcpServer,
} from "node:net";

import { startNetworkProxy, type LocalNetworkProxy } from "./network-proxy.js";

const proxies: LocalNetworkProxy[] = [];
const tcpServers: TcpServer[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  await Promise.all(tcpServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function rawProxyRequest(port: number, request: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = connectTcp({ host: "127.0.0.1", port });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const value = Buffer.concat(chunks).toString("utf8");
      socket.destroy();
      resolve(value);
    };
    const timeout = setTimeout(finish, 1_500);
    socket.once("connect", () => socket.write(request));
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const value = Buffer.concat(chunks).toString("utf8");
      if (/\r\nContent-Length: 0\r\n\r\n/i.test(value)) finish();
    });
    socket.once("error", reject);
    socket.once("close", finish);
  });
}

async function listenTcp(server: TcpServer): Promise<number> {
  tcpServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture did not bind TCP");
  return address.port;
}

async function promptly(promise: Promise<unknown>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 1_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function startSlowHttpTarget(): Promise<{ readonly port: number; readonly upstreamClosed: Promise<void> }> {
  let resolveUpstreamClosed: (() => void) | undefined;
  const upstreamClosed = new Promise<void>((resolve) => {
    resolveUpstreamClosed = resolve;
  });
  const target = createHttpServer((request, response) => {
    const interval = setInterval(() => response.write("."), 25);
    request.socket.once("close", () => {
      clearInterval(interval);
      resolveUpstreamClosed?.();
    });
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.write("streaming");
  });
  const port = await listenTcp(target);
  return { port, upstreamClosed };
}

async function openSlowProxyStream(proxyPort: number, targetPort: number): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = connectTcp({ host: "127.0.0.1", port: proxyPort });
    let received = "";
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error("timed out waiting for slow proxy response")), 1_000);
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.write(
        `GET http://slow.invalid:${targetPort}/stream HTTP/1.1\r\nHost: slow.invalid:${targetPort}\r\nConnection: close\r\n\r\n`,
      );
    });
    socket.on("data", (chunk: Buffer) => {
      if (settled) return;
      received += chunk.toString("utf8");
      if (!received.includes("streaming")) return;
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    });
  });
}

describe("network egress proxy", () => {
  test("denies literal and DNS-resolved private CONNECT destinations by default", async () => {
    const proxy = await startNetworkProxy({
      allowPrivateNetwork: false,
      timeoutMs: 1_000,
      resolveHostname: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
    });
    proxies.push(proxy);

    const literal = await rawProxyRequest(
      proxy.port,
      "CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n",
    );
    const resolved = await rawProxyRequest(
      proxy.port,
      "CONNECT public-looking.example:443 HTTP/1.1\r\nHost: public-looking.example:443\r\n\r\n",
    );
    expect(literal).toStartWith("HTTP/1.1 403 Forbidden");
    expect(resolved).toStartWith("HTTP/1.1 403 Forbidden");
    expect(literal).not.toContain("127.0.0.1");
    expect(resolved).not.toContain("public-looking.example");
  });

  test("rejects a mixed DNS set before opening a CONNECT tunnel", async () => {
    let accepted = false;
    const targetPort = await listenTcp(createTcpServer(() => {
      accepted = true;
    }));
    const proxy = await startNetworkProxy({
      allowPrivateNetwork: false,
      timeoutMs: 1_000,
      resolveHostname: () => Promise.resolve([
        { address: "1.1.1.1", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    });
    proxies.push(proxy);

    const response = await rawProxyRequest(
      proxy.port,
      `CONNECT mixed.example:${targetPort} HTTP/1.1\r\nHost: mixed.example:${targetPort}\r\n\r\n`,
    );
    expect(response).toStartWith("HTTP/1.1 403 Forbidden");
    expect(accepted).toBeFalse();
  });

  test("relays absolute-form HTTP through only the validated pinned address", async () => {
    let observedPath: string | undefined;
    let observedHost: string | undefined;
    let observedProxyAuthorization: string | string[] | undefined;
    const target = createHttpServer((request, response) => {
      observedPath = request.url;
      observedHost = request.headers.host;
      observedProxyAuthorization = request.headers["proxy-authorization"];
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.once("end", () => response.end(`received:${Buffer.concat(chunks).toString("utf8")}`));
    });
    await new Promise<void>((resolve, reject) => {
      target.once("error", reject);
      target.listen(0, "127.0.0.1", () => resolve());
    });
    tcpServers.push(target);
    const address = target.address();
    if (address === null || typeof address === "string") throw new Error("fixture did not bind HTTP");

    let resolverCalls = 0;
    const proxy = await startNetworkProxy({
      allowPrivateNetwork: true,
      timeoutMs: 2_000,
      resolveHostname: (hostname) => {
        resolverCalls += 1;
        expect(hostname).toBe("unresolvable.invalid");
        return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
      },
    });
    proxies.push(proxy);

    const body = await new Promise<string>((resolve, reject) => {
      const request = requestHttp({
        host: "127.0.0.1",
        port: proxy.port,
        method: "POST",
        path: `http://unresolvable.invalid:${address.port}/path?q=1`,
        headers: {
          "Content-Length": "7",
          "Proxy-Authorization": "Basic do-not-forward",
        },
      });
      const chunks: Buffer[] = [];
      request.once("response", (response) => {
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
      request.once("error", reject);
      request.end("payload");
    });
    expect(body).toBe("received:payload");
    expect(observedPath).toBe("/path?q=1");
    expect(observedHost).toStartWith("unresolvable.invalid:");
    expect(observedProxyAuthorization).toBeUndefined();
    expect(resolverCalls).toBe(1);
  });

  test("relays CONNECT bytes through a pinned address and closes active tunnels cleanly", async () => {
    const targetPort = await listenTcp(createTcpServer((socket) => socket.pipe(socket)));
    const proxy = await startNetworkProxy({
      allowPrivateNetwork: true,
      timeoutMs: 2_000,
      resolveHostname: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
    });
    proxies.push(proxy);

    const client = connectTcp({ host: "127.0.0.1", port: proxy.port });
    const received: Buffer[] = [];
    let wake: (() => void) | null = null;
    client.on("data", (chunk: Buffer) => {
      received.push(chunk);
      wake?.();
    });
    const waitFor = async (pattern: string): Promise<void> => {
      const deadline = Date.now() + 2_000;
      while (!Buffer.concat(received).toString("utf8").includes(pattern)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`timed out waiting for ${pattern}`);
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, remaining);
          wake = () => {
            clearTimeout(timeout);
            resolve();
          };
        });
        wake = null;
      }
    };
    await new Promise<void>((resolve, reject) => {
      client.once("error", reject);
      client.once("connect", () => {
        client.write(`CONNECT tunnel.invalid:${targetPort} HTTP/1.1\r\nHost: tunnel.invalid:${targetPort}\r\n\r\n`);
        resolve();
      });
    });
    await waitFor("200 Connection Established");
    expect(Buffer.concat(received).toString("utf8")).toStartWith("HTTP/1.1 200 Connection Established");
    client.write("ping");
    await waitFor("ping");
    expect(Buffer.concat(received).toString("utf8")).toEndWith("ping");

    const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
    await proxy.close();
    await closed;
    proxies.splice(proxies.indexOf(proxy), 1);
  });

  test("closes a slow absolute-form HTTP upstream when the proxy closes", async () => {
    const closingTarget = await startSlowHttpTarget();
    const closingProxy = await startNetworkProxy({
      allowPrivateNetwork: true,
      timeoutMs: 5_000,
      resolveHostname: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
    });
    proxies.push(closingProxy);

    const closingClient = await openSlowProxyStream(closingProxy.port, closingTarget.port);
    const downstreamClosed = new Promise<void>((resolve) => closingClient.once("close", () => resolve()));
    await promptly(
      Promise.all([closingProxy.close(), closingTarget.upstreamClosed, downstreamClosed]),
      "proxy and active HTTP stream close",
    );
    proxies.splice(proxies.indexOf(closingProxy), 1);
  });

  test("does not create a late HTTP upstream after closing during DNS resolution", async () => {
    let accepted = false;
    const targetPort = await listenTcp(createHttpServer((_request, response) => {
      accepted = true;
      response.end("unexpected");
    }));
    let resolveDns: ((addresses: readonly [{ readonly address: "127.0.0.1"; readonly family: 4 }]) => void) | undefined;
    let markDnsStarted: (() => void) | undefined;
    const dnsStarted = new Promise<void>((resolve) => {
      markDnsStarted = resolve;
    });
    const resolution = new Promise<readonly [{ readonly address: "127.0.0.1"; readonly family: 4 }]>(
      (resolve) => {
        resolveDns = resolve;
      },
    );
    const proxy = await startNetworkProxy({
      allowPrivateNetwork: true,
      timeoutMs: 5_000,
      resolveHostname: () => {
        markDnsStarted?.();
        return resolution;
      },
    });
    proxies.push(proxy);

    const client = connectTcp({ host: "127.0.0.1", port: proxy.port });
    client.on("error", () => undefined);
    const clientClosed = new Promise<void>((resolve) => client.once("close", () => resolve()));
    client.once("connect", () => {
      client.write(
        `GET http://pending-http.invalid:${targetPort}/ HTTP/1.1\r\nHost: pending-http.invalid:${targetPort}\r\n\r\n`,
      );
    });
    await dnsStarted;
    await promptly(Promise.all([proxy.close(), clientClosed]), "proxy close during HTTP resolution");
    resolveDns?.([{ address: "127.0.0.1", family: 4 }]);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));

    expect(accepted).toBeFalse();
    proxies.splice(proxies.indexOf(proxy), 1);
  });

  test("cancels an in-flight CONNECT attempt without trying another address", async () => {
    let connectCalls = 0;
    let resolvePending: ((socket: Socket) => void) | undefined;
    const pending = new Promise<Socket>((resolve) => {
      resolvePending = resolve;
    });
    const proxy = await startNetworkProxy({
      allowPrivateNetwork: true,
      timeoutMs: 5_000,
      resolveHostname: () => Promise.resolve([
        { address: "192.0.2.1", family: 4 },
        { address: "192.0.2.2", family: 4 },
      ]),
      connectAddress: () => {
        connectCalls += 1;
        const socket = new Socket();
        resolvePending?.(socket);
        return socket;
      },
    });
    proxies.push(proxy);

    const client = connectTcp({ host: "127.0.0.1", port: proxy.port });
    client.on("error", () => undefined);
    const clientClosed = new Promise<void>((resolve) => client.once("close", () => resolve()));
    client.once("connect", () => {
      client.write("CONNECT pending.invalid:443 HTTP/1.1\r\nHost: pending.invalid:443\r\n\r\n");
    });
    const candidate = await pending;
    await promptly(Promise.all([proxy.close(), clientClosed]), "pending CONNECT cancellation");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(candidate.destroyed).toBeTrue();
    expect(connectCalls).toBe(1);
    proxies.splice(proxies.indexOf(proxy), 1);
  });

  test("caps CONNECT attempts across an oversized DNS answer", async () => {
    let connectCalls = 0;
    const proxy = await startNetworkProxy({
      allowPrivateNetwork: true,
      timeoutMs: 2_000,
      resolveHostname: () => Promise.resolve(
        Array.from({ length: 32 }, (_value, index) => ({
          address: `192.0.2.${index + 1}`,
          family: 4 as const,
        })),
      ),
      connectAddress: () => {
        connectCalls += 1;
        const socket = new Socket();
        queueMicrotask(() => socket.destroy(new Error("fixture connect failure")));
        return socket;
      },
    });
    proxies.push(proxy);

    const response = await rawProxyRequest(
      proxy.port,
      "CONNECT many.invalid:443 HTTP/1.1\r\nHost: many.invalid:443\r\n\r\n",
    );
    expect(response).toStartWith("HTTP/1.1 502 Bad Gateway");
    expect(connectCalls).toBe(16);
  });

  test("bounds request bodies and DNS resolution time", async () => {
    const bodyProxy = await startNetworkProxy({
      allowPrivateNetwork: true,
      timeoutMs: 1_000,
      maxRequestBodyBytes: 4,
      resolveHostname: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
    });
    proxies.push(bodyProxy);
    const oversized = await rawProxyRequest(
      bodyProxy.port,
      "POST http://target.invalid/ HTTP/1.1\r\nHost: target.invalid\r\nContent-Length: 5\r\n\r\n12345",
    );
    expect(oversized).toStartWith("HTTP/1.1 413 Payload Too Large");

    const timeoutProxy = await startNetworkProxy({
      allowPrivateNetwork: false,
      timeoutMs: 50,
      resolveHostname: () => new Promise(() => undefined),
    });
    proxies.push(timeoutProxy);
    const timedOut = await rawProxyRequest(
      timeoutProxy.port,
      "CONNECT never-resolves.example:443 HTTP/1.1\r\nHost: never-resolves.example:443\r\n\r\n",
    );
    expect(timedOut).toStartWith("HTTP/1.1 504 Gateway Timeout");
  });

  test("rejects malformed CONNECT authorities without reflecting them", async () => {
    const proxy = await startNetworkProxy({ allowPrivateNetwork: false, timeoutMs: 1_000 });
    proxies.push(proxy);
    const response = await rawProxyRequest(
      proxy.port,
      "CONNECT user:secret@example.com:443 HTTP/1.1\r\nHost: example.com\r\n\r\n",
    );
    expect(response).toStartWith("HTTP/1.1 403 Forbidden");
    expect(response).not.toContain("secret");
  });
});
