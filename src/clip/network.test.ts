import { describe, expect, test } from "bun:test";
import { createServer as createHttpServer } from "node:http";
import type { Socket } from "node:net";
import { Readable } from "node:stream";

import {
  createPinnedLookup,
  createSafeFetch,
  decodeBytes,
  FetchFailure,
  isPrivateAddress,
  isPrivateHostname,
  type PinnedNetworkResponse,
  type SafeFetchOptions,
} from "./network.js";

const publicAddress = { address: "1.1.1.1", family: 4 } as const;

function fetchOptions(overrides: Partial<SafeFetchOptions> = {}): SafeFetchOptions {
  return {
    timeoutMs: 1_000,
    maxBytes: 1_024,
    allowPrivateNetwork: false,
    userAgent: "save-url-kb-network-test",
    retries: 0,
    maxRedirects: 4,
    ...overrides,
  };
}

function networkResponse(
  status: number,
  options: {
    readonly headers?: Readonly<Record<string, string>>;
    readonly chunks?: readonly Uint8Array[];
    readonly onCancel?: () => void;
  } = {},
): PinnedNetworkResponse {
  const chunks = options.chunks ?? [];
  return {
    status,
    headers: new Headers(options.headers),
    body: Readable.from(chunks),
    cancel: options.onCancel ?? (() => undefined),
  };
}

async function rejectedFetch(promise: Promise<unknown>): Promise<FetchFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FetchFailure) return error;
    throw error;
  }
  throw new Error("expected fetch to reject");
}

async function within<T>(promise: Promise<T>, label: string, timeoutMs = 1_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function createDeterministicSafeFetch(
  dependencies: NonNullable<Parameters<typeof createSafeFetch>[0]> = {},
): ReturnType<typeof createSafeFetch> {
  return createSafeFetch({
    getLocalNetworkAddresses: () => [],
    ...dependencies,
  });
}

describe("private-network boundary", () => {
  test.each([
    "0.0.0.0",
    "10.2.3.4",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "0:0:0:0:0:ffff:7f00:1",
    "::ffff:7f00:1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
  ])("rejects %s", (address) => expect(isPrivateAddress(address)).toBeTrue());

  test.each([
    "1.1.1.1",
    "8.8.8.8",
    "172.15.255.255",
    "172.32.0.0",
    "::ffff:8.8.8.8",
    "0:0:0:0:0:ffff:808:808",
    "2001:4860:4860::8888",
  ])(
    "accepts public address %s",
    (address) => expect(isPrivateAddress(address)).toBeFalse(),
  );

  test.each(["localhost", "api.localhost", "printer.local", "service.internal", "192.168.0.2", "::1", "[::1]"])(
    "recognizes private hostname %s",
    (hostname) => expect(isPrivateHostname(hostname)).toBeTrue(),
  );

  test.each(["example.com", "public.example", "x.com"])("accepts public-looking hostname %s", (hostname) => {
    expect(isPrivateHostname(hostname)).toBeFalse();
  });
});

test("decodes common response charsets", () => {
  expect(decodeBytes(new TextEncoder().encode("hello"), "text/html; charset=utf-8")).toBe("hello");
  expect(decodeBytes(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]), "text/html; charset=iso-8859-1")).toBe("café");
});

