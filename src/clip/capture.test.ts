import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AcquiredPage } from "./acquire.js";
import type { CaptureArguments } from "./args.js";
import { appendCapturedMedia, captureSlug, effectiveScope, runCapture } from "./capture.js";
import { countWords, type ExtractedPage } from "./extract.js";
import { CONTENT_REWRITE_TRUNCATION_WARNING } from "./lib.js";

const baseOptions = (url: string, overrides: Partial<CaptureArguments> = {}): CaptureArguments => ({
  command: "inspect",
  url: new URL(url),
  slug: undefined,
  mode: "http",
  scope: "auto",
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
  cookiesFile: undefined,
  timeoutMs: 1_000,
  maxItems: 20,
  maxDepth: 8,
  maxHtmlBytes: 1024 * 1024,
  maxAssetBytes: 1024 * 1024,
  maxTotalAssetBytes: 2 * 1024 * 1024,
  allowPrivateNetwork: false,
  userAgent: "test",
  ...overrides,
});

test("appends playable local video and audio while rejecting unsafe media paths", () => {
  const markdown = appendCapturedMedia("Article body", [
    { path: "assets/media/video file.mp4", mimeType: "video/mp4", bytes: 1, sha256: "a".repeat(64) },
    { path: "assets/media/audio.mp3", mimeType: "audio/mpeg", bytes: 1, sha256: "b".repeat(64) },
    { path: "../outside.mp4", mimeType: "video/mp4", bytes: 1, sha256: "c".repeat(64) },
  ]);
  expect(markdown).toContain("## Media");
  expect(markdown).toContain('<video controls preload="metadata" src="assets/media/video%20file.mp4"></video>');
  expect(markdown).toContain('<audio controls preload="metadata" src="assets/media/audio.mp3"></audio>');
  expect(markdown).not.toContain("outside.mp4");
});

const acquisition = (url: string): AcquiredPage => ({
  body: "<main><h1>Fixture</h1><p>Enough useful fixture prose for extraction.</p></main>",
  contentType: "text/html",
  finalUrl: new URL(url),
  method: "http",
  warnings: [],
});

const extraction = (url: string, title = "Fixture"): ExtractedPage => ({
  article: { title, content: "Useful body", author: "Alice", published: null, description: null },
  canonicalUrl: new URL(url),
  platform: url.includes("x.com") ? "x" : "generic",
  status: "complete",
  score: 10,
  wordCount: 2,
  expectedItems: null,
  capturedItems: 1,
  extractor: "fixture",
  warnings: [],
  acquisition: acquisition(url),
});

