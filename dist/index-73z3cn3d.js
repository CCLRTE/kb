// @bun
import {
  cloneBrowserProfile
} from "./index-k3pqw1a7.js";
import {
  adapterCapabilities,
  inspectClipEnvironment,
  renderAdapterCapabilities,
  renderDoctorReport
} from "./index-5vt7gy7e.js";
import {
  CONTENT_REWRITE_TRUNCATION_WARNING,
  MAX_COOKIE_BYTES,
  acquireBrowser,
  acquireCookieHttp,
  acquireCookieRecords,
  acquireFile,
  acquireHttp,
  articleMetadataLimits,
  assertSafePersistentProfile,
  buildClipMarkdown,
  classifyPlatformUrl,
  filterCookieProviderResult,
  filterCookies,
  parseBlueskyCapture,
  parseHackerNewsCapture,
  parseRedditCapture,
  readCookieFile,
  renderCapturedDocument,
  renderCookieHeader,
  renderNetscapeCookieJar,
  resolveRemote,
  rewriteContentWithStatus,
  scanImageSources,
  slugify
} from "./index-yn2qjcxe.js";
import {
  startNetworkProxy
} from "./index-k4cczfgz.js";
import {
  FetchFailure,
  decodeBytes,
  safeFetch
} from "./index-kvxzb85x.js";
import {
  abortCaptureBundle,
  beginCaptureBundle,
  commitCaptureBundle,
  redactSensitiveText,
  redactSensitiveTextWithCount,
  sanitizeArtifactUrl,
  writeCaptureBundle
} from "./index-7x30yhyy.js";
import {
  sanitizeTerminalLine,
  sanitizeTerminalText
} from "./index-q32a8bfd.js";
import {
  captureUrl,
  parseArguments,
  usage
} from "./index-6g2pv9d2.js";
import {
  BoundedByteBuffer
} from "./index-efcktfvv.js";

// src/clip/capture.ts
import {
  chmodSync as chmodSync2,
  copyFileSync,
  existsSync as existsSync2,
  mkdirSync as mkdirSync3,
  mkdtempSync as mkdtempSync2,
  readFileSync as readFileSync2,
  rmSync as rmSync2,
  statSync as statSync2
} from "fs";
import { tmpdir as tmpdir2 } from "os";
import { join as join3 } from "path";

