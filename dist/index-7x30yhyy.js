// @bun
import {
  sanitizeTerminalText
} from "./index-q32a8bfd.js";

// src/clip/persist.ts
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
var CAPTURE_MANIFEST_SCHEMA_VERSION = 2;
var CAPTURE_MANIFEST_FILENAME = "capture.json";
var CAPTURE_SOURCE_EVIDENCE_PATH = "evidence/source.html";
var transactionState = Symbol("captureBundleTransactionState");
var secretKeyPattern = /(?:auth(?:orization)?|cookie|credential|csrf|xsrf|jwt|pass(?:word|wd)?|secret|session|token|api[-_]?key|private[-_]?key|signature|signed[-_]?url|key[-_]?pair[-_]?id|hdne[at])/i;
var oneTimeCredentialKeyPattern = /^(?:code|ticket|otp|nonce|key|magic[-_]?link|magic[-_]?token|one[-_]?time(?:[-_]?code|[-_]?token)?)$/i;
var providerSignatureKeyPattern = /^(?:x-amz-.+|x-goog-.+|signature|sig|policy|key-pair-id|googleaccessid|awsaccesskeyid|hdne[at])$/i;
var azureSasKeyPattern = /^(?:sv|ss|srt|sp|se|st|spr|sip|sr|sig)$/i;
var safeManifestTokenPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
var safeArtifactMimePattern = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
var MAX_ARTIFACT_URL_CODE_UNITS = 64 * 1024;
var MAX_ARTIFACT_URL_PARAMETERS = 4096;
function requireSafeSlug(slug) {
  if (slug.length === 0 || slug.length > 240)
    throw new Error("unsafe capture slug");
  const normalized = slug.normalize("NFKC");
  const codePoints = [...slug];
  const validCharacters = /^[\p{Letter}\p{Number}](?:[\p{Letter}\p{Number}._-]*[\p{Letter}\p{Number}])?$/u;
  if (slug !== normalized || codePoints.length === 0 || codePoints.length > 80 || new TextEncoder().encode(slug).byteLength > 240 || !validCharacters.test(slug) || slug === "." || slug === "..") {
    throw new Error("unsafe capture slug");
  }
}
function captureMarkdownFilename(slug) {
  requireSafeSlug(slug);
  return `${slug}.md`;
}
function isConfinedChild(root, path) {
  const child = relative(root, path);
  return child !== "" && !isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`);
}
function assertConfinedChild(root, path, label) {
  if (!isConfinedChild(root, path))
    throw new Error(`${label} escapes the capture output root`);
}
function ensureOutputRoot(outputRoot) {
  const absolute = resolve(outputRoot);
  mkdirSync(absolute, { recursive: true, mode: 493 });
  const stats = lstatSync(absolute);
  if (!stats.isDirectory() && !stats.isSymbolicLink()) {
    throw new Error(`capture output root is not a directory: ${absolute}`);
  }
  const canonical = realpathSync(absolute);
  if (!lstatSync(canonical).isDirectory())
    throw new Error(`capture output root is not a directory: ${canonical}`);
  if (dirname(canonical) === canonical || canonical === realpathSync(homedir())) {
    throw new Error(`refusing dangerous capture output root: ${canonical}`);
  }
  return canonical;
}
function ownedTargetIdentity(targetDirectory, slug) {
  const directory = lstatSync(targetDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error(`--force only replaces a regular clip-owned directory: ${targetDirectory}`);
  }
  const manifestPath = join(targetDirectory, CAPTURE_MANIFEST_FILENAME);
  const markdownPath = join(targetDirectory, captureMarkdownFilename(slug));
  for (const [label, path] of [["manifest", manifestPath], ["Markdown", markdownPath]]) {
    let stats;
    try {
      stats = lstatSync(path);
    } catch {
      throw new Error(`--force refused an unowned target without its expected ${label}: ${targetDirectory}`);
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`--force refused an unowned target with an unsafe ${label}: ${targetDirectory}`);
    }
  }
  const manifestStats = lstatSync(manifestPath);
  if (manifestStats.size > 1024 * 1024) {
    throw new Error(`--force refused an unowned target with an oversized manifest: ${targetDirectory}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error(`--force refused an unowned target with an invalid manifest: ${targetDirectory}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("schemaVersion" in parsed) || parsed.schemaVersion !== 1 && parsed.schemaVersion !== CAPTURE_MANIFEST_SCHEMA_VERSION || !("sourceUrl" in parsed) || typeof parsed.sourceUrl !== "string") {
    throw new Error(`--force refused an unowned target with an incompatible manifest: ${targetDirectory}`);
  }
  try {
    const source = new URL(parsed.sourceUrl);
    if (source.protocol !== "http:" && source.protocol !== "https:")
      throw new Error("unsupported source protocol");
  } catch {
    throw new Error(`--force refused an unowned target with an invalid manifest source: ${targetDirectory}`);
  }
  return { device: directory.dev, inode: directory.ino };
}
function beginCaptureBundle(options) {
  requireSafeSlug(options.slug);
  const outputRoot = ensureOutputRoot(options.outputRoot);
  const targetDirectory = join(outputRoot, options.slug);
  assertConfinedChild(outputRoot, targetDirectory, "capture target");
  const targetExists = existsSync(targetDirectory);
  if (targetExists && !options.force) {
    throw new Error(`capture already exists: ${targetDirectory}; pass --force to replace it`);
  }
  const expectedTargetIdentity = targetExists ? ownedTargetIdentity(targetDirectory, options.slug) : null;
  const stagingDirectory = mkdtempSync(join(outputRoot, ".capture-staging-"));
  chmodSync(stagingDirectory, 448);
  assertConfinedChild(outputRoot, stagingDirectory, "capture staging directory");
  return {
    outputRoot,
    targetDirectory,
    stagingDirectory,
    assetsDirectory: join(stagingDirectory, "assets"),
    slug: options.slug,
    force: options.force,
    expectedTargetIdentity,
    [transactionState]: "open"
  };
}
function requireState(transaction, expected) {
  if (transaction[transactionState] !== expected) {
    throw new Error(`capture transaction is ${transaction[transactionState]}, expected ${expected}`);
  }
}
function ensureTrailingNewline(value) {
  return value.endsWith(`
`) ? value : `${value}
`;
}
var MAX_PROJECTED_CREDENTIAL_ENTITIES = 4096;
var MAX_CREDENTIAL_REPLACEMENTS = 4096;
var MAX_PROJECTED_URL_CANDIDATES = 4096;
var MAX_PROJECTED_URL_LENGTH = 16 * 1024;
var ENTITY_DENSE_REDACTION = "[REDACTED ENTITY-DENSE CONTENT]";
var CREDENTIAL_DENSE_REDACTION = "[REDACTED CREDENTIAL-DENSE CONTENT]";
var URL_DENSE_REDACTION = "[REDACTED URL-DENSE CONTENT]";
var exactCredentialAssignmentKeys = new Set([
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "csrf",
  "hdnea",
  "hdnat",
  "jwt",
  "password",
  "passwd",
  "proxy_authorization",
  "_auth",
  "secret",
  "session",
  "set_cookie",
  "token",
  "xsrf"
]);
var credentialAssignmentKeySuffixes = [
  "api_key",
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "csrf",
  "csrf_token",
  "jwt",
  "key_pair_id",
  "passwd",
  "password",
  "private_key",
  "secret",
  "secret_key",
  "session",
  "session_id",
  "session_key",
  "session_token",
  "signature",
  "signed_url",
  "token",
  "xsrf",
  "xsrf_token"
];
function normalizeCredentialKey(key) {
  return key.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/-+/g, "_").toLowerCase();
}
function isCredentialAssignmentKey(key) {
  const normalized = normalizeCredentialKey(key);
  return exactCredentialAssignmentKeys.has(normalized) || normalized === "aws_access_key_id" || normalized === "aws_secret_access_key" || credentialAssignmentKeySuffixes.some((suffix) => normalized === suffix || normalized.endsWith(`_${suffix}`));
}
var authenticationQueryKeys = new Set([
  "action_code",
  "activation_code",
  "assertion",
  "confirmation_code",
  "invite_code",
  "magic_code",
  "oob_code",
  "recovery_code",
  "relay_state",
  "reset_code",
  "saml_request",
  "saml_response",
  "verification_code",
  "verify_code"
]);
function isAuthenticationQueryKey(key) {
  return authenticationQueryKeys.has(normalizeCredentialKey(key));
}
var credentialEntityCharacters = {
  amp: "&",
  apos: "'",
  bsol: "\\",
  colon: ":",
  comma: ",",
  commat: "@",
  dash: "-",
  equals: "=",
  gt: ">",
  hyphen: "-",
  lowbar: "_",
  lt: "<",
  newline: `
`,
  nbsp: " ",
  num: "#",
  percnt: "%",
  period: ".",
  plus: "+",
  quot: '"',
  semi: ";",
  sol: "/",
  tab: "\t",
  underbar: "_"
};
function decodeCredentialEntity(entity) {
  const numeric = /^&#(?:x([0-9a-f]+)|(\d+));?$/i.exec(entity);
  if (numeric !== null) {
    const codePoint = Number.parseInt(numeric[1] ?? numeric[2] ?? "", numeric[1] === undefined ? 10 : 16);
    if (!Number.isSafeInteger(codePoint) || codePoint <= 0 || codePoint > 1114111)
      return null;
    if (codePoint >= 55296 && codePoint <= 57343)
      return null;
    return String.fromCodePoint(codePoint);
  }
  const named = /^&([a-z][a-z0-9]+);$/i.exec(entity)?.[1]?.toLowerCase();
  return named === undefined ? null : credentialEntityCharacters[named] ?? null;
}
function projectCredentialEntities(value) {
  if (!value.includes("&"))
    return { text: value, entities: [], limitExceeded: false };
  const entities = [];
  const parts = [];
  const entityPattern = /&(?:#[xX][0-9a-fA-F]{1,6};|#\d{1,7};|#[xX][0-9a-fA-F]{1,6}(?![0-9a-fA-F])|#\d{1,7}(?!\d)|[a-zA-Z][a-zA-Z0-9]+;)/g;
  let sourceCursor = 0;
  let projectedLength = 0;
  for (const match of value.matchAll(entityPattern)) {
    const sourceStart = match.index ?? 0;
    const sourceEnd = sourceStart + match[0].length;
    const decoded = decodeCredentialEntity(match[0]);
    if (decoded === null)
      continue;
    if (entities.length >= MAX_PROJECTED_CREDENTIAL_ENTITIES) {
      return { text: "", entities: [], limitExceeded: true };
    }
    const unchanged = value.slice(sourceCursor, sourceStart);
    parts.push(unchanged, decoded);
    projectedLength += unchanged.length;
    entities.push({
      projectedStart: projectedLength,
      projectedEnd: projectedLength + decoded.length,
      sourceStart,
      sourceEnd,
      deltaAfter: sourceEnd - (projectedLength + decoded.length)
    });
    projectedLength += decoded.length;
    sourceCursor = sourceEnd;
  }
  if (entities.length === 0)
    return { text: value, entities, limitExceeded: false };
  parts.push(value.slice(sourceCursor));
  return { text: parts.join(""), entities, limitExceeded: false };
}
function applyTextReplacements(value, replacements) {
  if (replacements.length === 0)
    return value;
  const ordered = [...replacements].sort((left, right) => left.start - right.start);
  const parts = [];
  let cursor = 0;
  for (const replacement of ordered) {
    if (replacement.start < cursor || replacement.end <= replacement.start)
      continue;
    parts.push(value.slice(cursor, replacement.start), replacement.text);
    cursor = replacement.end;
  }
  parts.push(value.slice(cursor));
  return parts.join("");
}
function quotedValueEnd(value, start) {
  const quote = value[start];
  if (quote !== '"' && quote !== "'")
    return null;
  for (let cursor = start + 1;cursor < value.length; cursor += 1) {
    if (value[cursor] === "\\") {
      cursor += 1;
    } else if (value[cursor] === quote) {
      return cursor;
    }
  }
  return null;
}
function firstUnencodedDelimiter(projected, start, delimiter) {
  let low = 0;
  let high = projected.entities.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((projected.entities[middle]?.projectedEnd ?? 0) <= start)
      low = middle + 1;
    else
      high = middle;
  }
  let entityIndex = low;
  for (let cursor = start;cursor < projected.text.length; cursor += 1) {
    while ((projected.entities[entityIndex]?.projectedEnd ?? Number.POSITIVE_INFINITY) <= cursor)
      entityIndex += 1;
    const entity = projected.entities[entityIndex];
    const insideEntity = entity !== undefined && cursor >= entity.projectedStart && cursor < entity.projectedEnd;
    if (!insideEntity && delimiter.test(projected.text[cursor] ?? ""))
      return cursor;
  }
  return projected.text.length;
}
function projectedBoundaryToSource(projected, offset, side) {
  let low = 0;
  let high = projected.entities.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((projected.entities[middle]?.projectedStart ?? Number.POSITIVE_INFINITY) <= offset)
      low = middle + 1;
    else
      high = middle;
  }
  const entity = projected.entities[low - 1];
  if (entity === undefined)
    return offset;
  if (side === "start" && offset < entity.projectedEnd)
    return entity.sourceStart;
  if (side === "end" && offset > entity.projectedStart && offset <= entity.projectedEnd)
    return entity.sourceEnd;
  if (offset >= entity.projectedEnd)
    return offset + entity.deltaAfter;
  return offset + (projected.entities[low - 2]?.deltaAfter ?? 0);
}
function credentialValueEnd(projected, start, key) {
  const quoteEnd = quotedValueEnd(projected.text, start);
  if (quoteEnd !== null)
    return { start: start + 1, end: quoteEnd };
  const normalizedKey = key.toLowerCase().replace(/_/g, "-");
  if (normalizedKey === "cookie" || normalizedKey === "set-cookie") {
    return { start, end: firstUnencodedDelimiter(projected, start, /[\r\n<]/) };
  }
  if (normalizedKey === "authorization" || normalizedKey === "proxy-authorization") {
    const schemeAtStart = /(?:basic|bearer)\s+/iy;
    schemeAtStart.lastIndex = start;
    const scheme = schemeAtStart.exec(projected.text);
    const secretStart = start + (scheme?.[0].length ?? 0);
    return { start, end: firstUnencodedDelimiter(projected, secretStart, /[\s<>&,"'\r\n]/) };
  }
  if (/(?:credential|pass(?:word|wd)?|private-key|secret)/i.test(normalizedKey)) {
    return { start, end: firstUnencodedDelimiter(projected, start, /[\r\n<]/) };
  }
  return { start, end: firstUnencodedDelimiter(projected, start, /[\s<>&;,)\]\r\n]/) };
}
function redactProjectedCredentialAssignments(value) {
  const projected = projectCredentialEntities(value);
  if (projected.limitExceeded)
    return { text: ENTITY_DENSE_REDACTION, count: 1 };
  const assignments = /(?<![a-z0-9_-])(?:(['"])([a-z_][a-z0-9_-]{0,127})\1|([a-z_][a-z0-9_-]{0,127}))\s*[:=]\s*/gi;
  const replacements = [];
  let match;
  while ((match = assignments.exec(projected.text)) !== null) {
    const key = match[2] ?? match[3] ?? "";
    if (!isCredentialAssignmentKey(key))
      continue;
    const valueStart = (match.index ?? 0) + match[0].length;
    const range = credentialValueEnd(projected, valueStart, key);
    if (range.end <= range.start)
      continue;
    const sourceStart = projectedBoundaryToSource(projected, range.start, "start");
    const sourceEnd = projectedBoundaryToSource(projected, range.end, "end");
    if (sourceEnd <= sourceStart)
      continue;
    if (replacements.length >= MAX_CREDENTIAL_REPLACEMENTS) {
      return { text: CREDENTIAL_DENSE_REDACTION, count: 1 };
    }
    replacements.push({ start: sourceStart, end: sourceEnd });
    assignments.lastIndex = Math.max(assignments.lastIndex, range.end);
  }
  return {
    text: applyTextReplacements(value, replacements.map((replacement) => ({ ...replacement, text: "[REDACTED]" }))),
    count: replacements.length
  };
}
function redactPemCredentialBlocks(value) {
  let count = 0;
  const label = "((?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY|PGP PRIVATE KEY BLOCK|(?:X509 |TRUSTED )?CERTIFICATE)";
  const pattern = new RegExp(`-----BEGIN ${label}-----[\\s\\S]*?(?:-----END \\1-----|$)`, "gi");
  const text = value.replace(pattern, () => {
    count += 1;
    return "[REDACTED_PEM_CREDENTIAL]";
  });
  return { text, count };
}
function redactCredentialText(value) {
  const pemBlocks = redactPemCredentialBlocks(value);
  const assignments = redactProjectedCredentialAssignments(pemBlocks.text);
  let count = pemBlocks.count + assignments.count;
  const replace = (replacement) => () => {
    count += 1;
    return replacement;
  };
  const text = assignments.text.replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, replace("[REDACTED JWT]")).replace(/\bAKIA[A-Z0-9]{16}\b/g, replace("[REDACTED ACCESS KEY]"));
  return { text, count };
}
function repeatedlyDecodeURIComponent(value) {
  let decoded = value;
  for (let pass = 0;pass < 5; pass += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      break;
    }
    if (next === decoded)
      break;
    decoded = next;
  }
  return decoded;
}
var directCredentialPathMarkerPattern = /^(?:magic[-_]?link|magic[-_]?token|one[-_]?time(?:[-_]?code|[-_]?token)?|password[-_]?reset|reset[-_]?password)$/i;
var contextualCredentialPathMarkerPattern = /^(?:code|key|nonce|otp|ticket|token)$/i;
var credentialPathContextPattern = /^(?:account|activate|activation|auth|callback|confirm|confirmation|invite|invitation|login|magic|oauth2?|password|recover|recovery|redeem|reset|signin|verify|verification)$/i;
function looksLikeCredentialPathValue(value) {
  if (value.length >= 20)
    return true;
  if (/^\d{4,}$/.test(value))
    return true;
  return value.length >= 6 && /[a-z]/i.test(value) && /\d/.test(value);
}
function sanitizeCredentialPath(url) {
  const segments = url.pathname.split("/");
  const decodedSegments = segments.map((segment) => repeatedlyDecodeURIComponent(segment));
  for (let index = 0;index < decodedSegments.length - 1; index += 1) {
    const marker = decodedSegments[index] ?? "";
    const credential = decodedSegments[index + 1] ?? "";
    if (credential === "")
      continue;
    const previous = decodedSegments[index - 1] ?? "";
    const isCredentialBoundary = directCredentialPathMarkerPattern.test(marker) || credentialPathContextPattern.test(marker) && looksLikeCredentialPathValue(credential) || contextualCredentialPathMarkerPattern.test(marker) && (credentialPathContextPattern.test(previous) || looksLikeCredentialPathValue(credential));
    if (!isCredentialBoundary)
      continue;
    url.pathname = `${segments.slice(0, index + 1).join("/")}/`;
    return 1;
  }
  return 0;
}
function sanitizeArtifactUrlWithCount(value) {
  if (value.length > MAX_ARTIFACT_URL_CODE_UNITS) {
    throw new Error("manifest URL exceeds the 65536 code-unit safety limit");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("manifest URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("manifest URL must use http or https");
  }
  let count = url.username === "" && url.password === "" ? 0 : 1;
  url.username = "";
  url.password = "";
  count += sanitizeCredentialPath(url);
  const entries = [];
  const valuesByKey = new Map;
  let queryLimitExceeded = false;
  for (const [key, queryValue] of url.searchParams) {
    if (entries.length >= MAX_ARTIFACT_URL_PARAMETERS) {
      queryLimitExceeded = true;
      break;
    }
    entries.push([key, queryValue]);
    const values = valuesByKey.get(key);
    if (values === undefined)
      valuesByKey.set(key, [queryValue]);
    else
      values.push(queryValue);
  }
  if (queryLimitExceeded) {
    url.search = "";
    count += 1;
  }
  const keys = queryLimitExceeded ? [] : [...valuesByKey.keys()];
  const decodedKeys = keys.map((key) => repeatedlyDecodeURIComponent(key));
  const hasAzureSignature = decodedKeys.some((key) => key.toLowerCase() === "sig") && decodedKeys.some((key) => /^(?:sv|sp|se|sr)$/i.test(key));
  const hasAuthenticationCredential = decodedKeys.some((key) => isCredentialAssignmentKey(key) || oneTimeCredentialKeyPattern.test(key) || isAuthenticationQueryKey(key));
  const removedKeys = new Set;
  for (const key of keys) {
    const values = valuesByKey.get(key) ?? [];
    const decodedKey = repeatedlyDecodeURIComponent(key);
    if (isCredentialAssignmentKey(decodedKey) || oneTimeCredentialKeyPattern.test(decodedKey) || isAuthenticationQueryKey(decodedKey) || normalizeCredentialKey(decodedKey) === "state" && hasAuthenticationCredential || providerSignatureKeyPattern.test(decodedKey) || hasAzureSignature && azureSasKeyPattern.test(decodedKey) || values.some((item) => {
      const decodedValue = repeatedlyDecodeURIComponent(item);
      return redactCredentialText(decodedValue).text !== decodedValue;
    })) {
      removedKeys.add(key);
      count += Math.max(1, values.length);
    }
  }
  if (removedKeys.size > 0) {
    const retained = new URLSearchParams;
    for (const [key, queryValue] of entries) {
      if (!removedKeys.has(key))
        retained.append(key, queryValue);
    }
    url.search = retained.toString();
  }
  const decodedHash = repeatedlyDecodeURIComponent(url.hash);
  const fragmentHasCredential = decodedHash.split(/[?&#;]/).some((segment) => {
    const equals = segment.indexOf("=");
    if (equals < 0)
      return false;
    const pathTail = segment.slice(0, equals).trim().split("/").at(-1) ?? "";
    const decodedKey = repeatedlyDecodeURIComponent(pathTail);
    return isCredentialAssignmentKey(decodedKey) || oneTimeCredentialKeyPattern.test(decodedKey) || isAuthenticationQueryKey(decodedKey) || providerSignatureKeyPattern.test(decodedKey);
  });
  if (fragmentHasCredential || redactCredentialText(decodedHash).text !== decodedHash) {
    url.hash = "";
    count += 1;
  }
  return { text: url.href, count };
}
function redactProjectedUrls(value) {
  const projected = projectCredentialEntities(value);
  if (projected.limitExceeded)
    return { text: ENTITY_DENSE_REDACTION, count: 1 };
  const replacements = [];
  let count = 0;
  let candidates = 0;
  const webUrl = /https?:\/\/[^\s<>"']+/gi;
  let match;
  while ((match = webUrl.exec(projected.text)) !== null) {
    candidates += 1;
    if (candidates > MAX_PROJECTED_URL_CANDIDATES || match[0].length > MAX_PROJECTED_URL_LENGTH) {
      return { text: URL_DENSE_REDACTION, count: 1 };
    }
    let urlText = match[0];
    while (/[),.!?;:]$/.test(urlText))
      urlText = urlText.slice(0, -1);
    try {
      const normalized = new URL(urlText).href;
      const sanitized = sanitizeArtifactUrlWithCount(urlText);
      if (sanitized.text === normalized)
        continue;
      const projectedStart = match.index ?? 0;
      const projectedEnd = projectedStart + urlText.length;
      const sourceStart = projectedBoundaryToSource(projected, projectedStart, "start");
      const sourceEnd = projectedBoundaryToSource(projected, projectedEnd, "end");
      if (sourceEnd <= sourceStart)
        continue;
      replacements.push({ start: sourceStart, end: sourceEnd, text: sanitized.text });
      count += Math.max(1, sanitized.count);
    } catch {}
  }
  return { text: applyTextReplacements(value, replacements), count };
}
function redactSensitiveTextWithCount(value) {
  const urls = redactProjectedUrls(value);
  const credentials = redactCredentialText(urls.text);
  return { text: credentials.text, count: urls.count + credentials.count };
}
function redactSensitiveText(value) {
  return redactSensitiveTextWithCount(value).text;
}
function sanitizeArtifactUrl(value) {
  return sanitizeArtifactUrlWithCount(value).text;
}
function sanitizeAssetUrl(value) {
  const url = new URL(sanitizeArtifactUrl(value));
  url.search = "";
  url.hash = "";
  return url.href;
}
function stripEvidenceReferenceControls(value) {
  let segmentStart = 0;
  let output = null;
  for (let index = 0;index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const unsafe = code <= 31 || code >= 127 && code <= 159 || code === 1564 || code === 8206 || code === 8207 || code >= 8234 && code <= 8238 || code >= 8294 && code <= 8297;
    if (!unsafe)
      continue;
    output ??= [];
    output.push(value.slice(segmentStart, index));
    segmentStart = index + 1;
  }
  if (output === null)
    return value;
  output.push(value.slice(segmentStart));
  return output.join("");
}
function sanitizeEvidenceReference(value) {
  if (value.length > 16 * 1024)
    return null;
  const trimmed = stripEvidenceReferenceControls(value.trim());
  if (trimmed === "" || /^(?:data|javascript|vbscript|file|blob):/i.test(trimmed))
    return null;
  try {
    const base = new URL("https://capture.invalid/");
    const parsed = new URL(trimmed, base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    const sanitized = new URL(sanitizeArtifactUrl(parsed.href));
    sanitized.search = "";
    sanitized.hash = "";
    if (sanitized.origin !== base.origin)
      return sanitized.href;
    return sanitized.pathname;
  } catch {
    return null;
  }
}
function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
var removedContentElements = new Set([
  "applet",
  "audio",
  "button",
  "datalist",
  "embed",
  "form",
  "frame",
  "frameset",
  "iframe",
  "math",
  "noscript",
  "object",
  "plaintext",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
  "xmp"
]);
var removedVoidElements = new Set(["base", "input", "link", "meta", "param", "source", "track"]);
var documentElements = new Set(["body", "head", "html"]);
var safeElements = new Set([
  "a",
  "abbr",
  "address",
  "article",
  "aside",
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
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "picture",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "section",
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
  "title",
  "tr",
  "u",
  "ul",
  "var",
  "wbr"
]);
var voidElements = new Set(["br", "col", "hr", "img", "wbr"]);
var safeAttributes = new Set([
  "alt",
  "class",
  "colspan",
  "datetime",
  "dir",
  "height",
  "headers",
  "id",
  "lang",
  "open",
  "role",
  "rowspan",
  "scope",
  "span",
  "start",
  "title",
  "width"
]);
var inertUrlAttributes = new Set(["cite", "href", "poster", "src"]);
function findTagEnd(html, start) {
  let quote = null;
  for (let cursor = start + 1;cursor < html.length; cursor += 1) {
    const character = html[cursor];
    if (quote !== null) {
      if (character === quote)
        quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return cursor;
    }
  }
  return -1;
}
function findRemovedElementEnd(html, start, tagName) {
  const closing = new RegExp(`<\\/\\s*${tagName}\\b`, "gi");
  closing.lastIndex = start;
  const match = closing.exec(html);
  if (match === null)
    return html.length;
  const end = findTagEnd(html, match.index);
  return end === -1 ? html.length : end + 1;
}
var MAX_EVIDENCE_TAG_LENGTH = 64 * 1024;
var MAX_EVIDENCE_ATTRIBUTES_PER_TAG = 512;
var MAX_EVIDENCE_STRUCTURAL_TOKENS = 50000;
var EVIDENCE_LIMIT_MARKER = "<p>[Source evidence omitted after a structural safety limit.]</p>";
function parseAttributes(tag, start) {
  const attributes = [];
  let cursor = start;
  while (cursor < tag.length && attributes.length < MAX_EVIDENCE_ATTRIBUTES_PER_TAG) {
    while (/\s/.test(tag[cursor] ?? ""))
      cursor += 1;
    if (cursor >= tag.length || tag[cursor] === "/" || tag[cursor] === ">")
      break;
    const nameStart = cursor;
    while (cursor < tag.length && !/[\s"'<>/=]/.test(tag[cursor] ?? ""))
      cursor += 1;
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }
    const name = tag.slice(nameStart, cursor).toLowerCase();
    while (/\s/.test(tag[cursor] ?? ""))
      cursor += 1;
    if (tag[cursor] !== "=") {
      attributes.push({ name, value: null });
      continue;
    }
    cursor += 1;
    while (/\s/.test(tag[cursor] ?? ""))
      cursor += 1;
    const quote = tag[cursor];
    if (quote === '"' || quote === "'") {
      cursor += 1;
      const valueStart = cursor;
      while (cursor < tag.length && tag[cursor] !== quote)
        cursor += 1;
      attributes.push({ name, value: tag.slice(valueStart, cursor) });
      if (tag[cursor] === quote)
        cursor += 1;
    } else {
      const valueStart = cursor;
      while (cursor < tag.length && !/[\s>]/.test(tag[cursor] ?? ""))
        cursor += 1;
      attributes.push({ name, value: tag.slice(valueStart, cursor) });
    }
  }
  return attributes;
}
function sanitizedAttributes(tag, nameEnd) {
  const output = [];
  for (const attribute of parseAttributes(tag, nameEnd)) {
    if (attribute.name.startsWith("on") || attribute.name === "style" || secretKeyPattern.test(attribute.name))
      continue;
    if (inertUrlAttributes.has(attribute.name)) {
      if (attribute.value === null)
        continue;
      const reference = sanitizeEvidenceReference(attribute.value);
      if (reference !== null) {
        output.push(`data-captured-${attribute.name}="${escapeAttribute(reference)}"`);
      }
      continue;
    }
    if (!safeAttributes.has(attribute.name) && !attribute.name.startsWith("aria-"))
      continue;
    if (attribute.value === null) {
      output.push(attribute.name);
      continue;
    }
    output.push(`${attribute.name}="${escapeAttribute(redactSensitiveText(attribute.value))}"`);
  }
  return output.length === 0 ? "" : ` ${output.join(" ")}`;
}
function sanitizeSourceHtml(html) {
  const output = [];
  let cursor = 0;
  let structuralTokens = 0;
  while (cursor < html.length) {
    const opening = html.indexOf("<", cursor);
    if (opening === -1) {
      output.push(redactSensitiveText(html.slice(cursor)));
      break;
    }
    output.push(redactSensitiveText(html.slice(cursor, opening)));
    structuralTokens += 1;
    if (structuralTokens > MAX_EVIDENCE_STRUCTURAL_TOKENS) {
      output.push(EVIDENCE_LIMIT_MARKER);
      break;
    }
    if (html.startsWith("<!--", opening)) {
      const commentEnd = html.indexOf("-->", opening + 4);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }
    const tagEnd = findTagEnd(html, opening);
    if (tagEnd === -1) {
      if (html.length - opening > MAX_EVIDENCE_TAG_LENGTH)
        output.push(EVIDENCE_LIMIT_MARKER);
      else
        output.push("&lt;", redactSensitiveText(html.slice(opening + 1)));
      break;
    }
    if (tagEnd - opening + 1 > MAX_EVIDENCE_TAG_LENGTH) {
      output.push(EVIDENCE_LIMIT_MARKER);
      cursor = tagEnd + 1;
      continue;
    }
    const tag = html.slice(opening, tagEnd + 1);
    const nameMatch = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(tag);
    if (nameMatch === null) {
      cursor = tagEnd + 1;
      continue;
    }
    const closing = nameMatch[1] === "/";
    const name = (nameMatch[2] ?? "").toLowerCase();
    const nameEnd = nameMatch[0].length;
    if (removedContentElements.has(name)) {
      cursor = closing || /\/\s*>$/.test(tag) ? tagEnd + 1 : findRemovedElementEnd(html, tagEnd + 1, name);
      continue;
    }
    if (removedVoidElements.has(name) || documentElements.has(name) || !safeElements.has(name)) {
      cursor = tagEnd + 1;
      continue;
    }
    if (closing) {
      if (!voidElements.has(name))
        output.push(`</${name}>`);
    } else {
      output.push(`<${name}${sanitizedAttributes(tag, nameEnd)}>`);
    }
    cursor = tagEnd + 1;
  }
  const csp = "default-src 'none'; img-src 'none'; media-src 'none'; style-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return ensureTrailingNewline(sanitizeTerminalText(`<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"></head><body><main data-captured-source="true">${output.join("")}</main></body></html>`));
}
function requireManifestToken(value, label) {
  if (!safeManifestTokenPattern.test(value))
    throw new Error(`${label} is not a safe manifest token`);
  return value;
}
function requireFiniteNumber(value, label) {
  if (!Number.isFinite(value))
    throw new Error(`${label} must be a finite number`);
  return value;
}
function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}
function sanitizeArtifactPath(value, label) {
  if (value === "" || value.includes("\\") || value.includes("\x00") || isAbsolute(value) || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a confined relative artifact path`);
  }
  return value;
}
function sanitizeContentType(value) {
  if (value === null)
    return null;
  const [rawMimeType, ...parameters] = value.split(";");
  const mimeType = rawMimeType?.trim().toLowerCase();
  if (mimeType === undefined || !safeArtifactMimePattern.test(mimeType))
    return null;
  const charset = parameters.map((parameter) => /^\s*charset\s*=\s*["']?([a-z0-9._-]+)["']?\s*$/i.exec(parameter)?.[1]).find((candidate) => candidate !== undefined);
  return charset === undefined ? mimeType : `${mimeType}; charset=${charset.toLowerCase()}`;
}
function requireListedValue(value, allowed, label) {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined)
    throw new Error(`${label} is invalid`);
  return match;
}
function normalizeManifest(input, hasSourceHtml) {
  const capturedAtTime = Date.parse(input.capturedAt);
  if (!Number.isFinite(capturedAtTime))
    throw new Error("capturedAt must be an ISO-compatible timestamp");
  const assets = input.assets.map((asset, index) => {
    if (!safeArtifactMimePattern.test(asset.mimeType))
      throw new Error(`assets[${index}].mimeType is invalid`);
    if (!/^[a-f0-9]{64}$/i.test(asset.sha256))
      throw new Error(`assets[${index}].sha256 must be a SHA-256 digest`);
    return {
      source: (() => {
        try {
          return sanitizeAssetUrl(asset.source);
        } catch {
          return sanitizeEvidenceReference(asset.source) ?? redactSensitiveText(asset.source);
        }
      })(),
      url: sanitizeAssetUrl(asset.url),
      path: sanitizeArtifactPath(asset.path, `assets[${index}].path`),
      mimeType: asset.mimeType.toLowerCase(),
      bytes: requireNonNegativeInteger(asset.bytes, `assets[${index}].bytes`),
      sha256: asset.sha256.toLowerCase()
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const screenshotPath = input.evidence.screenshotPath === null ? null : sanitizeArtifactPath(input.evidence.screenshotPath, "evidence.screenshotPath");
  if (input.artifacts.images.requested === (input.artifacts.images.status === "not-requested")) {
    throw new Error("artifacts.images requested/status fields disagree");
  }
  if (input.artifacts.media.requested === (input.artifacts.media.status === "not-requested")) {
    throw new Error("artifacts.media requested/status fields disagree");
  }
  if (!input.artifacts.images.requested && input.artifacts.images.files !== 0) {
    throw new Error("artifacts.images cannot record files when not requested");
  }
  if (!input.artifacts.media.requested && input.artifacts.media.files !== 0) {
    throw new Error("artifacts.media cannot record files when not requested");
  }
  const screenshotRequested = input.evidence.requested === "screenshot" || input.evidence.requested === "all";
  const sourceRequested = input.evidence.requested === "source" || input.evidence.requested === "all";
  if (screenshotRequested === (input.evidence.screenshotStatus === "not-requested")) {
    throw new Error("evidence screenshot requested/status fields disagree");
  }
  if (input.evidence.screenshotStatus === "captured" !== (screenshotPath !== null)) {
    throw new Error("evidence screenshot status/path fields disagree");
  }
  if (sourceRequested === (input.evidence.sourceHtmlStatus === "not-requested")) {
    throw new Error("evidence source requested/status fields disagree");
  }
  if (input.evidence.sourceHtmlStatus === "captured" !== hasSourceHtml) {
    throw new Error("evidence source status/file fields disagree");
  }
  return {
    schemaVersion: CAPTURE_MANIFEST_SCHEMA_VERSION,
    sourceUrl: sanitizeArtifactUrl(input.sourceUrl),
    canonicalUrl: sanitizeArtifactUrl(input.canonicalUrl),
    capturedAt: new Date(capturedAtTime).toISOString(),
    platform: requireManifestToken(input.platform, "platform"),
    status: requireManifestToken(input.status, "status"),
    scope: requireManifestToken(input.scope, "scope"),
    acquisition: {
      method: requireManifestToken(input.acquisition.method, "acquisition.method"),
      finalUrl: sanitizeArtifactUrl(input.acquisition.finalUrl),
      contentType: sanitizeContentType(input.acquisition.contentType)
    },
    extraction: {
      extractor: redactSensitiveText(input.extraction.extractor),
      score: requireFiniteNumber(input.extraction.score, "extraction.score"),
      wordCount: requireNonNegativeInteger(input.extraction.wordCount, "extraction.wordCount"),
      capturedItems: requireNonNegativeInteger(input.extraction.capturedItems, "extraction.capturedItems"),
      expectedItems: input.extraction.expectedItems === null ? null : requireNonNegativeInteger(input.extraction.expectedItems, "extraction.expectedItems")
    },
    attempts: input.attempts.map((attempt) => ({
      method: requireManifestToken(attempt.method, "attempts.method"),
      outcome: requireManifestToken(attempt.outcome, "attempts.outcome"),
      message: redactSensitiveText(attempt.message).replace(/[\r\n]+/g, " ").slice(0, 1000)
    })),
    assets,
    artifacts: {
      images: {
        requested: input.artifacts.images.requested,
        status: requireListedValue(input.artifacts.images.status, ["not-requested", "captured", "partial"], "artifacts.images.status"),
        files: requireNonNegativeInteger(input.artifacts.images.files, "artifacts.images.files")
      },
      media: {
        requested: input.artifacts.media.requested,
        status: requireListedValue(input.artifacts.media.status, ["not-requested", "captured", "partial", "unavailable", "unsupported", "failed"], "artifacts.media.status"),
        files: requireNonNegativeInteger(input.artifacts.media.files, "artifacts.media.files")
      }
    },
    evidence: {
      requested: requireListedValue(input.evidence.requested, ["none", "source", "screenshot", "all"], "evidence.requested"),
      screenshotPath,
      screenshotStatus: requireListedValue(input.evidence.screenshotStatus, ["not-requested", "captured", "unavailable"], "evidence.screenshotStatus"),
      sourceHtmlStatus: requireListedValue(input.evidence.sourceHtmlStatus, ["not-requested", "captured", "unavailable"], "evidence.sourceHtmlStatus"),
      sourceHtmlPath: hasSourceHtml ? CAPTURE_SOURCE_EVIDENCE_PATH : null
    },
    warnings: input.warnings.map(redactSensitiveText)
  };
}
function removeOwnedStaging(transaction) {
  assertConfinedChild(transaction.outputRoot, transaction.stagingDirectory, "capture staging directory");
  if (existsSync(transaction.stagingDirectory)) {
    rmSync(transaction.stagingDirectory, { recursive: true, force: true });
  }
}
function writeCaptureBundle(transaction, input) {
  requireState(transaction, "open");
  try {
    const manifest = normalizeManifest(input.manifest, input.sourceHtml !== undefined);
    writeFileSync(join(transaction.stagingDirectory, captureMarkdownFilename(transaction.slug)), ensureTrailingNewline(redactSensitiveText(input.markdown)), { encoding: "utf8", flag: "wx", mode: 420 });
    writeFileSync(join(transaction.stagingDirectory, CAPTURE_MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}
`, { encoding: "utf8", flag: "wx", mode: 420 });
    if (input.sourceHtml !== undefined) {
      const evidenceDirectory = join(transaction.stagingDirectory, dirname(CAPTURE_SOURCE_EVIDENCE_PATH));
      mkdirSync(evidenceDirectory, { recursive: true, mode: 448 });
      chmodSync(evidenceDirectory, 448);
      const evidencePath = join(transaction.stagingDirectory, CAPTURE_SOURCE_EVIDENCE_PATH);
      writeFileSync(evidencePath, sanitizeSourceHtml(input.sourceHtml), {
        encoding: "utf8",
        flag: "wx",
        mode: 384
      });
      chmodSync(evidencePath, 384);
    }
    transaction[transactionState] = "written";
    return manifest;
  } catch (error) {
    removeOwnedStaging(transaction);
    transaction[transactionState] = "aborted";
    throw error;
  }
}
function assertStagingTreeSafe(root, directory = root) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assertConfinedChild(root, path, "staged artifact");
    const stats = lstatSync(path);
    if (stats.isSymbolicLink())
      throw new Error(`staged artifact must not be a symbolic link: ${path}`);
    if (stats.isDirectory())
      assertStagingTreeSafe(root, path);
    else if (!stats.isFile())
      throw new Error(`staged artifact must be a regular file: ${path}`);
  }
}
function unusedBackupPath(outputRoot) {
  for (;; ) {
    const candidate = join(outputRoot, `.capture-backup-${crypto.randomUUID()}`);
    assertConfinedChild(outputRoot, candidate, "capture backup");
    if (!existsSync(candidate))
      return candidate;
  }
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function commitCaptureBundle(transaction, hooks = {}) {
  requireState(transaction, "written");
  assertStagingTreeSafe(transaction.stagingDirectory);
  const targetExists = existsSync(transaction.targetDirectory);
  if (targetExists && !transaction.force) {
    throw new Error(`capture already exists: ${transaction.targetDirectory}; pass --force to replace it`);
  }
  if (targetExists !== (transaction.expectedTargetIdentity !== null)) {
    throw new Error(`capture target changed during the transaction: ${transaction.targetDirectory}`);
  }
  if (targetExists) {
    const currentIdentity = ownedTargetIdentity(transaction.targetDirectory, transaction.slug);
    if (currentIdentity.device !== transaction.expectedTargetIdentity?.device || currentIdentity.inode !== transaction.expectedTargetIdentity.inode) {
      throw new Error(`capture target changed during the transaction: ${transaction.targetDirectory}`);
    }
  }
  const backupDirectory = targetExists ? unusedBackupPath(transaction.outputRoot) : null;
  let installed = false;
  let backedUp = false;
  try {
    if (backupDirectory !== null) {
      renameSync(transaction.targetDirectory, backupDirectory);
      backedUp = true;
      hooks.afterBackup?.();
    }
    renameSync(transaction.stagingDirectory, transaction.targetDirectory);
    installed = true;
    hooks.afterInstall?.();
    transaction[transactionState] = "committed";
    if (backupDirectory !== null)
      rmSync(backupDirectory, { recursive: true, force: true });
    return transaction.targetDirectory;
  } catch (error) {
    let rollbackError;
    try {
      if (installed && existsSync(transaction.targetDirectory)) {
        rmSync(transaction.targetDirectory, { recursive: true, force: true });
      }
      if (backedUp && backupDirectory !== null && existsSync(backupDirectory)) {
        if (existsSync(transaction.targetDirectory)) {
          throw new Error(`cannot restore backup because target was recreated: ${transaction.targetDirectory}`);
        }
        renameSync(backupDirectory, transaction.targetDirectory);
      }
    } catch (caught) {
      rollbackError = caught;
    }
    transaction[transactionState] = existsSync(transaction.stagingDirectory) ? "written" : "aborted";
    if (rollbackError !== undefined) {
      const recovery = backupDirectory === null ? "none" : backupDirectory;
      throw new Error(`capture commit failed (${errorMessage(error)}) and rollback failed (${errorMessage(rollbackError)}); recovery backup: ${recovery}`, { cause: error });
    }
    throw error;
  }
}
function abortCaptureBundle(transaction) {
  if (transaction[transactionState] === "committed" || transaction[transactionState] === "aborted")
    return;
  removeOwnedStaging(transaction);
  transaction[transactionState] = "aborted";
}

export { CAPTURE_MANIFEST_SCHEMA_VERSION, CAPTURE_MANIFEST_FILENAME, CAPTURE_SOURCE_EVIDENCE_PATH, captureMarkdownFilename, beginCaptureBundle, redactSensitiveTextWithCount, redactSensitiveText, sanitizeArtifactUrl, sanitizeSourceHtml, writeCaptureBundle, commitCaptureBundle, abortCaptureBundle };
