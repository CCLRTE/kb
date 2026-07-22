import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";

import {
  acquireBrowser,
  assertSafePersistentProfile,
  browserExpansionLimits,
  browserExpansionScript,
  browserExpansionStayedOnPage,
  browserExpansionWarnings,
  browserNavigationReachedTarget,
  browserCookieCommands,
  browserProxyArguments,
  seedOwnedBrowserCookies,
  createCookieHeaderReader,
  isSafeExpansionControlLabel,
  isolatedAgentBrowserEnvironment,
  readBrowserExpansionTelemetry,
  type BrowserExpansionLimits,
  type BrowserExpansionTelemetry,
} from "./acquire.js";
import type { CaptureArguments } from "./args.js";

const temporaryDirectories: string[] = [];

type FakeBrowserElement = {
  readonly localName: string;
  readonly textContent: string;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { readonly width: number; readonly height: number };
  click(): void;
};

function fakeControl(label: string, onClick: () => void, localName = "button"): FakeBrowserElement {
  return {
    localName,
    textContent: label,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    click: onClick,
  };
}

async function executeExpansionScript(
  limits: BrowserExpansionLimits,
  document: object,
): Promise<BrowserExpansionTelemetry> {
  const result: unknown = runInNewContext(browserExpansionScript(limits), {
    document,
    window: { scrollTo: () => undefined },
    setTimeout: (callback: () => void) => callback(),
  });
  const telemetry = readBrowserExpansionTelemetry(await Promise.resolve(result), limits);
  if (telemetry === null) throw new Error("expansion test script returned invalid telemetry");
  return telemetry;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function cookieOptions(cookieFile: string): CaptureArguments {
  return {
    command: "inspect",
    url: new URL("https://example.com/account"),
    slug: undefined,
    mode: "http",
    scope: "page",
    media: "none",
    evidence: "none",
    htmlFile: undefined,
    outputBase: "kb/articles",
    force: false,
    stdout: true,
    json: false,
    quiet: true,
    browserProfile: undefined,
    browserLive: false,
    cdp: undefined,
    trustAttachedBrowserEgress: false,
    cookieSources: [],
    cookieProfile: undefined,
    cookiesFile: cookieFile,
    timeoutMs: 1_000,
    maxItems: 10,
    maxDepth: 4,
    maxHtmlBytes: 1_024,
    maxAssetBytes: 1_024,
    maxTotalAssetBytes: 2_048,
    allowPrivateNetwork: false,
    userAgent: "test",
  };
}

test("fresh-browser cookie commands preserve host, path, Secure, HttpOnly, SameSite, and expiry", () => {
  expect(browserCookieCommands([{
    name: "session",
    value: "private",
    domain: "sub.example.com",
    hostOnly: true,
    path: "/account",
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
    expires: 4_102_444_800,
  }, {
    name: "parent",
    value: "value",
    domain: "example.com",
    hostOnly: false,
    path: "/",
    secure: false,
    httpOnly: false,
    sameSite: null,
    expires: 0,
  }], new URL("https://sub.example.com/account/page"))).toEqual([
    ["cookies", "set", "session", "private", "--url", "https://sub.example.com", "--path", "/account", "--httpOnly", "--secure", "--sameSite", "Strict", "--expires", "4102444800"],
    ["cookies", "set", "parent", "value", "--domain", ".example.com", "--path", "/"],
  ]);
});

test("owned profile cookie seeding filters the exact target before submitting stdin-only browser commands", async () => {
  const options: CaptureArguments = {
    ...cookieOptions("unused"),
    url: new URL("https://social.example/account/thread?id=1"),
    mode: "browser",
    browserProfile: "/private/owned-clone",
    browserProfileOwnership: "owned",
    cookieSources: ["arc"],
    cookieProfile: "Profile 1",
    cookiesFile: undefined,
  };
  const events: string[] = [];
  const warnings = await seedOwnedBrowserCookies(
    options,
    ["--session", "test"],
    { cwd: "/private", environment: {}, timeoutMs: 1_000, maxOutputBytes: 4_096 },
    {
      readCookies: (selected, target) => {
        events.push("read-filtered-cookies");
        expect(selected.cookieSources).toEqual(["arc"]);
        expect(selected.cookieProfile).toBe("Profile 1");
        expect(target.href).toBe("https://social.example/account/thread?id=1");
        return Promise.resolve({
          cookies: [{
            name: "session",
            value: "private",
            domain: "social.example",
            hostOnly: true,
            path: "/account",
            secure: true,
            httpOnly: true,
            sameSite: "Lax",
            expires: 0,
          }],
          warnings: ["filtered one unrelated cookie"],
        });
      },
      runBatch: (globalArgs, commands) => {
        events.push("submit-cookie-batch");
        expect(globalArgs).toEqual(["--session", "test"]);
        expect(commands).toEqual([[
          "cookies", "set", "session", "private",
          "--url", "https://social.example",
          "--path", "/account",
          "--httpOnly",
          "--secure",
          "--sameSite", "Lax",
        ]]);
        return Promise.resolve();
      },
    },
  );
  expect(events).toEqual(["read-filtered-cookies", "submit-cookie-batch"]);
  expect(warnings).toHaveLength(2);
  expect(warnings[0]).toBe("filtered one unrelated cookie");
  expect(warnings[1]).toContain("Seeded explicitly selected cookies into the owned browser");
});

describe("browser thread expansion controls", () => {
  test.each([
    "Show more",
    "View 20 replies",
    "Load more comments",
    "See this thread",
    "Read 1.2K replies",
  ])("allows explicit non-mutating disclosure label %j", (label) => {
    expect(isSafeExpansionControlLabel(label)).toBeTrue();
  });

  test.each([
    "Continue",
    "Continue to checkout",
    "Show",
    "View profile",
    "Read article",
    "Follow",
    "Like",
    "Repost",
    "Delete",
  ])("rejects ambiguous or state-changing label %j", (label) => {
    expect(isSafeExpansionControlLabel(label)).toBeFalse();
  });

  test("derives useful work budgets with fixed hard ceilings", () => {
    expect(browserExpansionLimits(1)).toEqual({
      maxScrolls: 3,
      maxVisitedElements: 2_048,
      maxClicks: 16,
    });
    expect(browserExpansionLimits(500)).toEqual({
      maxScrolls: 25,
      maxVisitedElements: 16_000,
      maxClicks: 250,
    });
    expect(browserExpansionLimits(Number.POSITIVE_INFINITY)).toEqual(browserExpansionLimits(500));
    expect(browserExpansionLimits(1_000_000)).toEqual({
      maxScrolls: 40,
      maxVisitedElements: 50_000,
      maxClicks: 256,
    });
  });

  test("bounds DOM traversal without materializing an attacker-sized control collection", async () => {
    const limits = browserExpansionLimits(1);
    let nextCalls = 0;
    const telemetry = await executeExpansionScript(limits, {
      documentElement: { scrollHeight: 100 },
      createTreeWalker: () => ({
        nextNode: () => {
          nextCalls += 1;
          return {
            localName: "div",
            textContent: "",
            getAttribute: () => null,
          };
        },
      }),
    });

    expect(browserExpansionScript(limits)).not.toContain("Array.from");
    expect(browserExpansionScript(limits)).not.toContain("querySelectorAll");
    expect(nextCalls).toBe(limits.maxVisitedElements);
    expect(telemetry).toMatchObject({
      visitedElements: limits.maxVisitedElements,
      clicks: 0,
      elementBudgetReached: true,
      clickBudgetReached: false,
      scrollBudgetReached: false,
    });
    expect(browserExpansionWarnings(telemetry, limits).join(" ")).toContain("element inspection budget");
  });

  test("never clicks one disclosure element more than once across scroll passes", async () => {
    const limits = browserExpansionLimits(1);
    const clickCounts = Array.from({ length: 10 }, () => 0);
    const controls = clickCounts.map((_count, index) =>
      fakeControl("Show more comments", () => {
        clickCounts[index] = (clickCounts[index] ?? 0) + 1;
      }));
    const telemetry = await executeExpansionScript(limits, {
      documentElement: { scrollHeight: 100 },
      createTreeWalker: () => {
        let cursor = 0;
        return { nextNode: () => controls[cursor++] ?? null };
      },
    });

    expect(clickCounts).toEqual(Array.from({ length: 10 }, () => 1));
    expect(telemetry.clicks).toBe(10);
    expect(telemetry.eligibleControls).toBe(10);
    expect(telemetry.clickBudgetReached).toBeFalse();
  });

  test("stops dispatching clicks at the hard click budget and reports it", async () => {
    const limits = browserExpansionLimits(1);
    let clicks = 0;
    const controls = Array.from(
      { length: limits.maxClicks + 20 },
      () => fakeControl("View more replies", () => {
        clicks += 1;
      }),
    );
    const telemetry = await executeExpansionScript(limits, {
      documentElement: { scrollHeight: 100 },
      createTreeWalker: () => {
        let cursor = 0;
        return { nextNode: () => controls[cursor++] ?? null };
      },
    });

    expect(clicks).toBe(limits.maxClicks);
    expect(telemetry.clicks).toBe(limits.maxClicks);
    expect(telemetry.clickBudgetReached).toBeTrue();
    expect(browserExpansionWarnings(telemetry, limits).join(" ")).toContain("click budget");
  });

  test("rejects impossible target-controlled expansion telemetry", () => {
    const limits = browserExpansionLimits(1);
    expect(readBrowserExpansionTelemetry({
      visitedElements: limits.maxVisitedElements + 1,
      eligibleControls: 0,
      clicks: 0,
      clickFailures: 0,
      inspectionFailures: 0,
      scrolls: 0,
      elementBudgetReached: false,
      clickBudgetReached: false,
      scrollBudgetReached: false,
    }, limits)).toBeNull();
  });
});

test("owned Chromium sessions cannot bypass the filtering proxy through loopback, QUIC, or WebRTC", () => {
  const arguments_ = browserProxyArguments("http://127.0.0.1:41234", "Default");
  expect(arguments_).toContain("--proxy");
  expect(arguments_).toContain("http://127.0.0.1:41234");
  const flags = arguments_.join("\n");
  expect(flags).toContain("--proxy-bypass-list=<-loopback>");
  expect(flags).toContain("--profile-directory=Default");
  expect(flags).toContain("--disable-quic");
  expect(flags).toContain("--force-webrtc-ip-handling-policy=disable_non_proxied_udp");
});

test("browser subprocess isolation removes ambient auth, providers, startup state, and proxy bypasses", () => {
  const environment = isolatedAgentBrowserEnvironment({
    PATH: "/bin",
    HOME: "/Users/tester",
    AGENT_BROWSER_PROFILE: "Personal",
    AGENT_BROWSER_STATE: "/private/state.json",
    AGENT_BROWSER_RESTORE: "signed-in",
    AGENT_BROWSER_AUTO_CONNECT: "1",
    AGENT_BROWSER_PROVIDER: "browserbase",
    AGENT_BROWSER_EXTENSIONS: "/private/extension",
    AGENT_BROWSER_INIT_SCRIPTS: "/private/init.js",
    HTTP_PROXY: "http://ambient-proxy.invalid",
    NO_PROXY: "127.0.0.1",
  }, "/private/clip-sockets");
  expect(environment).toEqual({
    PATH: "/bin",
    HOME: "/Users/tester",
    AGENT_BROWSER_SOCKET_DIR: "/private/clip-sockets",
  });
});

test("attached browser sessions require a browser-only egress trust acknowledgement", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clip-browser-trust-test-"));
  temporaryDirectories.push(directory);
  let failure: unknown;
  try {
    await acquireBrowser({
      ...cookieOptions(join(directory, "unused-cookies.json")),
      mode: "browser",
      browserLive: true,
    }, directory);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure instanceof Error ? failure.message : "").toContain("--trust-attached-browser-egress");
});

