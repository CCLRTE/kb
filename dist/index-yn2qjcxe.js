// @bun
import {
  startNetworkProxy
} from "./index-k4cczfgz.js";
import {
  assertSafeNetworkUrl,
  decodeBytes,
  safeFetch
} from "./index-kvxzb85x.js";
import {
  sanitizeArtifactUrl
} from "./index-7x30yhyy.js";
import {
  sanitizeTerminalText
} from "./index-q32a8bfd.js";
import {
  captureUrl
} from "./index-6g2pv9d2.js";
import {
  BoundedByteBuffer
} from "./index-efcktfvv.js";

// src/clip/acquire.ts
import {
  chmodSync,
  existsSync as existsSync2,
  lstatSync,
  mkdtempSync,
  readFileSync as readFileSync2,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "fs";
import { homedir, tmpdir } from "os";
import { basename, dirname as dirname2, isAbsolute, join as join2, relative, resolve as resolve3, sep } from "path";
import { getCookies } from "@steipete/sweet-cookie";

// src/clip/cookies.ts
import { closeSync, constants, fstatSync, openSync, readSync } from "fs";
import { resolve } from "path";
var MAX_COOKIE_RECORDS = 4096;
var MAX_COOKIE_BYTES = 2 * 1024 * 1024;
var cookieNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
var cookieValuePattern = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;
var cookieDomainPattern = /^[a-z0-9.-]+$/i;
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isUnknownArray = (value) => Array.isArray(value);
function hasControlCharacter(value) {
  for (let index = 0;index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127)
      return true;
  }
  return false;
}
function canonicalHostname(value) {
  const trimmed = value.trim().toLowerCase().replace(/^\.+/, "").replace(/\.$/, "");
  if (trimmed === "" || trimmed.length > 253 || trimmed.includes("..") || !cookieDomainPattern.test(trimmed)) {
    return null;
  }
  try {
    const hostname = new URL(`http://${trimmed}/`).hostname.toLowerCase().replace(/\.$/, "");
    return hostname === "" || hostname.length > 253 ? null : hostname;
  } catch {
    return null;
  }
}
function domainMatches(hostname, domain, hostOnly) {
  return hostname === domain || !hostOnly && hostname.endsWith(`.${domain}`);
}
function pathMatches(requestPath, cookiePath) {
  if (requestPath === cookiePath)
    return true;
  if (!requestPath.startsWith(cookiePath))
    return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}