describe("pinned network transport", () => {
  test("rejects a globally routable literal assigned to a local interface", async () => {
    let transported = false;
    const fetch = createSafeFetch({
      getLocalNetworkAddresses: () => ["1.1.1.1"],
      resolveHostname: () => Promise.reject(new Error("literal targets must not resolve DNS")),
      transport: () => {
        transported = true;
        return Promise.resolve(networkResponse(200));
      },
    });

    const failure = await rejectedFetch(fetch(new URL("http://1.1.1.1/"), fetchOptions()));
    expect(failure.code).toBe("private-network");
    expect(transported).toBeFalse();
  });

  test.each([
    { answer: "1.1.1.1", family: 4 as const, local: "1.1.1.1" },
    {
      answer: "2606:4700:4700::1111",
      family: 6 as const,
      local: "2606:4700:4700:0:0:0:0:1111",
    },
    { answer: "::ffff:8.8.8.8", family: 6 as const, local: "8.8.8.8" },
  ])("rejects assigned local address $answer across equivalent IP syntax", async ({ answer, family, local }) => {
    let transported = false;
    const fetch = createSafeFetch({
      getLocalNetworkAddresses: () => [local],
      resolveHostname: () => Promise.resolve([{ address: answer, family }]),
      transport: () => {
        transported = true;
        return Promise.resolve(networkResponse(200));
      },
    });

    const failure = await rejectedFetch(fetch(new URL("http://assigned.example/"), fetchOptions()));
    expect(failure.code).toBe("private-network");
    expect(transported).toBeFalse();
  });

  test("fails closed when local interface enumeration fails", async () => {
    let resolved = false;
    const fetch = createSafeFetch({
      getLocalNetworkAddresses: () => {
        throw new Error("interface fixture failed");
      },
      resolveHostname: () => {
        resolved = true;
        return Promise.resolve([publicAddress]);
      },
      transport: () => Promise.resolve(networkResponse(200)),
    });

    const failure = await rejectedFetch(fetch(new URL("http://public.example/"), fetchOptions()));
    expect(failure.code).toBe("network");
    expect(resolved).toBeFalse();
  });

  test("snapshots the validated address instead of consulting or observing DNS again during connect", async () => {
    const mutableAnswer: { address: string; family: 4 } = { address: "1.1.1.1", family: 4 };
    const pinnedLookup = createPinnedLookup(mutableAnswer);
    mutableAnswer.address = "127.0.0.1";

    const result = await new Promise<{ readonly address: string; readonly family: number }>((resolve, reject) => {
      pinnedLookup("rebind.example", { all: false }, (error, address, family) => {
        if (error !== null) {
          reject(error);
          return;
        }
        if (Array.isArray(address) || family === undefined) {
          reject(new Error("expected one pinned DNS address"));
          return;
        }
        resolve({ address, family });
      });
    });

    expect(result).toEqual(publicAddress);
  });

  test("uses the validated public answer throughout retries even if a later resolution would rebind", async () => {
    let resolverCalls = 0;
    let transportCalls = 0;
    const fetch = createDeterministicSafeFetch({
      resolveHostname: () => {
        resolverCalls += 1;
        return Promise.resolve(resolverCalls === 1 ? [publicAddress] : [{ address: "127.0.0.1", family: 4 }]);
      },
      transport: (request) => {
        transportCalls += 1;
        expect(request.address).toEqual(publicAddress);
        return Promise.resolve(
          transportCalls === 1
            ? networkResponse(503)
            : networkResponse(200, { chunks: [new TextEncoder().encode("safe")] }),
        );
      },
    });

    const result = await fetch(new URL("http://rebind.example/post"), fetchOptions({ retries: 1 }));
    expect(new TextDecoder().decode(result.bytes)).toBe("safe");
    expect(resolverCalls).toBe(1);
    expect(transportCalls).toBe(2);
  });

  test("the Node transport connects through the supplied address without system DNS", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("pinned"),
    });
    let resolverCalls = 0;
    try {
      const fetch = createDeterministicSafeFetch({
        resolveHostname: () => {
          resolverCalls += 1;
          return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
        },
      });
      const result = await fetch(
        new URL(`http://never-resolves.invalid:${server.port}/`),
        fetchOptions({ allowPrivateNetwork: true }),
      );
      expect(new TextDecoder().decode(result.bytes)).toBe("pinned");
      expect(resolverCalls).toBe(1);
    } finally {
      await server.stop(true);
    }
  });

  test("rejects a DNS set containing any private answer before transport", async () => {
    let transported = false;
    const fetch = createDeterministicSafeFetch({
      resolveHostname: () => Promise.resolve([publicAddress, { address: "169.254.169.254", family: 4 }]),
      transport: () => {
        transported = true;
        return Promise.resolve(networkResponse(200));
      },
    });

    const failure = await rejectedFetch(fetch(new URL("http://mixed.example/"), fetchOptions()));
    expect(failure).toBeInstanceOf(FetchFailure);
    expect(failure.code).toBe("private-network");
    expect(transported).toBeFalse();
  });

  test("resolves and validates every redirect target before following it", async () => {
    const resolved: string[] = [];
    let transportCalls = 0;
    let cancelled = false;
    const fetch = createDeterministicSafeFetch({
      resolveHostname: (hostname) => {
        resolved.push(hostname);
        return Promise.resolve(
          hostname === "start.example"
            ? [publicAddress]
            : [publicAddress, { address: "127.0.0.1", family: 4 }],
        );
      },
      transport: () => {
        transportCalls += 1;
        return Promise.resolve(
          networkResponse(302, {
            headers: { Location: "http://redirect.example/private" },
            onCancel: () => {
              cancelled = true;
            },
          }),
        );
      },
    });

    const failure = await rejectedFetch(fetch(new URL("http://start.example/"), fetchOptions()));
    expect(failure.code).toBe("private-network");
    expect(resolved).toEqual(["start.example", "redirect.example"]);
    expect(transportCalls).toBe(1);
    expect(cancelled).toBeTrue();
  });

  test("never forwards a flattened Cookie header across even same-origin redirects", async () => {
    const observed: Array<{ readonly url: string; readonly cookie: string | null }> = [];
    const fetch = createDeterministicSafeFetch({
      resolveHostname: () => Promise.resolve([publicAddress]),
      transport: (request) => {
        observed.push({ url: request.url.href, cookie: request.headers.get("cookie") });
        return Promise.resolve(observed.length === 1
          ? networkResponse(302, { headers: { Location: "/other" } })
          : networkResponse(200, { chunks: [new TextEncoder().encode("ok")] }));
      },
    });

    await fetch(new URL("https://example.com/account"), fetchOptions({ cookieHeader: "session=private" }));
    expect(observed).toEqual([
      { url: "https://example.com/account", cookie: "session=private" },
      { url: "https://example.com/other", cookie: null },
    ]);
  });
});