test("browser navigation provenance fails closed after a navigation command failure", () => {
  const target = new URL("https://target.example/post?id=1");
  const unrelated = new URL("https://private.example/inbox");
  expect(browserNavigationReachedTarget(target, unrelated, unrelated, true)).toBeFalse();
  expect(browserNavigationReachedTarget(target, unrelated, new URL(target), false)).toBeTrue();
  expect(browserNavigationReachedTarget(
    target,
    unrelated,
    new URL("https://private.example/message/2"),
    false,
  )).toBeFalse();
  expect(browserNavigationReachedTarget(
    target,
    new URL("about:blank"),
    new URL("https://identity.example/login?return=target"),
    true,
  )).toBeTrue();
  expect(browserNavigationReachedTarget(target, null, new URL(target), false)).toBeTrue();
  expect(browserNavigationReachedTarget(target, null, new URL("https://identity.example/login"), true)).toBeFalse();
  expect(browserNavigationReachedTarget(target, unrelated, new URL("about:blank"), true)).toBeFalse();
});

test("browser expansion cannot replace the proven capture page", () => {
  const baseline = new URL("https://social.example/post/1?view=thread#top");
  expect(browserExpansionStayedOnPage(baseline, new URL("https://social.example/post/1?view=thread#comments"))).toBeTrue();
  expect(browserExpansionStayedOnPage(baseline, new URL("https://social.example/post/2?view=thread"))).toBeFalse();
  expect(browserExpansionStayedOnPage(baseline, new URL("https://social.example/post/1?view=latest"))).toBeFalse();
  expect(browserExpansionStayedOnPage(baseline, new URL("https://private.example/inbox"))).toBeFalse();
});