// src/clip/assets.ts
import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
function startsWith(bytes, signature) {
  return signature.every((byte, index) => bytes[index] === byte);
}
function ascii(bytes, start, length) {
  return new TextDecoder().decode(bytes.slice(start, start + length));
}
function sniffImage(bytes) {
  if (startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (startsWith(bytes, [255, 216, 255]))
    return { mimeType: "image/jpeg", extension: "jpg" };
  const prefix = ascii(bytes, 0, 6);
  if (prefix === "GIF87a" || prefix === "GIF89a")
    return { mimeType: "image/gif", extension: "gif" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis")
      return { mimeType: "image/avif", extension: "avif" };
  }
  return null;
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function inertAssetUrl(url) {
  const inert = new URL(url);
  inert.username = "";
  inert.password = "";
  inert.search = "";
  inert.hash = "";
  return inert.href;
}
function safeAssetFailure(error) {
  if (!(error instanceof FetchFailure))
    return "image request failed";
  switch (error.code) {
    case "private-network":
      return "image request was blocked by the private-network boundary";
    case "timeout":
      return "image request timed out";
    case "too-large":
      return "image response exceeded its byte limit";
    case "redirect":
      return "image redirect chain was rejected";
    case "dns":
      return "image hostname could not be resolved";
    case "http":
      return "image server returned an unsuccessful response";
    case "invalid-url":
      return "image URL was rejected";
    case "network":
      return "image request failed";
  }
}
async function downloadImage(source, options, maxBytes) {
  const remote = resolveRemote(source, options.baseUrl);
  if (remote === null)
    return { ok: false, source, warning: "Skipped a non-web image target.", networkBytes: 0 };
  let authenticationWarning = null;
  let cookieHeader;
  if (options.cookieHeaderProvider !== undefined) {
    try {
      cookieHeader = await options.cookieHeaderProvider(remote) ?? undefined;
    } catch {
      authenticationWarning = "The explicitly selected cookie source could not provide origin-scoped image cookies.";
    }
  }
  try {
    const response = await (options.fetchResource ?? safeFetch)(remote, {
      timeoutMs: options.timeoutMs,
      maxBytes,
      allowPrivateNetwork: options.allowPrivateNetwork,
      userAgent: options.userAgent,
      referer: options.baseUrl.href,
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1",
      ...cookieHeader === undefined ? {} : { cookieHeader },
      retries: 0
    });
    const image = sniffImage(response.bytes);
    if (image === null) {
      const declared = response.contentType?.split(";")[0]?.trim() ?? "unknown content type";
      return {
        ok: false,
        source,
        warning: `${authenticationWarning === null ? "" : `${authenticationWarning} `}Kept remote ${inertAssetUrl(remote)}: response was not a supported raster image (${declared})`,
        networkBytes: response.bytes.byteLength
      };
    }
    return { ok: true, source, url: response.finalUrl, bytes: response.bytes, image, networkBytes: response.bytes.byteLength };
  } catch (error) {
    return {
      ok: false,
      source,
      warning: `${authenticationWarning === null ? "" : `${authenticationWarning} `}Kept remote ${inertAssetUrl(remote)}: ${safeAssetFailure(error)}`,
      networkBytes: maxBytes
    };
  }
}
async function localizeAssets(content, options) {
  const maxSources = Math.max(1, Math.min(options.maxSources ?? 1000, 1e4));
  const discovery = scanImageSources(content, maxSources + 1);
  const discoveredSources = [...discovery.sources].sort((left, right) => left.localeCompare(right));
  const sources = discoveredSources.slice(0, maxSources);
  const warnings = discoveredSources.length > sources.length ? [`Image localization stopped at ${sources.length} sources; ${discovery.truncated ? "at least " : ""}${discoveredSources.length - sources.length} additional remote image(s) remain inert links.`] : [];
  if (discovery.truncated) {
    warnings.push("Image discovery reached a safety limit; additional or over-limit image candidates remain inert.");
  }
  const rewrittenResult = (localBySource2) => {
    const rewritten2 = rewriteContentWithStatus(content, options.baseUrl, localBySource2, {
      maxImageSources: maxSources + 1
    });
    if (rewritten2.truncated)
      warnings.push(CONTENT_REWRITE_TRUNCATION_WARNING);
    return rewritten2;
  };
  if (discovery.requiresInertFallback) {
    const rewritten2 = rewrittenResult(new Map);
    return {
      ...rewritten2,
      assets: [],
      warnings
    };
  }
  if (discoveredSources.length === 0) {
    const rewritten2 = rewrittenResult(new Map);
    return {
      ...rewritten2,
      assets: [],
      warnings
    };
  }
  mkdirSync(options.assetsDirectory, { recursive: true });
  const results = new Map;
  const workerCount = Math.max(1, Math.min(options.concurrency ?? 4, sources.length, 16));
  let remainingNetworkBytes = options.maxTotalAssetBytes;
  const deadline = Date.now() + options.timeoutMs;
  for (let cursor = 0;cursor < sources.length && remainingNetworkBytes > 0; ) {
    const remainingTime = deadline - Date.now();
    if (remainingTime <= 0)
      break;
    const batchSize = Math.min(workerCount, sources.length - cursor, remainingNetworkBytes);
    const allocation = Math.min(options.maxAssetBytes, Math.floor(remainingNetworkBytes / batchSize));
    const batch = sources.slice(cursor, cursor + batchSize);
    cursor += batch.length;
    remainingNetworkBytes -= allocation * batch.length;
    const downloaded = await Promise.all(batch.map((source) => downloadImage(source, { ...options, timeoutMs: Math.max(1, Math.min(options.timeoutMs, remainingTime)) }, allocation)));
    for (const result of downloaded) {
      results.set(result.source, result);
      remainingNetworkBytes += Math.max(0, allocation - result.networkBytes);
    }
  }
  const localBySource = new Map;
  const assetsByHash = new Map;
  let totalBytes = 0;
  let unattempted = 0;
  for (const source of sources) {
    const result = results.get(source);
    if (result === undefined) {
      unattempted += 1;
      continue;
    }
    if (!result.ok) {
      warnings.push(result.warning);
      continue;
    }
    const digest = sha256(result.bytes);
    const existing = assetsByHash.get(digest);
    if (existing !== undefined) {
      localBySource.set(source, existing.path);
      continue;
    }
    if (totalBytes + result.bytes.byteLength > options.maxTotalAssetBytes) {
      warnings.push(`Kept remote ${inertAssetUrl(result.url)}: total asset limit ${options.maxTotalAssetBytes} bytes would be exceeded`);
      continue;
    }
    const filename = `${digest}.${result.image.extension}`;
    const relativePath = `assets/${filename}`;
    writeFileSync(join(options.assetsDirectory, filename), result.bytes, { mode: 420 });
    totalBytes += result.bytes.byteLength;
    const record = {
      source: (() => {
        const resolved = resolveRemote(source, options.baseUrl);
        return resolved === null ? source : inertAssetUrl(resolved);
      })(),
      url: inertAssetUrl(result.url),
      path: relativePath,
      mimeType: result.image.mimeType,
      bytes: result.bytes.byteLength,
      sha256: digest
    };
    assetsByHash.set(digest, record);
    localBySource.set(source, relativePath);
  }
  if (unattempted > 0) {
    const reason = Date.now() >= deadline ? "total asset deadline" : "aggregate asset network-byte budget";
    warnings.push(`${unattempted} remote image source(s) were not requested because the ${reason} was exhausted.`);
  }
  const rewritten = rewrittenResult(localBySource);
  return {
    ...rewritten,
    assets: [...assetsByHash.values()].sort((left, right) => left.path.localeCompare(right.path)),
    warnings
  };
}

// src/clip/extract.ts
var nonEmpty = (value) => typeof value === "string" && value.trim() !== "" ? value.trim() : null;
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var MAX_RENDERED_PAGE_FALLBACK_BYTES = 256 * 1024;
var renderedPageTruncationMarker = "[Rendered page text truncated at the bounded fallback limit.]";
function isWhitespaceCodeUnit(code) {
  return code >= 9 && code <= 13 || code === 32 || code === 160 || code === 5760 || code >= 8192 && code <= 8202 || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
}
function utf8CodePointWidth(value, index) {
  const first = value.charCodeAt(index);
  if (first <= 127)
    return { bytes: 1, codeUnits: 1 };
  if (first <= 2047)
    return { bytes: 2, codeUnits: 1 };
  const second = value.charCodeAt(index + 1);
  if (first >= 55296 && first <= 56319 && second >= 56320 && second <= 57343) {
    return { bytes: 4, codeUnits: 2 };
  }
  return { bytes: 3, codeUnits: 1 };
}
function utf8PrefixEnd(value, maxBytes) {
  let bytes = 0;
  let index = 0;
  while (index < value.length) {
    const width = utf8CodePointWidth(value, index);
    if (bytes + width.bytes > maxBytes)
      break;
    bytes += width.bytes;
    index += width.codeUnits;
  }
  return index;
}
function boundedRenderedPageText(value, requestedByteLimit) {
  if (typeof value !== "string")
    return null;
  const byteLimit = typeof requestedByteLimit === "number" && Number.isSafeInteger(requestedByteLimit) && requestedByteLimit > 0 ? Math.min(requestedByteLimit, MAX_RENDERED_PAGE_FALLBACK_BYTES) : MAX_RENDERED_PAGE_FALLBACK_BYTES;
  const fullEnd = utf8PrefixEnd(value, byteLimit);
  if (fullEnd === value.length) {
    const content = value.trim();
    return content === "" ? null : { content, truncated: false, byteLimit };
  }
  const detailedMarker = `

${renderedPageTruncationMarker}
`;
  const detailedMarkerBytes = new TextEncoder().encode(detailedMarker).byteLength;
  const marker = detailedMarkerBytes < byteLimit ? detailedMarker : byteLimit >= 3 ? "\u2026" : ".".repeat(byteLimit);
  const markerBytes = new TextEncoder().encode(marker).byteLength;
  const boundedEnd = utf8PrefixEnd(value, byteLimit - markerBytes);
  const prefix = value.slice(0, boundedEnd).trim();
  if (prefix === "")
    return null;
  return { content: `${prefix}${marker}`, truncated: true, byteLimit };
}
function boundedTrimmedSlice(value, start, end, maxCodeUnits) {
  while (start < end && isWhitespaceCodeUnit(value.charCodeAt(start)))
    start += 1;
  while (end > start && isWhitespaceCodeUnit(value.charCodeAt(end - 1)))
    end -= 1;
  if (start === end)
    return null;
  if (end - start <= maxCodeUnits)
    return value.slice(start, end);
  let boundedEnd = start + Math.max(0, maxCodeUnits - 1);
  const finalCode = value.charCodeAt(boundedEnd - 1);
  if (finalCode >= 55296 && finalCode <= 56319)
    boundedEnd -= 1;
  return `${value.slice(start, boundedEnd)}\u2026`;
}
function boundedMetadata(value, maxCodeUnits) {
  return typeof value === "string" ? boundedTrimmedSlice(value, 0, value.length, maxCodeUnits) : null;
}
function countWords(value) {
  let count = 0;
  let insideWord = false;
  for (let index = 0;index < value.length; index += 1) {
    if (isWhitespaceCodeUnit(value.charCodeAt(index))) {
      insideWord = false;
    } else if (!insideWord) {
      count += 1;
      insideWord = true;
    }
  }
  return count;
}
function isAsciiWordCodeUnit(code) {
  return code >= 48 && code <= 57 || code >= 65 && code <= 90 || code === 95 || code >= 97 && code <= 122;
}
function asciiCaseEqualAt(value, offset, expected, end = value.length) {
  if (offset < 0 || offset + expected.length > end)
    return false;
  for (let index = 0;index < expected.length; index += 1) {
    const actual = value.charCodeAt(offset + index);
    const folded = actual >= 65 && actual <= 90 ? actual + 32 : actual;
    if (folded !== expected.charCodeAt(index))
      return false;
  }
  return true;
}
function tagHasExactCommentClass(html, start, end) {
  const doubleQuoted = 'class="comment"';
  const singleQuoted = "class='comment'";
  for (let index = start;index < end; index += 1) {
    const preceding = index === 0 ? -1 : html.charCodeAt(index - 1);
    if (preceding >= 0 && isAsciiWordCodeUnit(preceding))
      continue;
    if (asciiCaseEqualAt(html, index, doubleQuoted, end) || asciiCaseEqualAt(html, index, singleQuoted, end))
      return true;
  }
  return false;
}
function countDefuddleCommentMarkers(html) {
  let count = 0;
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0)
      break;
    cursor = start + 1;
    if (!asciiCaseEqualAt(html, start + 1, "div"))
      continue;
    const afterName = start + 4;
    if (afterName < html.length && isAsciiWordCodeUnit(html.charCodeAt(afterName)))
      continue;
    const end = html.indexOf(">", afterName);
    if (end < 0)
      break;
    cursor = end + 1;
    if (tagHasExactCommentClass(html, afterName, end))
      count += 1;
  }
  return count;
}
function countDefuddleSeparators(html) {
  let count = 0;
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0)
      break;
    cursor = start + 1;
    if (!asciiCaseEqualAt(html, start + 1, "hr"))
      continue;
    const afterName = start + 3;
    const next = html.charCodeAt(afterName);
    if (next === 62) {
      count += 1;
      cursor = afterName + 1;
      continue;
    }
    if (!isWhitespaceCodeUnit(next))
      continue;
    const end = html.indexOf(">", afterName + 1);
    if (end < 0)
      break;
    count += 1;
    cursor = end + 1;
  }
  return count;
}
function countMarkdownMarkers(value, kind, limit) {
  const prefix = kind === "image" ? "![" : "[";
  let count = 0;
  let cursor = 0;
  while (count < limit && cursor < value.length) {
    const start = value.indexOf(prefix, cursor);
    if (start < 0)
      break;
    const openBracket = kind === "image" ? start + 1 : start;
    const closeBracket = value.indexOf("]", openBracket + 1);
    if (closeBracket < 0)
      break;
    const nonEmptyLinkLabel = kind === "image" || closeBracket > openBracket + 1;
    if (nonEmptyLinkLabel && value.charCodeAt(closeBracket + 1) === 40) {
      count += 1;
      cursor = closeBracket + 2;
    } else {
      cursor = start + prefix.length;
    }
  }
  return count;
}
function defuddleWorkerUrl(moduleUrl = import.meta.url) {
  return moduleUrl.endsWith(".ts") ? new URL("./defuddle-worker.ts", moduleUrl) : new URL("./clip/defuddle-worker.js", moduleUrl);
}
async function runDefuddleWorker(acquisition, scope, timeoutMs) {
  const worker = new Worker(defuddleWorkerUrl().href, { type: "module" });
  let timeout;
  try {
    const result = await new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`Defuddle exceeded the ${timeoutMs}ms extraction deadline.`));
      }, timeoutMs);
      worker.onmessage = (event) => {
        const message = event.data;
        if (!isRecord(message) || typeof message.ok !== "boolean") {
          reject(new Error("Defuddle worker returned malformed data."));
          return;
        }
        if (message.ok === true && isRecord(message.value)) {
          resolve({ ok: true, value: message.value });
          return;
        }
        resolve({
          ok: false,
          message: typeof message.message === "string" ? message.message.slice(0, 1000) : "Defuddle worker failed."
        });
      };
      worker.onerror = () => reject(new Error("Defuddle worker failed."));
      worker.postMessage({
        html: acquisition.body,
        url: acquisition.finalUrl.href,
        includeReplies: scope === "page" ? false : scope === "comments" ? true : "extractors"
      });
    });
    if (!result.ok)
      throw new Error(result.message);
    return result.value;
  } finally {
    if (timeout !== undefined)
      clearTimeout(timeout);
    worker.terminate();
  }
}
function detectPlatform(url) {
  return classifyPlatformUrl(url.href)?.platform ?? "generic";
}
function detectedExtractorPlatform(value, fallback) {
  if (fallback !== "generic")
    return fallback;
  return value === "github" ? "github" : value === "discourse" ? "discourse" : fallback;
}
var trackingKeys = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "mibextid"
]);
var credentialQueryKey = /(?:^|[-_])(?:access[-_]?token|refresh[-_]?token|auth(?:orization)?|api[-_]?key|credential|csrf|xsrf|jwt|pass(?:word|wd)?|secret|session[-_]?id|signature|sig|code|ticket|otp|nonce|key|magic[-_]?link|one[-_]?time)(?:$|[-_])/i;
function canonicalizeUrl(url, platform = detectPlatform(url)) {
  const canonical = new URL(url);
  canonical.hash = "";
  for (const key of [...canonical.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || trackingKeys.has(key.toLowerCase()) || credentialQueryKey.test(key)) {
      canonical.searchParams.delete(key);
    }
  }
  if (platform === "x") {
    canonical.hostname = "x.com";
    canonical.searchParams.delete("s");
    canonical.searchParams.delete("t");
  }
  return canonical;
}
var MAX_SCHEMA_COMMENT_NODES = 50000;
function schemaCommentCount(value) {
  const seen = new Set;
  const stack = [value];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_SCHEMA_COMMENT_NODES) {
    const current = stack.pop();
    visited += 1;
    if (typeof current !== "object" || current === null || seen.has(current))
      continue;
    seen.add(current);
    if (Array.isArray(current)) {
      const remaining2 = MAX_SCHEMA_COMMENT_NODES - visited;
      for (let index = Math.min(current.length, remaining2) - 1;index >= 0; index -= 1) {
        stack.push(current[index]);
      }
      continue;
    }
    if (!isRecord(current))
      continue;
    const own = current.commentCount;
    if (typeof own === "number" && Number.isSafeInteger(own) && own >= 0)
      return own;
    if (typeof own === "string" && /^\d+$/.test(own)) {
      const parsed = Number(own);
      if (Number.isSafeInteger(parsed))
        return parsed;
    }
    const children = [];
    const remaining = MAX_SCHEMA_COMMENT_NODES - visited;
    if (remaining <= 0)
      continue;
    for (const key in current) {
      if (!Object.prototype.hasOwnProperty.call(current, key))
        continue;
      children.push(current[key]);
      if (children.length >= remaining)
        break;
    }
    for (let index = children.length - 1;index >= 0; index -= 1)
      stack.push(children[index]);
  }
  return null;
}
function countDefuddleConversationItems(response, platform) {
  const html = nonEmpty(response.content);
  const extractorType = nonEmpty(response.extractorType);
  if (html === null || extractorType === null)
    return null;
  const supported = new Set(["twitter", "reddit", "hackernews", "github", "discourse", "linkedin"]);
  if (!supported.has(extractorType))
    return null;
  const comments = countDefuddleCommentMarkers(html);
  if (platform !== "x" || extractorType !== "twitter")
    return comments;
  const separators = countDefuddleSeparators(html);
  return comments + Math.max(0, separators - (comments > 0 ? 1 : 0));
}
function restoreXPostLineBreaks(content, description) {
  if (description === null || !/[\r\n]/.test(description))
    return content;
  const preserved = description.replace(/\r\n?/g, `
`).trim();
  const flattened = preserved.replace(/\s+/g, " ");
  const offset = content.indexOf(flattened);
  if (offset < 0)
    return content;
  const literal = preserved.split(`
`).map((line) => {
    let escaped = line.replace(/\\/g, "\\\\").replace(/([`*_~[\]])/g, "\\$1").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    escaped = escaped.replace(/^(\s*)(#{1,6}|[-+]|\d+[.)])(?=\s)/, "$1\\$2");
    if (/^\s*-{3,}\s*$/.test(escaped))
      escaped = escaped.replace("-", "\\-");
    if (/^(?: {4}|\t)/.test(escaped))
      escaped = `&#32;${escaped.slice(1)}`;
    return escaped;
  }).join(`
`);
  return `${content.slice(0, offset)}${literal}${content.slice(offset + flattened.length)}`;
}
function compactCount(value, suffix) {
  const number = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(number) || number < 0)
    return null;
  const multiplier = suffix?.toLowerCase() === "m" ? 1e6 : suffix?.toLowerCase() === "k" ? 1000 : 1;
  const result = Math.floor(number * multiplier);
  return Number.isSafeInteger(result) ? result : null;
}
function visibleCommentCount(content, platform) {
  const patterns = platform === "x" ? [/\bread\s+([\d,.]+)\s*([km])?\s+repl(?:y|ies)\b/i, /\b([\d,.]+)\s*([km])?\s+repl(?:y|ies)\b/i] : [/\b(?:view|read|show)\s+(?:all\s+)?([\d,.]+)\s*([km])?\s+comments?\b/i];
  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (match?.[1] === undefined)
      continue;
    const count = compactCount(match[1], match[2]);
    if (count !== null)
      return count;
  }
  return null;
}
var blockedPattern = /(?:verify (?:that )?you are (?:a )?human|(?:complete|solve) (?:the )?captcha|\bcaptcha\b|access denied|request (?:has been )?blocked|unusual traffic|cloudflare ray id)/i;
var blockedTitlePattern = /^(?:403(?: forbidden)?|access denied|request blocked|unusual traffic|verify (?:that )?you are (?:a )?human|human verification|captcha|security (?:check|verification)|attention required|just a moment(?:\.{3})?)$/i;
var blockedContextPattern = /(?:\b(?:please )?(?:verify|confirm) (?:that )?you are (?:a )?human\b|\b(?:complete|solve) (?:the )?captcha\b|\b(?:you (?:do not|don't) have permission|you have been blocked)\b|\b(?:your|this) (?:request|access|ip(?: address)?) (?:has been|was|is) blocked\b|\bunusual traffic from your (?:computer )?network\b|\bautomated (?:queries|requests)\b|\b(?:before proceeding|to continue),? (?:please )?(?:verify|complete|enable)\b|\bcloudflare ray id\b)/i;
var blockedStandaloneLinePattern = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]+)?(?:403(?: forbidden)?|access denied|request blocked|unusual traffic|verify (?:that )?you are (?:a )?human|captcha|security (?:check|verification))[.!]?[ \t]*(?:\r?\n|$)/i;
var articleDiscussionPattern = /(?:\bhow to\b|\btroubleshoot(?:ing)?\b|\b(?:this|the) (?:article|guide|tutorial)\b|\b(?:this|the) (?:article|guide|tutorial) explains?\b|\blearn (?:how|why)\b)/i;
var MAX_BLOCKED_SHELL_CODE_UNITS = 4096;
var MAX_BLOCKED_SHELL_WORDS = 160;
var MAX_STANDALONE_BLOCKED_SHELL_WORDS = 24;
function looksLikeBlockedShell(content, title) {
  if (content.length > MAX_BLOCKED_SHELL_CODE_UNITS)
    return false;
  const wordCount = countWords(content);
  if (wordCount > MAX_BLOCKED_SHELL_WORDS)
    return false;
  const normalizedTitle = (title ?? "").slice(0, articleMetadataLimits.title).replace(/\s+/g, " ").trim();
  const boundedVisible = `${normalizedTitle}
${content}`;
  if (articleDiscussionPattern.test(boundedVisible))
    return false;
  if (wordCount <= MAX_STANDALONE_BLOCKED_SHELL_WORDS && blockedStandaloneLinePattern.test(content))
    return true;
  const exactGateTitle = blockedTitlePattern.test(normalizedTitle);
  const hasBlockSignal = exactGateTitle || blockedPattern.test(content);
  return hasBlockSignal && (exactGateTitle || blockedContextPattern.test(content));
}
var authenticationGatePattern = /(?:\b(?:sign|log) in to (?:continue|read|view|see|access|comment|reply)\b|\blogin required\b|\bmembers? only\b|\bsubscriber-only\b|\bsubscribe to (?:continue|read)\b|\bthis content is private\b|\byou must be logged in\b)/i;
var shellPattern = /(?:enable javascript|javascript is disabled|something went wrong|try reloading)/i;
var xReplyGatePattern = /\bjoin\s+x\s+now\s+to\s+read\s+repl(?:y|ies)\b/i;
var xCombinedAccountShellPattern = /\blog\s*in\s*sign\s*up\b/i;
var loginShellPattern = /\blog\s*in\b/i;
var signupShellPattern = /\bsign\s*up\b/i;
function isRenderedConversationAccessGate(content, platform) {
  if (authenticationGatePattern.test(content))
    return true;
  return platform === "x" && (xReplyGatePattern.test(content) || xCombinedAccountShellPattern.test(content) || loginShellPattern.test(content) && signupShellPattern.test(content));
}
function statusFor(content, title, scope, contentTruncated, renderedTextFallback) {
  const visible = `${title ?? ""}
${content}`;
  if (looksLikeBlockedShell(content, title))
    return "blocked";
  if (authenticationGatePattern.test(visible) && content.length < 1500)
    return "auth-required";
  if (shellPattern.test(visible) && content.length < 500)
    return "unsupported";
  if (content.trim().length < 40)
    return "unsupported";
  if (authenticationGatePattern.test(visible))
    return "partial";
  if (contentTruncated || renderedTextFallback)
    return "partial";
  if (scope === "thread" || scope === "comments")
    return "partial";
  return "complete";
}
function qualityScore(article, status, wordCount, capturedItems, acquisition) {
  const statusWeight = {
    complete: 5000,
    partial: 2000,
    "auth-required": -2000,
    blocked: -4000,
    unsupported: -5000
  };
  const images = countMarkdownMarkers(article.content, "image", 100);
  const links = countMarkdownMarkers(article.content, "link", 500);
  const acquisitionAdjustment = acquisition.method.startsWith("browser") ? acquisition.contentType?.toLowerCase().includes("text/plain") === true ? -500 : 0 : 0;
  return statusWeight[status] + Math.min(article.content.length, 50000) + Math.min(wordCount, 1e4) * 5 + Math.min(capturedItems, 1000) * 50 + images * 100 + links * 5 + acquisitionAdjustment;
}
function plainTextArticle(acquisition) {
  const content = acquisition.body.trim();
  if (content === "")
    return null;
  const browserTitle = boundedMetadata(acquisition.browserTitle, articleMetadataLimits.title);
  const firstHeading = browserTitle === null ? firstMarkdownHeading(content) : null;
  const pathname = acquisition.finalUrl.pathname;
  let pathEnd = pathname.length;
  while (pathEnd > 0 && pathname.charCodeAt(pathEnd - 1) === 47)
    pathEnd -= 1;
  const pathStart = pathname.lastIndexOf("/", pathEnd - 1) + 1;
  const lastSegment = boundedTrimmedSlice(pathname, pathStart, pathEnd, articleMetadataLimits.title);
  return {
    content,
    title: browserTitle ?? firstHeading ?? lastSegment ?? boundedMetadata(acquisition.finalUrl.hostname, articleMetadataLimits.title),
    author: null,
    published: null,
    description: null
  };
}
function firstMarkdownHeading(content) {
  let lineStart = 0;
  while (lineStart < content.length) {
    const newline = content.indexOf(`
`, lineStart);
    const lineEnd = newline < 0 ? content.length : newline;
    let cursor = lineStart;
    let hashes = 0;
    while (hashes < 3 && cursor < lineEnd && content.charCodeAt(cursor) === 35) {
      hashes += 1;
      cursor += 1;
    }
    if (hashes > 0 && cursor < lineEnd && (content.charCodeAt(cursor) === 32 || content.charCodeAt(cursor) === 9)) {
      const heading = boundedTrimmedSlice(content, cursor, lineEnd, articleMetadataLimits.title);
      if (heading !== null)
        return heading;
    }
    if (newline < 0)
      break;
    lineStart = newline + 1;
  }
  return null;
}
async function extractPage(acquisition, scope, timeoutMs = 30000) {
  let platform = detectPlatform(acquisition.finalUrl);
  const contentType = acquisition.contentType?.toLowerCase() ?? "";
  let article = null;
  let wordCount = 0;
  let expectedItems = null;
  let structurallyCapturedItems = null;
  let extractor = "plain-text";
  const warnings = [...acquisition.warnings];
  const renderedPage = scope === "page" && acquisition.method.startsWith("browser") ? boundedRenderedPageText(acquisition.renderedText, acquisition.renderedTextByteLimit) : null;
  let renderedPageFallback = false;
  let renderedPageFallbackTruncated = false;
  if (contentType.includes("text/markdown") || contentType.includes("text/plain")) {
    article = plainTextArticle(acquisition);
    wordCount = article === null ? 0 : countWords(article.content);
    if (acquisition.method.startsWith("browser")) {
      warnings.push("Rendered readable-text fallback may include surrounding account or interface content; review it before reuse.");
    }
  } else {
    try {
      const response = await runDefuddleWorker(acquisition, scope, timeoutMs);
      platform = detectedExtractorPlatform(response.extractorType, platform);
      const content = nonEmpty(response.contentMarkdown) ?? nonEmpty(response.content);
      if (content !== null) {
        const description = boundedMetadata(response.description, articleMetadataLimits.description);
        article = {
          content: platform === "x" ? restoreXPostLineBreaks(content, description) : content,
          title: boundedMetadata(response.title, articleMetadataLimits.title) ?? boundedMetadata(acquisition.browserTitle, articleMetadataLimits.title),
          author: boundedMetadata(response.author, articleMetadataLimits.author),
          published: boundedMetadata(response.published, articleMetadataLimits.published),
          description
        };
        wordCount = typeof response.wordCount === "number" && Number.isSafeInteger(response.wordCount) && response.wordCount >= 0 ? response.wordCount : countWords(content);
        expectedItems = schemaCommentCount(response.schemaOrgData);
        structurallyCapturedItems = countDefuddleConversationItems(response, platform);
        extractor = platform === "generic" ? "defuddle" : `defuddle:${platform}`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (renderedPage !== null) {
        warnings.push("Article extraction failed; evaluated the bounded rendered-page text fallback from the same browser navigation.");
      } else {
        throw new Error(`Defuddle could not parse this acquisition: ${message}`, { cause: error });
      }
    }
  }
  if (renderedPage !== null) {
    const primaryStatus = article === null ? "unsupported" : statusFor(article.content, article.title, scope, acquisition.contentTruncated === true, false);
    const fallbackBase = plainTextArticle({
      ...acquisition,
      body: renderedPage.content,
      contentType: "text/plain; charset=utf-8"
    });
    if (fallbackBase !== null) {
      const fallbackStatus = statusFor(fallbackBase.content, fallbackBase.title, scope, renderedPage.truncated || acquisition.renderedTextTruncated === true, true);
      if (article === null || primaryStatus === "unsupported" && fallbackStatus !== "unsupported") {
        const primary = article;
        article = {
          ...fallbackBase,
          title: primary?.title ?? fallbackBase.title,
          author: primary?.author ?? fallbackBase.author,
          published: primary?.published ?? fallbackBase.published,
          description: primary?.description ?? fallbackBase.description
        };
        wordCount = countWords(article.content);
        extractor = primary === null ? "rendered-page" : `${extractor}+rendered-page`;
        renderedPageFallback = true;
        renderedPageFallbackTruncated = renderedPage.truncated || acquisition.renderedTextTruncated === true;
        warnings.push("Used bounded rendered-page text because article extraction produced no usable page body; it may include surrounding account or interface text and cannot prove feed completeness.");
        if (renderedPageFallbackTruncated) {
          warnings.push(`Rendered-page text reached the ${renderedPage.byteLimit}-byte fallback limit or the browser read boundary and was truncated.`);
        }
      }
    }
  }
  if (article === null)
    return null;
  const renderedConversation = scope !== "page" && structurallyCapturedItems === null ? nonEmpty(acquisition.renderedText) : null;
  if (renderedConversation !== null && renderedConversation !== article.content.trim()) {
    if (isRenderedConversationAccessGate(renderedConversation, platform)) {
      warnings.push("Skipped the separately rendered conversation context because it exposed an access gate rather than a trustworthy reply or comment tree.");
    } else {
      article = {
        ...article,
        content: `${article.content.trimEnd()}

## Rendered conversation context

${renderedConversation}
`
      };
      wordCount = countWords(article.content);
      extractor = `${extractor}+rendered-context`;
      warnings.push("Preserved the separately rendered conversation context because the article extractor exposed no trustworthy item tree; it can include duplicated article, account, or interface text.");
    }
  }
  expectedItems ??= visibleCommentCount(article.content, platform);
  const capturedItems = scope === "page" ? 1 : structurallyCapturedItems ?? 0;
  if (scope === "page") {
    expectedItems = null;
  } else if (structurallyCapturedItems === null) {
    warnings.push("The rendered response exposed no trustworthy per-item structure; capturedItems is conservatively reported as 0.");
  } else if (expectedItems !== null && capturedItems > expectedItems) {
    warnings.push(`The source declared ${expectedItems} scoped items, but ${capturedItems} items were observed; the expected count was normalized to the observed count.`);
    expectedItems = capturedItems;
  }
  const status = statusFor(article.content, article.title, scope, renderedPageFallback ? renderedPageFallbackTruncated : acquisition.contentTruncated === true, renderedPageFallback || acquisition.method.startsWith("browser") && contentType.includes("text/plain"));
  if (status !== "complete")
    warnings.push(`Capture status is ${status}; inspect the source before relying on completeness.`);
  const canonicalUrl = canonicalizeUrl(acquisition.finalUrl, platform);
  return {
    article,
    canonicalUrl,
    platform,
    status,
    score: qualityScore(article, status, wordCount, capturedItems, acquisition),
    wordCount,
    expectedItems,
    capturedItems,
    extractor,
    warnings,
    acquisition
  };
}
function chooseBestExtraction(candidates) {
  const statusRank = {
    complete: 5,
    partial: 4,
    "auth-required": 3,
    blocked: 2,
    unsupported: 1
  };
  let best = null;
  for (const candidate of candidates) {
    if (best === null || statusRank[candidate.status] > statusRank[best.status] || statusRank[candidate.status] === statusRank[best.status] && candidate.score > best.score)
      best = candidate;
  }
  return best;
}

// src/clip/media.ts
import { createHash as createHash2 } from "crypto";
import { spawn } from "child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync as mkdirSync2,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "fs";
import { homedir, tmpdir } from "os";
import { basename, extname, join as join2, resolve } from "path";
import { getCookies } from "@steipete/sweet-cookie";
var metadataPrefix = "CLIP_MEDIA_JSON\t";
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function startsWith2(bytes, signature) {
  return signature.every((byte, index) => bytes[index] === byte);
}
function ascii2(bytes, start, length) {
  let result = "";
  for (let index = start;index < start + length && index < bytes.length; index += 1) {
    result += String.fromCharCode(bytes[index] ?? 0);
  }
  return result;
}
function sniffMediaMimeType(bytes, extension) {
  const normalized = extension.toLowerCase();
  if (ascii2(bytes, 4, 4) === "ftyp") {
    if (normalized === ".mov")
      return "video/quicktime";
    if (normalized === ".m4a")
      return "audio/mp4";
    if (normalized === ".mp4")
      return "video/mp4";
    if (normalized === ".m4v")
      return "video/x-m4v";
    return null;
  }
  if (startsWith2(bytes, [26, 69, 223, 163])) {
    if (normalized === ".webm")
      return "video/webm";
    if (normalized === ".mkv")
      return "video/x-matroska";
    return null;
  }
  if (ascii2(bytes, 0, 3) === "ID3" || bytes[0] === 255 && ((bytes[1] ?? 0) & 224) === 224) {
    return normalized === ".mp3" ? "audio/mpeg" : null;
  }
  if (ascii2(bytes, 0, 4) === "OggS") {
    if (normalized === ".opus")
      return "audio/opus";
    if (normalized === ".ogg")
      return "audio/ogg";
    return null;
  }
  if (ascii2(bytes, 0, 4) === "RIFF" && ascii2(bytes, 8, 4) === "WAVE") {
    return normalized === ".wav" ? "audio/wav" : null;
  }
  if (ascii2(bytes, 0, 4) === "fLaC")
    return normalized === ".flac" ? "audio/flac" : null;
  if (bytes[0] === 255 && ((bytes[1] ?? 0) & 246) === 240) {
    return normalized === ".aac" ? "audio/aac" : null;
  }
  return null;
}
async function readBoundedStream(stream, maxBytes) {
  const iterable = stream;
  const bytes = new BoundedByteBuffer(maxBytes);
  for await (const value of iterable) {
    let chunk;
    if (Buffer.isBuffer(value))
      chunk = value;
    else if (typeof value === "string")
      chunk = Buffer.from(value);
    else if (value instanceof Uint8Array)
      chunk = Buffer.from(value);
    else
      throw new Error("media command returned an unsupported output chunk");
    if (!bytes.append(chunk))
      throw new Error(`media command output exceeded ${maxBytes} bytes`);
  }
  return new TextDecoder().decode(bytes.toUint8Array());
}
function inspectMonitoredDirectory(directory, maxFiles, maxFileBytes, maxTotalBytes) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    return `could not inspect media staging directory: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (entries.length > maxFiles)
    return `media capture created more than ${maxFiles} files`;
  let totalBytes = 0;
  for (const entry of entries) {
    const path = join2(directory, entry.name);
    let stats;
    try {
      stats = lstatSync(path);
    } catch {
      continue;
    }
    if (!entry.isFile() || stats.isSymbolicLink())
      return "media capture created an unexpected non-file output";
    if (stats.size > maxFileBytes)
      return `media capture created a file larger than ${maxFileBytes} bytes`;
    totalBytes += stats.size;
    if (totalBytes > maxTotalBytes)
      return `media capture exceeded the ${maxTotalBytes}-byte total limit`;
  }
  return null;
}
var runMediaCommand = async (specification) => {
  const executable = specification.command[0];
  if (executable === undefined)
    throw new Error("media command is empty");
  const useProcessGroup = process.platform !== "win32";
  const child = spawn(executable, specification.command.slice(1), {
    detached: useProcessGroup,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdin.once("error", () => {});
  child.stdin.end(specification.stdin ?? "");
  const exited = new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (code) => resolveExit(code ?? 1));
  });
  const signalProcessTree = (signal) => {
    if (useProcessGroup && child.pid !== undefined) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {}
    }
    try {
      child.kill(signal);
    } catch {}
  };
  let failure = null;
  let forceKillTimer = null;
  const requestStop = (reason) => {
    if (failure === null)
      failure = reason;
    if (forceKillTimer !== null)
      return;
    signalProcessTree("SIGTERM");
    forceKillTimer = setTimeout(() => signalProcessTree("SIGKILL"), 1000);
  };
  const timeout = setTimeout(() => {
    requestStop(`media command timed out after ${specification.timeoutMs}ms`);
  }, specification.timeoutMs);
  const monitor = setInterval(() => {
    const violation = inspectMonitoredDirectory(specification.monitoredDirectory, specification.maxFiles, specification.maxFileBytes, specification.maxTotalBytes);
    if (violation !== null)
      requestStop(violation);
  }, 100);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readBoundedStream(child.stdout, specification.maxOutputBytes),
      readBoundedStream(child.stderr, specification.maxOutputBytes),
      exited
    ]);
    const finalViolation = inspectMonitoredDirectory(specification.monitoredDirectory, specification.maxFiles, specification.maxFileBytes, specification.maxTotalBytes);
    if (failure !== null)
      throw new Error(failure);
    if (finalViolation !== null)
      throw new Error(finalViolation);
    return { stdout, stderr, exitCode };
  } catch (error) {
    if (failure === null)
      requestStop(error instanceof Error ? error.message : "media command failed");
    await exited.catch(() => 1);
    throw error;
  } finally {
    clearTimeout(timeout);
    clearInterval(monitor);
    if (forceKillTimer !== null)
      clearTimeout(forceKillTimer);
  }
};
function discoverYtDlp(options = {}) {
  const exists = options.exists ?? existsSync;
  const which = options.which ?? ((name) => Bun.which(name));
  const fromPath = which("yt-dlp");
  if (fromPath !== null && exists(fromPath))
    return fromPath;
  const homeDirectory = options.homeDirectory ?? homedir();
  return [
    join2(homeDirectory, ".local", "bin", "yt-dlp"),
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp"
  ].find((path) => exists(path)) ?? null;
}
function cleanString(value, maximumLength) {
  if (typeof value !== "string")
    return;
  const cleaned = value.replace(/\0/g, "").trim();
  if (cleaned === "" || cleaned.length > maximumLength)
    return;
  return cleaned;
}
function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function safeWebUrl(value) {
  const candidate = cleanString(value, 8192);
  if (candidate === undefined)
    return;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:" || url.username !== "" || url.password !== "") {
      return;
    }
    return url.href;
  } catch {
    return;
  }
}
function parseMediaMetadata(stdout) {
  const scanStart = Math.max(0, stdout.length - 2 * 1024 * 1024);
  let lineEnd = stdout.length;
  while (lineEnd >= scanStart) {
    const newline = stdout.lastIndexOf(`
`, lineEnd - 1);
    const lineStart = Math.max(scanStart, newline + 1);
    const rawLine = stdout.slice(lineStart, lineEnd);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    lineEnd = newline < scanStart ? scanStart - 1 : newline;
    if (!line.startsWith(metadataPrefix))
      continue;
    try {
      const parsed = JSON.parse(line.slice(metadataPrefix.length));
      if (!isRecord2(parsed))
        continue;
      const id = cleanString(parsed.id, 512);
      const title = cleanString(parsed.title, 8192);
      const description = cleanString(parsed.description, 500000);
      const uploader = cleanString(parsed.uploader, 8192);
      const uploaderId = cleanString(parsed.uploader_id, 8192);
      const webpageUrl = safeWebUrl(parsed.webpage_url);
      const extractor = cleanString(parsed.extractor, 1024);
      const durationSeconds = finiteNonNegative(parsed.duration);
      const timestamp = finiteNonNegative(parsed.timestamp);
      return {
        ...id === undefined ? {} : { id },
        ...title === undefined ? {} : { title },
        ...description === undefined ? {} : { description },
        ...uploader === undefined ? {} : { uploader },
        ...uploaderId === undefined ? {} : { uploaderId },
        ...webpageUrl === undefined ? {} : { webpageUrl },
        ...extractor === undefined ? {} : { extractor },
        ...durationSeconds === undefined ? {} : { durationSeconds },
        ...timestamp === undefined ? {} : { timestamp }
      };
    } catch {}
  }
  return null;
}
function validProfile(profile) {
  return profile === undefined || profile.trim() !== "" && profile.length <= 4096 && !/\p{Cc}/u.test(profile);
}
function buildMediaCookieOptions(request) {
  const common = {
    url: request.url.href,
    timeoutMs: request.timeoutMs,
    mode: "first",
    debug: false
  };
  const profile = request.profile?.trim();
  if (request.source === "edge") {
    return {
      ...common,
      browsers: ["edge"],
      edgeProfile: profile ?? ""
    };
  }
  if (request.source === "firefox") {
    return {
      ...common,
      browsers: ["firefox"],
      firefoxProfile: profile ?? ""
    };
  }
  if (request.source === "safari") {
    return {
      ...common,
      browsers: ["safari"],
      ...profile === undefined ? {} : { safariCookiesFile: profile }
    };
  }
  return {
    ...common,
    browsers: ["chrome"],
    chromiumBrowser: request.source,
    chromeProfile: profile ?? ""
  };
}
function createMediaCookieProvider(reader) {
  return (request) => {
    if (request.source !== "file")
      return reader(buildMediaCookieOptions(request));
    const parsed = readCookieFile(request.file, request.url);
    return Promise.resolve(parsed.ok ? {
      cookies: parsed.cookies,
      warnings: parsed.rejected === 0 ? [] : [`Ignored ${parsed.rejected} malformed, expired, or out-of-scope cookie record(s).`]
    } : { cookies: [], warnings: [] });
  };
}
var readMediaCookies = createMediaCookieProvider((options) => getCookies(options));
async function prepareCookieJar(request, directory, provider) {
  let provided;
  try {
    provided = await provider(request);
  } catch {
    return { ok: false, warning: "Could not read cookies from the explicitly selected browser." };
  }
  const filtered = filterCookieProviderResult(provided, request.url);
  if (!filtered.validShape) {
    return { ok: false, warning: "The selected browser cookie provider returned malformed data." };
  }
  if (filtered.cookies.length === 0) {
    return {
      ok: false,
      warning: filtered.rejected === 0 ? "No origin-scoped cookies were found in the explicitly selected browser." : `No usable origin-scoped cookies were found; rejected ${filtered.rejected} malformed, expired, or out-of-scope record(s).`
    };
  }
  const body = renderNetscapeCookieJar(filtered.cookies, request.url);
  if (Buffer.byteLength(body, "utf8") > MAX_COOKIE_BYTES) {
    return { ok: false, warning: "Origin-scoped browser cookies exceeded the private jar size limit." };
  }
  const path = join2(directory, "cookies.txt");
  try {
    writeFileSync2(path, body, { encoding: "utf8", flag: "wx", mode: 384 });
    chmodSync(path, 384);
  } catch {
    return { ok: false, warning: "Could not create the private temporary cookie jar." };
  }
  const warnings = [];
  if (filtered.rejected > 0) {
    warnings.push(`Ignored ${filtered.rejected} malformed, expired, or out-of-scope browser cookie record(s).`);
  }
  if (filtered.providerWarningCount > 0) {
    warnings.push(`The browser cookie provider reported ${filtered.providerWarningCount} non-fatal warning(s).`);
  }
  return { ok: true, path, warnings };
}
function metadataTemplate() {
  return `${metadataPrefix}{"id":%(id)j,"title":%(title)j,"description":%(description)j,` + `"uploader":%(uploader)j,"uploader_id":%(uploader_id)j,"webpage_url":%(webpage_url)j,` + `"extractor":%(extractor)j,"duration":%(duration)j,"timestamp":%(timestamp)j}`;
}
function commandArguments(executable, runDirectory, options, cookieFile, proxyUrl) {
  const output = join2(runDirectory, "media-%(id).80B.%(ext)s");
  const arguments_ = [
    executable,
    "--ignore-config",
    "--no-playlist",
    "--max-downloads",
    "1",
    "--max-filesize",
    String(options.maxFileBytes),
    "--restrict-filenames",
    "--trim-filenames",
    "100",
    "--no-overwrites",
    "--no-progress",
    "--newline",
    "--no-colors",
    "--socket-timeout",
    String(Math.max(1, Math.ceil(options.timeoutMs / 1000))),
    "--retries",
    "2",
    "--fragment-retries",
    "2",
    "--proxy",
    proxyUrl,
    "--batch-file",
    "-",
    "--downloader",
    "native",
    "--output",
    output,
    "--print",
    `after_move:${metadataTemplate()}`
  ];
  if (options.userAgent !== undefined)
    arguments_.push("--user-agent", options.userAgent);
  if (cookieFile !== undefined)
    arguments_.push("--cookies", cookieFile);
  return arguments_;
}
function privateMediaUrlInput(url) {
  const value = url.href;
  if (/[\0\r\n]/.test(value))
    throw new Error("media URL contains an invalid batch-file control character");
  return `${value}
`;
}
function errorClassification(stderr) {
  const normalized = stderr.toLowerCase();
  if (normalized.includes("unsupported url") || normalized.includes("no suitable extractor")) {
    return { status: "unsupported", warning: "yt-dlp does not support media capture for this URL." };
  }
  if (normalized.includes("drm")) {
    return { status: "unsupported", warning: "The media is DRM-protected; clip does not bypass DRM or access controls." };
  }
  if (normalized.includes("login") || normalized.includes("sign in") || normalized.includes("cookies")) {
    return { status: "failed", warning: "The site requires an authorized session; explicitly select a cookie source or cookie file." };
  }
  if (normalized.includes("requested format is not available") || normalized.includes("no video formats found")) {
    return { status: "unsupported", warning: "No downloadable, non-DRM media format was exposed for this page." };
  }
  return { status: "failed", warning: "yt-dlp could not capture media for this page; page text and images can still be clipped." };
}
function safeRunnerFailure(message) {
  const safePatterns = [
    /^media command timed out after \d+ms$/,
    /^media command output exceeded \d+ bytes$/,
    /^media capture created more than \d+ files$/,
    /^media capture created a file larger than \d+ bytes$/,
    /^media capture exceeded the \d+-byte total limit$/
  ];
  return safePatterns.some((pattern) => pattern.test(message)) ? message : "yt-dlp media capture failed; page text and images can still be clipped.";
}
function sha2562(bytes) {
  return createHash2("sha256").update(bytes).digest("hex");
}
function normalizePrefix(value) {
  if (value === undefined || value === "")
    return "media";
  const pieces = value.split("/").filter((piece) => piece !== "" && piece !== ".");
  if (pieces.length === 0 || pieces.some((piece) => piece === ".." || /[\\\0]/.test(piece)))
    return "media";
  return pieces.join("/");
}
function promoteMediaFiles(runDirectory, outputDirectory, relativePrefix, maxFiles, maxFileBytes, maxTotalBytes) {
  const violation = inspectMonitoredDirectory(runDirectory, maxFiles, maxFileBytes, maxTotalBytes);
  if (violation !== null)
    return { records: [], warnings: [violation] };
  const recordsByHash = new Map;
  const warnings = [];
  for (const entry of readdirSync(runDirectory, { withFileTypes: true })) {
    if (!entry.isFile())
      continue;
    const extension = extname(entry.name).toLowerCase();
    const source = join2(runDirectory, entry.name);
    const stats = statSync(source);
    if (!stats.isFile() || stats.size > maxFileBytes) {
      warnings.push(`Ignored invalid or oversized yt-dlp output ${basename(entry.name)}.`);
      continue;
    }
    const bytes = readFileSync(source);
    const mimeType = sniffMediaMimeType(bytes, extension);
    if (mimeType === null) {
      warnings.push(`Ignored unrecognized or mislabeled yt-dlp output ${basename(entry.name)}.`);
      continue;
    }
    const digest = sha2562(bytes);
    const filename = `${digest}${extension}`;
    const destination = join2(outputDirectory, filename);
    if (existsSync(destination)) {
      const destinationStats = lstatSync(destination);
      if (!destinationStats.isFile() || destinationStats.isSymbolicLink()) {
        warnings.push(`Refused unsafe existing media destination ${filename}.`);
        continue;
      }
      const destinationDigest = sha2562(readFileSync(destination));
      if (destinationDigest !== digest) {
        warnings.push(`Refused conflicting existing media destination ${filename}.`);
        continue;
      }
      unlinkSync(source);
    } else
      renameSync(source, destination);
    if (!recordsByHash.has(digest)) {
      recordsByHash.set(digest, {
        path: `${relativePrefix}/${filename}`,
        mimeType,
        bytes: stats.size,
        sha256: digest
      });
    }
  }
  return {
    records: [...recordsByHash.values()].sort((left, right) => left.path.localeCompare(right.path)),
    warnings
  };
}
function validateOptions(options) {
  if (options.url.protocol !== "http:" && options.url.protocol !== "https:")
    return "Media URL must use HTTP or HTTPS.";
  if (options.url.username !== "" || options.url.password !== "")
    return "Media URL must not contain credentials.";
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)
    return "Media timeout must be a positive integer.";
  if (!Number.isSafeInteger(options.maxFileBytes) || options.maxFileBytes < 1)
    return "Per-file media limit must be positive.";
  if (!Number.isSafeInteger(options.maxTotalBytes) || options.maxTotalBytes < options.maxFileBytes) {
    return "Total media limit must be at least the per-file limit.";
  }
  if (options.cookiesFile !== undefined) {
    try {
      const cookieFileStats = lstatSync(resolve(options.cookiesFile));
      if (!cookieFileStats.isFile())
        return "The explicitly selected cookie file is not a regular file.";
      if (cookieFileStats.size > MAX_COOKIE_BYTES)
        return "The explicitly selected cookie file exceeds the 2mb input limit.";
    } catch {
      return "The explicitly selected cookie file is unavailable.";
    }
  }
  if (options.cookieBrowser !== undefined && !validProfile(options.cookieBrowser.profile)) {
    return "The explicitly selected browser cookie profile is invalid.";
  }
  return null;
}
async function captureMedia(options) {
  const validation = validateOptions(options);
  if (validation !== null)
    return { status: "failed", records: [], metadata: null, warnings: [validation] };
  const exists = options.exists ?? existsSync;
  const executable = options.executable ?? discoverYtDlp({
    ...options.homeDirectory === undefined ? {} : { homeDirectory: options.homeDirectory },
    exists,
    ...options.which === undefined ? {} : { which: options.which }
  });
  if (executable === null || !exists(executable)) {
    return {
      status: "unavailable",
      records: [],
      metadata: null,
      warnings: ["yt-dlp is not installed; skipped optional audio/video capture."]
    };
  }
  const maxFiles = Math.max(1, Math.min(options.maxFiles ?? 12, 100));
  const maxOutputBytes = Math.max(4096, Math.min(options.maxOutputBytes ?? 2 * 1024 * 1024, 16 * 1024 * 1024));
  const outputDirectory = resolve(options.outputDirectory);
  try {
    mkdirSync2(outputDirectory, { recursive: true, mode: 493 });
    const outputStats = lstatSync(outputDirectory);
    if (!outputStats.isDirectory() || outputStats.isSymbolicLink()) {
      return { status: "failed", records: [], metadata: null, warnings: ["Media destination must be a real directory, not a symlink."] };
    }
  } catch {
    return { status: "failed", records: [], metadata: null, warnings: ["Could not create the media destination directory."] };
  }
  const realOutputDirectory = realpathSync(outputDirectory);
  const runDirectory = mkdtempSync(join2(realOutputDirectory, ".clip-media-"));
  let authDirectory = null;
  let networkProxy = null;
  const run = options.run ?? runMediaCommand;
  const authenticationWarnings = [];
  try {
    let cookieFile;
    let cookieRequest;
    if (options.cookiesFile !== undefined) {
      cookieRequest = {
        url: options.url,
        source: "file",
        file: resolve(options.cookiesFile),
        timeoutMs: options.timeoutMs
      };
      if (options.cookieBrowser !== undefined) {
        authenticationWarnings.push("The explicit cookie file took precedence over the selected browser cookie source.");
      }
    } else if (options.cookieBrowser !== undefined) {
      cookieRequest = {
        url: options.url,
        source: options.cookieBrowser.source,
        timeoutMs: options.timeoutMs,
        ...options.cookieBrowser.profile === undefined ? {} : { profile: options.cookieBrowser.profile }
      };
    }
    if (cookieRequest !== undefined) {
      authDirectory = mkdtempSync(join2(tmpdir(), "cclrte-kb-auth-"));
      chmodSync(authDirectory, 448);
      const prepared = await prepareCookieJar(cookieRequest, authDirectory, options.cookieProvider ?? readMediaCookies);
      if (!prepared.ok) {
        return { status: "failed", records: [], metadata: null, warnings: [prepared.warning] };
      }
      cookieFile = prepared.path;
      authenticationWarnings.push(...prepared.warnings);
    }
    networkProxy = await (options.startProxy ?? startNetworkProxy)({
      allowPrivateNetwork: options.allowPrivateNetwork ?? false,
      timeoutMs: options.timeoutMs,
      maxTransferredBytes: Math.max(64 * 1024 * 1024, Math.min(Number.MAX_SAFE_INTEGER, options.maxTotalBytes * 3))
    });
    const result = await run({
      command: commandArguments(executable, runDirectory, options, cookieFile, networkProxy.url),
      stdin: privateMediaUrlInput(options.url),
      timeoutMs: options.timeoutMs,
      maxOutputBytes,
      monitoredDirectory: runDirectory,
      maxFiles,
      maxFileBytes: options.maxFileBytes,
      maxTotalBytes: options.maxTotalBytes
    });
    const metadata = parseMediaMetadata(result.stdout);
    if (result.exitCode !== 0) {
      const classification = errorClassification(result.stderr);
      return {
        status: classification.status,
        records: [],
        metadata,
        warnings: [...authenticationWarnings, classification.warning]
      };
    }
    const promoted = promoteMediaFiles(runDirectory, realOutputDirectory, normalizePrefix(options.relativePrefix), maxFiles, options.maxFileBytes, options.maxTotalBytes);
    if (promoted.records.length === 0) {
      return {
        status: "unsupported",
        records: [],
        metadata,
        warnings: [
          ...authenticationWarnings,
          ...promoted.warnings,
          "yt-dlp completed without a supported audio/video file."
        ]
      };
    }
    return {
      status: "captured",
      records: promoted.records,
      metadata,
      warnings: [...authenticationWarnings, ...promoted.warnings]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      records: [],
      metadata: null,
      warnings: [...authenticationWarnings, safeRunnerFailure(message)]
    };
  } finally {
    try {
      await networkProxy?.close();
    } finally {
      if (authDirectory !== null)
        rmSync(authDirectory, { recursive: true, force: true });
      rmSync(runDirectory, { recursive: true, force: true });
    }
  }
}

// src/clip/structured.ts
var isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var itemId = (value) => {
  if (typeof value === "string" && /^\d+$/.test(value))
    return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  return null;
};
var enqueueHackerNewsChildren = (value, depth, maximumQueueSize, queue, scheduled) => {
  if (!isRecord3(value) || !Array.isArray(value.kids))
    return { duplicate: false, truncated: false };
  let duplicate = false;
  for (const child of value.kids) {
    const id = itemId(child);
    if (id === null)
      continue;
    if (scheduled.has(id)) {
      duplicate = true;
      continue;
    }
    if (queue.length >= maximumQueueSize)
      return { duplicate, truncated: true };
    scheduled.add(id);
    queue.push({ id, depth });
  }
  return { duplicate, truncated: false };
};
async function defaultJsonFetcher(options, url, maxBytes, timeoutMs = options.timeoutMs) {
  const response = await safeFetch(url, {
    timeoutMs,
    maxBytes,
    allowPrivateNetwork: options.allowPrivateNetwork,
    userAgent: options.userAgent,
    accept: "application/json",
    retries: 2
  });
  const text = decodeBytes(response.bytes, response.contentType);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON from ${url.origin}`, { cause: error });
  }
}
function serializedBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
function walkDocument(document) {
  let pageItems = 0;
  let scopedItems = 0;
  let incomplete = false;
  let rootIncomplete = false;
  let blockedRoot = false;
  const active = new WeakSet;
  const visit = (entry, location) => {
    if (active.has(entry)) {
      incomplete = true;
      return;
    }
    active.add(entry);
    if (entry.kind === "boundary" || entry.kind === "more") {
      incomplete = true;
      if (location === "root")
        rootIncomplete = true;
      active.delete(entry);
      return;
    }
    const unavailable = entry.kind === "unavailable";
    const unavailableButRepresented = unavailable && (entry.reason === "deleted" || entry.reason === "dead" || entry.reason === "removed");
    const captured = entry.kind === "content" || unavailableButRepresented;
    if (location === "root" && captured)
      pageItems += 1;
    if (location === "reply" && captured)
      scopedItems += 1;
    if (unavailable && (entry.reason === "not-found" || entry.reason === "blocked"))
      incomplete = true;
    if (location === "root" && unavailable && (entry.reason === "not-found" || entry.reason === "blocked")) {
      rootIncomplete = true;
    }
    if (location === "root" && unavailable && entry.reason === "blocked")
      blockedRoot = true;
    if (entry.kind === "content") {
      for (const quote of entry.quotes)
        visit(quote, "quote");
      for (const reply of entry.replies)
        visit(reply, "reply");
    } else if (entry.kind === "unavailable") {
      for (const reply of entry.replies)
        visit(reply, "reply");
    }
    active.delete(entry);
  };
  for (const entry of document.ancestors)
    visit(entry, "ancestor");
  for (const entry of document.roots)
    visit(entry, "root");
  return { pageItems, scopedItems, incomplete, rootIncomplete, blockedRoot };
}
var rootContent = (document) => {
  const root = document.roots[0];
  return root?.kind === "content" ? root : null;
};
function structuredStatus(document, scope, adapterWarnings) {
  const walked = walkDocument(document);
  const root = rootContent(document);
  if (scope === "page") {
    return {
      status: walked.blockedRoot ? "blocked" : walked.rootIncomplete || walked.pageItems === 0 || adapterWarnings.length > 0 ? "partial" : "complete",
      capturedItems: walked.pageItems,
      expectedItems: null,
      declaredItems: null
    };
  }
  const declaredItems = root?.metrics.replies ?? null;
  const expectedItems = declaredItems === null ? null : Math.max(declaredItems, walked.scopedItems);
  if (walked.blockedRoot) {
    return { status: "blocked", capturedItems: walked.scopedItems, expectedItems, declaredItems };
  }
  const shortOfDeclared = declaredItems !== null && walked.scopedItems < declaredItems;
  return {
    status: walked.incomplete || shortOfDeclared || adapterWarnings.length > 0 ? "partial" : "complete",
    capturedItems: walked.scopedItems,
    expectedItems,
    declaredItems
  };
}
function structuredCaptureFromDocument(options, document, evidence, method, adapterWarnings, extractor = `${document.platform}-public-api`) {
  const rendered = renderCapturedDocument(document);
  const content = rendered.replace(/^# [^\n]+\n\n/, "").trim();
  const root = rootContent(document);
  const article = {
    content,
    title: document.title,
    author: root?.author?.name ?? null,
    published: root?.createdAt ?? null,
    description: null
  };
  const completeness = structuredStatus(document, options.scope, [...adapterWarnings, ...document.warnings]);
  const warnings = [...adapterWarnings, ...document.warnings];
  if (completeness.declaredItems !== null && completeness.capturedItems > completeness.declaredItems) {
    warnings.push(`The source declared ${completeness.declaredItems} scoped items, but ${completeness.capturedItems} distinct items were captured; the expected count was normalized to the observed count.`);
  }
  if (completeness.status !== "complete") {
    warnings.push(`Structured ${document.platform} capture is ${completeness.status}; limits or unavailable branches remain.`);
  }
  const acquisition = {
    body: JSON.stringify(evidence),
    contentType: "application/json",
    finalUrl: captureUrl(options),
    method,
    warnings
  };
  const wordCount = countWords(content);
  const statusWeight = {
    complete: 1e5,
    partial: 60000,
    "auth-required": 0,
    blocked: -1e4,
    unsupported: -20000
  };
  return {
    extraction: {
      article,
      canonicalUrl: new URL(document.sourceUrl),
      platform: document.platform,
      status: completeness.status,
      score: statusWeight[completeness.status] + Math.min(content.length, 50000) + completeness.capturedItems * 50,
      wordCount,
      expectedItems: completeness.expectedItems,
      capturedItems: completeness.capturedItems,
      extractor,
      warnings,
      acquisition
    },
    evidence: `${JSON.stringify(evidence, null, 2)}
`
  };
}
async function captureHackerNews(options, classified, fetchJson) {
  const endpoint = (id) => new URL(`https://hacker-news.firebaseio.com/v0/item/${encodeURIComponent(id)}.json`);
  const deadline = Date.now() + options.timeoutMs;
  let remainingBytes = options.maxHtmlBytes;
  const remainingTime = () => {
    const value = deadline - Date.now();
    if (value <= 0)
      throw new Error(`Hacker News capture exceeded the ${options.timeoutMs}ms total deadline`);
    return value;
  };
  const rootAllocation = Math.min(remainingBytes, 1024 * 1024);
  if (rootAllocation < 1)
    throw new Error("Hacker News capture has no remaining response-byte budget");
  remainingBytes -= rootAllocation;
  const root = await fetchJson(endpoint(classified.itemId), rootAllocation, remainingTime());
  const rootBytes = serializedBytes(root);
  if (!Number.isFinite(rootBytes) || rootBytes > rootAllocation) {
    throw new Error("Hacker News root item exceeded its bounded JSON allocation");
  }
  remainingBytes += rootAllocation - rootBytes;
  if (!isRecord3(root) || itemId(root.id) === null)
    throw new Error("Hacker News API returned no root item");
  if (options.scope === "page") {
    const evidence2 = { root, descendants: [] };
    const parsed2 = parseHackerNewsCapture(evidence2, classified.href, {
      limits: { maxItems: options.maxItems, maxDepth: options.maxDepth }
    });
    if (!parsed2.ok)
      throw new Error(parsed2.error.message);
    return structuredCaptureFromDocument(options, parsed2.document, evidence2, "hacker-news-api", []);
  }
  const descendants = [];
  const warnings = [];
  const scheduled = new Set([classified.itemId]);
  const queue = [];
  const initialChildren = enqueueHackerNewsChildren(root, 1, Math.max(0, options.maxItems - 1), queue, scheduled);
  let duplicateChildren = initialChildren.duplicate;
  let limited = initialChildren.truncated;
  while (queue.length > 0 && descendants.length + 1 < options.maxItems) {
    const remaining = options.maxItems - descendants.length - 1;
    const batchSize = Math.min(8, remaining, queue.length, remainingBytes);
    if (batchSize < 1) {
      limited = true;
      break;
    }
    const batch = queue.splice(0, batchSize);
    const allocation = Math.min(64 * 1024, Math.floor(remainingBytes / batch.length));
    remainingBytes -= allocation * batch.length;
    const fetched = await Promise.all(batch.map(async ({ id, depth }) => {
      try {
        const value = await fetchJson(endpoint(id), allocation, remainingTime());
        const bytes = serializedBytes(value);
        if (!Number.isFinite(bytes) || bytes > allocation) {
          return { id, depth, value: null, warning: `Hacker News item ${id} exceeded its bounded JSON allocation.` };
        }
        remainingBytes += allocation - bytes;
        return { id, depth, value, warning: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { id, depth, value: null, warning: `Could not fetch Hacker News item ${id}: ${message}` };
      }
    }));
    const childrenToSchedule = [];
    for (const result of fetched) {
      if (result.warning !== null)
        warnings.push(result.warning);
      if (result.value === null)
        continue;
      descendants.push(result.value);
      childrenToSchedule.push({ value: result.value, depth: result.depth });
    }
    const maximumQueueSize = Math.max(0, options.maxItems - descendants.length - 1);
    for (const result of childrenToSchedule) {
      const atDepthLimit = result.depth >= options.maxDepth - 1;
      const enqueued = enqueueHackerNewsChildren(result.value, result.depth + 1, atDepthLimit ? queue.length : maximumQueueSize, queue, scheduled);
      duplicateChildren = duplicateChildren || enqueued.duplicate;
      limited = limited || enqueued.truncated;
    }
  }
  if (duplicateChildren)
    warnings.push("Hacker News duplicate or cyclic child IDs were skipped.");
  if (queue.length > 0 || limited) {
    warnings.push("Hacker News descendants exceeded the configured item, depth, byte, or total-deadline limit.");
  }
  const evidence = { root, descendants };
  const parsed = parseHackerNewsCapture(evidence, classified.href, {
    limits: { maxItems: options.maxItems, maxDepth: options.maxDepth }
  });
  if (!parsed.ok)
    throw new Error(parsed.error.message);
  const document = {
    ...parsed.document,
    warnings: [...parsed.document.warnings, ...warnings]
  };
  return structuredCaptureFromDocument(options, document, evidence, "hacker-news-api", warnings);
}
async function captureBluesky(options, classified, fetchJson) {
  let did = classified.actor;
  const evidence = {};
  if (!did.startsWith("did:")) {
    const resolveUrl = new URL("https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle");
    resolveUrl.searchParams.set("handle", did);
    const resolution = await fetchJson(resolveUrl, Math.min(options.maxHtmlBytes, 1024 * 1024));
    evidence.resolution = resolution;
    if (!isRecord3(resolution) || typeof resolution.did !== "string" || !resolution.did.startsWith("did:")) {
      throw new Error(`Bluesky could not resolve ${classified.actor}`);
    }
    did = resolution.did;
  }
  const threadUrl = new URL("https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread");
  threadUrl.searchParams.set("uri", `at://${did}/app.bsky.feed.post/${classified.postId}`);
  threadUrl.searchParams.set("depth", options.scope === "page" ? "0" : String(Math.min(options.maxDepth, 1000)));
  threadUrl.searchParams.set("parentHeight", String(Math.min(options.maxDepth, 1000)));
  const thread = await fetchJson(threadUrl, options.maxHtmlBytes);
  evidence.thread = thread;
  const parsed = parseBlueskyCapture(thread, classified.href, {
    limits: { maxItems: options.maxItems, maxDepth: options.maxDepth }
  });
  if (!parsed.ok)
    throw new Error(parsed.error.message);
  return structuredCaptureFromDocument(options, parsed.document, evidence, "bluesky-api", []);
}
function rootOnlyRedditInput(input) {
  if (!Array.isArray(input))
    return input;
  const values = input;
  const post = values[0];
  return post === undefined ? values : [post];
}
function redditHasPagination(input) {
  if (!Array.isArray(input))
    return false;
  const comments = input[1];
  if (!isRecord3(comments))
    return false;
  const data = isRecord3(comments.data) ? comments.data : null;
  return data !== null && data.after !== undefined && data.after !== null;
}
async function captureReddit(options, classified, fetchJson) {
  const endpoint = new URL(`https://www.reddit.com/comments/${encodeURIComponent(classified.postId)}.json`);
  endpoint.searchParams.set("raw_json", "1");
  endpoint.searchParams.set("limit", String(Math.max(1, options.maxItems - 1)));
  endpoint.searchParams.set("depth", String(options.scope === "page" ? 0 : options.maxDepth));
  if (classified.commentId !== null)
    endpoint.searchParams.set("comment", classified.commentId);
  const evidence = await fetchJson(endpoint, options.maxHtmlBytes, options.timeoutMs);
  const parserInput = options.scope === "page" ? rootOnlyRedditInput(evidence) : evidence;
  const parsed = parseRedditCapture(parserInput, classified.href, {
    limits: { maxItems: options.maxItems, maxDepth: options.maxDepth }
  });
  if (!parsed.ok)
    throw new Error(parsed.error.message);
  const warnings = options.scope !== "page" && redditHasPagination(evidence) ? ["Reddit JSON returned a pagination cursor; additional comments remain uncaptured."] : [];
  const storedEvidence = options.scope === "page" ? parserInput : evidence;
  return structuredCaptureFromDocument(options, parsed.document, storedEvidence, "reddit-json", warnings, "reddit-json");
}
async function acquirePublicStructured(options, dependencies = {}) {
  const classified = classifyPlatformUrl(captureUrl(options).href);
  if (classified === null)
    return null;
  const fetchJson = dependencies.fetchJson ?? ((url, maxBytes, timeoutMs) => defaultJsonFetcher(options, url, maxBytes, timeoutMs));
  if (classified.platform === "hacker-news")
    return captureHackerNews(options, classified, fetchJson);
  if (classified.platform === "bluesky")
    return captureBluesky(options, classified, fetchJson);
  if (classified.platform === "reddit")
    return captureReddit(options, classified, fetchJson);
  return null;
}

// src/clip/capture.ts
var browserFirstPlatforms = new Set([
  "x",
  "instagram",
  "linkedin",
  "reddit",
  "facebook",
  "tiktok",
  "threads",
  "whatsapp",
  "youtube"
]);
function effectiveScope(platform, scope) {
  if (scope !== "auto")
    return scope;
  if (platform === "hacker-news" || platform === "reddit" || platform === "github" || platform === "discourse") {
    return "comments";
  }
  if (platform === "x" || platform === "bluesky")
    return "thread";
  return "page";
}
function stableContentId(url) {
  const classified = classifyPlatformUrl(url.href);
  if (classified === null)
    return null;
  switch (classified.platform) {
    case "x":
    case "bluesky":
      return classified.postId;
    case "hacker-news":
      return classified.itemId;
    case "reddit":
      return classified.commentId ?? classified.postId;
    case "github":
      return classified.contentId;
    case "discourse":
      return classified.topicId;
    case "instagram":
    case "linkedin":
    case "facebook":
    case "tiktok":
    case "threads":
    case "whatsapp":
    case "youtube":
      return classified.contentId;
    case "substack":
    case "generic":
      return null;
  }
}
function captureSlug(options, extraction) {
  if (options.slug !== undefined)
    return slugify(options.slug);
  const fallback = extraction.canonicalUrl.pathname.split("/").filter(Boolean).at(-1) ?? extraction.canonicalUrl.hostname;
  const base = slugify(redactSensitiveText(extraction.article.title ?? fallback));
  const id = stableContentId(extraction.canonicalUrl);
  if (id === null)
    return base;
  const idSlug = slugify(id);
  if (idSlug === "" || base.endsWith(`-${idSlug}`) || base === idSlug)
    return base;
  const available = Math.max(1, 80 - [...idSlug].length - 1);
  const shortened = [...base].slice(0, available).join("").replace(/-+$/g, "") || "post";
  return `${shortened}-${idSlug}`;
}
function shouldUseBrowser(options, platform, scope, directCandidates) {
  if (options.mode === "browser")
    return true;
  if (options.mode !== "auto")
    return false;
  if (options.browserProfile !== undefined || options.browserLive || options.cdp !== undefined)
    return true;
  if (options.evidence === "screenshot" || options.evidence === "all")
    return true;
  if (browserFirstPlatforms.has(platform))
    return true;
  if (scope !== "page" && platform !== "hacker-news" && platform !== "bluesky")
    return true;
  const boundedStructured = directCandidates.some((candidate) => (candidate.acquisition.method === "hacker-news-api" || candidate.acquisition.method === "bluesky-api") && candidate.warnings.some((warning) => /configured (?:item|depth)|item (?:or depth )?limit|depth limit|capture stopped at \d+ items?/i.test(warning)));
  if (boundedStructured)
    return false;
  const best = chooseBestExtraction(directCandidates);
  return best === null || best.status !== "complete" || best.wordCount < 60;
}
function safeAttemptMessage(value) {
  const message = value instanceof Error ? value.message : String(value);
  return redactSensitiveText(message).replace(/[\r\n]+/g, " ").slice(0, 1000);
}
function finalizedWarnings(values, markdownRedactions = 0) {
  const sanitized = values.map((value) => safeAttemptMessage(value));
  if (markdownRedactions > 0) {
    sanitized.push(`Redacted ${markdownRedactions} credential-shaped occurrence${markdownRedactions === 1 ? "" : "s"} from captured Markdown.`);
  }
  return [...new Set(sanitized)];
}
function statusAfterContentRewrite(status, truncated) {
  return truncated && status === "complete" ? "partial" : status;
}
function chooseCaptureExtraction(candidates, structuredCapture) {
  const structured = structuredCapture?.extraction;
  if (structured !== undefined && (structured.acquisition.method === "hacker-news-api" || structured.acquisition.method === "bluesky-api") && (structured.status === "complete" || structured.status === "partial")) {
    return structured;
  }
  return chooseBestExtraction(candidates);
}
async function tryAcquisition(method, acquire, scope, timeoutMs, extractor, candidates, attempts) {
  try {
    const acquisition = await acquire();
    const extracted = await extractor(acquisition, scope, timeoutMs);
    if (extracted === null) {
      attempts.push({ method, outcome: "failed", message: "acquisition yielded no extractable content" });
      return acquisition;
    }
    candidates.push(extracted);
    attempts.push({
      method: acquisition.method,
      outcome: "succeeded",
      message: `${extracted.status}; ${extracted.wordCount} words; ${extracted.capturedItems} items`
    });
    return acquisition;
  } catch (error) {
    attempts.push({ method, outcome: "failed", message: safeAttemptMessage(error) });
    return null;
  }
}
function screenshotIntoBundle(screenshotPath, transaction, maxBytes) {
  if (screenshotPath === null || !existsSync2(screenshotPath))
    return null;
  const stats = statSync2(screenshotPath);
  if (!stats.isFile() || stats.size > maxBytes)
    return null;
  const bytes = readFileSync2(screenshotPath);
  if (sniffImage(bytes)?.mimeType !== "image/png")
    return null;
  const evidenceDirectory = join3(transaction.stagingDirectory, "evidence");
  mkdirSync3(evidenceDirectory, { recursive: true, mode: 448 });
  const destination = join3(evidenceDirectory, "page.png");
  copyFileSync(screenshotPath, destination);
  chmodSync2(destination, 384);
  return "evidence/page.png";
}
var mediaManifestAssets = (result, sourceUrl) => result.records.map((record) => ({
  source: sourceUrl,
  url: sourceUrl,
  path: record.path,
  mimeType: record.mimeType,
  bytes: record.bytes,
  sha256: record.sha256
}));
function safeMediaPath(path) {
  if (path === "" || path.startsWith("/") || /[\\\0\r\n?#]/.test(path))
    return null;
  const pieces = path.split("/");
  if (pieces.some((piece) => piece === "" || piece === "." || piece === ".."))
    return null;
  return pieces.map((piece) => encodeURIComponent(piece)).join("/");
}
function appendCapturedMedia(content, records) {
  const lines = [];
  for (const record of records) {
    const path = safeMediaPath(record.path);
    if (path === null)
      continue;
    if (record.mimeType.startsWith("video/")) {
      lines.push(`<video controls preload="metadata" src="${path}"></video>`, `[Download video](${path})`);
    } else if (record.mimeType.startsWith("audio/")) {
      lines.push(`<audio controls preload="metadata" src="${path}"></audio>`, `[Download audio](${path})`);
    } else
      lines.push(`[Download media](${path})`);
  }
  if (lines.length === 0)
    return content;
  return `${content.trimEnd()}

## Media

${lines.join(`

`)}
`;
}
function cookieMediaOptions(options) {
  const source = options.cookieSources[0] ?? (options.browserProfile === undefined ? undefined : "chrome");
  const profile = options.cookieSources.length > 0 ? options.cookieProfile : selectedBrowserCookieProfile(options);
  return {
    ...source === undefined ? {} : { cookieBrowser: { source, ...profile === undefined ? {} : { profile } } },
    ...options.cookiesFile === undefined ? {} : { cookiesFile: options.cookiesFile }
  };
}
function selectedBrowserCookieProfile(options) {
  if (options.browserProfile === undefined)
    return;
  return options.browserProfileDirectory === undefined ? options.browserProfile : join3(options.browserProfile, options.browserProfileDirectory);
}
function assetCookieProvider(options, reader, authorizedUrl) {
  const explicit = options.cookieSources.length > 0 || options.cookiesFile !== undefined;
  if (!explicit && options.browserProfile === undefined)
    return;
  const effective = explicit ? options : {
    ...options,
    cookieSources: ["chrome"],
    cookieProfile: selectedBrowserCookieProfile(options)
  };
  let records;
  return (url) => {
    if (url.origin !== authorizedUrl.origin)
      return Promise.resolve(null);
    records ??= reader(effective, authorizedUrl);
    return records.then((result) => {
      const header = renderCookieHeader(filterCookies(result.cookies, url).cookies);
      return header === "" ? null : header;
    });
  };
}
function withBrowserProfileSnapshot(options, temporaryDirectory) {
  if (options.browserProfile === undefined || options.browserProfileOwnership === "owned")
    return options;
  const source = assertSafePersistentProfile(options);
  if (source === null)
    return options;
  const cloned = cloneBrowserProfile(source, temporaryDirectory);
  return {
    ...options,
    browserProfile: cloned.userDataPath,
    browserProfileOwnership: "owned",
    ...cloned.profileDirectory === undefined ? {} : { browserProfileDirectory: cloned.profileDirectory }
  };
}
async function runCapture(rawOptions, dependencies = {}) {
  if (rawOptions.stdout && (rawOptions.media !== "none" || rawOptions.evidence !== "none")) {
    throw new Error("stdout capture cannot request persisted media or evidence");
  }
  const deps = {
    acquireFile: dependencies.acquireFile ?? acquireFile,
    acquireHttp: dependencies.acquireHttp ?? acquireHttp,
    acquireCookieHttp: dependencies.acquireCookieHttp ?? acquireCookieHttp,
    acquireCookieRecords: dependencies.acquireCookieRecords ?? acquireCookieRecords,
    acquireBrowser: dependencies.acquireBrowser ?? acquireBrowser,
    acquirePublicStructured: dependencies.acquirePublicStructured ?? acquirePublicStructured,
    extractPage: dependencies.extractPage ?? extractPage,
    localizeAssets: dependencies.localizeAssets ?? localizeAssets,
    captureMedia: dependencies.captureMedia ?? captureMedia,
    now: dependencies.now ?? (() => new Date)
  };
  const browserTemporaryDirectory = mkdtempSync2(join3(tmpdir2(), "cclrte-kb-browser-"));
  chmodSync2(browserTemporaryDirectory, 448);
  try {
    const preparedOptions = withBrowserProfileSnapshot(rawOptions, browserTemporaryDirectory);
    let currentBrowser = null;
    let resolvedOptions = preparedOptions;
    if (preparedOptions.currentTab) {
      try {
        const acquired = await deps.acquireBrowser(preparedOptions, browserTemporaryDirectory, false);
        const sanitizedUrl = new URL(sanitizeArtifactUrl(acquired.finalUrl.href));
        currentBrowser = sanitizedUrl.href === acquired.finalUrl.href ? acquired : { ...acquired, finalUrl: sanitizedUrl };
      } catch (error) {
        throw new Error(`current browser acquisition failed: ${safeAttemptMessage(error)}`, { cause: error });
      }
      resolvedOptions = { ...preparedOptions, url: currentBrowser.finalUrl, mode: "browser" };
    }
    const requestedUrl = captureUrl(resolvedOptions);
    const platform = classifyPlatformUrl(requestedUrl.href)?.platform ?? "generic";
    const sourceUrl = canonicalizeUrl(requestedUrl, platform).href;
    const scope = effectiveScope(platform, resolvedOptions.scope);
    const options = { ...resolvedOptions, scope };
    const candidates = [];
    const attempts = [];
    const browserOperationalWarnings = [];
    let structuredCapture = null;
    const browserScreenshots = new Map;
    const eagerBrowserCandidates = [];
    const eagerBrowserAttempts = [];
    const eagerBrowserRequested = options.mode === "auto" && browserFirstPlatforms.has(platform);
    if (eagerBrowserRequested && (options.browserLive || options.cdp !== undefined)) {
      browserOperationalWarnings.push("An attached browser attempt may have navigated and scrolled the active tab even if that candidate was not selected.");
    } else if (eagerBrowserRequested && options.browserProfile !== undefined && options.browserProfileOwnership !== "owned") {
      browserOperationalWarnings.push("A selected browser profile was exercised even if that candidate was not selected; a path-backed persistent profile may have been updated by page activity.");
    }
    const eagerBrowser = eagerBrowserRequested ? tryAcquisition(options.browserLive ? "browser-live" : options.cdp === undefined ? "browser" : "browser-cdp", () => deps.acquireBrowser(options, browserTemporaryDirectory, false), scope, options.timeoutMs, deps.extractPage, eagerBrowserCandidates, eagerBrowserAttempts) : null;
    if (options.currentTab) {
      if (currentBrowser === null)
        throw new Error("current browser acquisition did not produce a page");
      const browser = await tryAcquisition(options.browserLive ? "browser-live-current" : "browser-cdp-current", () => Promise.resolve(currentBrowser), scope, options.timeoutMs, deps.extractPage, candidates, attempts);
      if (browser !== null)
        browserOperationalWarnings.push(...browser.warnings);
      if (browser?.screenshotPath !== undefined)
        browserScreenshots.set(browser, browser.screenshotPath);
    } else if (options.mode === "file") {
      await tryAcquisition("file", () => deps.acquireFile(options), scope, options.timeoutMs, deps.extractPage, candidates, attempts);
    } else {
      if (options.mode === "auto" || options.mode === "http") {
        try {
          structuredCapture = await deps.acquirePublicStructured(options);
          if (structuredCapture !== null) {
            candidates.push(structuredCapture.extraction);
            attempts.push({
              method: structuredCapture.extraction.acquisition.method,
              outcome: "succeeded",
              message: `${structuredCapture.extraction.status}; ${structuredCapture.extraction.capturedItems} items`
            });
          } else {
            attempts.push({ method: "public-api", outcome: "skipped", message: "no stable public structured adapter" });
          }
        } catch (error) {
          attempts.push({ method: "public-api", outcome: "failed", message: safeAttemptMessage(error) });
        }
        await tryAcquisition("http", () => deps.acquireHttp(options), scope, options.timeoutMs, deps.extractPage, candidates, attempts);
        if (options.cookieSources.length > 0 || options.cookiesFile !== undefined) {
          await tryAcquisition("cookie-http", () => deps.acquireCookieHttp(options), scope, options.timeoutMs, deps.extractPage, candidates, attempts);
        }
      }
      if (eagerBrowser !== null) {
        const browser = await eagerBrowser;
        candidates.push(...eagerBrowserCandidates);
        attempts.push(...eagerBrowserAttempts);
        if (browser !== null)
          browserOperationalWarnings.push(...browser.warnings);
        if (browser?.screenshotPath !== undefined)
          browserScreenshots.set(browser, browser.screenshotPath);
      } else if (shouldUseBrowser(options, platform, scope, candidates)) {
        if (options.browserLive || options.cdp !== undefined) {
          browserOperationalWarnings.push("An attached browser attempt may have navigated and scrolled the active tab even if that candidate was not selected.");
        } else if (options.browserProfile !== undefined && options.browserProfileOwnership !== "owned") {
          browserOperationalWarnings.push("A selected browser profile was exercised even if that candidate was not selected; a path-backed persistent profile may have been updated by page activity.");
        }
        const browser = await tryAcquisition(options.browserLive ? "browser-live" : options.cdp === undefined ? "browser" : "browser-cdp", () => deps.acquireBrowser(options, browserTemporaryDirectory, false), scope, options.timeoutMs, deps.extractPage, candidates, attempts);
        if (browser !== null)
          browserOperationalWarnings.push(...browser.warnings);
        if (browser?.screenshotPath !== undefined)
          browserScreenshots.set(browser, browser.screenshotPath);
      }
    }
    const best = chooseCaptureExtraction(candidates, structuredCapture);
    if (best === null) {
      const details = attempts.filter(({ outcome }) => outcome === "failed").map(({ method, message }) => `${method}: ${message}`);
      throw new Error(`no acquisition produced usable content${details.length === 0 ? "" : ` (${details.join("; ")})`}`);
    }
    const slug = captureSlug(options, best);
    if (slug === "") {
      throw new Error(options.slug === undefined ? "could not derive a safe slug; pass one after the URL" : `slug ${JSON.stringify(options.slug)} contains no letters or digits`);
    }
    const capturedAt = deps.now().toISOString();
    const attemptWarnings = attempts.filter(({ outcome }) => outcome === "failed").map(({ method, message }) => `${method} attempt failed: ${message}`);
    const warnings = [...new Set([...best.warnings, ...browserOperationalWarnings, ...attemptWarnings])];
    if (options.stdout) {
      const rewritten = rewriteContentWithStatus(best.article.content, best.canonicalUrl, new Map);
      const status = statusAfterContentRewrite(best.status, rewritten.truncated);
      const redactedMarkdown = redactSensitiveTextWithCount(buildClipMarkdown(best.article, {
        slug,
        sourceHref: best.canonicalUrl.href,
        clipped: capturedAt.slice(0, 10),
        content: rewritten.content,
        platform: best.platform,
        captureStatus: status,
        captureMethod: best.acquisition.method,
        captureScope: scope
      }));
      const wordCount = countWords(redactedMarkdown.text);
      return {
        status,
        sourceUrl,
        canonicalUrl: best.canonicalUrl.href,
        platform: best.platform,
        scope,
        slug,
        acquisitionMethod: best.acquisition.method,
        extractor: best.extractor,
        wordCount,
        capturedItems: best.capturedItems,
        expectedItems: best.expectedItems,
        outputDirectory: null,
        markdownPath: null,
        assetCount: 0,
        warnings: finalizedWarnings([
          ...warnings,
          ...rewritten.truncated ? [CONTENT_REWRITE_TRUNCATION_WARNING] : []
        ], redactedMarkdown.count),
        attempts,
        markdown: redactedMarkdown.text,
        manifest: null
      };
    }
    const transaction = beginCaptureBundle({ outputRoot: options.outputBase, slug, force: options.force });
    try {
      const imageCookieProvider = assetCookieProvider(options, deps.acquireCookieRecords, best.canonicalUrl);
      const localized = options.media === "none" ? {
        ...rewriteContentWithStatus(best.article.content, best.canonicalUrl, new Map),
        assets: [],
        warnings: []
      } : await deps.localizeAssets(best.article.content, {
        assetsDirectory: transaction.assetsDirectory,
        baseUrl: best.canonicalUrl,
        userAgent: options.userAgent,
        timeoutMs: options.timeoutMs,
        maxAssetBytes: options.maxAssetBytes,
        maxTotalAssetBytes: options.maxTotalAssetBytes,
        allowPrivateNetwork: options.allowPrivateNetwork,
        ...imageCookieProvider === undefined ? {} : { cookieHeaderProvider: imageCookieProvider }
      });
      const combinedWarnings = [
        ...warnings,
        ...localized.warnings,
        ...localized.truncated ? [CONTENT_REWRITE_TRUNCATION_WARNING] : []
      ];
      const status = statusAfterContentRewrite(best.status, localized.truncated);
      const manifestAssets = [...localized.assets];
      let mediaRecords = [];
      let mediaStatus = "not-requested";
      if (options.media === "all") {
        const usedBytes = localized.assets.reduce((sum, asset) => sum + asset.bytes, 0);
        const remainingBytes = Math.max(1, options.maxTotalAssetBytes - usedBytes);
        const media = await deps.captureMedia({
          url: best.canonicalUrl,
          outputDirectory: join3(transaction.assetsDirectory, "media"),
          relativePrefix: "assets/media",
          timeoutMs: options.timeoutMs,
          maxFileBytes: Math.min(options.maxAssetBytes, remainingBytes),
          maxTotalBytes: remainingBytes,
          allowPrivateNetwork: options.allowPrivateNetwork,
          maxFiles: Math.min(options.maxItems, 100),
          userAgent: options.userAgent,
          ...cookieMediaOptions(options)
        });
        mediaStatus = media.status === "captured" && media.warnings.length > 0 ? "partial" : media.status;
        mediaRecords = media.records;
        manifestAssets.push(...mediaManifestAssets(media, best.canonicalUrl.href));
        combinedWarnings.push(...media.warnings);
      }
      const requestedScreenshot = options.evidence === "screenshot" || options.evidence === "all";
      const selectedScreenshot = browserScreenshots.get(best.acquisition) ?? null;
      const screenshotPath = requestedScreenshot ? screenshotIntoBundle(selectedScreenshot, transaction, options.maxAssetBytes) : null;
      if (requestedScreenshot && screenshotPath === null) {
        combinedWarnings.push(browserScreenshots.size > 0 ? "A screenshot was captured for a different acquisition candidate, so it was not attached to the selected content." : "A screenshot was requested but no valid bounded PNG was captured.");
      }
      const redactedMarkdown = redactSensitiveTextWithCount(buildClipMarkdown(best.article, {
        slug,
        sourceHref: best.canonicalUrl.href,
        clipped: capturedAt.slice(0, 10),
        content: appendCapturedMedia(localized.content, mediaRecords),
        platform: best.platform,
        captureStatus: status,
        captureMethod: best.acquisition.method,
        captureScope: scope
      }));
      const wordCount = countWords(redactedMarkdown.text);
      const finalWarnings = finalizedWarnings(combinedWarnings, redactedMarkdown.count);
      const includeSource = options.evidence === "source" || options.evidence === "all";
      const manifestInput = {
        sourceUrl,
        canonicalUrl: best.canonicalUrl.href,
        capturedAt,
        platform: best.platform,
        status,
        scope,
        acquisition: {
          method: best.acquisition.method,
          finalUrl: canonicalizeUrl(best.acquisition.finalUrl, best.platform).href,
          contentType: best.acquisition.contentType
        },
        extraction: {
          extractor: best.extractor,
          score: best.score,
          wordCount,
          capturedItems: best.capturedItems,
          expectedItems: best.expectedItems
        },
        attempts,
        assets: manifestAssets,
        artifacts: {
          images: {
            requested: options.media !== "none",
            status: options.media === "none" ? "not-requested" : localized.truncated || localized.warnings.length > 0 ? "partial" : "captured",
            files: localized.assets.length
          },
          media: {
            requested: options.media === "all",
            status: mediaStatus,
            files: mediaRecords.length
          }
        },
        evidence: {
          requested: options.evidence,
          screenshotPath,
          screenshotStatus: requestedScreenshot ? screenshotPath === null ? "unavailable" : "captured" : "not-requested",
          sourceHtmlStatus: includeSource ? "captured" : "not-requested"
        },
        warnings: finalWarnings
      };
      const manifest = writeCaptureBundle(transaction, {
        markdown: redactedMarkdown.text,
        manifest: manifestInput,
        ...includeSource ? { sourceHtml: best.acquisition.sourceEvidence ?? best.acquisition.body } : {}
      });
      const outputDirectory = commitCaptureBundle(transaction);
      return {
        status,
        sourceUrl,
        canonicalUrl: best.canonicalUrl.href,
        platform: best.platform,
        scope,
        slug,
        acquisitionMethod: best.acquisition.method,
        extractor: best.extractor,
        wordCount,
        capturedItems: best.capturedItems,
        expectedItems: best.expectedItems,
        outputDirectory,
        markdownPath: join3(outputDirectory, `${slug}.md`),
        assetCount: manifestAssets.length,
        warnings: finalWarnings,
        attempts,
        markdown: redactedMarkdown.text,
        manifest
      };
    } catch (error) {
      abortCaptureBundle(transaction);
      throw error;
    }
  } finally {
    rmSync2(browserTemporaryDirectory, { recursive: true, force: true });
  }
}

// src/clip/cli.ts
var defaultOutput = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value)
};
function line(value) {
  return value.endsWith(`
`) ? value : `${value}
`;
}
function safe(value) {
  return sanitizeTerminalLine(redactSensitiveText(value));
}
function redacted(value) {
  return redactSensitiveText(value);
}
function terminalSafeJson(value) {
  return `${JSON.stringify(value, (_key, candidate) => typeof candidate === "string" ? sanitizeTerminalText(candidate) : candidate, 2)}
`;
}
function captureSummary(outcome) {
  return {
    ok: captureSucceeded(outcome),
    status: outcome.status,
    sourceUrl: redacted(outcome.sourceUrl),
    canonicalUrl: redacted(outcome.canonicalUrl),
    platform: outcome.platform,
    scope: outcome.scope,
    slug: outcome.slug,
    acquisitionMethod: outcome.acquisitionMethod,
    extractor: outcome.extractor,
    wordCount: outcome.wordCount,
    capturedItems: outcome.capturedItems,
    expectedItems: outcome.expectedItems,
    outputDirectory: outcome.outputDirectory,
    markdownPath: outcome.markdownPath,
    assetCount: outcome.assetCount,
    warnings: outcome.warnings.map((warning) => redacted(warning)),
    attempts: outcome.attempts.map((attempt) => ({ ...attempt, message: redacted(attempt.message) })),
    manifest: outcome.manifest
  };
}
function captureSucceeded(outcome) {
  return outcome.status === "complete" || outcome.status === "partial";
}
function captureExitCode(outcome) {
  return captureSucceeded(outcome) ? 0 : 3;
}
async function diagnosticCommand(arguments_, output, inspectEnvironment) {
  const report = await inspectEnvironment();
  output.stdout(arguments_.json ? terminalSafeJson(report) : sanitizeTerminalText(renderDoctorReport(report)));
  const requiredReady = report.bun.status === "ready" && report.dependencies.every(({ status }) => status === "ready");
  return requiredReady ? 0 : 4;
}
async function main(rawArguments = process.argv.slice(2), environment = process.env, output = defaultOutput, dependencies = {}, runtimeOptions = {}) {
  const parsed = parseArguments(rawArguments, environment);
  if (!parsed.ok) {
    output.stderr(`error: ${safe(parsed.message)}

${sanitizeTerminalText(usage)}`);
    return 2;
  }
  const arguments_ = parsed.value;
  if (arguments_.command === "help") {
    output.stdout(sanitizeTerminalText(usage));
    return 0;
  }
  if (arguments_.command === "doctor") {
    return diagnosticCommand(arguments_, output, dependencies.inspectClipEnvironment ?? inspectClipEnvironment);
  }
  if (arguments_.command === "adapters") {
    output.stdout(arguments_.json ? terminalSafeJson({ schemaVersion: 1, adapters: adapterCapabilities }) : sanitizeTerminalText(renderAdapterCapabilities()));
    return 0;
  }
  if (!arguments_.quiet && !arguments_.json) {
    const target = arguments_.currentTab ? "the current browser tab" : safe(arguments_.url?.href ?? "current");
    output.stderr(`Capturing ${target} (${arguments_.mode}, ${arguments_.scope}) ...
`);
  }
  try {
    if (runtimeOptions.ownedBrowserProfile !== undefined && arguments_.browserProfile !== runtimeOptions.ownedBrowserProfile.path) {
      throw new Error("owned browser-profile execution does not match the selected private profile path");
    }
    const captureArguments = runtimeOptions.ownedBrowserProfile === undefined ? arguments_ : {
      ...arguments_,
      browserProfileOwnership: "owned",
      ...runtimeOptions.ownedBrowserProfile.profileDirectory === undefined ? {} : { browserProfileDirectory: runtimeOptions.ownedBrowserProfile.profileDirectory }
    };
    const outcome = await (dependencies.runCapture ?? runCapture)(captureArguments);
    if (arguments_.json) {
      output.stdout(terminalSafeJson(captureSummary(outcome)));
    } else if (arguments_.stdout) {
      output.stdout(sanitizeTerminalText(outcome.markdown));
    } else {
      output.stdout(line(safe(`Done: ${outcome.markdownPath ?? outcome.outputDirectory ?? outcome.slug}`)));
      output.stdout(line(safe(`Status: ${outcome.status}; ${outcome.wordCount} words; ${outcome.capturedItems}${outcome.expectedItems === null ? "" : `/${outcome.expectedItems}`} items; ${outcome.assetCount} assets.`)));
    }
    if (!arguments_.quiet && outcome.warnings.length > 0) {
      for (const warning of outcome.warnings)
        output.stderr(`warning: ${safe(warning)}
`);
    }
    return captureExitCode(outcome);
  } catch (error) {
    const message = safe(error instanceof Error ? error.message : String(error));
    if (arguments_.json)
      output.stdout(terminalSafeJson({ ok: false, error: message }));
    else
      output.stderr(`error: ${message}
`);
    return 1;
  }
}
if (import.meta.main)
  process.exitCode = await main();

export { runCapture, captureSummary, captureSucceeded, captureExitCode, main };