describe("capture orchestration", () => {
  test("chooses platform-aware default scopes", () => {
    expect(effectiveScope("hacker-news", "auto")).toBe("comments");
    expect(effectiveScope("x", "auto")).toBe("thread");
    expect(effectiveScope("generic", "auto")).toBe("page");
    expect(effectiveScope("x", "page")).toBe("page");
  });

  test("retains a stable social post ID in generated slugs", () => {
    const value = extraction("https://x.com/alice/status/2078889282404569267", "A very useful post");
    expect(captureSlug(baseOptions(value.canonicalUrl.href), value)).toBe("a-very-useful-post-2078889282404569267");
  });

  test("does not persist platform tracking parameters from the submitted source URL", async () => {
    const submitted = "https://x.com/alice/status/2078889282404569267?s=46&t=tracking-value";
    const canonical = "https://x.com/alice/status/2078889282404569267";
    const root = mkdtempSync(join(tmpdir(), "clip-tracking-test-"));
    try {
      const result = await runCapture(baseOptions(submitted, {
        command: "capture",
        stdout: false,
        outputBase: root,
      }), {
        acquirePublicStructured: () => Promise.resolve(null),
        acquireHttp: () => Promise.resolve(acquisition(submitted)),
        extractPage: () => Promise.resolve({
          ...extraction(canonical),
          acquisition: acquisition(submitted),
        }),
        now: () => new Date("2026-07-21T12:00:00Z"),
      });
      expect(result.sourceUrl).toBe(canonical);
      expect(result.manifest?.sourceUrl).toBe(canonical);
      expect(result.manifest?.acquisition.finalUrl).toBe(canonical);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("runs a read-only HTTP inspection without browser or filesystem output", async () => {
    let browserCalls = 0;
    const url = "https://example.com/article";
    const result = await runCapture(baseOptions(url), {
      acquirePublicStructured: () => Promise.resolve(null),
      acquireHttp: () => Promise.resolve(acquisition(url)),
      acquireBrowser: () => {
        browserCalls += 1;
        return Promise.reject(new Error("unexpected"));
      },
      extractPage: () => Promise.resolve(extraction(url)),
      now: () => new Date("2026-07-21T12:00:00Z"),
    });
    expect(browserCalls).toBe(0);
    expect(result.outputDirectory).toBeNull();
    expect(result.markdown).toContain("capture_status: \"complete\"");
    expect(result.markdown).toContain("clipped: \"2026-07-21\"");
  });

  test("downgrades rewrite truncation and derives every reported word count from final Markdown", async () => {
    const url = "https://example.com/truncated";
    const denseProtectedContent = `${"preserved prose ".repeat(24_000)}${"`x`".repeat(4_097)}`;
    const truncatedExtraction = {
      ...extraction(url),
      article: { ...extraction(url).article, content: denseProtectedContent },
      wordCount: 99_999,
    };
    const dependencies = {
      acquirePublicStructured: () => Promise.resolve(null),
      acquireHttp: () => Promise.resolve(acquisition(url)),
      extractPage: () => Promise.resolve(truncatedExtraction),
      now: () => new Date("2026-07-21T12:00:00Z"),
    };

    const inspected = await runCapture(baseOptions(url), dependencies);
    expect(inspected.status).toBe("partial");
    expect(inspected.markdown).toContain('capture_status: "partial"');
    expect(inspected.markdown).toContain("source code unit(s) omitted");
    expect(inspected.warnings).toContain(CONTENT_REWRITE_TRUNCATION_WARNING);
    expect(inspected.wordCount).toBe(countWords(inspected.markdown));
    expect(inspected.wordCount).not.toBe(truncatedExtraction.wordCount);

    const root = mkdtempSync(join(tmpdir(), "clip-rewrite-truncation-"));
    try {
      for (const media of ["none", "images"] as const) {
        const result = await runCapture(baseOptions(url, {
          command: "capture",
          stdout: false,
          outputBase: root,
          slug: `truncated-${media}`,
          media,
        }), dependencies);
        expect(result.status).toBe("partial");
        expect(result.warnings).toContain(CONTENT_REWRITE_TRUNCATION_WARNING);
        expect(result.wordCount).toBe(countWords(result.markdown));
        expect(result.manifest?.status).toBe("partial");
        expect(result.manifest?.extraction.wordCount).toBe(result.wordCount);
        expect(result.manifest?.artifacts.images.status).toBe(media === "none" ? "not-requested" : "partial");
        expect(readFileSync(result.markdownPath ?? "", "utf8")).toBe(result.markdown);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("never returns signed URL credentials from read-only Markdown", async () => {
    const url = "https://example.com/article";
    const result = await runCapture(baseOptions(url), {
      acquirePublicStructured: () => Promise.resolve(null),
      acquireHttp: () => Promise.resolve(acquisition(url)),
      extractPage: () => Promise.resolve({
        ...extraction(url),
        article: {
          ...extraction(url).article,
          content: "![private](https://cdn.example/image.png?keep=1&X-Amz-Signature=DO_NOT_PRINT)",
        },
      }),
      now: () => new Date("2026-07-21T12:00:00Z"),
    });
    expect(result.markdown).not.toContain("DO_NOT_PRINT");
    expect(result.markdown).toContain("https://cdn.example/image.png");
    expect(result.markdown).not.toContain("?keep=1");
    expect(result.warnings).toEqual([]);
  });

  test("does not discover a signed-in browser profile unless one was explicitly requested", async () => {
    const url = "https://example.com/article";
    let discoveredProfileRequested: boolean | undefined;
    await runCapture(baseOptions(url, { mode: "browser" }), {
      acquireBrowser: (_options, _temporaryDirectory, useDiscoveredProfile) => {
        discoveredProfileRequested = useDiscoveredProfile;
        return Promise.resolve({ ...acquisition(url), method: "browser-fresh" });
      },
      extractPage: () => Promise.resolve(extraction(url)),
      now: () => new Date("2026-07-21T12:00:00Z"),
    });
    expect(discoveredProfileRequested).toBe(false);
  });

  test("does not defeat explicit structured item bounds with an unbounded browser fallback", async () => {
    const url = "https://news.ycombinator.com/item?id=1";
    let browserCalls = 0;
    const bounded = {
      ...extraction(url),
      platform: "hacker-news" as const,
      status: "partial" as const,
      score: 60_000,
      warnings: ["Hacker News descendants exceeded the configured item or depth limit."],
      acquisition: { ...acquisition(url), method: "hacker-news-api" as const },
    };
    await runCapture(baseOptions(url, { mode: "auto", scope: "comments", maxItems: 5 }), {
      acquirePublicStructured: () => Promise.resolve({ extraction: bounded, evidence: "{}\n" }),
      acquireHttp: () => Promise.resolve(acquisition(url)),
      acquireBrowser: () => {
        browserCalls += 1;
        return Promise.reject(new Error("unexpected"));
      },
      extractPage: () => Promise.resolve({ ...extraction(url), status: "partial", score: 2_000 }),
      now: () => new Date("2026-07-21T12:00:00Z"),
    });
    expect(browserCalls).toBe(0);
  });

  test("does not launch a browser after Bluesky reaches the explicit item bound", async () => {
    const url = "https://bsky.app/profile/example.test/post/3example";
    let browserCalls = 0;
    const bounded: ExtractedPage = {
      ...extraction(url),
      platform: "bluesky",
      status: "partial",
      capturedItems: 18,
      expectedItems: 40,
      warnings: ["Capture stopped at 20 items."],
      acquisition: { ...acquisition(url), method: "bluesky-api" },
    };
    await runCapture(baseOptions(url, { mode: "auto", scope: "thread", maxItems: 20 }), {
      acquirePublicStructured: () => Promise.resolve({ extraction: bounded, evidence: "{}\n" }),
      acquireHttp: () => Promise.resolve(acquisition(url)),
      acquireBrowser: () => {
        browserCalls += 1;
        return Promise.reject(new Error("unexpected"));
      },
      extractPage: () => Promise.resolve({
        ...extraction(url),
        platform: "bluesky",
        status: "partial",
        capturedItems: 0,
      }),
      now: () => new Date("2026-07-21T12:00:00Z"),
    });
    expect(browserCalls).toBe(0);
  });

  test("prefers an official structured thread over higher-volume unstructured prose", async () => {
    const url = "https://bsky.app/profile/example.test/post/3example";
    const structured: ExtractedPage = {
      ...extraction(url),
      platform: "bluesky",
      status: "partial",
      score: 60_100,
      capturedItems: 12,
      expectedItems: 40,
      acquisition: { ...acquisition(url), method: "bluesky-api" },
    };
    const result = await runCapture(baseOptions(url, { mode: "http", scope: "thread" }), {
      acquirePublicStructured: () => Promise.resolve({ extraction: structured, evidence: "{}\n" }),
      acquireHttp: () => Promise.resolve(acquisition(url)),
      extractPage: (page) => Promise.resolve({
        ...extraction(url),
        platform: "bluesky",
        status: "partial",
        score: 200_000,
        capturedItems: 0,
        expectedItems: 40,
        acquisition: page,
      }),
      now: () => new Date("2026-07-21T12:00:00Z"),
    });

    expect(result.acquisitionMethod).toBe("bluesky-api");
    expect(result.capturedItems).toBe(12);
  });

  test("falls back to ordinary HTTP when Reddit's best-effort JSON endpoint fails", async () => {
    const url = "https://www.reddit.com/r/test/comments/abc/a_post/";
    const result = await runCapture(baseOptions(url), {
      acquirePublicStructured: () => Promise.reject(new Error("Reddit JSON denied the request")),
      acquireHttp: () => Promise.resolve(acquisition(url)),
      extractPage: () => Promise.resolve({ ...extraction(url), platform: "reddit" }),
      now: () => new Date("2026-07-21T12:00:00Z"),
    });
    expect(result.acquisitionMethod).toBe("http");
    expect(result.attempts).toContainEqual({
      method: "public-api",
      outcome: "failed",
      message: "Reddit JSON denied the request",
    });
    expect(result.attempts.some(({ method, outcome }) => method === "http" && outcome === "succeeded")).toBeTrue();
  });

  test("persists the vault-compatible Markdown name and manifest atomically", async () => {
    const root = mkdtempSync(join(tmpdir(), "clip-capture-test-"));
    const url = "https://example.com/article";
    try {
      const result = await runCapture(baseOptions(url, {
        command: "capture",
        stdout: false,
        outputBase: root,
      }), {
        acquirePublicStructured: () => Promise.resolve(null),
        acquireHttp: () => Promise.resolve(acquisition(url)),
        extractPage: () => Promise.resolve(extraction(url)),
        now: () => new Date("2026-07-21T12:00:00Z"),
      });
      expect(result.markdownPath).toBe(join(realpathSync(root), "fixture", "fixture.md"));
      expect(existsSync(result.markdownPath ?? "")).toBe(true);
      expect(readFileSync(join(root, "fixture", "capture.json"), "utf8")).toContain('"schemaVersion": 2');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("binds evidence to the selected candidate and audits partial artifact capture", async () => {
    const root = mkdtempSync(join(tmpdir(), "clip-capture-evidence-provenance-"));
    const url = "https://x.com/alice/status/123";
    try {
      const result = await runCapture(baseOptions(url, {
        command: "capture",
        mode: "auto",
        stdout: false,
        outputBase: root,
        browserProfile: "Work",
        media: "all",
        evidence: "screenshot",
      }), {
        acquirePublicStructured: () => Promise.resolve(null),
        acquireHttp: () => Promise.resolve(acquisition(url)),
        acquireBrowser: () => Promise.resolve({
          ...acquisition(url),
          method: "browser-profile",
          screenshotPath: join(root, "unused-browser.png"),
          warnings: ["The selected persistent browser profile may have been updated."],
        }),
        extractPage: (page) => Promise.resolve({
          ...extraction(url),
          platform: "x",
          status: page.method === "http" ? "complete" : "partial",
          acquisition: page,
        }),
        captureMedia: () => Promise.resolve({
          status: "captured",
          records: [],
          metadata: null,
          warnings: ["One alternate media output was skipped."],
        }),
        now: () => new Date("2026-07-21T12:00:00Z"),
      });
      expect(result.manifest?.acquisition.method).toBe("http");
      expect(result.manifest?.evidence).toMatchObject({
        requested: "screenshot",
        screenshotPath: null,
        screenshotStatus: "unavailable",
      });
      expect(result.manifest?.artifacts.media).toEqual({ requested: true, status: "partial", files: 0 });
      expect(result.warnings.some((warning) => warning.includes("different acquisition candidate"))).toBeTrue();
      expect(result.warnings.some((warning) => warning.includes("persistent browser profile"))).toBeTrue();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reuses explicit cookies only for same-origin images and refuses hostile cross-origin asset auth", async () => {
    const root = mkdtempSync(join(tmpdir(), "clip-capture-auth-assets-"));
    const url = "https://example.com/article";
    try {
      let cookieReads = 0;
      await runCapture(baseOptions(url, {
        command: "capture",
        stdout: false,
        outputBase: root,
        media: "images",
        browserProfile: "Work",
      }), {
        acquirePublicStructured: () => Promise.resolve(null),
        acquireHttp: () => Promise.resolve(acquisition(url)),
        extractPage: () => Promise.resolve(extraction(url)),
        acquireCookieRecords: (selected, assetUrl) => {
          cookieReads += 1;
          expect(selected.cookieSources).toEqual(["chrome"]);
          expect(selected.cookieProfile).toBe("Work");
          expect(assetUrl.href).toBe("https://example.com/article");
          return Promise.resolve({
            cookies: [
              { name: "root", value: "private", domain: "example.com", hostOnly: true, path: "/", secure: true, httpOnly: true, sameSite: "Strict", expires: 0 },
              { name: "page", value: "private", domain: "example.com", hostOnly: true, path: "/article", secure: true, httpOnly: true, sameSite: "Strict", expires: 0 },
            ],
            warnings: [],
          });
        },
        localizeAssets: async (content, options) => {
          expect(await options.cookieHeaderProvider?.(new URL("https://example.com/private.png"))).toBe("root=private");
          expect(await options.cookieHeaderProvider?.(new URL("https://example.com/another.png"))).toBe("root=private");
          expect(await options.cookieHeaderProvider?.(new URL("https://bank.example/private.png"))).toBeNull();
          return { content, assets: [], warnings: [], truncated: false };
        },
        now: () => new Date("2026-07-21T12:00:00Z"),
      });
      expect(cookieReads).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