test("explicit browser cookie sources suppress ambient Sweet Cookie profile selectors", async () => {
  let observed: unknown;
  const read = createCookieHeaderReader((options) => {
    observed = options;
    return Promise.resolve({
      cookies: [{ name: "session", value: "private", domain: "example.com", hostOnly: true, path: "/account" }],
      warnings: [],
    });
  });
  await read({
    ...cookieOptions("unused"),
    cookiesFile: undefined,
    cookieSources: ["chrome"],
  }, new URL("https://example.com/account"));
  expect(observed).toMatchObject({
    profile: "",
    chromeProfile: "",
    edgeProfile: "",
    firefoxProfile: "",
    browsers: ["chrome"],
    mode: "first",
  });
});

test("persistent profiles cannot enter the repository through a symlinked missing parent", () => {
  const directory = mkdtempSync(join(tmpdir(), "clip-profile-repository-test-"));
  temporaryDirectories.push(directory);
  const repositoryAlias = join(directory, "repository-alias");
  symlinkSync(resolve(import.meta.dir, "..", ".."), repositoryAlias, "dir");
  expect(() => assertSafePersistentProfile({
    ...cookieOptions(join(directory, "unused-cookies.json")),
    browserProfile: join(repositoryAlias, "new-profile"),
    outputBase: join(directory, "output"),
  })).toThrow("outside the repository");
});

