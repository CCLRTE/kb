import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import {
  buildMediaCookieOptions,
  captureMedia,
  createMediaCookieProvider,
  discoverYtDlp,
  parseMediaMetadata,
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
        writeFileSync(join(specification.monitoredDirectory, "media-post.mp4"), bytes);
        return Promise.resolve({
          stdout: `CLIP_MEDIA_JSON\t${JSON.stringify({
            id: "post",
            title: "Clip",
            webpage_url: "https://video.example/watch?id=1",
            duration: 9,
          })}\n`,
          stderr: "",
          exitCode: 0,
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
    expect(command[command.indexOf("--batch-file") + 1]).toBe("-");
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
