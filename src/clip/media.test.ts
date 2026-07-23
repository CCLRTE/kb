import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import {
  buildMediaCookieOptions,
  captureMedia,
  captureVideoContext,
  createMediaCookieProvider,
  discoverNodeRuntime,
  discoverYtDlp,
  parseMediaMetadata,
  parseWebVtt,
  runMediaCommand,
  sniffMediaMimeType,
} from "./media.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "clip-media-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("media metadata", () => {
  test("parses only the allowlisted metadata and rejects credential-bearing output URLs", () => {
    const metadata = parseMediaMetadata(`noise\nCLIP_MEDIA_JSON\t${JSON.stringify({
      id: "post-1",
      title: "A title",
      description: "A description",
      uploader: "Creator",
      uploader_id: "creator-id",
      channel: "Creator channel",
      channel_id: "creator-channel-id",
      webpage_url: "https://user:password@example.com/private",
      extractor: "fixture",
      duration: 12.5,
      timestamp: 1_721_234_567,
      formats: [{ url: "https://cdn.example.com/file?token=secret" }],
      cookies: "session=secret",
    })}\n`);
    expect(metadata).toEqual({
      id: "post-1",
      title: "A title",
      description: "A description",
      uploader: "Creator",
      uploaderId: "creator-id",
      channel: "Creator channel",
      channelId: "creator-channel-id",
      extractor: "fixture",
      durationSeconds: 12.5,
      timestamp: 1_721_234_567,
    });
    expect(JSON.stringify(metadata)).not.toContain("token=secret");
    expect(JSON.stringify(metadata)).not.toContain("session=secret");
  });

  test("ignores malformed and unbounded fields", () => {
    expect(parseMediaMetadata("CLIP_MEDIA_JSON\t{broken\n")).toBeNull();
    expect(parseMediaMetadata(`CLIP_MEDIA_JSON\t${JSON.stringify({
      id: "x".repeat(600),
      title: "ok",
      duration: -1,
      webpage_url: "file:///etc/passwd",
    })}`)).toEqual({ title: "ok" });
  });

  test("scans dense multi-megabyte process output without allocating a line array", () => {
    const output = `${"noise\n".repeat(500_000)}CLIP_MEDIA_JSON\t{"title":"bounded"}\n`;
    const startedAt = performance.now();
    expect(parseMediaMetadata(output)).toEqual({ title: "bounded" });
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});

test("validates media containers by signature and extension", () => {
  const mp4 = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  expect(sniffMediaMimeType(mp4, ".mp4")).toBe("video/mp4");
  expect(sniffMediaMimeType(mp4, ".html")).toBeNull();
  expect(sniffMediaMimeType(new TextEncoder().encode("<html>challenge</html>"), ".mp4")).toBeNull();
  expect(sniffMediaMimeType(new TextEncoder().encode("OggS fixture"), ".opus")).toBe("audio/opus");
});

test("discovers yt-dlp from PATH before common local paths", () => {
  expect(discoverYtDlp({
    homeDirectory: "/home/person",
    which: () => "/tools/yt-dlp",
    exists: (path) => path === "/tools/yt-dlp",
  })).toBe("/tools/yt-dlp");
  expect(discoverYtDlp({
    homeDirectory: "/home/person",
    which: () => null,
    exists: (path) => path === "/home/person/.local/bin/yt-dlp",
  })).toBe("/home/person/.local/bin/yt-dlp");
});

test("discovers only Node.js 22 or newer for yt-dlp JavaScript runtime support", () => {
  expect(discoverNodeRuntime({
    homeDirectory: "/home/person",
    which: () => "/tools/node",
    exists: (path) => path === "/tools/node",
    readVersion: () => "v22.14.0",
  })).toBe("/tools/node");
  expect(discoverNodeRuntime({
    homeDirectory: "/home/person",
    which: () => "/tools/node",
    exists: (path) => path === "/tools/node",
    readVersion: () => "v20.19.0",
  })).toBeNull();
});

describe("WebVTT transcripts", () => {
  test("deduplicates rolling YouTube captions into timestamped Markdown", () => {
    expect(parseWebVtt([
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:02.000",
      "<c>Hello</c>",
      "",
      "00:00:01.000 --> 00:00:03.000",
      "Hello world",
      "",
      "00:00:02.000 --> 00:00:04.000",
      "world again",
      "",
      "00:00:03.000 --> 00:00:05.000",
      "again",
      "",
    ].join("\n"))).toEqual({
      markdown: "- [00:00] Hello\n- [00:01] world\n- [00:02] again\n",
      cueCount: 3,
      truncated: false,
    });
  });

  test("bounds cue count and renders foreign Markdown as literal transcript text", () => {
    const parsed = parseWebVtt([
      "WEBVTT",
      "",
      "00:00.000 --> 00:01.000",
      "![unsafe](javascript:alert(1)) <b>first</b>",
      "",
      "00:01.000 --> 00:02.000",
      "second",
      "",
    ].join("\n"), { maxCues: 1 });
    expect(parsed).toEqual({
      markdown: "- [00:00] !\\[unsafe\\](javascript:alert(1)) first\n",
      cueCount: 1,
      truncated: true,
    });
  });
});

test("maps Arc and other Chromium selections through Sweet Cookie's Chrome backend", () => {
  expect(buildMediaCookieOptions({
    url: new URL("https://social.example/post/1"),
    source: "arc",
    profile: "Profile 9",
    timeoutMs: 15_000,
  })).toMatchObject({
    url: "https://social.example/post/1",
    browsers: ["chrome"],
    chromiumBrowser: "arc",
    chromeProfile: "Profile 9",
  });
  expect(buildMediaCookieOptions({
    url: new URL("https://social.example/post/1"),
    source: "brave",
    timeoutMs: 15_000,
  })).toMatchObject({ browsers: ["chrome"], chromiumBrowser: "brave", chromeProfile: "" });
  expect(buildMediaCookieOptions({
    url: new URL("https://social.example/post/1"),
    source: "chromium",
    timeoutMs: 15_000,
  })).toMatchObject({ browsers: ["chrome"], chromiumBrowser: "chromium", chromeProfile: "" });
});

test("normalizes Cookie-Editor JSON and cURL input without probing an injected browser reader", async () => {
  const directory = temporaryDirectory();
  const jsonFile = join(directory, "cookies.json");
  const curlFile = join(directory, "cookies.curl");
  const invalidFile = join(directory, "invalid.txt");
  writeFileSync(jsonFile, JSON.stringify([{
    name: "json-session",
    value: "json-secret",
    domain: ".social.example",
    path: "/",
    expirationDate: 4_102_444_800,
  }]));
  writeFileSync(curlFile, "curl --cookie 'curl-session=curl-secret' https://social.example/post/1\n");
  writeFileSync(invalidFile, "not a cookie payload\n");
  let browserReads = 0;
  const provider = createMediaCookieProvider(() => {
    browserReads += 1;
    return Promise.reject(new Error("file parsing must not reach a browser provider"));
  });
  const base = { url: new URL("https://social.example/post/1"), source: "file" as const, timeoutMs: 5_000 };
  const jsonResult = await provider({ ...base, file: jsonFile });
  const curlResult = await provider({ ...base, file: curlFile });
  const invalidResult = await provider({ ...base, file: invalidFile });

  expect(jsonResult).toMatchObject({ cookies: [{ name: "json-session", expires: 4_102_444_800 }] });
  expect(curlResult).toMatchObject({ cookies: [{
    name: "curl-session",
    value: "curl-secret",
    domain: "social.example",
  }] });
  expect(invalidResult).toEqual({ cookies: [], warnings: [] });
  expect(browserReads).toBe(0);
});

describe("yt-dlp capture", () => {
  test("returns unavailable without invoking a process", async () => {
    const result = await captureMedia({
      url: new URL("https://example.com/watch/1"),
      outputDirectory: temporaryDirectory(),
      timeoutMs: 10_000,
      maxFileBytes: 1_024,
      maxTotalBytes: 2_048,
      exists: () => false,
      which: () => null,
      run: () => Promise.reject(new Error("must not run")),
    });
    expect(result).toMatchObject({ status: "unavailable", records: [] });
  });

  test("uses bounded, non-playlist arguments and promotes content-addressed media", async () => {
    const outputDirectory = temporaryDirectory();
    const bytes = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    let command: string[] = [];
    let standardInput: string | undefined;
    let workingDirectory: string | undefined;
    const result = await captureMedia({
      url: new URL("https://video.example/watch?id=1"),
      outputDirectory,
      relativePrefix: "assets/media",
      timeoutMs: 15_000,
      maxFileBytes: 1_024,
      maxTotalBytes: 2_048,
      executable: "/fake/yt-dlp",
      exists: (path) => path === "/fake/yt-dlp",
      run: (specification) => {
        command = [...specification.command];
        standardInput = specification.stdin;
        workingDirectory = specification.cwd;
        writeFileSync(join(specification.monitoredDirectory, "media-post.mp4"), bytes);
        return Promise.resolve({
          stdout: `CLIP_MEDIA_JSON\t${JSON.stringify({
            id: "post",
            title: "Clip",
            webpage_url: "https://video.example/watch?id=1",
            duration: 9,
          })}\n`,
          stderr: "",
          exitCode: 101,
        });
      },
    });
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(result).toEqual({
      status: "captured",
      records: [{
        path: `assets/media/${digest}.mp4`,
        mimeType: "video/mp4",
        bytes: bytes.byteLength,
        sha256: digest,
      }],
      metadata: {
        id: "post",
        title: "Clip",
        webpageUrl: "https://video.example/watch?id=1",
        durationSeconds: 9,
      },
      warnings: [],
    });
    expect(existsSync(join(outputDirectory, `${digest}.mp4`))).toBeTrue();
    expect(readdirSync(outputDirectory).some((name) => name.startsWith(".clip-media-"))).toBeFalse();

    expect(command).toContain("--ignore-config");
    expect(command).toContain("--no-playlist");
    expect(command).toContain("--max-downloads");
    expect(command).toContain("--max-filesize");
    expect(command).toContain("--proxy");
    expect(command).toContain("--downloader");
    expect(command[command.indexOf("--downloader") + 1]).toBe("native");
    expect(command[command.indexOf("--proxy") + 1]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(command).not.toContain("--cookies");
    expect(command).not.toContain("--cookies-from-browser");
    expect(command).not.toContain("--trim-filenames");
    expect(command[command.indexOf("--batch-file") + 1]).toBe("-");
    expect(command[command.indexOf("--output") + 1]).toBe("media-%(id).80B.%(ext)s");
    expect(workingDirectory).toBeDefined();
    expect(workingDirectory).toBe(resolve(workingDirectory ?? ""));
    expect(workingDirectory === undefined ? "" : relative(realpathSync(outputDirectory), workingDirectory)).not.toStartWith("..");
    expect(command).not.toContain("https://video.example/watch?id=1");
    expect(standardInput).toBe("https://video.example/watch?id=1\n");
  });

  test("delivers a signed media URL only through private stdin", async () => {
    const signedUrl = "https://video.example/watch?id=1&token=process-list-secret";
    let observedCommand: readonly string[] = [];
    let observedStdin: string | undefined;
    await captureMedia({
      url: new URL(signedUrl),
      outputDirectory: temporaryDirectory(),
      timeoutMs: 15_000,
      maxFileBytes: 1_024,
      maxTotalBytes: 2_048,
      executable: "/fake/yt-dlp",
      exists: (path) => path === "/fake/yt-dlp",
      run: (specification) => {
        observedCommand = specification.command;
        observedStdin = specification.stdin;
        return Promise.resolve({ stdout: "", stderr: "ERROR: Unsupported URL", exitCode: 1 });
      },
    });
    expect(observedCommand[observedCommand.indexOf("--batch-file") + 1]).toBe("-");
    expect(observedCommand.join(" ")).not.toContain(signedUrl);
    expect(observedCommand.join(" ")).not.toContain("process-list-secret");
    expect(observedStdin).toBe(`${signedUrl}\n`);
  });

  test("converts an explicitly selected Arc profile to a private origin-scoped jar and deletes it", async () => {
    const outputDirectory = temporaryDirectory();
    let command: string[] = [];
    let cookiePath: string | undefined;
    let cookieMode: number | undefined;
    let cookieBody: string | undefined;
    let requestedSource: string | undefined;
    let requestedProfile: string | undefined;
    const secret = "super-secret-cookie-value";
    const result = await captureMedia({
      url: new URL("https://social.example/post/1"),
      outputDirectory,
      timeoutMs: 15_000,
      maxFileBytes: 1_024,
      maxTotalBytes: 2_048,
      executable: "/fake/yt-dlp",
      cookieBrowser: { source: "arc", profile: "Profile 9" },
      exists: (path) => path === "/fake/yt-dlp",
      cookieProvider: (request) => {
        requestedSource = request.source;
        if (request.source !== "file") requestedProfile = request.profile;
        return Promise.resolve({
          cookies: [{
            name: "session",
            value: secret,
            domain: "social.example",
            hostOnly: false,
            path: "/",
            secure: true,
            httpOnly: true,
            expires: Math.floor(Date.now() / 1_000) + 3_600,
          }],
          warnings: [`provider detail containing ${secret}`],
        });
      },
      run: (specification) => {
        command = [...specification.command];
        const cookieIndex = command.indexOf("--cookies");
        cookiePath = command[cookieIndex + 1];
        if (cookiePath !== undefined) {
          cookieMode = statSync(cookiePath).mode & 0o777;
          cookieBody = readFileSync(cookiePath, "utf8");
        }
        return Promise.resolve({ stdout: "", stderr: "ERROR: Unsupported URL", exitCode: 1 });
      },
    });
    expect(requestedSource).toBe("arc");
    expect(requestedProfile).toBe("Profile 9");
    expect(command).toContain("--cookies");
    expect(command).not.toContain("--cookies-from-browser");
    expect(command).not.toContain(secret);
    expect(cookieMode).toBe(0o600);
    expect(cookieBody).toContain("# Netscape HTTP Cookie File");
    expect(cookieBody).toContain(`#HttpOnly_social.example\tFALSE\t/\tTRUE`);
    expect(cookieBody).toContain(secret);
    expect(cookiePath).toBeDefined();
    expect(cookiePath === undefined ? "" : relative(outputDirectory, cookiePath)).toStartWith("..");
    expect(cookiePath === undefined ? true : existsSync(cookiePath)).toBeFalse();
    expect(readdirSync(outputDirectory).some((name) => name.startsWith(".clip-auth-"))).toBeFalse();
    expect(result.status).toBe("unsupported");
    expect(JSON.stringify(result)).not.toContain("Profile 9");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.warnings.join(" ")).toContain("1 non-fatal warning");
  });

  test("rejects malformed or out-of-origin browser cookies without running yt-dlp or leaking values", async () => {
    const outputDirectory = temporaryDirectory();
    let invoked = false;
    const secret = "do-not-leak-this-value";
    const result = await captureMedia({
      url: new URL("https://social.example/post/1"),
      outputDirectory,
      timeoutMs: 15_000,
      maxFileBytes: 1_024,
      maxTotalBytes: 2_048,
      executable: "/fake/yt-dlp",
      cookieBrowser: { source: "brave" },
      exists: (path) => path === "/fake/yt-dlp",
      cookieProvider: () => Promise.resolve({
        cookies: [
          { name: "session", value: secret, domain: "attacker.example", hostOnly: true, path: "/" },
          { name: "session", value: `${secret}\n`, domain: "social.example", hostOnly: true, path: "/" },
          { value: secret, domain: "social.example", hostOnly: true, path: "/" },
        ],
        warnings: [`provider accidentally included ${secret}`],
      }),
      run: () => {
        invoked = true;
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      },
    });
    expect(invoked).toBeFalse();
    expect(result.status).toBe("failed");
    expect(result.warnings.join(" ")).toContain("rejected 3");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(readdirSync(outputDirectory).some((name) => name.startsWith(".clip-auth-"))).toBeFalse();
  });

  test("normalizes an explicit Cookie-Editor file without probing the also-selected browser", async () => {
    const directory = temporaryDirectory();
    const outputDirectory = join(directory, "output");
    const cookieFile = join(directory, "cookies.json");
    const secret = "file-cookie-secret";
    const original = JSON.stringify([{ name: "session", value: secret, domain: "social.example" }]);
    writeFileSync(cookieFile, original, { mode: 0o600 });
    let providerSource: string | undefined;
    let providerFile: string | undefined;
    let command: readonly string[] = [];
    let privateCookieFile: string | undefined;
    let privateCookieMode: number | undefined;
    let privateCookieBody: string | undefined;
    const result = await captureMedia({
      url: new URL("https://social.example/post/1"),
      outputDirectory,
      timeoutMs: 15_000,
      maxFileBytes: 1_024,
      maxTotalBytes: 2_048,
      executable: "/fake/yt-dlp",
      cookieBrowser: { source: "arc", profile: "Profile 9" },
      cookiesFile: cookieFile,
      exists: (path) => path === "/fake/yt-dlp",
      cookieProvider: (request) => {
        providerSource = request.source;
        if (request.source === "file") providerFile = request.file;
        return Promise.resolve({
          cookies: [{ name: "session", value: secret, domain: "social.example", hostOnly: true, path: "/", secure: true }],
          warnings: [],
        });
      },
      run: (specification) => {
        command = specification.command;
        const cookieIndex = command.indexOf("--cookies");
        privateCookieFile = command[cookieIndex + 1];
        if (privateCookieFile !== undefined) {
          privateCookieMode = statSync(privateCookieFile).mode & 0o777;
          privateCookieBody = readFileSync(privateCookieFile, "utf8");
        }
        return Promise.resolve({ stdout: "", stderr: "ERROR: Unsupported URL", exitCode: 1 });
      },
    });
    const cookieIndex = command.indexOf("--cookies");
    expect(providerSource).toBe("file");
    expect(providerFile).toBe(resolve(cookieFile));
    expect(command[cookieIndex + 1]).not.toBe(resolve(cookieFile));
    expect(privateCookieMode).toBe(0o600);
    expect(privateCookieBody).toContain(secret);
    expect(privateCookieFile).toBeDefined();
    expect(privateCookieFile === undefined ? true : existsSync(privateCookieFile)).toBeFalse();
    expect(command).not.toContain("--cookies-from-browser");
    expect(readFileSync(cookieFile, "utf8")).toBe(original);
    expect(result.warnings.join(" ")).toContain("took precedence");
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  test("does not promote oversized or unexpected files", async () => {
    const outputDirectory = temporaryDirectory();
    const result = await captureMedia({
      url: new URL("https://video.example/watch/large"),
      outputDirectory,
      timeoutMs: 15_000,
      maxFileBytes: 4,
      maxTotalBytes: 8,
      executable: "/fake/yt-dlp",
      exists: (path) => path === "/fake/yt-dlp",
      run: (specification) => {
        writeFileSync(join(specification.monitoredDirectory, "media-too-big.mp4"), "12345");
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      },
    });
    expect(result.status).toBe("unsupported");
    expect(result.records).toEqual([]);
    expect(result.warnings.join(" ")).toContain("larger than 4 bytes");
    expect(readdirSync(outputDirectory)).toEqual([]);
  });

  test("refuses credential URLs and never invokes yt-dlp", async () => {
    let invoked = false;
    const result = await captureMedia({
      url: new URL("https://person:secret@example.com/video"),
      outputDirectory: temporaryDirectory(),
      timeoutMs: 15_000,
      maxFileBytes: 1_024,
      maxTotalBytes: 2_048,
      executable: "/fake/yt-dlp",
      exists: () => true,
      run: () => {
        invoked = true;
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      },
    });
    expect(invoked).toBeFalse();
    expect(result).toMatchObject({ status: "failed", records: [] });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("yt-dlp video context", () => {
  test("captures only a thumbnail, exact-language transcript, and allowlisted video metadata", async () => {
    const outputDirectory = temporaryDirectory();
    const thumbnailBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let command: readonly string[] = [];
    let standardInput: string | undefined;
    let workingDirectory: string | undefined;
    const result = await captureVideoContext({
      url: new URL("https://video.example/watch?id=1&token=private"),
      outputDirectory,
      relativePrefix: "assets/media",
      timeoutMs: 15_000,
      maxFileBytes: 4_096,
      maxTotalBytes: 8_192,
      executable: "/fake/yt-dlp",
      nodeExecutable: "/fake/node",
      exists: (path) => path === "/fake/yt-dlp" || path === "/fake/node",
      readNodeVersion: () => "v22.14.0",
      run: (specification) => {
        command = specification.command;
        standardInput = specification.stdin;
        workingDirectory = specification.cwd;
        writeFileSync(join(specification.monitoredDirectory, "thumbnail-video.webp"), thumbnailBytes);
        writeFileSync(join(specification.monitoredDirectory, "transcript-video.en.vtt"), [
          "WEBVTT",
          "",
          "00:00.000 --> 00:02.000",
          "Hello",
          "",
          "00:01.000 --> 00:03.000",
          "Hello world",
          "",
        ].join("\n"));
        return Promise.resolve({
          stdout: `CLIP_MEDIA_JSON\t${JSON.stringify({
            id: "video",
            title: "Video title",
            description: "Video description",
            uploader: "Uploader",
            uploader_id: "uploader-id",
            channel: "Video channel",
            channel_id: "channel-id",
            webpage_url: "https://video.example/watch?id=1",
            extractor: "fixture",
            duration: 123,
          })}\n`,
          stderr: "",
          exitCode: 101,
        });
      },
    });

    const digest = createHash("sha256").update(thumbnailBytes).digest("hex");
    expect(result).toEqual({
      status: "captured",
      thumbnail: {
        path: `assets/media/${digest}.png`,
        mimeType: "image/png",
        bytes: thumbnailBytes.byteLength,
        sha256: digest,
      },
      transcript: {
        language: "en",
        markdown: "- [00:00] Hello\n- [00:01] world\n",
        cueCount: 2,
        truncated: false,
      },
      metadata: {
        id: "video",
        title: "Video title",
        description: "Video description",
        uploader: "Uploader",
        uploaderId: "uploader-id",
        channel: "Video channel",
        channelId: "channel-id",
        webpageUrl: "https://video.example/watch?id=1",
        extractor: "fixture",
        durationSeconds: 123,
      },
      warnings: [],
    });
    expect(existsSync(join(outputDirectory, `${digest}.png`))).toBeTrue();
    expect(readdirSync(outputDirectory).some((name) => name.endsWith(".vtt"))).toBeFalse();
    expect(command).toContain("--skip-download");
    expect(command).toContain("--no-simulate");
    expect(command).toContain("--write-thumbnail");
    expect(command).toContain("--write-subs");
    expect(command).toContain("--write-auto-subs");
    expect(command[command.indexOf("--sub-langs") + 1]).toBe("en");
    expect(command[command.indexOf("--sub-format") + 1]).toBe("vtt");
    expect(command[command.indexOf("--js-runtimes") + 1]).toBe("node:/fake/node");
    expect(command[command.indexOf("--print") + 1]).toStartWith("CLIP_MEDIA_JSON\t");
    expect(command[command.indexOf("--print") + 1]).not.toContain("after_move:");
    expect(command).not.toContain("--downloader");
    expect(command).not.toContain("--trim-filenames");
    const outputTemplates = command
      .flatMap((argument, index) => argument === "--output" ? [command[index + 1]] : [])
      .filter((argument): argument is string => argument !== undefined);
    expect(outputTemplates).toEqual([
      "unused-%(id).80B.%(ext)s",
      "thumbnail:thumbnail-%(id).80B.%(ext)s",
      "subtitle:transcript-%(id).80B.%(language).16B.%(ext)s",
    ]);
    expect(outputTemplates.every((template) => !template.includes(outputDirectory))).toBeTrue();
    expect(workingDirectory).toBeDefined();
    expect(workingDirectory === undefined ? "" : relative(realpathSync(outputDirectory), workingDirectory)).not.toStartWith("..");
    expect(command.join(" ")).not.toContain("token=private");
    expect(standardInput).toBe("https://video.example/watch?id=1&token=private\n");
  });

  test("rejects regex-like subtitle selectors before invoking yt-dlp", async () => {
    let invoked = false;
    const result = await captureVideoContext({
      url: new URL("https://video.example/watch/1"),
      outputDirectory: temporaryDirectory(),
      transcriptLanguage: "en.*",
      timeoutMs: 15_000,
      maxFileBytes: 4_096,
      maxTotalBytes: 8_192,
      executable: "/fake/yt-dlp",
      exists: () => true,
      run: () => {
        invoked = true;
        return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      },
    });
    expect(invoked).toBeFalse();
    expect(result.status).toBe("failed");
    expect(result.warnings.join(" ")).toContain("exact language identifier");
  });

  test("returns partial context when an otherwise successful video has no transcript", async () => {
    const result = await captureVideoContext({
      url: new URL("https://video.example/watch/1"),
      outputDirectory: temporaryDirectory(),
      transcriptLanguage: "fr",
      timeoutMs: 15_000,
      maxFileBytes: 4_096,
      maxTotalBytes: 8_192,
      executable: "/fake/yt-dlp",
      nodeExecutable: null,
      exists: (path) => path === "/fake/yt-dlp",
      run: (specification) => {
        writeFileSync(
          join(specification.monitoredDirectory, "thumbnail-video.jpg"),
          Uint8Array.from([0xff, 0xd8, 0xff]),
        );
        return Promise.resolve({
          stdout: 'CLIP_MEDIA_JSON\t{"title":"Silent fixture","duration":4}\n',
          stderr: "",
          exitCode: 0,
        });
      },
    });
    expect(result.status).toBe("partial");
    expect(result.thumbnail?.mimeType).toBe("image/jpeg");
    expect(result.transcript).toBeNull();
    expect(result.warnings.join(" ")).toContain("no fr transcript");
  });
});

test("media timeouts escalate to SIGKILL when a child ignores SIGTERM", async () => {
  const directory = temporaryDirectory();
  const fixture = join(directory, "ignore-term.sh");
  const monitoredDirectory = join(directory, "output");
  writeFileSync(fixture, "trap '' TERM\nwhile :; do :; done\n");
  mkdirSync(monitoredDirectory);
  const startedAt = Date.now();
  let failure: unknown;
  try {
    await runMediaCommand({
      command: ["/bin/sh", fixture],
      timeoutMs: 1_000,
      maxOutputBytes: 4_096,
      monitoredDirectory,
      maxFiles: 2,
      maxFileBytes: 1_024,
      maxTotalBytes: 2_048,
    });
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure instanceof Error ? failure.message : "").toContain("timed out");
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_800);
  expect(Date.now() - startedAt).toBeLessThan(5_000);
});

test("media commands run in their dedicated working directory", async () => {
  const directory = temporaryDirectory();
  const monitoredDirectory = join(directory, "output");
  mkdirSync(monitoredDirectory);
  const result = await runMediaCommand({
    command: ["/bin/pwd"],
    cwd: monitoredDirectory,
    timeoutMs: 1_000,
    maxOutputBytes: 4_096,
    monitoredDirectory,
    maxFiles: 2,
    maxFileBytes: 1_024,
    maxTotalBytes: 2_048,
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe(realpathSync(monitoredDirectory));
});

test("media timeouts kill a stubborn POSIX grandchild process", async () => {
  if (process.platform === "win32") return;
  const directory = temporaryDirectory();
  const fixture = join(directory, "stubborn-tree.sh");
  const grandchildPidFile = join(directory, "grandchild.pid");
  const monitoredDirectory = join(directory, "output");
  writeFileSync(fixture, [
    "trap '' TERM",
    "/bin/sh -c 'trap \"\" TERM; echo $$ > \"$1\"; while :; do sleep 60; done' child \"$1\" &",
    "while :; do sleep 60; done",
    "",
  ].join("\n"));
  mkdirSync(monitoredDirectory);

  let failure: unknown;
  try {
    await runMediaCommand({
      command: ["/bin/sh", fixture, grandchildPidFile],
      timeoutMs: 1_000,
      maxOutputBytes: 4_096,
      monitoredDirectory,
      maxFiles: 2,
      maxFileBytes: 1_024,
      maxTotalBytes: 2_048,
    });
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  const grandchildPid = Number(readFileSync(grandchildPidFile, "utf8").trim());
  expect(Number.isSafeInteger(grandchildPid)).toBeTrue();

  const processExists = (): boolean => {
    try {
      process.kill(grandchildPid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    for (let attempt = 0; attempt < 40 && processExists(); attempt += 1) await Bun.sleep(50);
    expect(processExists()).toBeFalse();
  } finally {
    if (processExists()) process.kill(grandchildPid, "SIGKILL");
  }
}, 10_000);