test("persistent profile and output confinement canonicalize missing paths below symlinks", () => {
  const directory = mkdtempSync(join(tmpdir(), "clip-profile-output-test-"));
  temporaryDirectories.push(directory);
  const realOutput = join(directory, "real-output");
  const outputAlias = join(directory, "output-alias");
  mkdirSync(realOutput);
  symlinkSync(realOutput, outputAlias, "dir");
  expect(() => assertSafePersistentProfile({
    ...cookieOptions(join(directory, "unused-cookies.json")),
    browserProfile: join(realOutput, "profiles", "new-profile"),
    outputBase: outputAlias,
  })).toThrow("capture output roots");
});

describe("explicit cookie-file isolation", () => {
  test("an invalid file fails closed without probing any browser provider", async () => {
    const directory = mkdtempSync(join(tmpdir(), "clip-cookie-acquire-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "cookies.txt");
    writeFileSync(file, "not a supported cookie payload\n", { mode: 0o600 });
    let browserProbes = 0;
    const read = createCookieHeaderReader(() => {
      browserProbes += 1;
      return Promise.resolve({ cookies: [], warnings: [] });
    });

    let message = "";
    try {
      await read(cookieOptions(file), new URL("https://example.com/account"));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("no usable cookies");
    expect(browserProbes).toBe(0);
  });

  test("provider failures never expose raw error values", async () => {
    const read = createCookieHeaderReader(() => Promise.reject(new Error("provider leaked SECRET_VALUE")));
    const options = { ...cookieOptions("unused"), cookiesFile: undefined, cookieSources: ["chrome"] as const };
    let message = "";
    try {
      await read(options, new URL("https://example.com/account"));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("SECRET_VALUE");
    expect(message).toContain("could not be read");
  });

  test("maps Safari's explicit profile to Sweet Cookie's cookie-file option", async () => {
    let safariCookiesFile: string | undefined;
    const read = createCookieHeaderReader((options) => {
      safariCookiesFile = typeof options.safariCookiesFile === "string" ? options.safariCookiesFile : undefined;
      return Promise.resolve({
        cookies: [{
          name: "session",
          value: "private",
          domain: "example.com",
          hostOnly: true,
          path: "/",
          secure: true,
          expires: Math.floor(Date.now() / 1_000) + 3_600,
        }],
        warnings: [],
      });
    });
    await read({
      ...cookieOptions("unused"),
      cookiesFile: undefined,
      cookieSources: ["safari"] as const,
      cookieProfile: "/private/Cookies.binarycookies",
    }, new URL("https://example.com/account"));
    expect(safariCookiesFile).toBe("/private/Cookies.binarycookies");
  });
});