function safeCookiePath(value) {
  const path = value === undefined ? "/" : value;
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 4096 || hasControlCharacter(path))
    return null;
  return path;
}
function cookieExpiry(value, nowSeconds) {
  const raw = value.expires ?? value.expirationDate;
  if (raw === undefined || raw === null)
    return 0;
  if (typeof raw !== "number" || !Number.isFinite(raw))
    return null;
  if (raw === 0)
    return 0;
  if (raw <= nowSeconds || raw > 253402300799)
    return null;
  return Math.trunc(raw);
}
function cookieSameSite(value) {
  if (value.sameSite === undefined || value.sameSite === null)
    return null;
  if (typeof value.sameSite !== "string")
    return;
  switch (value.sameSite.toLowerCase()) {
    case "strict":
      return "Strict";
    case "lax":
      return "Lax";
    case "none":
    case "no_restriction":
      return "None";
    case "unspecified":
      return null;
    default:
      return;
  }
}
function candidateDomain(value, target) {
  const targetHostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  let rawDomain;
  if (typeof value.domain === "string")
    rawDomain = value.domain;
  else if (value.domain !== undefined)
    return null;
  let urlHostname;
  if (value.url !== undefined) {
    if (typeof value.url !== "string" || value.url.length > 8192)
      return null;
    try {
      const url = new URL(value.url);
      if (url.protocol !== "http:" && url.protocol !== "https:" || url.username !== "" || url.password !== "")
        return null;
      urlHostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    } catch {
      return null;
    }
  }
  if (rawDomain === undefined && urlHostname === undefined) {
    return { domain: targetHostname, hostOnly: true };
  }
  const hadLeadingDot = rawDomain?.trim().startsWith(".") === true;
  const domain = canonicalHostname(rawDomain ?? urlHostname ?? "");
  if (domain === null)
    return null;
  const explicitHostOnly = value.hostOnly;
  if (explicitHostOnly !== undefined && typeof explicitHostOnly !== "boolean")
    return null;
  const hostOnly = typeof explicitHostOnly === "boolean" ? explicitHostOnly : !hadLeadingDot;
  if (!domainMatches(targetHostname, domain, hostOnly))
    return null;
  if (urlHostname !== undefined && !domainMatches(urlHostname, domain, hostOnly))
    return null;
  return { domain, hostOnly };
}
function hasSafeUnpartitionedProvenance(value) {
  for (const field of ["partitionKey", "topFrameSiteKey", "top_frame_site_key", "originAttributes"]) {
    const provenance = value[field];
    if (provenance === undefined || provenance === null)
      continue;
    if (typeof provenance !== "string" || provenance.trim() !== "")
      return false;
  }
  for (const field of ["partitioned"]) {
    const flag = value[field];
    if (flag === undefined || flag === null)
      continue;
    if (typeof flag !== "boolean" || flag)
      return false;
  }
  for (const field of ["isPartitionedAttributeSet", "hasCrossSiteAncestor", "has_cross_site_ancestor"]) {
    const flag = value[field];
    if (flag === undefined || flag === null)
      continue;
    if (flag !== false && flag !== 0 && flag !== "0")
      return false;
  }
  return true;
}
function validatedCookie(value, target, nowSeconds) {
  if (!isRecord(value))
    return null;
  if (typeof value.name !== "string" || value.name.length > 1024 || !cookieNamePattern.test(value.name))
    return null;
  if (typeof value.value !== "string" || value.value.length > 64 * 1024 || !cookieValuePattern.test(value.value))
    return null;
  if (!hasSafeUnpartitionedProvenance(value))
    return null;
  const domain = candidateDomain(value, target);
  const path = safeCookiePath(value.path);
  const expires = cookieExpiry(value, nowSeconds);
  const sameSite = cookieSameSite(value);
  if (domain === null || path === null || expires === null || sameSite === undefined)
    return null;
  if (!pathMatches(target.pathname || "/", path))
    return null;
  if (value.secure !== undefined && typeof value.secure !== "boolean")
    return null;
  if (value.httpOnly !== undefined && typeof value.httpOnly !== "boolean")
    return null;
  const secure = value.secure === true;
  if (secure && target.protocol !== "https:")
    return null;
  if (sameSite === "None" && !secure)
    return null;
  return {
    name: value.name,
    value: value.value,
    domain: domain.domain,
    hostOnly: domain.hostOnly,
    path,
    secure,
    httpOnly: value.httpOnly === true,
    sameSite,
    expires
  };
}
function cookieBytes(cookie) {
  return Buffer.byteLength(`${cookie.domain}	${cookie.path}	${cookie.name}	${cookie.value}
`, "utf8");
}
function filterCookies(values, target, nowSeconds = Math.floor(Date.now() / 1000)) {
  const bounded = values.slice(0, MAX_COOKIE_RECORDS);
  let rejected = Math.max(0, values.length - bounded.length);
  let totalBytes = 0;
  const cookies = new Map;
  for (const value of bounded) {
    const cookie = validatedCookie(value, target, nowSeconds);
    if (cookie === null) {
      rejected += 1;
      continue;
    }
    const key = `${cookie.domain}\x00${cookie.hostOnly ? "host" : "domain"}\x00${cookie.path}\x00${cookie.name}`;
    const previous = cookies.get(key);
    const nextBytes = totalBytes - (previous === undefined ? 0 : cookieBytes(previous)) + cookieBytes(cookie);
    if (nextBytes > MAX_COOKIE_BYTES) {
      rejected += 1;
      continue;
    }
    cookies.set(key, cookie);
    totalBytes = nextBytes;
  }
  return {
    cookies: [...cookies.values()].sort((left, right) => right.path.length - left.path.length || left.name.localeCompare(right.name) || left.domain.localeCompare(right.domain)),
    rejected
  };
}
function jsonCookieArray(value) {
  if (isUnknownArray(value))
    return value;
  return isRecord(value) && isUnknownArray(value.cookies) ? value.cookies : null;
}
function parseJson(input) {
  try {
    return jsonCookieArray(JSON.parse(input));
  } catch {
    return null;
  }
}
function parseBase64Json(input) {
  const compact = input.replace(/\s+/g, "");
  if (compact === "" || compact.length > MAX_COOKIE_BYTES * 2 || !/^[a-z0-9+/]+=*$/i.test(compact))
    return null;
  try {
    const decoded = Buffer.from(compact, "base64");
    return decoded.byteLength > MAX_COOKIE_BYTES ? null : parseJson(decoded.toString("utf8"));
  } catch {
    return null;
  }
}
function parseNetscape(input) {
  const cookies = [];
  let looksLikeNetscape = /^# Netscape HTTP Cookie File/im.test(input);
  let cursor = 0;
  while (cursor <= input.length && cookies.length <= MAX_COOKIE_RECORDS) {
    const newline = input.indexOf(`
`, cursor);
    const lineEnd = newline === -1 ? input.length : newline;
    const rawLine = input.slice(cursor, lineEnd).replace(/\r$/, "");
    cursor = newline === -1 ? input.length + 1 : newline + 1;
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") && !line.startsWith("#HttpOnly_"))
      continue;
    if (line.length > 80 * 1024)
      continue;
    const columns = line.split("\t", 8);
    if (columns.length < 7)
      continue;
    looksLikeNetscape = true;
    const rawDomain = columns[0];
    const includeSubdomains = columns[1];
    const path = columns[2];
    const secure = columns[3];
    const rawExpires = columns[4];
    const name = columns[5];
    const value = columns.slice(6).join("\t");
    if (rawDomain === undefined || includeSubdomains === undefined || path === undefined || secure === undefined || rawExpires === undefined || name === undefined)
      continue;
    const httpOnly = rawDomain.startsWith("#HttpOnly_");
    const domain = httpOnly ? rawDomain.slice("#HttpOnly_".length) : rawDomain;
    const expires = Number(rawExpires);
    cookies.push({
      name,
      value,
      domain,
      hostOnly: includeSubdomains.toUpperCase() !== "TRUE",
      path,
      secure: secure.toUpperCase() === "TRUE",
      httpOnly,
      ...Number.isFinite(expires) && expires > 0 ? { expires } : {}
    });
  }
  return looksLikeNetscape ? cookies : null;
}
function unquote(value) {
  const trimmed = value.trim();
  const first = trimmed[0];
  return (first === "'" || first === '"') && trimmed.at(-1) === first ? trimmed.slice(1, -1) : trimmed;
}
function parseCookieHeaderValue(value, target) {
  const cookies = [];
  const restrictivePath = target.pathname === "" ? "/" : target.pathname;
  let cursor = 0;
  while (cursor <= value.length && cookies.length <= MAX_COOKIE_RECORDS) {
    const delimiter = value.indexOf(";", cursor);
    const pairEnd = delimiter === -1 ? value.length : delimiter;
    const pair = value.slice(cursor, pairEnd);
    cursor = delimiter === -1 ? value.length + 1 : delimiter + 1;
    const separator = pair.indexOf("=");
    if (separator < 1)
      continue;
    cookies.push({
      name: pair.slice(0, separator).trim(),
      value: pair.slice(separator + 1).trim(),
      domain: target.hostname,
      hostOnly: true,
      path: restrictivePath,
      secure: target.protocol === "https:",
      httpOnly: true,
      sameSite: "Strict"
    });
  }
  return cookies;
}
function curlCookieValue(input) {
  const patterns = [
    /(?:^|\s)(?:-b|--cookie)(?:=|\s+)(('[^']*')|("[^"]*")|[^\s]+)/i,
    /(?:^|\s)(?:-H|--header)(?:=|\s+)(('Cookie:\s*[^']*')|("Cookie:\s*[^"]*"))/i
  ];
  for (const pattern of patterns) {
    const raw = pattern.exec(input)?.[1];
    if (raw === undefined)
      continue;
    return { value: unquote(raw).replace(/^Cookie:\s*/i, ""), curl: true };
  }
  const header = /^Cookie:\s*([^\r\n]*)$/im.exec(input)?.[1];
  if (header !== undefined)
    return { value: header, curl: false };
  const trimmed = input.trim();
  return !trimmed.includes(`
`) && trimmed.includes("=") ? { value: trimmed, curl: false } : null;
}
function parseCookiePayload(input, target, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (Buffer.byteLength(input, "utf8") > MAX_COOKIE_BYTES)
    return { ok: false, reason: "too-large" };
  if (input.trim() === "")
    return { ok: false, reason: "empty" };
  let values = parseJson(input);
  let format = "json";
  if (values === null) {
    values = parseBase64Json(input);
    format = "base64-json";
  }
  if (values === null) {
    values = parseNetscape(input);
    format = "netscape";
  }
  if (values === null) {
    const header = curlCookieValue(input);
    if (header !== null) {
      values = parseCookieHeaderValue(header.value, target);
      format = header.curl ? "curl" : "cookie-header";
    }
  }
  if (values === null)
    return { ok: false, reason: "invalid" };
  const filtered = filterCookies(values, target, nowSeconds);
  return filtered.cookies.length === 0 ? { ok: false, reason: "empty" } : { ok: true, format, ...filtered };
}
function readCookieFile(path, target, options = {}) {
  let descriptor;
  try {
    const absolute = resolve(path);
    const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
    const nonBlocking = "O_NONBLOCK" in constants ? constants.O_NONBLOCK : 0;
    descriptor = openSync(absolute, constants.O_RDONLY | noFollow | nonBlocking);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  try {
    options.afterOpen?.();
    const stats = fstatSync(descriptor);
    if (!stats.isFile())
      return { ok: false, reason: "unavailable" };
    if (stats.size > MAX_COOKIE_BYTES)
      return { ok: false, reason: "too-large" };
    const chunks = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    for (;; ) {
      const count = readSync(descriptor, buffer, 0, buffer.byteLength, null);
      if (count === 0)
        break;
      total += count;
      if (total > MAX_COOKIE_BYTES)
        return { ok: false, reason: "too-large" };
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
    } catch {
      return { ok: false, reason: "invalid" };
    }
    return parseCookiePayload(text, target);
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    closeSync(descriptor);
  }
}
function filterCookieProviderResult(value, target) {
  if (!isRecord(value) || !Array.isArray(value.cookies)) {
    return { validShape: false, cookies: [], rejected: 0, providerWarningCount: 0 };
  }
  const provenancePreserving = value.cookies.filter((cookie) => isRecord(cookie) && typeof cookie.hostOnly === "boolean");
  const missingProvenance = value.cookies.length - provenancePreserving.length;
  const filtered = filterCookies(provenancePreserving, target, Math.floor(Date.now() / 1000));
  return {
    validShape: true,
    ...filtered,
    rejected: filtered.rejected + missingProvenance,
    providerWarningCount: Array.isArray(value.warnings) ? value.warnings.length : 0
  };
}
function renderCookieHeader(cookies) {
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}
function renderNetscapeCookieJar(cookies, target) {
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return [
    "# Netscape HTTP Cookie File",
    "# Created temporarily by kb clip; deleted after media capture.",
    ...cookies.map((cookie) => {
      const domain = `${cookie.httpOnly ? "#HttpOnly_" : ""}${hostname}`;
      return `${domain}	FALSE	${cookie.path}	${cookie.secure ? "TRUE" : "FALSE"}	${cookie.expires}	${cookie.name}	${cookie.value}`;
    }),
    ""
  ].join(`
`);
}

// src/clip/lib.ts
var articleMetadataLimits = {
  title: 2048,
  author: 1024,
  published: 256,
  description: 8192
};
var MAX_SLUG_INPUT_CODE_UNITS = 4096;
var MAX_YAML_SCALAR_CODE_UNITS = 16384;
function boundedPrefix(value, maxCodeUnits, marker = "") {
  if (value.length <= maxCodeUnits)
    return value;
  const markerLength = Math.min(marker.length, maxCodeUnits);
  let end = maxCodeUnits - markerLength;
  const finalCode = value.charCodeAt(end - 1);
  if (finalCode >= 55296 && finalCode <= 56319)
    end -= 1;
  return value.slice(0, Math.max(0, end)) + marker.slice(0, markerLength);
}
function boundedMetadata(value, maxCodeUnits) {
  return value === null ? null : boundedPrefix(value, maxCodeUnits, "\u2026");
}
function slugify(value) {
  const normalized = boundedPrefix(value, MAX_SLUG_INPUT_CODE_UNITS).normalize("NFKC").toLowerCase().replace(/['\u2019]/g, "").replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/g, "").replace(/-+$/g, "");
  let end = 0;
  let characters = 0;
  for (const character of normalized) {
    if (characters === 80)
      break;
    end += character.length;
    characters += 1;
  }
  return normalized.slice(0, end).replace(/-+$/g, "");
}
function yamlString(value) {
  const sanitized = sanitizeTerminalText(boundedPrefix(value, MAX_YAML_SCALAR_CODE_UNITS, "\u2026"));
  const chunks = ['"'];
  let unchangedStart = 0;
  for (let cursor = 0;cursor < sanitized.length; cursor += 1) {
    const character = sanitized[cursor] ?? "";
    const codePoint = sanitized.charCodeAt(cursor);
    let replacement = null;
    if (character === "\\")
      replacement = "\\\\";
    else if (character === '"')
      replacement = "\\\"";
    else if (character === `
`)
      replacement = "\\n";
    else if (character === "\r")
      replacement = "\\r";
    else if (character === "\t")
      replacement = "\\t";
    else if (codePoint <= 31 || codePoint >= 127 && codePoint <= 159) {
      replacement = `\\x${codePoint.toString(16).padStart(2, "0")}`;
    } else if (codePoint === 8232 || codePoint === 8233 || codePoint === 65279) {
      replacement = `\\u${codePoint.toString(16).padStart(4, "0")}`;
    }
    if (replacement === null)
      continue;
    chunks.push(sanitized.slice(unchangedStart, cursor), replacement);
    unchangedStart = cursor + 1;
  }
  chunks.push(sanitized.slice(unchangedStart), '"');
  return chunks.join("");
}
function resolveRemote(source, base) {
  if (source.length > MAX_REMOTE_SOURCE_CODE_UNITS || source.startsWith("data:") || source.startsWith("#"))
    return null;
  try {
    const url = new URL(source, base);
    return (url.protocol === "http:" || url.protocol === "https:") && url.href.length <= MAX_RESOLVED_URL_CODE_UNITS ? url : null;
  } catch {
    return null;
  }
}
function inertRemoteImageHref(url) {
  const inert = new URL(url);
  inert.username = "";
  inert.password = "";
  inert.search = "";
  inert.hash = "";
  return inert.href.replace(/\(/g, "%28").replace(/\)/g, "%29");
}
var balancedParentheses = /[^()\s]*(?:\([^()\s]*(?:\([^()\s]*(?:\([^()\s]*\)[^()\s]*)?\)[^()\s]*)?\)[^()\s]*)*/;
var markdownImage = new RegExp(`!\\[([^\\]]*)\\]\\((?:<([^<>]*)>|(${balancedParentheses.source}))((?:\\s+"[^"]*")?)\\)`, "g");
var htmlImage = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
var plainLink = new RegExp(`(\\]\\()(?:<([^<>]*)>|(${balancedParentheses.source}))((?:\\s+"[^"]*")?)(\\))`, "g");
var referenceImage = /!\[([^\]\r\n]*)\]\[([^\]\r\n]*)\]/g;
var referenceDefinition = /^([ \t]{0,3}\[([^\]\r\n]+)\]:[ \t]*)(?:<([^<>\r\n]*)>|(\S+))([^\r\n]*)$/gm;
var obsidianEmbed = /!\[\[([^\]\r\n]+)\]\]/g;
var safeMarkdownHtmlElements = new Set([
  "abbr",
  "b",
  "bdi",
  "bdo",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
  "wbr"
]);
var rawHtmlTag = /<\s*(?!https?:\/\/)(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)\b[^>]*>/gi;
var unsafeMarkdownImage = /!\[([^\]]*)\]\(\s*<?\s*(?:data|javascript|vbscript|file|blob):[^\r\n]*\)/gi;
var protectedPlaceholder = /\0PROTECTED(\d+)\0/g;
var MAX_PROTECTED_MARKDOWN_SPANS = 4096;
var MAX_INLINE_CODE_RUNS_PER_LINE = 4096;
var MAX_IMAGE_CANDIDATES = 250000;
var MAX_MARKUP_CANDIDATES = 50000;
var MAX_INERT_OVERFLOW_PREVIEW_CODE_UNITS = 256 * 1024;
var MAX_IMAGE_SOURCES = 10001;
var MAX_REFERENCE_LABELS = 10001;
var MAX_REFERENCE_LABEL_CODE_UNITS = 1024;
var MAX_REMOTE_SOURCE_CODE_UNITS = 8192;
var MAX_RESOLVED_URL_CODE_UNITS = 16384;
var MAX_IMAGE_ALT_CODE_UNITS = 2048;
function openingFence(content, lineStart, lineEnd) {
  let cursor = lineStart;
  let indentation = 0;
  while (indentation < 3 && content[cursor] === " ") {
    cursor += 1;
    indentation += 1;
  }
  const marker = content[cursor];
  if (marker !== "`" && marker !== "~")
    return null;
  const runStart = cursor;
  while (cursor < lineEnd && content[cursor] === marker)
    cursor += 1;
  const length = cursor - runStart;
  if (length < 3)
    return null;
  const laterBacktick = marker === "`" ? content.indexOf("`", cursor) : -1;
  if (laterBacktick !== -1 && laterBacktick < lineEnd)
    return null;
  return { marker, length };
}
function isClosingFence(content, lineStart, lineEnd, delimiter) {
  let cursor = lineStart;
  let indentation = 0;
  while (indentation < 3 && content[cursor] === " ") {
    cursor += 1;
    indentation += 1;
  }
  const runStart = cursor;
  while (cursor < lineEnd && content[cursor] === delimiter.marker)
    cursor += 1;
  if (cursor - runStart < delimiter.length)
    return false;
  while (cursor < lineEnd && (content[cursor] === " " || content[cursor] === "\t" || content[cursor] === "\r")) {
    cursor += 1;
  }
  return cursor === lineEnd;
}
function protectMarkdownFences(content, protectedSpans) {
  const chunks = [];
  let unchangedStart = 0;
  let lineStart = 0;
  let active = null;
  while (lineStart < content.length) {
    const newline = content.indexOf(`
`, lineStart);
    const lineEnd = newline === -1 ? content.length : newline;
    if (active === null) {
      const delimiter = newline === -1 ? null : openingFence(content, lineStart, lineEnd);
      if (delimiter !== null)
        active = { start: lineStart, delimiter };
    } else if (isClosingFence(content, lineStart, lineEnd, active.delimiter)) {
      if (protectedSpans.length >= MAX_PROTECTED_MARKDOWN_SPANS)
        return null;
      chunks.push(content.slice(unchangedStart, active.start), `\x00PROTECTED${protectedSpans.length}\x00`);
      protectedSpans.push(content.slice(active.start, lineEnd));
      unchangedStart = lineEnd;
      active = null;
    }
    if (newline === -1)
      break;
    lineStart = newline + 1;
  }
  if (active !== null)
    return null;
  if (chunks.length === 0)
    return content;
  chunks.push(content.slice(unchangedStart));
  return chunks.join("");
}
function protectInlineCodeSpans(content, protectedSpans) {
  if (!content.includes("`"))
    return content;
  const chunks = [];
  let unchangedStart = 0;
  let lineStart = 0;
  while (lineStart < content.length) {
    const newline = content.indexOf(`
`, lineStart);
    const lineEnd = newline === -1 ? content.length : newline;
    const runs = [];
    let cursor = lineStart;
    for (;; ) {
      const start = content.indexOf("`", cursor);
      if (start === -1 || start >= lineEnd)
        break;
      let end = start + 1;
      while (end < lineEnd && content[end] === "`")
        end += 1;
      if (runs.length >= MAX_INLINE_CODE_RUNS_PER_LINE)
        return null;
      runs.push({ start, end, length: end - start });
      cursor = end;
    }
    const nextSameLength = [];
    nextSameLength.length = runs.length;
    const laterByLength = new Map;
    for (let index = runs.length - 1;index >= 0; index -= 1) {
      const run = runs[index];
      if (run === undefined)
        continue;
      nextSameLength[index] = laterByLength.get(run.length);
      laterByLength.set(run.length, index);
    }
    for (let index = 0;index < runs.length; ) {
      const closingIndex = nextSameLength[index];
      if (closingIndex === undefined) {
        index += 1;
        continue;
      }
      const opening = runs[index];
      const closing = runs[closingIndex];
      if (opening === undefined || closing === undefined) {
        index += 1;
        continue;
      }
      if (protectedSpans.length >= MAX_PROTECTED_MARKDOWN_SPANS)
        return null;
      chunks.push(content.slice(unchangedStart, opening.start), `\x00PROTECTED${protectedSpans.length}\x00`);
      protectedSpans.push(content.slice(opening.start, closing.end));
      unchangedStart = closing.end;
      index = closingIndex + 1;
    }
    if (newline === -1)
      break;
    lineStart = newline + 1;
  }
  if (chunks.length === 0)
    return content;
  chunks.push(content.slice(unchangedStart));
  return chunks.join("");
}
function restoreMarkdownSpans(content, protectedSpans) {
  return content.replace(protectedPlaceholder, (_whole, index) => protectedSpans[Number(index)] ?? "");
}
function inertProtectedOverflow(content) {
  let previewEnd = Math.min(content.length, MAX_INERT_OVERFLOW_PREVIEW_CODE_UNITS);
  const finalCode = content.charCodeAt(previewEnd - 1);
  if (finalCode >= 55296 && finalCode <= 56319)
    previewEnd -= 1;
  const escaped = content.slice(0, previewEnd).replace(/[&<>]/g, (character) => character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;");
  const omitted = content.length - previewEnd;
  const omission = omitted === 0 ? "" : `

[${omitted} source code unit(s) omitted]`;
  return `*[Content rendered inert because the protected Markdown span limit was exceeded.]*

<pre>
${escaped}${omission}
</pre>`;
}
function inertCandidateOverflow(content) {
  let previewEnd = Math.min(content.length, MAX_INERT_OVERFLOW_PREVIEW_CODE_UNITS);
  const finalCode = content.charCodeAt(previewEnd - 1);
  if (finalCode >= 55296 && finalCode <= 56319)
    previewEnd -= 1;
  const escaped = content.slice(0, previewEnd).replace(/[&<>]/g, (character) => character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;");
  const omitted = content.length - previewEnd;
  const omission = omitted === 0 ? "" : `

[${omitted} source code unit(s) omitted]`;
  return `*[Content rendered inert because a markup/image-candidate safety limit was exceeded.]*

<pre>
${escaped}${omission}
</pre>`;
}
function escapeMarkdownLabel(value) {
  return boundedPrefix(value, MAX_IMAGE_ALT_CODE_UNITS, "\u2026").replace(/\\/g, "\\\\").replace(/[[\]`]/g, "\\$&").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\r\n]+/g, " ").trim();
}
function normalizedReferenceLabel(value) {
  if (value.length > MAX_REFERENCE_LABEL_CODE_UNITS)
    return null;
  return value.replace(/\\([\\[\]])/g, "$1").replace(/\s+/g, " ").trim().toLowerCase();
}
function referenceLabels(content) {
  const labels = new Set;
  let truncated = false;
  let cardinalityExceeded = false;
  referenceImage.lastIndex = 0;
  try {
    for (;; ) {
      const match = referenceImage.exec(content);
      if (match === null)
        break;
      const alt = match[1] ?? "";
      const rawLabel = match[2] === "" ? alt : match[2] ?? "";
      const label = normalizedReferenceLabel(rawLabel);
      if (label === null) {
        truncated = true;
        continue;
      }
      if (labels.has(label))
        continue;
      if (labels.size >= MAX_REFERENCE_LABELS) {
        truncated = true;
        cardinalityExceeded = true;
        break;
      }
      labels.add(label);
    }
  } finally {
    referenceImage.lastIndex = 0;
  }
  return { labels, truncated, cardinalityExceeded };
}
function referenceTargets(content, labels) {
  const targets = new Map;
  let truncated = false;
  if (labels.size === 0)
    return { targets, truncated };
  referenceDefinition.lastIndex = 0;
  try {
    for (;; ) {
      const match = referenceDefinition.exec(content);
      if (match === null)
        break;
      const rawLabel = match[2];
      const target = match[3] ?? match[4];
      if (rawLabel === undefined || target === undefined)
        continue;
      const label = normalizedReferenceLabel(rawLabel);
      if (label === null || !labels.has(label))
        continue;
      if (target.length > MAX_REMOTE_SOURCE_CODE_UNITS) {
        targets.delete(label);
        truncated = true;
        continue;
      }
      targets.set(label, target);
    }
  } finally {
    referenceDefinition.lastIndex = 0;
  }
  return { targets, truncated };
}
function sanitizeMarkdownHtml(content) {
  return content.replace(/<!--[\s\S]*?-->/g, "").replace(rawHtmlTag, (_whole, closing, rawName) => {
    const name = rawName.toLowerCase();
    if (!safeMarkdownHtmlElements.has(name)) {
      return `&lt;${closing === "/" ? "/" : ""}${name}&gt;`;
    }
    return `<${closing === "/" ? "/" : ""}${name}>`;
  });
}
function imageCandidateStructure(content) {
  let cursor = 0;
  let count = 0;
  for (;; ) {
    const start = content.indexOf("![", cursor);
    if (start === -1)
      return { safeForRegexScan: true, cardinalityExceeded: false };
    count += 1;
    if (count > MAX_IMAGE_CANDIDATES) {
      return { safeForRegexScan: false, cardinalityExceeded: true };
    }
    const altEnd = content.indexOf("]", start + 2);
    const nestedImage = content.indexOf("![", start + 2);
    if (altEnd === -1 || nestedImage !== -1 && nestedImage < altEnd) {
      return { safeForRegexScan: false, cardinalityExceeded: false };
    }
    const targetMarker = content[altEnd + 1];
    if (targetMarker === "(" || targetMarker === "[") {
      const targetEnd = content.indexOf(targetMarker === "(" ? ")" : "]", altEnd + 2);
      const nestedTargetImage = content.indexOf("![", altEnd + 2);
      if (targetEnd === -1 || nestedTargetImage !== -1 && nestedTargetImage < targetEnd) {
        return { safeForRegexScan: false, cardinalityExceeded: false };
      }
      cursor = targetEnd + 1;
      continue;
    }
    cursor = targetMarker === "]" ? altEnd + 2 : altEnd + 1;
  }
}
function markupCandidateStructure(content) {
  let cursor = 0;
  let count = 0;
  for (;; ) {
    const start = content.indexOf("<", cursor);
    if (start === -1)
      return { safeForRegexScan: true, cardinalityExceeded: false };
    if (content.startsWith("<!--", start)) {
      count += 1;
      if (count > MAX_MARKUP_CANDIDATES) {
        return { safeForRegexScan: false, cardinalityExceeded: true };
      }
      const end2 = content.indexOf("-->", start + 4);
      const nested2 = content.indexOf("<!--", start + 4);
      if (end2 === -1) {
        return nested2 === -1 ? { safeForRegexScan: true, cardinalityExceeded: false } : { safeForRegexScan: false, cardinalityExceeded: false };
      }
      if (nested2 !== -1 && nested2 < end2) {
        return { safeForRegexScan: false, cardinalityExceeded: false };
      }
      cursor = end2 + 3;
      continue;
    }
    let nameStart = start + 1;
    while (content[nameStart] === " " || content[nameStart] === "\t")
      nameStart += 1;
    if (content[nameStart] === "/")
      nameStart += 1;
    while (content[nameStart] === " " || content[nameStart] === "\t")
      nameStart += 1;
    const first = content.charCodeAt(nameStart);
    if (!(first >= 65 && first <= 90 || first >= 97 && first <= 122)) {
      cursor = start + 1;
      continue;
    }
    const schemePrefix = content.slice(nameStart, nameStart + 8).toLowerCase();
    if (schemePrefix.startsWith("http://") || schemePrefix.startsWith("https://")) {
      cursor = start + 1;
      continue;
    }
    count += 1;
    if (count > MAX_MARKUP_CANDIDATES) {
      return { safeForRegexScan: false, cardinalityExceeded: true };
    }
    const end = content.indexOf(">", nameStart + 1);
    const nested = content.indexOf("<", nameStart + 1);
    if (end === -1) {
      return nested === -1 ? { safeForRegexScan: true, cardinalityExceeded: false } : { safeForRegexScan: false, cardinalityExceeded: false };
    }
    if (nested !== -1 && nested < end) {
      return { safeForRegexScan: false, cardinalityExceeded: false };
    }
    cursor = end + 1;
  }
}
function scanImageSources(content, requestedMaximum = MAX_IMAGE_SOURCES) {
  const maximum = Number.isSafeInteger(requestedMaximum) ? Math.max(0, Math.min(requestedMaximum, MAX_IMAGE_SOURCES)) : MAX_IMAGE_SOURCES;
  const protectedSpans = [];
  const fenced = protectMarkdownFences(content, protectedSpans);
  if (fenced === null) {
    return { sources: new Set, truncated: true, cardinalityExceeded: true, requiresInertFallback: true };
  }
  const searchable = protectInlineCodeSpans(fenced, protectedSpans);
  if (searchable === null) {
    return { sources: new Set, truncated: true, cardinalityExceeded: true, requiresInertFallback: true };
  }
  const candidateStructure = imageCandidateStructure(searchable);
  if (!candidateStructure.safeForRegexScan) {
    return {
      sources: new Set,
      truncated: true,
      cardinalityExceeded: candidateStructure.cardinalityExceeded,
      requiresInertFallback: true
    };
  }
  const markupStructure = markupCandidateStructure(searchable);
  if (!markupStructure.safeForRegexScan) {
    return {
      sources: new Set,
      truncated: true,
      cardinalityExceeded: markupStructure.cardinalityExceeded,
      requiresInertFallback: true
    };
  }
  const sources = new Set;
  let truncated = false;
  let cardinalityExceeded = false;
  const addSource = (source) => {
    if (source === undefined || source === "")
      return true;
    if (source.length > MAX_REMOTE_SOURCE_CODE_UNITS) {
      truncated = true;
      return true;
    }
    if (sources.has(source))
      return true;
    if (sources.size >= maximum) {
      truncated = true;
      cardinalityExceeded = true;
      return false;
    }
    sources.add(source);
    return true;
  };
  markdownImage.lastIndex = 0;
  try {
    for (;; ) {
      const match = markdownImage.exec(searchable);
      if (match === null)
        break;
      if (!addSource(match[2] ?? match[3]))
        break;
    }
  } finally {
    markdownImage.lastIndex = 0;
  }
  if (!truncated) {
    htmlImage.lastIndex = 0;
    try {
      for (;; ) {
        const match = htmlImage.exec(searchable);
        if (match === null)
          break;
        if (!addSource(match[1]))
          break;
      }
    } finally {
      htmlImage.lastIndex = 0;
    }
  }
  if (!truncated) {
    const labelScan = referenceLabels(searchable);
    const definitionScan = referenceTargets(searchable, labelScan.labels);
    truncated ||= labelScan.truncated || definitionScan.truncated;
    cardinalityExceeded ||= labelScan.cardinalityExceeded;
    for (const label of labelScan.labels) {
      if (!addSource(definitionScan.targets.get(label)))
        break;
    }
  }
  return {
    sources,
    truncated,
    cardinalityExceeded,
    requiresInertFallback: cardinalityExceeded
  };
}
var CONTENT_REWRITE_TRUNCATION_WARNING = "Content rewriting reached a safety limit; the final Markdown is truncated, so a complete extraction is reported as partial.";
function rewriteContentWithStatus(content, base, localBySource, options = {}) {
  const sanitizedContent = sanitizeTerminalText(content);
  const protectedSpans = [];
  const fenced = protectMarkdownFences(sanitizedContent, protectedSpans);
  if (fenced === null)
    return { content: inertProtectedOverflow(sanitizedContent), truncated: true };
  let output = protectInlineCodeSpans(fenced, protectedSpans);
  if (output === null)
    return { content: inertProtectedOverflow(sanitizedContent), truncated: true };
  const imageSafety = scanImageSources(output, options.maxImageSources ?? MAX_IMAGE_SOURCES);
  if (imageSafety.requiresInertFallback) {
    return { content: inertCandidateOverflow(sanitizedContent), truncated: true };
  }
  let truncated = imageSafety.truncated;
  output = output.replace(unsafeMarkdownImage, (_whole, alt) => `*[omitted unsafe image: ${escapeMarkdownLabel(alt) || "image"}]*`);
  output = output.replace(obsidianEmbed, (_whole, target) => `*[omitted local embed: ${escapeMarkdownLabel(target) || "attachment"}]*`);
  const labelScan = referenceLabels(output);
  const definitionScan = referenceTargets(output, labelScan.labels);
  const definitions = definitionScan.targets;
  const referenceScanTruncated = labelScan.truncated || definitionScan.truncated;
  output = output.replace(referenceImage, (_whole, alt, rawLabel) => {
    const label = normalizedReferenceLabel(rawLabel === "" ? alt : rawLabel);
    if (label === null) {
      truncated = true;
      return `*[omitted over-limit image reference: ${escapeMarkdownLabel(alt) || "image"}]*`;
    }
    const source = definitions.get(label);
    if (source === undefined)
      return `*[omitted unresolved image reference: ${escapeMarkdownLabel(alt) || "image"}]*`;
    const local = localBySource.get(source);
    if (local !== undefined)
      return `![${alt}](${local})`;
    const absolute = resolveRemote(source, base);
    if (absolute === null)
      return `*[omitted unsafe image: ${escapeMarkdownLabel(alt) || "image"}]*`;
    const target = inertRemoteImageHref(absolute);
    return options.remoteImages === "embed" ? `![${alt}](${target})` : `[remote image: ${escapeMarkdownLabel(alt) || "image"}](${target})`;
  });
  const localPaths = new Set;
  for (const localPath of localBySource.values()) {
    if (localPaths.size >= MAX_IMAGE_SOURCES)
      break;
    localPaths.add(localPath);
  }
  output = output.replace(markdownImage, (whole, alt, bracketed, bare, title) => {
    const source = bracketed ?? bare ?? "";
    if (source.length > MAX_REMOTE_SOURCE_CODE_UNITS) {
      truncated = true;
      return `*[omitted over-limit image: ${escapeMarkdownLabel(alt) || "image"}]*`;
    }
    const local = localBySource.get(source);
    if (local !== undefined)
      return `![${alt}](${local}${title})`;
    if (localPaths.has(source))
      return whole;
    const absolute = resolveRemote(source, base);
    return absolute === null ? `*[omitted unsafe image: ${escapeMarkdownLabel(alt) || "image"}]*` : options.remoteImages === "embed" ? `![${alt}](${inertRemoteImageHref(absolute)}${title})` : `[remote image: ${escapeMarkdownLabel(alt) || "image"}](${inertRemoteImageHref(absolute)}${title})`;
  });
  output = output.replace(htmlImage, (_whole, source) => {
    if (source.length > MAX_REMOTE_SOURCE_CODE_UNITS) {
      truncated = true;
      return "*[omitted over-limit image]*";
    }
    const local = localBySource.get(source);
    if (local !== undefined)
      return `![](${local})`;
    if (localPaths.has(source))
      return `![](${source})`;
    const absolute = resolveRemote(source, base);
    return absolute === null ? "*[omitted unsafe image]*" : options.remoteImages === "embed" ? `![](${inertRemoteImageHref(absolute)})` : `[remote image](${inertRemoteImageHref(absolute)})`;
  });
  output = output.replace(plainLink, (whole, open, bracketed, bare, title, close) => {
    const target = bracketed ?? bare ?? "";
    if (target.length > MAX_REMOTE_SOURCE_CODE_UNITS) {
      truncated = true;
      return `${open}#${title}${close}`;
    }
    if (/^(https?:|mailto:|#)/i.test(target) || localPaths.has(target))
      return whole;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target))
      return `${open}#${title}${close}`;
    const absolute = resolveRemote(target, base);
    return absolute === null ? `${open}#${title}${close}` : `${open}${absolute.href.replace(/\(/g, "%28").replace(/\)/g, "%29")}${title}${close}`;
  });
  output = output.replace(referenceDefinition, (_whole, prefix, label, bracketed, bare, title) => {
    const target = bracketed ?? bare ?? "";
    if (label.length > MAX_REFERENCE_LABEL_CODE_UNITS || target.length > MAX_REMOTE_SOURCE_CODE_UNITS) {
      truncated = true;
      return `${prefix}#${title}`;
    }
    if (/^(?:https?:|mailto:|#)/i.test(target) || localPaths.has(target)) {
      return `${prefix}${bracketed === undefined ? target : `<${target}>`}${title}`;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(target))
      return `${prefix}#${title}`;
    const absolute = resolveRemote(target, base);
    return `${prefix}${absolute === null ? "#" : absolute.href}${title}`;
  });
  output = sanitizeMarkdownHtml(output);
  if (referenceScanTruncated) {
    truncated = true;
    output = `*[Some image references were omitted because capture safety limits were exceeded.]*

` + output;
  }
  return { content: restoreMarkdownSpans(output, protectedSpans), truncated };
}
function rewriteContent(content, base, localBySource, options = {}) {
  return rewriteContentWithStatus(content, base, localBySource, options).content;
}
function buildClipMarkdown(article, options) {
  const title = boundedMetadata(article.title, articleMetadataLimits.title);
  const author = boundedMetadata(article.author, articleMetadataLimits.author);
  const published = boundedMetadata(article.published, articleMetadataLimits.published);
  const description = boundedMetadata(article.description, articleMetadataLimits.description);
  const frontmatter = [
    "---",
    `title: ${yamlString(title ?? options.slug)}`,
    `source: ${yamlString(options.sourceHref)}`,
    ...author === null ? [] : [`author: ${yamlString(author)}`],
    ...published === null ? [] : [`published: ${yamlString(published)}`],
    ...description === null ? [] : [`description: ${yamlString(description)}`],
    `clipped: ${yamlString(options.clipped)}`,
    ...options.platform === undefined ? [] : [`platform: ${yamlString(options.platform)}`],
    ...options.captureStatus === undefined ? [] : [`capture_status: ${yamlString(options.captureStatus)}`],
    ...options.captureMethod === undefined ? [] : [`capture_method: ${yamlString(options.captureMethod)}`],
    ...options.captureScope === undefined ? [] : [`capture_scope: ${yamlString(options.captureScope)}`],
    "---",
    ""
  ].join(`
`);
  const headingTitle = title === null ? null : escapeMarkdownLabel(title).replace(/\s+/g, " ").trim();
  const heading = headingTitle === null || headingTitle === "" ? "" : `# ${headingTitle}

`;
  return sanitizeTerminalText(frontmatter + heading + options.content.trimEnd() + `
`);
}

// src/clip/platforms.ts
var DEFAULT_CAPTURE_LIMITS = {
  maxDepth: 24,
  maxItems: 1000,
  maxTextLength: 1e5,
  maxMediaPerEntry: 32
};
var HARD_CAPTURE_LIMITS = {
  maxDepth: 64,
  maxItems: 1e4,
  maxTextLength: 1e6,
  maxMediaPerEntry: 128
};
var isUnknownArray2 = (value) => Array.isArray(value);
var isRecord2 = (value) => typeof value === "object" && value !== null && !isUnknownArray2(value);
var nonEmptyString = (value) => typeof value === "string" && value.trim() !== "" ? value.trim() : null;
var stringValue = (value) => typeof value === "string" ? value : null;
var booleanValue = (value) => typeof value === "boolean" ? value : null;
var safeInteger = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
var signedSafeInteger = (value) => typeof value === "number" && Number.isSafeInteger(value) ? value : null;
var finiteNumber = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
var foreignId = (value) => {
  const text = nonEmptyString(value);
  if (text !== null)
    return text;
  const number = safeInteger(value);
  return number === null ? null : String(number);
};
var readRecord = (record, key) => {
  const value = record[key];
  return isRecord2(value) ? value : null;
};
var readArray = (record, key) => {
  const value = record[key];
  return isUnknownArray2(value) ? value : null;
};
var clampLimit = (value, fallback, ceiling) => {
  if (value === undefined || !Number.isFinite(value))
    return fallback;
  return Math.max(1, Math.min(Math.floor(value), ceiling));
};
var createContext = (options) => ({
  limits: {
    maxDepth: clampLimit(options?.limits?.maxDepth, DEFAULT_CAPTURE_LIMITS.maxDepth, HARD_CAPTURE_LIMITS.maxDepth),
    maxItems: clampLimit(options?.limits?.maxItems, DEFAULT_CAPTURE_LIMITS.maxItems, HARD_CAPTURE_LIMITS.maxItems),
    maxTextLength: clampLimit(options?.limits?.maxTextLength, DEFAULT_CAPTURE_LIMITS.maxTextLength, HARD_CAPTURE_LIMITS.maxTextLength),
    maxMediaPerEntry: clampLimit(options?.limits?.maxMediaPerEntry, DEFAULT_CAPTURE_LIMITS.maxMediaPerEntry, HARD_CAPTURE_LIMITS.maxMediaPerEntry)
  },
  usedItems: 0,
  warnings: []
});
var warn = (context, message) => {
  if (context.warnings.length < 100 && !context.warnings.includes(message)) {
    context.warnings.push(message);
  }
};
var reserveItem = (context) => {
  if (context.usedItems >= context.limits.maxItems) {
    warn(context, `Capture stopped at ${context.limits.maxItems} items.`);
    return false;
  }
  context.usedItems += 1;
  return true;
};
var boundary = (reason, detail) => ({
  kind: "boundary",
  reason,
  detail
});
var emptyMetrics = () => ({
  score: null,
  replies: null,
  likes: null,
  reposts: null,
  quotes: null
});
var httpUrl = (value, base) => {
  const text = nonEmptyString(value);
  if (text === null)
    return null;
  try {
    const url = base === undefined ? new URL(text) : new URL(text, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};
var normalizedSource = (sourceUrl) => httpUrl(sourceUrl);
var boundedText = (value, context, label) => {
  if (value.length <= context.limits.maxTextLength)
    return value;
  warn(context, `${label} was truncated to ${context.limits.maxTextLength} characters.`);
  return `${value.slice(0, context.limits.maxTextLength)}

[Text truncated.]`;
};
var boundedTitle = (value, context, label) => {
  const limit = Math.min(context.limits.maxTextLength, 512);
  if (value.length <= limit)
    return value;
  warn(context, `${label} was truncated to ${limit} characters.`);
  return `${value.slice(0, Math.max(1, limit - 1))}\u2026`;
};
var isoTimestamp = (value) => {
  const text = nonEmptyString(value);
  if (text === null)
    return null;
  const milliseconds = Date.parse(text);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
};
var epochTimestamp = (value) => {
  const seconds = finiteNumber(value);
  if (seconds === null || seconds > 253402300799)
    return null;
  return new Date(seconds * 1000).toISOString();
};
var cleanPathSegments = (url) => {
  const segments = [];
  for (const rawSegment of url.pathname.split("/")) {
    if (rawSegment === "")
      continue;
    try {
      segments.push(decodeURIComponent(rawSegment));
    } catch {
      segments.push(rawSegment);
    }
  }
  return segments;
};
var domainMatches2 = (hostname, domain) => hostname === domain || hostname.endsWith(`.${domain}`);
var canonicalWithoutFragment = (url) => {
  const canonical = new URL(url.href);
  canonical.hash = "";
  return canonical.href;
};
function classifyPlatformUrl(value) {
  let url;
  try {
    url = new URL(typeof value === "string" ? value : value.href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return null;
  const hostname = url.hostname.toLowerCase();
  const segments = cleanPathSegments(url);
  if (domainMatches2(hostname, "x.com") || domainMatches2(hostname, "twitter.com")) {
    const handle = segments[0];
    const status = segments[1];
    const postId = segments[2];
    if (handle !== undefined && status === "status" && postId !== undefined && /^[a-zA-Z0-9_]{1,32}$/.test(handle) && /^\d+$/.test(postId)) {
      return {
        platform: "x",
        href: `https://x.com/${handle}/status/${postId}`,
        handle,
        postId
      };
    }
  }
  if (hostname === "news.ycombinator.com" && url.pathname === "/item") {
    const itemId = url.searchParams.get("id");
    if (itemId !== null && /^\d+$/.test(itemId)) {
      return {
        platform: "hacker-news",
        href: `https://news.ycombinator.com/item?id=${itemId}`,
        itemId
      };
    }
  }
  if (domainMatches2(hostname, "reddit.com")) {
    const commentsIndex = segments.indexOf("comments");
    const postId = commentsIndex >= 0 ? segments[commentsIndex + 1] : undefined;
    if (postId !== undefined && /^[a-zA-Z0-9]+$/.test(postId)) {
      const subreddit = commentsIndex >= 2 && segments[0] === "r" ? segments[1] ?? null : null;
      const possibleComment = segments[commentsIndex + 3];
      const commentId = possibleComment !== undefined && /^[a-zA-Z0-9]+$/.test(possibleComment) ? possibleComment : null;
      return {
        platform: "reddit",
        href: canonicalWithoutFragment(url),
        postId,
        subreddit,
        commentId
      };
    }
  }
  if (hostname === "redd.it") {
    const postId = segments[0];
    if (postId !== undefined && /^[a-zA-Z0-9]+$/.test(postId)) {
      return {
        platform: "reddit",
        href: canonicalWithoutFragment(url),
        postId,
        subreddit: null,
        commentId: null
      };
    }
  }
  if (hostname === "bsky.app" && segments[0] === "profile" && segments[2] === "post") {
    const actor = segments[1];
    const postId = segments[3];
    if (actor !== undefined && actor !== "" && postId !== undefined && postId !== "") {
      return {
        platform: "bluesky",
        href: `https://bsky.app/profile/${encodeURIComponent(actor)}/post/${encodeURIComponent(postId)}`,
        actor,
        postId
      };
    }
  }
  if (hostname === "substack.com" || domainMatches2(hostname, "substack.com")) {
    const publication = hostname === "substack.com" ? null : hostname.slice(0, -".substack.com".length);
    return { platform: "substack", href: canonicalWithoutFragment(url), publication };
  }
  if (domainMatches2(hostname, "instagram.com")) {
    const contentId = ["p", "reel", "tv"].includes(segments[0] ?? "") ? segments[1] ?? null : null;
    return { platform: "instagram", href: canonicalWithoutFragment(url), contentId };
  }
  if (domainMatches2(hostname, "linkedin.com")) {
    const contentId = segments.find((segment) => /(?:activity|ugcPost|share)[:-]?\d+/.test(segment)) ?? segments[1] ?? null;
    return { platform: "linkedin", href: canonicalWithoutFragment(url), contentId };
  }
  if (domainMatches2(hostname, "facebook.com") || hostname === "fb.com" || hostname === "fb.watch") {
    const contentId = url.searchParams.get("story_fbid") ?? url.searchParams.get("v") ?? segments.at(-1) ?? null;
    return { platform: "facebook", href: canonicalWithoutFragment(url), contentId };
  }
  if (domainMatches2(hostname, "tiktok.com")) {
    const videoIndex = segments.indexOf("video");
    const contentId = videoIndex >= 0 ? segments[videoIndex + 1] ?? null : segments[0] ?? null;
    return { platform: "tiktok", href: canonicalWithoutFragment(url), contentId };
  }
  if (domainMatches2(hostname, "threads.com") || domainMatches2(hostname, "threads.net")) {
    const postIndex = segments.indexOf("post");
    const contentId = postIndex >= 0 ? segments[postIndex + 1] ?? null : null;
    return { platform: "threads", href: canonicalWithoutFragment(url), contentId };
  }
  if (hostname === "web.whatsapp.com") {
    return { platform: "whatsapp", href: canonicalWithoutFragment(url), contentId: null };
  }
  if (domainMatches2(hostname, "youtube.com") || hostname === "youtu.be") {
    const contentId = hostname === "youtu.be" ? segments[0] ?? null : url.searchParams.get("v") ?? (segments[0] === "shorts" || segments[0] === "live" ? segments[1] ?? null : null);
    return { platform: "youtube", href: canonicalWithoutFragment(url), contentId };
  }
  if (hostname === "github.com") {
    const owner = segments[0];
    const repository = segments[1];
    const route = segments[2];
    const contentId = segments[3];
    const contentKind = route === "issues" ? "issue" : route === "pull" ? "pull-request" : route === "discussions" ? "discussion" : null;
    if (owner !== undefined && repository !== undefined && contentKind !== null && contentId !== undefined && /^[A-Za-z0-9_.-]+$/.test(owner) && /^[A-Za-z0-9_.-]+$/.test(repository) && /^\d+$/.test(contentId)) {
      return {
        platform: "github",
        href: canonicalWithoutFragment(url),
        owner,
        repository,
        contentKind,
        contentId
      };
    }
  }
  const discourseHostHint = hostname.split(".").some((label) => label === "discourse" || label === "discuss" || label === "forum" || label === "community");
  if (discourseHostHint && segments[0] === "t") {
    const topicId = /^\d+$/.test(segments[1] ?? "") ? segments[1] : /^\d+$/.test(segments[2] ?? "") ? segments[2] : undefined;
    if (topicId !== undefined) {
      return { platform: "discourse", href: canonicalWithoutFragment(url), topicId };
    }
  }
  return { platform: "generic", href: canonicalWithoutFragment(url), host: hostname };
}
var invalidSource = () => ({
  ok: false,
  error: { code: "invalid-source", message: "The capture source must be an HTTP(S) URL." }
});
var invalidShape = (message) => ({
  ok: false,
  error: { code: "invalid-shape", message }
});
var firstLine = (text, maxLength) => {
  const line = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line.length <= maxLength ? line : `${line.slice(0, Math.max(1, maxLength - 1))}\u2026`;
};
var decodeHtmlEntities = (value) => value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, decimal, hexadecimal, named) => {
  if (typeof decimal === "string") {
    const point = Number.parseInt(decimal, 10);
    return Number.isSafeInteger(point) && point <= 1114111 ? String.fromCodePoint(point) : whole;
  }
  if (typeof hexadecimal === "string") {
    const point = Number.parseInt(hexadecimal, 16);
    return Number.isSafeInteger(point) && point <= 1114111 ? String.fromCodePoint(point) : whole;
  }
  if (typeof named !== "string")
    return whole;
  const entities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };
  return entities[named.toLowerCase()] ?? whole;
});
var parseHtmlTag = (raw) => {
  let cursor = 0;
  let closing = false;
  if (raw.charCodeAt(cursor) === 47) {
    closing = true;
    cursor += 1;
  }
  const start = cursor;
  while (cursor < raw.length) {
    const code = raw.charCodeAt(cursor);
    const alphaNumeric = code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122;
    if (!alphaNumeric)
      break;
    cursor += 1;
  }
  if (cursor === start)
    return null;
  return { closing, name: raw.slice(start, cursor).toLowerCase(), raw };
};
var stripHtmlTagsLinear = (html) => {
  const chunks = [];
  let cursor = 0;
  while (cursor < html.length) {
    const opening = html.indexOf("<", cursor);
    if (opening < 0) {
      chunks.push(html.slice(cursor));
      break;
    }
    if (opening > cursor)
      chunks.push(html.slice(cursor, opening));
    const closing = html.indexOf(">", opening + 1);
    if (closing < 0) {
      chunks.push(html.slice(opening));
      break;
    }
    cursor = closing + 1;
  }
  return chunks.join("");
};
var quotedHref = (tag) => {
  let cursor = tag.name.length;
  while (cursor < tag.raw.length) {
    while (cursor < tag.raw.length && /\s/.test(tag.raw[cursor] ?? ""))
      cursor += 1;
    if (tag.raw[cursor] === "/") {
      cursor += 1;
      continue;
    }
    const nameStart = cursor;
    while (cursor < tag.raw.length) {
      const character = tag.raw[cursor] ?? "";
      if (/\s/.test(character) || character === "=" || character === "/")
        break;
      cursor += 1;
    }
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }
    const name = tag.raw.slice(nameStart, cursor).toLowerCase();
    while (cursor < tag.raw.length && /\s/.test(tag.raw[cursor] ?? ""))
      cursor += 1;
    if (tag.raw[cursor] !== "=")
      continue;
    cursor += 1;
    while (cursor < tag.raw.length && /\s/.test(tag.raw[cursor] ?? ""))
      cursor += 1;
    const quote = tag.raw[cursor];
    if (quote !== '"' && quote !== "'")
      continue;
    cursor += 1;
    const valueStart = cursor;
    while (cursor < tag.raw.length && tag.raw[cursor] !== quote)
      cursor += 1;
    if (cursor >= tag.raw.length)
      return null;
    if (name === "href")
      return tag.raw.slice(valueStart, cursor);
    cursor += 1;
  }
  return null;
};
var isWhitespace = (value) => /\s/.test(value);
var isPlainBreakTag = (tag) => {
  if (tag.closing || tag.name !== "br")
    return false;
  let cursor = tag.name.length;
  while (cursor < tag.raw.length && isWhitespace(tag.raw[cursor] ?? ""))
    cursor += 1;
  if (tag.raw[cursor] === "/")
    cursor += 1;
  while (cursor < tag.raw.length && isWhitespace(tag.raw[cursor] ?? ""))
    cursor += 1;
  return cursor === tag.raw.length;
};
var isExactFormattingTag = (tag, name) => tag.name === name && tag.raw.length === name.length + (tag.closing ? 1 : 0);
var htmlToMarkdown = (html) => {
  const chunks = [];
  const lower = html.toLowerCase();
  let nextAnchorClosing = lower.indexOf("</a>");
  let cursor = 0;
  while (cursor < html.length) {
    const opening = html.indexOf("<", cursor);
    if (opening < 0) {
      chunks.push(html.slice(cursor));
      break;
    }
    if (opening > cursor)
      chunks.push(html.slice(cursor, opening));
    const closing = html.indexOf(">", opening + 1);
    if (closing < 0) {
      chunks.push(html.slice(opening));
      break;
    }
    const tag = parseHtmlTag(html.slice(opening + 1, closing));
    if (tag === null) {
      cursor = closing + 1;
      continue;
    }
    if (!tag.closing && tag.name === "a") {
      const target = quotedHref(tag);
      while (nextAnchorClosing >= 0 && nextAnchorClosing < closing + 1) {
        nextAnchorClosing = lower.indexOf("</a>", nextAnchorClosing + 4);
      }
      if (target !== null && nextAnchorClosing >= 0) {
        const label = html.slice(closing + 1, nextAnchorClosing);
        const cleanLabel = decodeHtmlEntities(stripHtmlTagsLinear(label)).trim();
        const url = httpUrl(decodeHtmlEntities(target), "https://news.ycombinator.com/");
        chunks.push(url === null ? cleanLabel : `[${cleanLabel || url}](<${url}>)`);
        cursor = nextAnchorClosing + 4;
        nextAnchorClosing = lower.indexOf("</a>", cursor);
        continue;
      }
    }
    const nextOpening = closing + 1;
    if (isExactFormattingTag(tag, "pre") && !tag.closing && lower.startsWith("<code>", nextOpening)) {
      chunks.push("\n\n```\n");
      cursor = nextOpening + 6;
      continue;
    }
    if (isExactFormattingTag(tag, "code") && tag.closing && lower.startsWith("</pre>", nextOpening)) {
      chunks.push("\n```\n\n");
      cursor = nextOpening + 6;
      continue;
    }
    if (!tag.closing && tag.name === "p")
      chunks.push(`

`);
    else if (isPlainBreakTag(tag))
      chunks.push(`
`);
    else if (isExactFormattingTag(tag, "i") || isExactFormattingTag(tag, "em"))
      chunks.push("*");
    else if (isExactFormattingTag(tag, "b") || isExactFormattingTag(tag, "strong"))
      chunks.push("**");
    cursor = closing + 1;
  }
  return decodeHtmlEntities(chunks.join("")).replace(/\n{3,}/g, `

`).trim();
};
var hackerNewsEnvelope = (input) => {
  if (isUnknownArray2(input)) {
    const [root2, ...descendants2] = input;
    return root2 === undefined ? null : { root: root2, descendants: descendants2 };
  }
  if (!isRecord2(input))
    return null;
  const root = input.root ?? input.rootItem;
  const descendants = readArray(input, "descendants") ?? readArray(input, "items") ?? [];
  return root === undefined ? null : { root, descendants };
};
var hackerNewsKids = (record, context) => {
  const kids = readArray(record, "kids");
  if (kids === null)
    return [];
  const result = [];
  const limit = Math.min(kids.length, context.limits.maxItems);
  for (let index = 0;index < limit; index += 1) {
    const id = foreignId(kids[index]);
    if (id !== null)
      result.push(id);
  }
  if (kids.length > limit)
    warn(context, `Hacker News child IDs were truncated to ${limit}.`);
  return result;
};
function parseHackerNewsCapture(input, sourceUrl, options) {
  const source = normalizedSource(sourceUrl);
  if (source === null)
    return invalidSource();
  const envelope = hackerNewsEnvelope(input);
  if (envelope === null || !isRecord2(envelope.root)) {
    return invalidShape("Hacker News input must provide a root item and descendant items.");
  }
  const rootId = foreignId(envelope.root.id);
  if (rootId === null)
    return invalidShape("The Hacker News root item has no valid id.");
  const context = createContext(options);
  const byId = new Map;
  byId.set(rootId, envelope.root);
  const scanLimit = Math.min(envelope.descendants.length, context.limits.maxItems - 1);
  for (let index = 0;index < scanLimit; index += 1) {
    const value = envelope.descendants[index];
    if (!isRecord2(value)) {
      warn(context, `Malformed Hacker News descendant at index ${index} was skipped.`);
      continue;
    }
    const id = foreignId(value.id);
    if (id === null) {
      warn(context, `Hacker News descendant at index ${index} has no id.`);
      continue;
    }
    if (byId.has(id))
      warn(context, `Duplicate Hacker News item ${id} was skipped.`);
    else
      byId.set(id, value);
  }
  if (envelope.descendants.length > scanLimit) {
    warn(context, `Hacker News descendants were truncated to ${scanLimit}.`);
  }
  const buildItem = (id, role, path, depth) => {
    if (depth >= context.limits.maxDepth) {
      return boundary("depth-limit", `Hacker News nesting exceeded ${context.limits.maxDepth}.`);
    }
    if (path.has(id)) {
      warn(context, "A cycle in Hacker News child IDs was stopped.");
      return boundary("cycle", `Hacker News item ${id} repeats in its ancestry.`);
    }
    if (!reserveItem(context))
      return boundary("item-limit", "The Hacker News item limit was reached.");
    const record = byId.get(id);
    if (record === undefined) {
      return {
        kind: "unavailable",
        role,
        id,
        reason: "not-found",
        sourceUrl: `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`,
        replies: []
      };
    }
    const nextPath = new Set(path);
    nextPath.add(id);
    const replies = [];
    for (const childId of hackerNewsKids(record, context)) {
      if (context.usedItems >= context.limits.maxItems) {
        replies.push(boundary("item-limit", "Additional Hacker News descendants were omitted."));
        break;
      }
      replies.push(buildItem(childId, "comment", nextPath, depth + 1));
    }
    const sourceForItem = `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`;
    if (booleanValue(record.deleted) === true || booleanValue(record.dead) === true) {
      return {
        kind: "unavailable",
        role,
        id,
        reason: booleanValue(record.deleted) === true ? "deleted" : "dead",
        sourceUrl: sourceForItem,
        replies
      };
    }
    const authorHandle = nonEmptyString(record.by);
    const author = authorHandle === null ? null : {
      name: authorHandle,
      handle: authorHandle,
      profileUrl: `https://news.ycombinator.com/user?id=${encodeURIComponent(authorHandle)}`
    };
    const rawText = stringValue(record.text) ?? "";
    const body = htmlToMarkdown(boundedText(rawText, context, `Hacker News item ${id}`));
    const external = httpUrl(record.url, "https://news.ycombinator.com/");
    const text = external === null ? body : `${body}${body === "" ? "" : `

`}[Linked article](<${external}>)`;
    return {
      kind: "content",
      role,
      id,
      author,
      createdAt: epochTimestamp(record.time),
      sourceUrl: sourceForItem,
      text,
      media: [],
      metrics: {
        ...emptyMetrics(),
        score: safeInteger(record.score),
        replies: safeInteger(record.descendants) ?? (replies.length === 0 ? null : replies.length)
      },
      quotes: [],
      replies
    };
  };
  const root = buildItem(rootId, "post", new Set, 0);
  const title = boundedTitle(nonEmptyString(envelope.root.title) ?? `Hacker News item ${rootId}`, context, "Hacker News title");
  return {
    ok: true,
    document: {
      platform: "hacker-news",
      sourceUrl: source,
      title,
      ancestors: [],
      roots: [root],
      warnings: context.warnings
    }
  };
}
var redditListingChildren = (value) => {
  if (!isRecord2(value))
    return null;
  if (value.kind === "Listing") {
    const data2 = readRecord(value, "data");
    return data2 === null ? null : readArray(data2, "children");
  }
  const data = readRecord(value, "data");
  return data === null ? null : readArray(data, "children");
};
var redditEnvelope = (input) => {
  if (isUnknownArray2(input)) {
    const post = input[0];
    if (post === undefined)
      return null;
    return { post, comments: input[1] ?? null };
  }
  if (!isRecord2(input) || input.post === undefined)
    return null;
  return { post: input.post, comments: input.comments ?? null };
};
var redditPostData = (value, maxItems) => {
  if (isRecord2(value) && value.kind === "t3")
    return readRecord(value, "data");
  const children = redditListingChildren(value);
  if (children === null)
    return null;
  const limit = Math.min(children.length, maxItems);
  for (let index = 0;index < limit; index += 1) {
    const child = children[index];
    if (isRecord2(child) && child.kind === "t3")
      return readRecord(child, "data");
  }
  return null;
};
var redditAuthor = (value) => {
  const handle = nonEmptyString(value);
  if (handle === null || handle === "[deleted]")
    return null;
  return {
    name: handle,
    handle,
    profileUrl: `https://www.reddit.com/user/${encodeURIComponent(handle)}`
  };
};
var redditPermalink = (value) => httpUrl(value, "https://www.reddit.com/");
function parseRedditCapture(input, sourceUrl, options) {
  const source = normalizedSource(sourceUrl);
  if (source === null)
    return invalidSource();
  const envelope = redditEnvelope(input);
  if (envelope === null)
    return invalidShape("Reddit input must contain a post listing.");
  const context = createContext(options);
  const post = redditPostData(envelope.post, context.limits.maxItems);
  if (post === null)
    return invalidShape("Reddit input contained no valid post object.");
  const postId = foreignId(post.id) ?? foreignId(post.name);
  const rawTitle = nonEmptyString(post.title);
  if (postId === null || rawTitle === null)
    return invalidShape("The Reddit post has no valid id or title.");
  const title = boundedTitle(rawTitle, context, "Reddit title");
  if (!reserveItem(context))
    return invalidShape("The capture item limit cannot hold the Reddit post.");
  const active = new WeakSet;
  const parseThing = (value, depth) => {
    if (!isRecord2(value))
      return null;
    if (depth >= context.limits.maxDepth) {
      return boundary("depth-limit", `Reddit nesting exceeded ${context.limits.maxDepth}.`);
    }
    if (active.has(value)) {
      warn(context, "A cycle in Reddit replies was stopped.");
      return boundary("cycle", "A Reddit reply object repeats in its ancestry.");
    }
    const kind = nonEmptyString(value.kind);
    const data = readRecord(value, "data");
    if (kind === null || data === null)
      return null;
    if (!reserveItem(context))
      return boundary("item-limit", "Additional Reddit comments were omitted.");
    active.add(value);
    if (kind === "more") {
      const childValues = readArray(data, "children") ?? [];
      const childIds = [];
      const limit2 = Math.min(childValues.length, context.limits.maxItems);
      for (let index = 0;index < limit2; index += 1) {
        const id2 = foreignId(childValues[index]);
        if (id2 !== null)
          childIds.push(id2);
      }
      active.delete(value);
      return {
        kind: "more",
        id: foreignId(data.id) ?? "more",
        count: safeInteger(data.count),
        childIds
      };
    }
    if (kind !== "t1") {
      active.delete(value);
      warn(context, `Unsupported Reddit thing kind ${kind} was skipped.`);
      return null;
    }
    const id = foreignId(data.id) ?? foreignId(data.name) ?? "unknown-comment";
    const replyValues = redditListingChildren(data.replies) ?? [];
    const replies2 = [];
    const limit = Math.min(replyValues.length, context.limits.maxItems);
    for (let index = 0;index < limit; index += 1) {
      if (context.usedItems >= context.limits.maxItems) {
        warn(context, `Capture stopped at ${context.limits.maxItems} items.`);
        replies2.push(boundary("item-limit", "Additional Reddit replies were omitted."));
        break;
      }
      const reply = parseThing(replyValues[index], depth + 1);
      if (reply !== null)
        replies2.push(reply);
    }
    const itemSource = redditPermalink(data.permalink);
    const body2 = stringValue(data.body) ?? "";
    active.delete(value);
    if (body2.trim() === "[deleted]" || body2.trim() === "[removed]") {
      return {
        kind: "unavailable",
        role: "comment",
        id,
        reason: body2.trim() === "[deleted]" ? "deleted" : "removed",
        sourceUrl: itemSource,
        replies: replies2
      };
    }
    return {
      kind: "content",
      role: "comment",
      id,
      author: redditAuthor(data.author),
      createdAt: epochTimestamp(data.created_utc),
      sourceUrl: itemSource,
      text: boundedText(body2, context, `Reddit comment ${id}`),
      media: [],
      metrics: { ...emptyMetrics(), score: signedSafeInteger(data.score), replies: replies2.length || null },
      quotes: [],
      replies: replies2
    };
  };
  const commentValues = redditListingChildren(envelope.comments) ?? [];
  const replies = [];
  const commentLimit = Math.min(commentValues.length, context.limits.maxItems);
  for (let index = 0;index < commentLimit; index += 1) {
    if (context.usedItems >= context.limits.maxItems) {
      warn(context, `Capture stopped at ${context.limits.maxItems} items.`);
      replies.push(boundary("item-limit", "Additional Reddit comments were omitted."));
      break;
    }
    const reply = parseThing(commentValues[index], 1);
    if (reply !== null)
      replies.push(reply);
  }
  if (commentValues.length > commentLimit)
    warn(context, `Reddit comments were truncated to ${commentLimit}.`);
  const permalink = redditPermalink(post.permalink);
  const selfText = stringValue(post.selftext) ?? "";
  const linkedUrl = httpUrl(post.url);
  const linkText = linkedUrl === null || linkedUrl === permalink ? "" : `[Linked page](<${linkedUrl}>)`;
  const body = `${boundedText(selfText, context, `Reddit post ${postId}`)}${selfText.trim() === "" || linkText === "" ? "" : `

`}${linkText}`;
  const root = {
    kind: "content",
    role: "post",
    id: postId,
    author: redditAuthor(post.author),
    createdAt: epochTimestamp(post.created_utc),
    sourceUrl: permalink ?? source,
    text: body,
    media: [],
    metrics: {
      ...emptyMetrics(),
      score: signedSafeInteger(post.score),
      replies: safeInteger(post.num_comments) ?? replies.length
    },
    quotes: [],
    replies
  };
  return {
    ok: true,
    document: {
      platform: "reddit",
      sourceUrl: source,
      title,
      ancestors: [],
      roots: [root],
      warnings: context.warnings
    }
  };
}
var bskyAuthor = (value) => {
  if (!isRecord2(value))
    return null;
  const handle = nonEmptyString(value.handle);
  const did = nonEmptyString(value.did);
  if (handle === null && did === null)
    return null;
  const actor = handle ?? did ?? "unknown";
  return {
    name: nonEmptyString(value.displayName) ?? actor,
    handle,
    profileUrl: `https://bsky.app/profile/${encodeURIComponent(actor)}`
  };
};
var bskyRkey = (uri) => {
  const segments = uri.split("/").filter((segment) => segment !== "");
  return segments.at(-1) ?? null;
};
var bskyPostUrl = (uri, author) => {
  if (uri === null || author === null)
    return null;
  const rkey = bskyRkey(uri);
  const actor = author.handle;
  return rkey === null || actor === null ? null : `https://bsky.app/profile/${encodeURIComponent(actor)}/post/${encodeURIComponent(rkey)}`;
};
var bskyMedia = (values, context) => {
  const media = [];
  const seen = new Set;
  const active = new WeakSet;
  const add = (item) => {
    const key = `${item.kind}:${item.url}`;
    if (seen.has(key) || media.length >= context.limits.maxMediaPerEntry)
      return;
    seen.add(key);
    media.push(item);
  };
  const visit = (value, depth) => {
    if (!isRecord2(value) || depth > Math.min(8, context.limits.maxDepth) || active.has(value))
      return;
    active.add(value);
    const images = readArray(value, "images");
    if (images !== null) {
      const limit = Math.min(images.length, context.limits.maxMediaPerEntry);
      for (let index = 0;index < limit; index += 1) {
        const image = images[index];
        if (!isRecord2(image))
          continue;
        const url = httpUrl(image.fullsize) ?? httpUrl(image.thumb);
        if (url === null)
          continue;
        const ratio = readRecord(image, "aspectRatio");
        const width = ratio === null ? null : safeInteger(ratio.width);
        const height = ratio === null ? null : safeInteger(ratio.height);
        add({
          kind: "image",
          url,
          previewUrl: httpUrl(image.thumb),
          alt: nonEmptyString(image.alt),
          title: null,
          dimensions: width === null || height === null ? null : { width, height }
        });
      }
    }
    const playlist = httpUrl(value.playlist);
    if (playlist !== null) {
      add({
        kind: "video",
        url: playlist,
        previewUrl: httpUrl(value.thumbnail),
        alt: nonEmptyString(value.alt),
        title: null,
        dimensions: null
      });
    }
    const external = readRecord(value, "external");
    if (external !== null) {
      const url = httpUrl(external.uri);
      if (url !== null) {
        add({
          kind: "link",
          url,
          previewUrl: httpUrl(external.thumb),
          alt: nonEmptyString(external.description),
          title: nonEmptyString(external.title),
          dimensions: null
        });
      }
    }
    if (value.media !== undefined)
      visit(value.media, depth + 1);
    const embeds = readArray(value, "embeds");
    if (embeds !== null) {
      const limit = Math.min(embeds.length, context.limits.maxMediaPerEntry);
      for (let index = 0;index < limit; index += 1)
        visit(embeds[index], depth + 1);
    }
    active.delete(value);
  };
  for (const value of values)
    visit(value, 0);
  if (media.length >= context.limits.maxMediaPerEntry) {
    warn(context, `Bluesky media was truncated to ${context.limits.maxMediaPerEntry} items on one entry.`);
  }
  return media;
};
var bskyQuoteRecord = (embed) => {
  if (!isRecord2(embed))
    return null;
  const type = nonEmptyString(embed.$type) ?? "";
  if (type.includes("recordWithMedia")) {
    const outerRecord = readRecord(embed, "record");
    return outerRecord?.record ?? null;
  }
  if (type.includes("record#view") || type.includes("recordWithMedia#view"))
    return embed.record ?? null;
  return null;
};
function parseBskyQuote(value, context, depth, active) {
  if (!isRecord2(value))
    return null;
  if (depth >= context.limits.maxDepth) {
    return boundary("depth-limit", `Bluesky quote nesting exceeded ${context.limits.maxDepth}.`);
  }
  if (active.has(value)) {
    warn(context, "A cycle in Bluesky quoted records was stopped.");
    return boundary("cycle", "A Bluesky quoted record repeats in its ancestry.");
  }
  const uri = nonEmptyString(value.uri) ?? "unknown-quote";
  if (booleanValue(value.notFound) === true || booleanValue(value.blocked) === true) {
    if (!reserveItem(context))
      return boundary("item-limit", "Additional Bluesky quotes were omitted.");
    return {
      kind: "unavailable",
      role: "quote",
      id: uri,
      reason: booleanValue(value.blocked) === true ? "blocked" : "not-found",
      sourceUrl: null,
      replies: []
    };
  }
  const author = bskyAuthor(value.author);
  const record = readRecord(value, "value") ?? readRecord(value, "record");
  if (record === null || !reserveItem(context))
    return null;
  active.add(value);
  const nestedEmbed = value.embeds ?? record.embed;
  const nestedQuoteValue = bskyQuoteRecord(nestedEmbed);
  const quotes = [];
  if (nestedQuoteValue !== null) {
    const nested = parseBskyQuote(nestedQuoteValue, context, depth + 1, active);
    if (nested !== null)
      quotes.push(nested);
  }
  active.delete(value);
  return {
    kind: "content",
    role: "quote",
    id: uri,
    author,
    createdAt: isoTimestamp(record.createdAt),
    sourceUrl: bskyPostUrl(uri, author),
    text: boundedText(stringValue(record.text) ?? "", context, `Bluesky quote ${uri}`),
    media: bskyMedia([value, record], context),
    metrics: emptyMetrics(),
    quotes,
    replies: []
  };
}
function parseBskyThreadNode(value, role, includeReplies, context, depth, active) {
  if (!isRecord2(value))
    return null;
  if (depth >= context.limits.maxDepth) {
    return boundary("depth-limit", `Bluesky nesting exceeded ${context.limits.maxDepth}.`);
  }
  if (active.has(value)) {
    warn(context, "A cycle in Bluesky thread objects was stopped.");
    return boundary("cycle", "A Bluesky thread object repeats in its ancestry.");
  }
  const post = readRecord(value, "post");
  const fallbackUri = nonEmptyString(value.uri) ?? "unknown-post";
  const type = nonEmptyString(value.$type) ?? "";
  if (booleanValue(value.notFound) === true || booleanValue(value.blocked) === true || type.includes("notFoundPost") || type.includes("blockedPost")) {
    if (!reserveItem(context))
      return boundary("item-limit", "Additional Bluesky entries were omitted.");
    return {
      kind: "unavailable",
      role,
      id: fallbackUri,
      reason: booleanValue(value.blocked) === true || type.includes("blockedPost") ? "blocked" : "not-found",
      sourceUrl: null,
      replies: []
    };
  }
  if (post === null || !reserveItem(context))
    return null;
  const uri = nonEmptyString(post.uri) ?? fallbackUri;
  const author = bskyAuthor(post.author);
  const record = readRecord(post, "record");
  if (record === null)
    return null;
  active.add(value);
  const embedValues = [];
  if (post.embed !== undefined)
    embedValues.push(post.embed);
  if (record.embed !== undefined)
    embedValues.push(record.embed);
  const quotes = [];
  for (const embed of embedValues) {
    const quoteValue = bskyQuoteRecord(embed);
    if (quoteValue === null)
      continue;
    const quote = parseBskyQuote(quoteValue, context, depth + 1, active);
    if (quote !== null)
      quotes.push(quote);
  }
  const replies = [];
  const replyValues = includeReplies ? readArray(value, "replies") ?? [] : [];
  const limit = Math.min(replyValues.length, context.limits.maxItems);
  for (let index = 0;index < limit; index += 1) {
    if (context.usedItems >= context.limits.maxItems) {
      warn(context, `Capture stopped at ${context.limits.maxItems} items.`);
      replies.push(boundary("item-limit", "Additional Bluesky replies were omitted."));
      break;
    }
    const reply = parseBskyThreadNode(replyValues[index], "comment", true, context, depth + 1, active);
    if (reply !== null)
      replies.push(reply);
  }
  active.delete(value);
  return {
    kind: "content",
    role,
    id: uri,
    author,
    createdAt: isoTimestamp(record.createdAt) ?? isoTimestamp(post.indexedAt),
    sourceUrl: bskyPostUrl(uri, author),
    text: boundedText(stringValue(record.text) ?? "", context, `Bluesky post ${uri}`),
    media: bskyMedia(embedValues, context),
    metrics: {
      score: null,
      replies: safeInteger(post.replyCount),
      likes: safeInteger(post.likeCount),
      reposts: safeInteger(post.repostCount),
      quotes: safeInteger(post.quoteCount)
    },
    quotes,
    replies
  };
}
function parseBlueskyCapture(input, sourceUrl, options) {
  const source = normalizedSource(sourceUrl);
  if (source === null)
    return invalidSource();
  if (!isRecord2(input))
    return invalidShape("Bluesky output must be an object containing a thread.");
  const thread = input.thread ?? input;
  if (!isRecord2(thread))
    return invalidShape("Bluesky output contained no thread root.");
  const context = createContext(options);
  const root = parseBskyThreadNode(thread, "post", true, context, 0, new WeakSet);
  if (root === null)
    return invalidShape("Bluesky output contained no valid post at the thread root.");
  const ancestorsNearestFirst = [];
  const seenParents = new WeakSet;
  let parent = thread.parent;
  for (let depth = 1;parent !== undefined && parent !== null; depth += 1) {
    if (depth >= context.limits.maxDepth) {
      ancestorsNearestFirst.push(boundary("depth-limit", "Additional Bluesky parent context was omitted."));
      break;
    }
    if (!isRecord2(parent))
      break;
    if (seenParents.has(parent)) {
      ancestorsNearestFirst.push(boundary("cycle", "A Bluesky parent object repeats in its ancestry."));
      warn(context, "A cycle in Bluesky parent context was stopped.");
      break;
    }
    seenParents.add(parent);
    const parsed = parseBskyThreadNode(parent, "post", false, context, depth, new WeakSet);
    if (parsed !== null)
      ancestorsNearestFirst.push(parsed);
    parent = parent.parent;
  }
  ancestorsNearestFirst.reverse();
  const titleAuthor = root.kind === "content" ? root.author : null;
  const titleText = root.kind === "content" ? firstLine(root.text, 96) : "";
  const title = titleText || `${titleAuthor?.name ?? "Unknown author"} on Bluesky`;
  return {
    ok: true,
    document: {
      platform: "bluesky",
      sourceUrl: source,
      title,
      ancestors: ancestorsNearestFirst,
      roots: [root],
      warnings: context.warnings
    }
  };
}
var platformLabel = (platform) => {
  switch (platform) {
    case "x":
      return "X";
    case "hacker-news":
      return "Hacker News";
    case "reddit":
      return "Reddit";
    case "bluesky":
      return "Bluesky";
  }
};
var escapeInline = (value) => value.replace(/\\/g, "\\\\").replace(/([*_[\]`])/g, "\\$1").replace(/\s+/g, " ").trim();
var cleanHeading = (value) => value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
var authorLabel = (author) => {
  if (author === null)
    return "Unknown author";
  const name = escapeInline(author.name);
  if (author.handle === null || author.handle === author.name)
    return name;
  return `${name} (@${escapeInline(author.handle)})`;
};
var metadata = (entry) => {
  const pieces = [`**${authorLabel(entry.author)}**`];
  if (entry.createdAt !== null)
    pieces.push(entry.createdAt);
  if (entry.sourceUrl !== null)
    pieces.push(`[source](<${entry.sourceUrl}>)`);
  return pieces.join(" \xB7 ");
};
var metricLabel = (value, singular, plural = `${singular}s`) => `${value} ${value === 1 ? singular : plural}`;
var metricsLine = (metrics) => {
  const pieces = [];
  if (metrics.score !== null)
    pieces.push(metricLabel(metrics.score, "point"));
  if (metrics.replies !== null)
    pieces.push(metricLabel(metrics.replies, "reply", "replies"));
  if (metrics.likes !== null)
    pieces.push(metricLabel(metrics.likes, "like"));
  if (metrics.reposts !== null)
    pieces.push(metricLabel(metrics.reposts, "repost"));
  if (metrics.quotes !== null)
    pieces.push(metricLabel(metrics.quotes, "quote"));
  return pieces.length === 0 ? null : pieces.join(" \xB7 ");
};
var indentLines = (lines, prefix) => lines.map((line) => line === "" ? prefix.trimEnd() : `${prefix}${line}`);
var mediaLines = (media) => {
  const lines = [];
  for (const item of media) {
    const fallback = item.kind === "gif" ? "GIF" : `${item.kind[0]?.toUpperCase() ?? ""}${item.kind.slice(1)}`;
    const label = escapeInline(item.title ?? item.alt ?? fallback);
    if (item.kind === "image" || item.kind === "gif") {
      lines.push(`![${label}](<${item.url}>)`);
    } else {
      if (item.previewUrl !== null)
        lines.push(`![${label} preview](<${item.previewUrl}>)`);
      lines.push(`- [${label}](<${item.url}>)`);
    }
  }
  return lines;
};
var unavailableLabel = (entry) => {
  const noun = entry.role === "comment" ? "comment" : entry.role === "quote" ? "quoted post" : "post";
  return `${entry.reason} ${noun} ${escapeInline(entry.id)}`;
};
var renderQuote = (entry, depth, state) => {
  const lines = renderRootEntry(entry, depth + 1, state);
  return indentLines(lines, "> ");
};
var renderReplies = (entries, depth, state) => {
  const lines = [];
  for (const entry of entries)
    lines.push(...renderNestedEntry(entry, depth, state));
  return lines;
};
function renderNestedEntry(entry, depth, state) {
  const prefix = "  ".repeat(depth);
  if (depth >= 64 || state.count >= 20000)
    return [`${prefix}- *[render limit reached]*`];
  if (state.active.has(entry))
    return [`${prefix}- *[cycle omitted]*`];
  state.count += 1;
  state.active.add(entry);
  let lines;
  switch (entry.kind) {
    case "boundary":
      lines = [`${prefix}- *[${escapeInline(entry.detail)}]*`];
      break;
    case "more": {
      const count = entry.count === null ? "More comments" : `${entry.count} more comments`;
      const ids = entry.childIds.length === 0 ? "" : ` (${entry.childIds.map(escapeInline).join(", ")})`;
      lines = [`${prefix}- *${count}${ids}*`];
      break;
    }
    case "unavailable": {
      const source = entry.sourceUrl === null ? "" : ` \xB7 [source](<${entry.sourceUrl}>)`;
      lines = [`${prefix}- *[${unavailableLabel(entry)}]*${source}`];
      lines.push(...renderReplies(entry.replies, depth + 1, state));
      break;
    }
    case "content": {
      lines = [`${prefix}- ${metadata(entry)}`];
      if (entry.text.trim() !== "") {
        lines.push(`${prefix}  `, ...indentLines(entry.text.trim().split(`
`), `${prefix}  `));
      }
      const metricText = metricsLine(entry.metrics);
      if (metricText !== null)
        lines.push(`${prefix}  `, `${prefix}  _${metricText}_`);
      if (entry.media.length > 0) {
        lines.push(`${prefix}  `, ...indentLines(mediaLines(entry.media), `${prefix}  `));
      }
      for (const quote of entry.quotes) {
        lines.push(`${prefix}  `, ...indentLines(renderQuote(quote, depth, state), `${prefix}  `));
      }
      lines.push(...renderReplies(entry.replies, depth + 1, state));
      break;
    }
  }
  state.active.delete(entry);
  return lines;
}
function renderRootEntry(entry, depth, state) {
  if (depth >= 64 || state.count >= 20000)
    return ["*[render limit reached]*"];
  if (state.active.has(entry))
    return ["*[cycle omitted]*"];
  state.count += 1;
  state.active.add(entry);
  let lines;
  switch (entry.kind) {
    case "boundary":
      lines = [`*[${escapeInline(entry.detail)}]*`];
      break;
    case "more": {
      const count = entry.count === null ? "More comments" : `${entry.count} more comments`;
      lines = [`*${count}*`];
      break;
    }
    case "unavailable": {
      const source = entry.sourceUrl === null ? "" : ` \xB7 [source](<${entry.sourceUrl}>)`;
      lines = [`*[${unavailableLabel(entry)}]*${source}`];
      if (entry.replies.length > 0)
        lines.push("", "#### Replies", "", ...renderReplies(entry.replies, 0, state));
      break;
    }
    case "content": {
      lines = [metadata(entry)];
      if (entry.text.trim() !== "")
        lines.push("", entry.text.trim());
      const metricText = metricsLine(entry.metrics);
      if (metricText !== null)
        lines.push("", `_${metricText}_`);
      if (entry.media.length > 0)
        lines.push("", ...mediaLines(entry.media));
      if (entry.quotes.length > 0) {
        lines.push("", "#### Quoted posts", "");
        for (const quote of entry.quotes)
          lines.push(...renderQuote(quote, depth, state), "");
        if (lines.at(-1) === "")
          lines.pop();
      }
      if (entry.replies.length > 0)
        lines.push("", "#### Replies", "", ...renderReplies(entry.replies, 0, state));
      break;
    }
  }
  state.active.delete(entry);
  return lines;
}
function renderCapturedDocument(document) {
  const lines = [
    `# ${cleanHeading(document.title) || "Captured post"}`,
    "",
    `Source: [${document.sourceUrl}](<${document.sourceUrl}>)`,
    `Platform: ${platformLabel(document.platform)}`
  ];
  const state = { count: 0, active: new WeakSet };
  if (document.ancestors.length > 0) {
    lines.push("", "## Parent context", "");
    for (let index = 0;index < document.ancestors.length; index += 1) {
      lines.push(`### Parent ${index + 1}`, "", ...renderRootEntry(document.ancestors[index] ?? boundary("cycle", "Missing parent."), 0, state), "");
    }
    if (lines.at(-1) === "")
      lines.pop();
  }
  lines.push("", document.roots.length === 1 ? "## Post" : "## Posts", "");
  for (let index = 0;index < document.roots.length; index += 1) {
    if (document.roots.length > 1)
      lines.push(`### Post ${index + 1}`, "");
    const root = document.roots[index];
    if (root !== undefined)
      lines.push(...renderRootEntry(root, 0, state));
    if (index < document.roots.length - 1)
      lines.push("");
  }
  if (document.warnings.length > 0) {
    lines.push("", "## Capture notes", "");
    for (const warning of document.warnings)
      lines.push(`- ${warning}`);
  }
  const markdown = `${lines.join(`
`).replace(/\n{3,}/g, `

`).trimEnd()}
`;
  return rewriteContent(markdown, new URL(document.sourceUrl), new Map, { remoteImages: "embed" });
}

// src/clip/package-root.ts
import { existsSync, readFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join, resolve as resolve2 } from "path";
function isPackageManifest(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function findKbPackageRoot(startDirectory = import.meta.dir, dependencies = {}) {
  const exists = dependencies.exists ?? existsSync;
  const readText = dependencies.readText ?? ((path) => readFileSync(path, "utf8"));
  let directory = resolve2(startDirectory);
  for (let depth = 0;depth < 8; depth += 1) {
    const manifestPath = join(directory, "package.json");
    if (exists(manifestPath)) {
      try {
        const parsed = JSON.parse(readText(manifestPath));
        if (isPackageManifest(parsed) && typeof parsed.name === "string" && parsed.name.endsWith("/kb") && typeof parsed.version === "string")
          return directory;
      } catch {}
    }
    const parent = dirname(directory);
    if (parent === directory)
      break;
    directory = parent;
  }
  throw new Error("Could not locate the kb package root.");
}
function resolvePackageDirectory(packageName, parentUrl = import.meta.url) {
  const manifest = createRequire(parentUrl).resolve(`${packageName}/package.json`);
  return dirname(manifest);
}

// src/clip/acquire.ts
var agentBrowserBinDirectory = join2(resolvePackageDirectory("agent-browser"), "bin");
function agentBrowserCommand() {
  const platform = process.platform === "win32" ? "win32" : process.platform;
  const extension = process.platform === "win32" ? ".exe" : "";
  const native = join2(agentBrowserBinDirectory, `agent-browser-${platform}-${process.arch}${extension}`);
  return existsSync2(native) ? [native] : [process.execPath, join2(agentBrowserBinDirectory, "agent-browser.js")];
}
var inheritedProxyKeys = new Set([
  "ALL_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy"
]);
function isolatedAgentBrowserEnvironment(source, socketDirectory) {
  const environment = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || key.startsWith("AGENT_BROWSER_") || inheritedProxyKeys.has(key))
      continue;
    environment[key] = value;
  }
  environment.AGENT_BROWSER_SOCKET_DIR = socketDirectory;
  return environment;
}
function createAgentBrowserIsolation(directory) {
  const configPath = join2(directory, "agent-browser.config.json");
  const socketRoot = process.platform === "win32" ? tmpdir() : "/tmp";
  const socketDirectory = mkdtempSync(join2(socketRoot, "jc-ab-"));
  try {
    chmodSync(socketDirectory, 448);
    writeFileSync(configPath, `{}
`, { encoding: "utf8", flag: "wx", mode: 384 });
    chmodSync(configPath, 384);
    return {
      configPath,
      cwd: directory,
      socketDirectory,
      environment: isolatedAgentBrowserEnvironment(process.env, socketDirectory)
    };
  } catch (error) {
    rmSync(socketDirectory, { recursive: true, force: true });
    throw error;
  }
}
var isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
async function readBoundedStream(stream, maxBytes) {
  const reader = stream.getReader();
  const bytes = new BoundedByteBuffer(maxBytes);
  try {
    for (;; ) {
      const result = await reader.read();
      if (result.done)
        break;
      if (!bytes.append(result.value))
        throw new Error(`process output exceeded ${maxBytes} bytes`);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(bytes.toUint8Array());
}
async function runCommand(command, timeoutMs, maxOutputBytes, isolation, stdin) {
  const child = Bun.spawn([...command], {
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    ...isolation === undefined ? {} : { cwd: isolation.cwd, env: isolation.environment }
  });
  let timedOut = false;
  let forceKill = null;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKill = setTimeout(() => child.kill("SIGKILL"), 1000);
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readBoundedStream(child.stdout, maxOutputBytes),
      readBoundedStream(child.stderr, Math.min(maxOutputBytes, 2 * 1024 * 1024)),
      child.exited
    ]);
    if (timedOut)
      throw new Error(`command timed out after ${timeoutMs}ms`);
    return { stdout, stderr, exitCode };
  } catch (error) {
    child.kill("SIGKILL");
    await child.exited;
    throw error;
  } finally {
    clearTimeout(timeout);
    if (forceKill !== null)
      clearTimeout(forceKill);
  }
}
function parseJsonValueOutput(output, label) {
  let lineEnd = output.length;
  while (lineEnd >= 0) {
    const newline = output.lastIndexOf(`
`, lineEnd - 1);
    const line = output.slice(newline + 1, lineEnd).trim();
    lineEnd = newline;
    if (line[0] !== "{" && line[0] !== "[")
      continue;
    try {
      return JSON.parse(line);
    } catch {}
  }
  throw new Error(`${label} did not return JSON`);
}
function parseJsonOutput(output, label) {
  const parsed = parseJsonValueOutput(output, label);
  if (isRecord3(parsed))
    return parsed;
  throw new Error(`${label} did not return a JSON object`);
}
function parseAgentBrowserData(output, label) {
  const parsed = parseJsonOutput(output, label);
  if (parsed.success !== true) {
    throw new Error(`${label} failed`);
  }
  if (!isRecord3(parsed.data))
    throw new Error(`${label} returned no data`);
  return parsed.data;
}
async function runAgentBrowser(globalArgs, command, options) {
  let result;
  try {
    result = await runCommand([...agentBrowserCommand(), ...globalArgs, ...command, "--json"], options.timeoutMs, options.maxOutputBytes, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`agent-browser ${command[0] ?? "command"} failed: ${message}`, { cause: error });
  }
  if (result.exitCode !== 0) {
    throw new Error(`agent-browser ${command[0] ?? "command"} failed with exit code ${result.exitCode}`);
  }
  return parseAgentBrowserData(result.stdout, `agent-browser ${command[0] ?? "command"}`);
}
async function runAgentBrowserBatch(globalArgs, commands, options) {
  const result = await runCommand([...agentBrowserCommand(), ...globalArgs, "batch", "--bail", "--json"], options.timeoutMs, options.maxOutputBytes, options, JSON.stringify(commands));
  if (result.exitCode !== 0)
    throw new Error(`agent-browser batch failed with exit code ${result.exitCode}`);
  const parsed = parseJsonValueOutput(result.stdout, "agent-browser batch");
  if (!Array.isArray(parsed) || parsed.length !== commands.length || parsed.some((entry) => !isRecord3(entry) || entry.success !== true))
    throw new Error("agent-browser batch failed");
}
async function discoverChromeProfiles(timeoutMs = 15000) {
  const directory = mkdtempSync(join2(tmpdir(), "cclrte-kb-profiles-"));
  chmodSync(directory, 448);
  let socketDirectory = null;
  try {
    const isolation = createAgentBrowserIsolation(directory);
    socketDirectory = isolation.socketDirectory;
    const result = await runCommand([...agentBrowserCommand(), "--config", isolation.configPath, "profiles", "--json"], timeoutMs, 1024 * 1024, isolation);
    if (result.exitCode !== 0)
      return [];
    const parsed = parseJsonOutput(result.stdout, "agent-browser profiles");
    if (parsed.success !== true || !Array.isArray(parsed.data))
      return [];
    const profiles = [];
    for (const entry of parsed.data) {
      if (!isRecord3(entry))
        continue;
      if (typeof entry.directory !== "string" || typeof entry.name !== "string")
        continue;
      profiles.push({ directory: entry.directory, name: entry.name });
    }
    return profiles;
  } finally {
    if (socketDirectory !== null)
      rmSync(socketDirectory, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
}
function selectedProfile(profiles) {
  const defaultProfile = profiles.find(({ directory }) => directory === "Default");
  if (defaultProfile !== undefined)
    return defaultProfile.directory;
  return profiles.length === 1 ? profiles[0]?.directory : undefined;
}
function shouldExpand(url, options, method) {
  if (options.scope === "page")
    return false;
  const platform = classifyPlatformUrl(url.href)?.platform ?? "generic";
  const hasExplicitCookies = options.cookieSources.length > 0 || options.cookiesFile !== undefined;
  if (platform === "x" && method === "browser-fresh" && !hasExplicitCookies)
    return false;
  return platform === "x" || platform === "hacker-news" || platform === "reddit" || platform === "bluesky" || platform === "linkedin" || platform === "facebook" || platform === "instagram" || platform === "tiktok" || platform === "threads" || platform === "whatsapp" || platform === "youtube" || platform === "github" || platform === "discourse" || platform === "substack";
}
function renderedTextLines(snapshot) {
  const lines = snapshot.replace(/\r\n?/g, `
`).split(`
`);
  let start = 0;
  while (start < lines.length && lines[start]?.trim() === "")
    start += 1;
  let end = lines.length;
  while (end > start && lines[end - 1]?.trim() === "")
    end -= 1;
  return lines.slice(start, end);
}
function suffixPrefixOverlap(source, prefix) {
  if (source.length === 0 || prefix.length === 0)
    return 0;
  const fallback = new Array(prefix.length).fill(0);
  for (let index = 1;index < prefix.length; index += 1) {
    let matched2 = fallback[index - 1] ?? 0;
    while (matched2 > 0 && prefix[index] !== prefix[matched2]) {
      matched2 = fallback[matched2 - 1] ?? 0;
    }
    if (prefix[index] === prefix[matched2])
      matched2 += 1;
    fallback[index] = matched2;
  }
  let matched = 0;
  for (let index = 0;index < source.length; index += 1) {
    while (matched > 0 && source[index] !== prefix[matched]) {
      matched = fallback[matched - 1] ?? 0;
    }
    if (source[index] === prefix[matched])
      matched += 1;
    if (matched === prefix.length && index < source.length - 1) {
      matched = fallback[matched - 1] ?? 0;
    }
  }
  return matched;
}
function truncateUtf8(value, maxBytes) {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes)
    return { content: value, truncated: false };
  let end = maxBytes;
  while (end > 0 && (encoded[end] ?? 0) >>> 6 === 2)
    end -= 1;
  return {
    content: new TextDecoder("utf-8", { fatal: true }).decode(encoded.subarray(0, end)),
    truncated: true
  };
}
function mergeRenderedTextSnapshots(snapshots, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("rendered text byte limit must be a non-negative safe integer");
  }
  const merged = [];
  let hasBaseline = false;
  let addedLines = 0;
  for (const snapshot of snapshots) {
    const lines = renderedTextLines(snapshot);
    if (lines.length === 0)
      continue;
    if (!hasBaseline) {
      for (const line of lines)
        merged.push(line);
      hasBaseline = true;
      continue;
    }
    let commonPrefix = 0;
    const prefixLimit = Math.min(merged.length, lines.length);
    while (commonPrefix < prefixLimit && merged[commonPrefix] === lines[commonPrefix]) {
      commonPrefix += 1;
    }
    const remaining = lines.slice(commonPrefix);
    if (remaining.length === 0)
      continue;
    const overlap = suffixPrefixOverlap(merged, remaining);
    const additions = remaining.slice(overlap);
    if (additions.length === 0)
      continue;
    if (commonPrefix === 0 && overlap === 0 && merged.at(-1) !== "")
      merged.push("");
    for (const line of additions)
      merged.push(line);
    addedLines += additions.length;
  }
  const bounded = truncateUtf8(merged.join(`
`), maxBytes);
  return {
    ...bounded,
    observedSnapshots: snapshots.length,
    addedLines
  };
}
function browserExpansionLimits(maxItems, maxObservedTextBytes = 4 * 1024 * 1024) {
  const boundedItems = Number.isSafeInteger(maxItems) ? Math.max(1, Math.min(maxItems, 1e4)) : 500;
  const boundedObservationBytes = Number.isSafeInteger(maxObservedTextBytes) && maxObservedTextBytes > 0 ? Math.min(maxObservedTextBytes, 4 * 1024 * 1024) : 4 * 1024 * 1024;
  return {
    maxScrolls: Math.max(3, Math.min(40, Math.ceil(boundedItems / 20))),
    maxObservedTextBytes: boundedObservationBytes
  };
}
function browserExpansionScript(limits) {
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const renderedTextSnapshots = [];
    let observedTextBytes = 0;
    let renderedTextObservationTruncated = false;
    let stable = 0;
    let previousHeight = 0;
    let scrolls = 0;
    let settled = false;
    const boundedRenderedText = (value, maxBytes) => {
      let bytes = 0;
      let end = 0;
      while (end < value.length) {
        const first = value.charCodeAt(end);
        let width = 3;
        let codeUnits = 1;
        if (first <= 0x7f) width = 1;
        else if (first <= 0x7ff) width = 2;
        else if (first >= 0xd800 && first <= 0xdbff) {
          const second = value.charCodeAt(end + 1);
          if (second >= 0xdc00 && second <= 0xdfff) {
            width = 4;
            codeUnits = 2;
          }
        }
        if (bytes + width > maxBytes) break;
        bytes += width;
        end += codeUnits;
      }
      return { text: value.slice(0, end), bytes, truncated: end < value.length };
    };
    for (let pass = 0; pass < ${limits.maxScrolls}; pass += 1) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      scrolls += 1;
      await sleep(700);
      try {
        const root = document.body || document.documentElement;
        const renderedValue = root ? root.innerText : '';
        const rendered = typeof renderedValue === 'string' ? renderedValue : '';
        const remainingBytes = ${limits.maxObservedTextBytes} - observedTextBytes;
        const remainingPasses = ${limits.maxScrolls} - pass;
        const passBytes = Math.max(0, Math.ceil(remainingBytes / remainingPasses));
        const observation = boundedRenderedText(rendered, passBytes);
        if (observation.text.trim() !== '') renderedTextSnapshots.push(observation.text);
        observedTextBytes += observation.bytes;
        if (observation.truncated) renderedTextObservationTruncated = true;
      } catch {
        renderedTextObservationTruncated = true;
      }
      const height = document.documentElement.scrollHeight;
      stable = height === previousHeight ? stable + 1 : 0;
      previousHeight = height;
      if (stable >= 2) {
        settled = true;
        break;
      }
    }
    window.scrollTo(0, 0);
    return {
      scrolls,
      scrollBudgetReached: !settled && scrolls >= ${limits.maxScrolls},
      renderedTextSnapshots,
      renderedTextObservationTruncated
    };
  })()`;
}
var nonNegativeInteger = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
function readBrowserExpansionTelemetry(value, limits) {
  if (!isRecord3(value))
    return null;
  const scrolls = nonNegativeInteger(value.scrolls);
  if (!Array.isArray(value.renderedTextSnapshots))
    return null;
  if (value.renderedTextSnapshots.length > limits.maxScrolls)
    return null;
  const renderedTextSnapshots = [];
  let observedTextBytes = 0;
  for (const snapshot of value.renderedTextSnapshots) {
    if (typeof snapshot !== "string")
      return null;
    if (snapshot.length > limits.maxObservedTextBytes)
      return null;
    observedTextBytes += new TextEncoder().encode(snapshot).byteLength;
    if (observedTextBytes > limits.maxObservedTextBytes)
      return null;
    renderedTextSnapshots.push(snapshot);
  }
  if (scrolls === null || scrolls > limits.maxScrolls || renderedTextSnapshots.length > scrolls || typeof value.scrollBudgetReached !== "boolean" || typeof value.renderedTextObservationTruncated !== "boolean")
    return null;
  return {
    scrolls,
    scrollBudgetReached: value.scrollBudgetReached,
    renderedTextSnapshots,
    renderedTextObservationTruncated: value.renderedTextObservationTruncated
  };
}
function browserExpansionWarnings(telemetry, limits) {
  const warnings = [
    "Browser capture left disclosure controls untouched; collapsed content may remain unavailable."
  ];
  if (telemetry.scrollBudgetReached) {
    warnings.push(`Browser capture reached its ${limits.maxScrolls}-scroll budget before the document stabilized; lazy content may remain unloaded.`);
  }
  if (telemetry.renderedTextObservationTruncated) {
    warnings.push(`Rendered-text observations reached their ${limits.maxObservedTextBytes}-byte capture budget; some virtualized content may be missing.`);
  }
  return warnings;
}
function browserCaptureScript() {
  return `({
    url: location.href,
    title: document.title,
    html: '<!doctype html>\\n' + document.documentElement.outerHTML
  })`;
}
function readBrowserContent(data) {
  if (typeof data.content !== "string" || data.content.trim() === "") {
    throw new Error("agent-browser read returned no rendered content");
  }
  const url = typeof data.finalUrl === "string" ? data.finalUrl : data.url;
  if (typeof url !== "string")
    throw new Error("agent-browser read returned no final URL");
  return { content: data.content, finalUrl: new URL(url), truncated: data.truncated === true };
}
function readBrowserUrl(data) {
  const value = typeof data.url === "string" ? data.url : data.finalUrl;
  if (typeof value !== "string")
    throw new Error("agent-browser returned no current URL");
  return new URL(value);
}
function navigationIdentity(url) {
  const comparable = new URL(url);
  comparable.hash = "";
  return comparable.href;
}
function browserExpansionStayedOnPage(before, after) {
  return (after.protocol === "http:" || after.protocol === "https:") && navigationIdentity(before) === navigationIdentity(after);
}
function browserNavigationReachedTarget(target, before, after, navigationCommandSucceeded) {
  if (after.protocol !== "http:" && after.protocol !== "https:")
    return false;
  const targetIdentity = navigationIdentity(target);
  const afterIdentity = navigationIdentity(after);
  if (afterIdentity === targetIdentity)
    return true;
  return navigationCommandSucceeded && before !== null && navigationIdentity(before) !== afterIdentity;
}
async function terminateAgentBrowserSession(session, socketDirectory) {
  const pidPath = join2(socketDirectory, `${session}.pid`);
  if (!existsSync2(pidPath))
    return;
  const rawPid = readFileSync2(pidPath, "utf8").trim();
  if (!/^\d+$/.test(rawPid))
    return;
  const pid = Number(rawPid);
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid)
    return;
  const signal = (name) => {
    try {
      process.kill(process.platform === "win32" ? pid : -pid, name);
    } catch {
      try {
        process.kill(pid, name);
      } catch {}
    }
  };
  signal("SIGTERM");
  await Bun.sleep(500);
  signal("SIGKILL");
}
function pathInside(root, target) {
  const child = relative(root, target);
  return child === "" || !isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`);
}
function canonicalPotentialPath(value, label) {
  const suffix = [];
  let ancestor = resolve3(value);
  while (true) {
    try {
      lstatSync(ancestor);
      let canonicalAncestor;
      try {
        canonicalAncestor = realpathSync(ancestor);
      } catch {
        throw new Error(`${label} contains an unresolved symbolic link.`);
      }
      return resolve3(canonicalAncestor, ...suffix);
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
    }
    const parent = dirname2(ancestor);
    if (parent === ancestor)
      throw new Error(`${label} has no resolvable filesystem ancestor.`);
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
}
function profilePath(value) {
  const pathLike = isAbsolute(value) || value.startsWith(`.${sep}`) || value.startsWith(`..${sep}`) || value.startsWith(`~${sep}`) || value.includes("/") || value.includes("\\");
  if (!pathLike)
    return null;
  const expanded = value.startsWith(`~${sep}`) ? join2(homedir(), value.slice(2)) : resolve3(value);
  return canonicalPotentialPath(expanded, "Persistent browser profile");
}
function assertSafePersistentProfile(options) {
  if (options.browserProfile === undefined)
    return null;
  const path = profilePath(options.browserProfile);
  if (path === null)
    return null;
  const repositoryRoot = realpathSync(findKbPackageRoot());
  const outputRoot = canonicalPotentialPath(options.outputBase, "Capture output root");
  if (pathInside(repositoryRoot, path) || pathInside(outputRoot, path) || pathInside(path, outputRoot)) {
    throw new Error("Persistent browser profiles must live outside the repository and capture output roots.");
  }
  return path;
}
function browserCookieCommands(cookies, target) {
  return cookies.map((cookie) => {
    const command = ["cookies", "set", cookie.name, cookie.value];
    if (cookie.hostOnly)
      command.push("--url", target.origin);
    else
      command.push("--domain", `.${cookie.domain}`);
    command.push("--path", cookie.path);
    if (cookie.httpOnly)
      command.push("--httpOnly");
    if (cookie.secure)
      command.push("--secure");
    if (cookie.sameSite !== null)
      command.push("--sameSite", cookie.sameSite);
    if (cookie.expires > 0)
      command.push("--expires", String(cookie.expires));
    return command;
  });
}
async function seedOwnedBrowserCookies(options, globalArgs, commandOptions, dependencies = {}) {
  const selected = options.cookieSources.length > 0 || options.cookiesFile !== undefined;
  if (!selected)
    return [];
  const target = captureUrl(options);
  const result = await (dependencies.readCookies ?? acquireCookieRecords)(options, target);
  await (dependencies.runBatch ?? runAgentBrowserBatch)(globalArgs, browserCookieCommands(result.cookies, target), commandOptions);
  return [
    ...result.warnings,
    "Seeded explicitly selected cookies into the owned browser without broadening their domain, path, Secure, HttpOnly, SameSite, or expiry attributes."
  ];
}
function browserProxyArguments(proxyUrl, profileDirectory) {
  const chromiumArguments = [
    ...profileDirectory === undefined ? [] : [`--profile-directory=${profileDirectory}`],
    "--disable-quic",
    "--disable-dns-prefetch",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-features=AsyncDns",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--proxy-bypass-list=<-loopback>"
  ].join(`
`);
  return ["--proxy", proxyUrl, "--args", chromiumArguments];
}
async function acquireBrowser(options, temporaryDirectory, useDiscoveredProfile = false, dependencies = {}) {
  if (options.currentTab && (!options.browserLive && options.cdp === undefined)) {
    throw new Error("current-tab capture requires --browser-live or --cdp");
  }
  if (options.currentTab && options.browserProfile !== undefined) {
    throw new Error("current-tab capture cannot use a browser profile; attach with --browser-live or --cdp");
  }
  const assertNetworkUrl = dependencies.assertNetworkUrl ?? assertSafeNetworkUrl;
  const requestedUrl = options.currentTab ? null : captureUrl(options);
  if (requestedUrl !== null) {
    await assertNetworkUrl(requestedUrl, options.allowPrivateNetwork, options.timeoutMs);
  }
  const runBrowser = dependencies.run ?? runAgentBrowser;
  const runBrowserBatch = dependencies.runBatch ?? runAgentBrowserBatch;
  const sleep = dependencies.sleep ?? ((milliseconds) => Bun.sleep(milliseconds));
  const warnings = [];
  const persistentProfilePath = assertSafePersistentProfile(options);
  const ownedProfile = options.browserProfileOwnership === "owned";
  if (ownedProfile && persistentProfilePath === null) {
    throw new Error("owned browser-profile execution requires an explicit path-backed profile");
  }
  const session = `clip-${process.pid}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const isolation = createAgentBrowserIsolation(temporaryDirectory);
  try {
    const globalArgs = ["--config", isolation.configPath, "--session", session];
    let method = "browser-fresh";
    let ownsBrowser = true;
    if (options.cdp !== undefined) {
      globalArgs.push("--cdp", options.cdp);
      method = "browser-cdp";
      ownsBrowser = false;
    } else if (options.browserLive) {
      globalArgs.push("--auto-connect");
      method = "browser-live";
      ownsBrowser = false;
    } else {
      const profile = options.browserProfile ?? (useDiscoveredProfile ? selectedProfile(await discoverChromeProfiles(options.timeoutMs)) : undefined);
      if (profile !== undefined) {
        globalArgs.push("--profile", profile);
        method = "browser-profile";
        warnings.push(ownedProfile ? "Used an owned private browser-profile snapshot; page activity cannot modify the source profile." : persistentProfilePath === null ? "A named Chrome profile can expose broad all-origin browser state to public subresources loaded by the target page; prefer a dedicated per-site profile." : "The selected persistent browser profile can be updated by page activity; keep dedicated capture profiles outside the repository.");
      } else if (options.browserProfile !== undefined || useDiscoveredProfile) {
        warnings.push("No unambiguous Chrome profile was found; used a fresh browser session.");
      }
    }
    let networkProxy = null;
    const commandOptions = {
      cwd: isolation.cwd,
      environment: isolation.environment,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: Math.max(options.maxHtmlBytes * 2 + 1024 * 1024, 4 * 1024 * 1024)
    };
    try {
      if (ownsBrowser) {
        networkProxy = await startNetworkProxy({
          allowPrivateNetwork: options.allowPrivateNetwork,
          timeoutMs: options.timeoutMs,
          maxTransferredBytes: Math.max(64 * 1024 * 1024, Math.min(Number.MAX_SAFE_INTEGER, (options.maxHtmlBytes + options.maxTotalAssetBytes) * 2))
        });
        globalArgs.push(...browserProxyArguments(networkProxy.url, options.browserProfileDirectory));
      }
      if (!options.currentTab) {
        try {
          await runBrowser(globalArgs, ["open", "about:blank"], commandOptions);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Browser startup did not settle cleanly; attempted to use the isolated session: ${message}`);
        }
      }
      if (ownsBrowser && (method === "browser-fresh" || ownedProfile)) {
        warnings.push(...await seedOwnedBrowserCookies(options, globalArgs, commandOptions));
      } else if (options.cookieSources.length > 0 || options.cookiesFile !== undefined) {
        warnings.push("Explicit cookie input remained a separate HTTP/media lane and was not imported into the selected profile or attached browser.");
      }
      if (!ownsBrowser) {
        warnings.push(options.currentTab ? "Captured the current attached tab without navigation or interaction; the external browser itself was left open." : "Attached browser capture navigated and scrolled the active tab; the external browser itself was left open.");
      }
      let beforeNavigation = null;
      try {
        beforeNavigation = readBrowserUrl(await runBrowser(globalArgs, ["get", "url"], commandOptions));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Could not establish a pre-navigation browser URL: ${message}`);
      }
      let navigationCommandSucceeded = false;
      if (!options.currentTab) {
        try {
          await runBrowserBatch(globalArgs, [["open", captureUrl(options).href]], commandOptions);
          navigationCommandSucceeded = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Browser navigation command ended during page transition: ${message}`);
        }
        await sleep(Math.min(5000, Math.max(1500, Math.floor(options.timeoutMs / 6))));
      }
      let readable;
      try {
        readable = readBrowserContent(await runBrowser(globalArgs, ["read"], commandOptions));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Rendered readable text was unavailable; continuing with the bounded DOM: ${message}`);
        readable = {
          content: "",
          finalUrl: readBrowserUrl(await runBrowser(globalArgs, ["get", "url"], commandOptions)),
          truncated: false
        };
      }
      if (options.currentTab) {
        if (readable.finalUrl.protocol !== "http:" && readable.finalUrl.protocol !== "https:") {
          throw new Error("the current tab must have an HTTP or HTTPS URL");
        }
        if (beforeNavigation !== null && !browserExpansionStayedOnPage(beforeNavigation, readable.finalUrl)) {
          throw new Error("the current tab changed pages while it was being read; retry on the intended page");
        }
      } else if (!browserNavigationReachedTarget(captureUrl(options), beforeNavigation, readable.finalUrl, navigationCommandSucceeded)) {
        throw new Error("browser did not establish the requested navigation; refusing to capture a pre-existing tab");
      }
      let browserPageProvenanceIntact = true;
      if (!options.currentTab && shouldExpand(readable.finalUrl, options, method)) {
        const expansionLimits = browserExpansionLimits(options.maxItems, options.maxHtmlBytes);
        try {
          const expansion = await runBrowser(globalArgs, ["eval", browserExpansionScript(expansionLimits)], {
            ...commandOptions,
            timeoutMs: Math.min(commandOptions.timeoutMs, 30000)
          });
          const telemetry = readBrowserExpansionTelemetry(expansion.result, expansionLimits);
          if (telemetry === null) {
            warnings.push("Browser expansion returned no trustworthy bounded-work telemetry; conversation completeness cannot be confirmed.");
          } else {
            warnings.push(...browserExpansionWarnings(telemetry, expansionLimits));
          }
          const expandedReadable = readBrowserContent(await runBrowser(globalArgs, ["read"], commandOptions));
          if (browserExpansionStayedOnPage(readable.finalUrl, expandedReadable.finalUrl)) {
            const merged = mergeRenderedTextSnapshots([
              readable.content,
              ...telemetry?.renderedTextSnapshots ?? [],
              expandedReadable.content
            ], options.maxHtmlBytes);
            readable = {
              content: merged.content,
              finalUrl: expandedReadable.finalUrl,
              truncated: readable.truncated || expandedReadable.truncated || telemetry?.renderedTextObservationTruncated === true || merged.truncated
            };
            if (merged.addedLines > 0) {
              warnings.push(`Merged ${merged.addedLines} newly observed rendered-text line(s) with the pre-expansion snapshot so virtualized content remains available.`);
            }
          } else {
            browserPageProvenanceIntact = false;
            warnings.push("Browser expansion navigated away from the captured page; preserved the proven baseline and skipped post-expansion DOM and screenshot capture.");
          }
        } catch (error) {
          browserPageProvenanceIntact = false;
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Browser expansion stopped early; preserved the baseline rendered text and skipped post-expansion DOM and screenshot capture: ${message}`);
        }
      }
      if (!options.currentTab) {
        await assertNetworkUrl(readable.finalUrl, options.allowPrivateNetwork, options.timeoutMs);
      }
      const renderedText = readable.content;
      let body = renderedText;
      let contentType = "text/plain; charset=utf-8";
      let contentTruncated = readable.truncated;
      let sourceEvidence;
      let browserTitle;
      if (browserPageProvenanceIntact) {
        try {
          const capture = await runBrowser(globalArgs, ["eval", browserCaptureScript()], commandOptions);
          if (isRecord3(capture.result)) {
            const html = capture.result.html;
            const title = capture.result.title;
            const captureUrl2 = typeof capture.result.url === "string" ? new URL(capture.result.url) : null;
            if (captureUrl2 === null || !browserExpansionStayedOnPage(readable.finalUrl, captureUrl2)) {
              browserPageProvenanceIntact = false;
              warnings.push("Rendered DOM capture changed pages; preserved the proven readable baseline.");
            } else if (typeof html === "string") {
              const byteLength = new TextEncoder().encode(html).byteLength;
              if (byteLength <= options.maxHtmlBytes) {
                body = html;
                contentType = "text/html; charset=utf-8";
                contentTruncated = false;
                if (options.evidence === "source" || options.evidence === "all")
                  sourceEvidence = html;
              } else {
                warnings.push(`Rendered DOM exceeded ${options.maxHtmlBytes} bytes; extracted the bounded readable fallback.`);
              }
            }
            if (browserPageProvenanceIntact && typeof title === "string" && title.trim() !== "")
              browserTitle = title;
          } else {
            browserPageProvenanceIntact = false;
            warnings.push("Rendered DOM capture returned no trustworthy page provenance; preserved the readable baseline.");
          }
        } catch (error) {
          browserPageProvenanceIntact = false;
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Rendered DOM was unavailable; extracted the bounded readable fallback: ${message}`);
        }
      } else {
        warnings.push("Rendered DOM capture was skipped because post-expansion page provenance was not established.");
      }
      if (body.trim() === "")
        throw new Error("browser returned neither readable text nor a bounded rendered DOM");
      if (readable.truncated)
        warnings.push("Rendered text was truncated at its configured output boundary.");
      let screenshotPath;
      if ((options.evidence === "screenshot" || options.evidence === "all") && browserPageProvenanceIntact) {
        const requestedScreenshotPath = join2(temporaryDirectory, "page.png");
        screenshotPath = requestedScreenshotPath;
        try {
          await runBrowser(globalArgs, ["screenshot", requestedScreenshotPath], {
            ...commandOptions,
            timeoutMs: options.timeoutMs,
            maxOutputBytes: 2 * 1024 * 1024
          });
          const afterScreenshot = readBrowserUrl(await runBrowser(globalArgs, ["get", "url"], commandOptions));
          if (!browserExpansionStayedOnPage(readable.finalUrl, afterScreenshot)) {
            rmSync(requestedScreenshotPath, { force: true });
            warnings.push("Browser screenshot changed pages during capture and was discarded.");
            screenshotPath = undefined;
          } else if (!existsSync2(requestedScreenshotPath)) {
            warnings.push("Browser screenshot was requested but agent-browser did not create it.");
            screenshotPath = undefined;
          }
        } catch (error) {
          rmSync(requestedScreenshotPath, { force: true });
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Browser screenshot was unavailable or had no trustworthy page provenance: ${message}`);
          screenshotPath = undefined;
        }
      } else if (options.evidence === "screenshot" || options.evidence === "all") {
        warnings.push("Browser screenshot was skipped because post-expansion page provenance was not established.");
      }
      return {
        body,
        contentType,
        finalUrl: options.currentTab ? new URL(sanitizeArtifactUrl(readable.finalUrl.href)) : readable.finalUrl,
        method,
        warnings,
        ...browserTitle === undefined ? {} : { browserTitle },
        ...screenshotPath === undefined ? {} : { screenshotPath },
        ...sourceEvidence === undefined ? {} : { sourceEvidence },
        ...contentTruncated ? { contentTruncated: true } : {},
        renderedText,
        ...readable.truncated ? { renderedTextTruncated: true } : {},
        renderedTextByteLimit: options.maxHtmlBytes
      };
    } finally {
      try {
        if (ownsBrowser) {
          try {
            await runBrowser(["--config", isolation.configPath, "--session", session], ["close"], {
              cwd: isolation.cwd,
              environment: isolation.environment,
              timeoutMs: 15000,
              maxOutputBytes: 1024 * 1024
            });
          } catch {
            warnings.push("Browser session did not close cleanly; terminated its isolated process group.");
          }
        }
        await terminateAgentBrowserSession(session, isolation.socketDirectory);
      } finally {
        await networkProxy?.close();
      }
    }
  } finally {
    rmSync(isolation.socketDirectory, { recursive: true, force: true });
  }
}
async function acquireHttp(options) {
  const response = await safeFetch(captureUrl(options), {
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxHtmlBytes,
    allowPrivateNetwork: options.allowPrivateNetwork,
    userAgent: options.userAgent,
    retries: 2
  });
  return {
    body: decodeBytes(response.bytes, response.contentType),
    contentType: response.contentType,
    finalUrl: response.finalUrl,
    method: "http",
    warnings: []
  };
}
async function acquireCookieHttp(options) {
  if (options.cookieSources.length === 0 && options.cookiesFile === undefined) {
    throw new Error("cookie capture requires --cookie-source or --cookies-file");
  }
  const target = captureUrl(options);
  const cookieResult = await acquireCookieHeader(options, target);
  const response = await safeFetch(target, {
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxHtmlBytes,
    allowPrivateNetwork: options.allowPrivateNetwork,
    userAgent: options.userAgent,
    cookieHeader: cookieResult.header,
    retries: 2
  });
  return {
    body: decodeBytes(response.bytes, response.contentType),
    contentType: response.contentType,
    finalUrl: response.finalUrl,
    method: "cookie-http",
    warnings: cookieResult.warnings
  };
}
function createCookieRecordReader(reader) {
  return async (options, url) => {
    if (options.cookieSources.length === 0 && options.cookiesFile === undefined) {
      throw new Error("cookie capture requires --cookie-source or --cookies-file");
    }
    if (options.cookiesFile !== undefined) {
      const parsed = readCookieFile(options.cookiesFile, url);
      if (!parsed.ok) {
        throw new Error("the explicitly selected cookie file contained no usable cookies for this request");
      }
      const warnings2 = [];
      if (options.cookieSources.length > 0) {
        warnings2.push("The explicit cookie file took precedence over the selected browser cookie source.");
      }
      if (parsed.rejected > 0) {
        warnings2.push(`Ignored ${parsed.rejected} malformed, expired, or out-of-scope cookie record(s).`);
      }
      if (parsed.format === "cookie-header" || parsed.format === "curl") {
        warnings2.push("The cookie header did not encode attributes; browser replay inferred restrictive host-only, target-path, HTTPS-Secure, HttpOnly, and SameSite=Strict attributes. Use Cookie-Editor JSON or Netscape format when exact attributes matter.");
      }
      return { cookies: parsed.cookies, warnings: warnings2 };
    }
    if (options.cookieSources.length === 0) {
      throw new Error("cookie capture requires at least one explicit browser cookie source");
    }
    const chromiumSource = options.cookieSources.find((source) => source === "chrome" || source === "arc" || source === "brave" || source === "chromium");
    const selectedBrowsers = [];
    for (const source of options.cookieSources) {
      const backend = source === "arc" || source === "brave" || source === "chromium" ? "chrome" : source;
      if (!selectedBrowsers.includes(backend))
        selectedBrowsers.push(backend);
    }
    const cookieOptions = {
      url: url.href,
      mode: "first",
      timeoutMs: options.timeoutMs,
      debug: false,
      browsers: selectedBrowsers,
      profile: options.cookieProfile ?? "",
      chromeProfile: options.cookieProfile ?? "",
      edgeProfile: options.cookieProfile ?? "",
      firefoxProfile: options.cookieProfile ?? "",
      ...chromiumSource === undefined ? {} : { chromiumBrowser: chromiumSource },
      ...options.cookieProfile === undefined ? {} : {
        ...options.cookieSources.includes("safari") ? { safariCookiesFile: options.cookieProfile } : {}
      }
    };
    let provided;
    try {
      provided = await reader(cookieOptions);
    } catch {
      throw new Error("the explicitly selected browser cookie source could not be read");
    }
    const filtered = filterCookieProviderResult(provided, url);
    if (!filtered.validShape)
      throw new Error("the selected browser cookie provider returned malformed data");
    if (filtered.cookies.length === 0) {
      throw new Error(filtered.rejected === 0 ? "no matching cookies were found in the explicitly selected browser" : `no usable origin-scoped cookies were found; rejected ${filtered.rejected} malformed, expired, or out-of-scope record(s)`);
    }
    const warnings = [];
    if (filtered.rejected > 0) {
      warnings.push(`Ignored ${filtered.rejected} malformed, expired, or out-of-scope browser cookie record(s).`);
    }
    if (filtered.providerWarningCount > 0) {
      warnings.push(`The browser cookie provider reported ${filtered.providerWarningCount} non-fatal warning(s).`);
    }
    return { cookies: filtered.cookies, warnings };
  };
}
function createCookieHeaderReader(reader) {
  const records = createCookieRecordReader(reader);
  return async (options, url) => {
    const result = await records(options, url);
    return { header: renderCookieHeader(result.cookies), warnings: result.warnings };
  };
}
var acquireCookieRecords = createCookieRecordReader((options) => getCookies(options));
var acquireCookieHeader = async (options, url) => {
  const result = await acquireCookieRecords(options, url);
  return { header: renderCookieHeader(result.cookies), warnings: result.warnings };
};
async function readStdinBounded(maxBytes) {
  return readBoundedStream(Bun.stdin.stream(), maxBytes);
}
async function acquireFile(options) {
  if (options.htmlFile === undefined)
    throw new Error("file capture requires --html <path|->");
  const body = options.htmlFile === "-" ? await readStdinBounded(options.maxHtmlBytes) : (() => {
    const stats = statSync(options.htmlFile);
    if (!stats.isFile())
      throw new Error(`HTML input is not a regular file: ${options.htmlFile}`);
    if (stats.size > options.maxHtmlBytes) {
      throw new Error(`HTML input is ${stats.size} bytes; limit is ${options.maxHtmlBytes}`);
    }
    return readFileSync2(options.htmlFile, "utf8");
  })();
  return {
    body,
    contentType: "text/html; charset=utf-8",
    finalUrl: captureUrl(options),
    method: "file",
    warnings: options.htmlFile === "-" ? [] : [`Parsed rendered HTML from ${basename(options.htmlFile)}.`]
  };
}

export { MAX_COOKIE_BYTES, filterCookies, readCookieFile, filterCookieProviderResult, renderCookieHeader, renderNetscapeCookieJar, articleMetadataLimits, slugify, resolveRemote, scanImageSources, CONTENT_REWRITE_TRUNCATION_WARNING, rewriteContentWithStatus, buildClipMarkdown, classifyPlatformUrl, parseHackerNewsCapture, parseRedditCapture, parseBlueskyCapture, renderCapturedDocument, findKbPackageRoot, agentBrowserCommand, isolatedAgentBrowserEnvironment, discoverChromeProfiles, mergeRenderedTextSnapshots, browserExpansionLimits, browserExpansionScript, readBrowserExpansionTelemetry, browserExpansionWarnings, browserExpansionStayedOnPage, browserNavigationReachedTarget, assertSafePersistentProfile, browserCookieCommands, seedOwnedBrowserCookies, browserProxyArguments, acquireBrowser, acquireHttp, acquireCookieHttp, createCookieRecordReader, createCookieHeaderReader, acquireCookieRecords, acquireCookieHeader, acquireFile };