describe("bounded requests", () => {
  test("rejects a body that crosses the byte limit and cancels it", async () => {
    let cancelled = false;
    const fetch = createDeterministicSafeFetch({
      resolveHostname: () => Promise.resolve([publicAddress]),
      transport: () => Promise.resolve(
        networkResponse(200, {
          chunks: [new TextEncoder().encode("123"), new TextEncoder().encode("456")],
          onCancel: () => {
            cancelled = true;
          },
        }),
      ),
    });

    const failure = await rejectedFetch(fetch(new URL("http://large.example/"), fetchOptions({ maxBytes: 5 })));
    expect(failure.code).toBe("too-large");
    expect(cancelled).toBeTrue();
  });

  test("rejects an oversized declared content length before reading", async () => {
    let cancelled = false;
    const fetch = createDeterministicSafeFetch({
      resolveHostname: () => Promise.resolve([publicAddress]),
      transport: () => Promise.resolve(
        networkResponse(200, {
          headers: { "Content-Length": "200" },
          chunks: [new TextEncoder().encode("small")],
          onCancel: () => {
            cancelled = true;
          },
        }),
      ),
    });

    const failure = await rejectedFetch(
      fetch(new URL("http://declared-large.example/"), fetchOptions({ maxBytes: 10 })),
    );
    expect(failure.code).toBe("too-large");
    expect(cancelled).toBeTrue();
  });

  test("collects one million tiny chunks without retaining the chunk objects", async () => {
    const chunkCount = 1_000_000;
    const fetch = createDeterministicSafeFetch({
      resolveHostname: () => Promise.resolve([publicAddress]),
      transport: () => Promise.resolve({
        status: 200,
        headers: new Headers(),
        body: (async function* tinyChunks(): AsyncGenerator<Uint8Array> {
          await Promise.resolve();
          for (let index = 0; index < chunkCount; index += 1) {
            yield new Uint8Array([index & 0xff]);
          }
        })(),
        cancel: () => undefined,
      }),
    });

    const result = await fetch(
      new URL("http://tiny-chunks.example/"),
      fetchOptions({ maxBytes: chunkCount, timeoutMs: 5_000 }),
    );
    expect(result.bytes).toHaveLength(chunkCount);
    expect(result.bytes[0]).toBe(0);
    expect(result.bytes[chunkCount - 1]).toBe(63);
  }, 10_000);

  test("aborts a connection at the overall deadline", async () => {
    const fetch = createDeterministicSafeFetch({
      resolveHostname: () => Promise.resolve([publicAddress]),
      transport: (request) => new Promise((_resolve, reject) => {
        const rejectOnAbort = (): void => {
          const reason: unknown = request.signal.reason;
          reject(reason instanceof Error ? reason : new Error("request aborted"));
        };
        if (request.signal.aborted) rejectOnAbort();
        else request.signal.addEventListener("abort", rejectOnAbort, { once: true });
      }),
    });

    const failure = await rejectedFetch(fetch(new URL("http://slow.example/"), fetchOptions({ timeoutMs: 20 })));
    expect(failure.code).toBe("timeout");
  });

  test("the production transport closes its accepted socket when the request deadline wins", async () => {
    const sockets = new Set<Socket>();
    let accepted: (() => void) | null = null;
    let upstreamClosed: (() => void) | null = null;
    const acceptedPromise = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    const upstreamClosedPromise = new Promise<void>((resolve) => {
      upstreamClosed = resolve;
    });
    const server = createHttpServer((request) => {
      accepted?.();
      request.socket.once("close", () => upstreamClosed?.());
      // Intentionally leave the response pending beyond the client deadline.
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("fixture did not bind TCP");
      const fetch = createSafeFetch({
        getLocalNetworkAddresses: () => [],
        resolveHostname: () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
      });
      const requestFailure = rejectedFetch(
        fetch(
          new URL(`http://deadline.invalid:${address.port}/`),
          fetchOptions({ allowPrivateNetwork: true, timeoutMs: 100 }),
        ),
      );
      await within(acceptedPromise, "the production transport fixture to accept a request");
      const failure = await requestFailure;
      expect(failure.code).toBe("timeout");
      await within(upstreamClosedPromise, "the aborted transport socket to close");
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
