// @bun
// src/clip/terminal.ts
var ESCAPE = 27;
var BELL = 7;
var STRING_TERMINATOR = 156;
var MAX_PENDING_LENGTH = 64 * 1024;
var MAX_PENDING_SEGMENTS = 4096;
function chunkBuilder() {
  const chunks = [];
  let pending = [];
  let pendingLength = 0;
  const flush = () => {
    if (pending.length === 0)
      return;
    chunks.push(pending.join(""));
    pending = [];
    pendingLength = 0;
  };
  return {
    append: (value) => {
      if (value === "")
        return;
      if (value.length >= MAX_PENDING_LENGTH) {
        flush();
        chunks.push(value);
        return;
      }
      pending.push(value);
      pendingLength += value.length;
      if (pendingLength >= MAX_PENDING_LENGTH || pending.length >= MAX_PENDING_SEGMENTS)
        flush();
    },
    finish: () => {
      flush();
      if (chunks.length === 0)
        return "";
      if (chunks.length === 1)
        return chunks[0] ?? "";
      return chunks.join("");
    }
  };
}
function isEscapeStringIntroducer(code) {
  return code === 80 || code === 88 || code === 93 || code === 94 || code === 95;
}
function isC1StringIntroducer(code) {
  return code === 144 || code === 152 || code === 157 || code === 158 || code === 159;
}
function controlStringEnd(value, start) {
  for (let cursor = start;cursor < value.length; cursor += 1) {
    const code = value.charCodeAt(cursor);
    if (code === BELL || code === STRING_TERMINATOR)
      return cursor + 1;
    if (code === ESCAPE && value.charCodeAt(cursor + 1) === 92)
      return cursor + 2;
  }
  return value.length;
}
function controlSequenceEnd(value, start) {
  for (let cursor = start;cursor < value.length; cursor += 1) {
    const code = value.charCodeAt(cursor);
    if (code >= 64 && code <= 126)
      return cursor + 1;
  }
  return value.length;
}
function escapeSequenceEnd(value, start) {
  const introducer = value.charCodeAt(start + 1);
  if (Number.isNaN(introducer))
    return start + 1;
  if (introducer === 91)
    return controlSequenceEnd(value, start + 2);
  if (isEscapeStringIntroducer(introducer)) {
    return controlStringEnd(value, start + 2);
  }
  let cursor = start + 1;
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code >= 32 && code <= 47) {
      cursor += 1;
      continue;
    }
    return code >= 48 && code <= 126 ? cursor + 1 : start + 1;
  }
  return value.length;
}
function isBidiFormatControl(code) {
  return code === 1564 || code === 8206 || code === 8207 || code >= 8234 && code <= 8238 || code >= 8294 && code <= 8297;
}
function sanitizeTerminalText(value) {
  let builder = null;
  let unchangedStart = 0;
  const replace = (start, end, replacement = "") => {
    builder ??= chunkBuilder();
    builder.append(value.slice(unchangedStart, start));
    builder.append(replacement);
    unchangedStart = end;
  };
  for (let cursor = 0;cursor < value.length; ) {
    const code = value.charCodeAt(cursor);
    if (code === ESCAPE) {
      const end = escapeSequenceEnd(value, cursor);
      replace(cursor, end);
      cursor = end;
      continue;
    }
    if (code === 155) {
      const end = controlSequenceEnd(value, cursor + 1);
      replace(cursor, end);
      cursor = end;
      continue;
    }
    if (isC1StringIntroducer(code)) {
      const end = controlStringEnd(value, cursor + 1);
      replace(cursor, end);
      cursor = end;
      continue;
    }
    if (code === 13) {
      const end = value.charCodeAt(cursor + 1) === 10 ? cursor + 2 : cursor + 1;
      replace(cursor, end, `
`);
      cursor = end;
      continue;
    }
    if (code === 10) {
      cursor += 1;
      continue;
    }
    if (code === 8232 || code === 8233) {
      replace(cursor, cursor + 1, `
`);
      cursor += 1;
      continue;
    }
    if (code === 9) {
      replace(cursor, cursor + 1, "    ");
      cursor += 1;
      continue;
    }
    if (code <= 31 || code >= 127 && code <= 159 || isBidiFormatControl(code)) {
      replace(cursor, cursor + 1);
      cursor += 1;
      continue;
    }
    cursor += 1;
  }
  const completedBuilder = builder;
  if (completedBuilder === null)
    return value;
  completedBuilder.append(value.slice(unchangedStart));
  return completedBuilder.finish();
}
function sanitizeTerminalLine(value) {
  return sanitizeTerminalText(value).replace(/\n/g, " ");
}

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

// src/clip/capture.ts
import {
  chmodSync as chmodSync4,
  copyFileSync,
  existsSync as existsSync5,
  mkdirSync as mkdirSync4,
  mkdtempSync as mkdtempSync4,
  readFileSync as readFileSync5,
  rmSync as rmSync4,
  statSync as statSync3
} from "fs";
import { tmpdir as tmpdir3 } from "os";
import { join as join6 } from "path";

// src/clip/acquire.ts
import {
  chmodSync as chmodSync2,
  existsSync as existsSync3,
  lstatSync as lstatSync2,
  mkdtempSync as mkdtempSync2,
  readFileSync as readFileSync3,
  realpathSync as realpathSync2,
  rmSync as rmSync2,
  statSync,
  writeFileSync as writeFileSync2
} from "fs";
import { homedir as homedir2, tmpdir } from "os";
import { basename, dirname as dirname3, isAbsolute as isAbsolute2, join as join3, relative as relative2, resolve as resolve4, sep as sep2 } from "path";
import { getCookies } from "@steipete/sweet-cookie";

// src/clip/bounded-byte-buffer.ts
class BoundedByteBuffer {
  #maxBytes;
  #storage = new Uint8Array;
  #length = 0;
  constructor(maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new RangeError("byte buffer limit must be a non-negative safe integer");
    }
    this.#maxBytes = maxBytes;
  }
  get byteLength() {
    return this.#length;
  }
  append(chunk) {
    if (chunk.byteLength > this.#maxBytes - this.#length)
      return false;
    if (chunk.byteLength === 0)
      return true;
    const required = this.#length + chunk.byteLength;
    if (required > this.#storage.byteLength)
      this.#grow(required);
    this.#storage.set(chunk, this.#length);
    this.#length = required;
    return true;
  }
  toUint8Array() {
    if (this.#length === this.#storage.byteLength)
      return this.#storage;
    return this.#storage.slice(0, this.#length);
  }
  #grow(required) {
    let capacity = this.#storage.byteLength;
    if (capacity === 0)
      capacity = Math.min(this.#maxBytes, Math.max(1024, required));
    while (capacity < required) {
      capacity = capacity <= Math.floor(this.#maxBytes / 2) ? capacity * 2 : this.#maxBytes;
    }
    const grown = new Uint8Array(capacity);
    grown.set(this.#storage.subarray(0, this.#length));
    this.#storage = grown;
  }
}

// src/clip/cookies.ts
import { closeSync, constants, fstatSync, openSync, readSync } from "fs";
import { resolve as resolve2 } from "path";
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
    const absolute = resolve2(path);
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

// src/clip/network.ts
import { lookup } from "dns/promises";
import {
  request as requestHttp
} from "http";
import { request as requestHttps } from "https";
import { isIP } from "net";
import { networkInterfaces } from "os";
class FetchFailure extends Error {
  code;
  constructor(code, message, options) {
    super(message, options);
    this.name = "FetchFailure";
    this.code = code;
  }
}
var privateHostnameSuffixes = [".localhost", ".local", ".internal", ".home", ".lan"];
function normalizeHostname(hostname) {
  const withoutBrackets = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return withoutBrackets.toLowerCase().replace(/\.$/, "");
}
function parseIpv4(address) {
  const pieces = address.split(".");
  if (pieces.length !== 4)
    return null;
  const numbers = pieces.map((piece) => Number(piece));
  return numbers.every((piece) => Number.isInteger(piece) && piece >= 0 && piece <= 255) ? numbers : null;
}
function parseIpv6(address) {
  let value = address;
  const ipv4Separator = value.lastIndexOf(":");
  const ipv4Tail = ipv4Separator >= 0 ? value.slice(ipv4Separator + 1) : value;
  if (ipv4Tail.includes(".")) {
    const ipv4 = parseIpv4(ipv4Tail);
    if (ipv4 === null || ipv4Separator < 0)
      return null;
    const high = (ipv4[0] ?? 0) << 8 | (ipv4[1] ?? 0);
    const low = (ipv4[2] ?? 0) << 8 | (ipv4[3] ?? 0);
    value = `${value.slice(0, ipv4Separator)}:${high.toString(16)}:${low.toString(16)}`;
  }
  const compression = value.indexOf("::");
  if (compression !== -1 && compression !== value.lastIndexOf("::"))
    return null;
  const leftText = compression === -1 ? value : value.slice(0, compression);
  const rightText = compression === -1 ? "" : value.slice(compression + 2);
  const left = leftText === "" ? [] : leftText.split(":");
  const right = rightText === "" ? [] : rightText.split(":");
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/i.test(part)))
    return null;
  const missing = 8 - left.length - right.length;
  if (compression === -1 && missing !== 0 || compression !== -1 && missing < 1)
    return null;
  const groups = [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: Math.max(0, missing) }, () => 0),
    ...right.map((part) => Number.parseInt(part, 16))
  ];
  return groups.length === 8 ? groups : null;
}
function addressWithoutScope(address) {
  const normalized = normalizeHostname(address);
  const scope = normalized.indexOf("%");
  return scope === -1 ? normalized : normalized.slice(0, scope);
}
function comparableAddressKeys(address) {
  const normalized = addressWithoutScope(address);
  const version = isIP(normalized);
  if (version === 4) {
    const pieces = parseIpv4(normalized);
    return pieces === null ? [] : [`4:${pieces.join(".")}`];
  }
  if (version !== 6)
    return [];
  const groups = parseIpv6(normalized);
  if (groups === null)
    return [];
  const keys = [`6:${groups.map((group) => group.toString(16).padStart(4, "0")).join(":")}`];
  const ipv4Compatible = groups.slice(0, 6).every((group) => group === 0);
  const ipv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 65535;
  if (ipv4Compatible || ipv4Mapped) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    keys.push(`4:${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
  }
  return keys;
}
function systemLocalNetworkAddresses() {
  let interfaces;
  try {
    interfaces = networkInterfaces();
  } catch (error) {
    throw new FetchFailure("network", "could not inspect local network interfaces", { cause: error });
  }
  const addresses = [];
  for (const records of Object.values(interfaces)) {
    if (!Array.isArray(records))
      continue;
    for (const record of records) {
      if (typeof record?.address === "string")
        addresses.push(record.address);
    }
  }
  return addresses;
}
function localAddressKeys(provider) {
  let addresses;
  try {
    addresses = provider();
  } catch (error) {
    if (error instanceof FetchFailure)
      throw error;
    throw new FetchFailure("network", "could not inspect local network interfaces", { cause: error });
  }
  const keys = new Set;
  for (const address of addresses) {
    for (const key of comparableAddressKeys(address))
      keys.add(key);
  }
  return keys;
}
function isAssignedLocalAddress(address, localKeys) {
  return comparableAddressKeys(address).some((key) => localKeys.has(key));
}
function isPrivateAddress(address) {
  const normalized = addressWithoutScope(address);
  const version = isIP(normalized);
  if (version === 4) {
    const pieces = parseIpv4(normalized);
    if (pieces === null)
      return true;
    const a = pieces[0] ?? 0;
    const b = pieces[1] ?? 0;
    return a === 0 || a === 10 || a === 127 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 0 || b === 168) || a === 192 && b === 0 && (pieces[2] ?? 0) === 2 || a === 198 && (b === 18 || b === 19) || a === 198 && b === 51 && (pieces[2] ?? 0) === 100 || a === 203 && b === 0 && (pieces[2] ?? 0) === 113 || a >= 224;
  }
  if (version === 6) {
    const groups = parseIpv6(normalized);
    if (groups === null)
      return true;
    const first = groups[0] ?? 0;
    const second = groups[1] ?? 0;
    const firstSixAreZero = groups.slice(0, 6).every((group) => group === 0);
    const ipv4Compatible = firstSixAreZero;
    const ipv4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 65535;
    if (ipv4Compatible || ipv4Mapped) {
      const high = groups[6] ?? 0;
      const low = groups[7] ?? 0;
      return isPrivateAddress(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
    }
    return (first & 65024) === 64512 || (first & 65472) === 65152 || (first & 65472) === 65216 || (first & 65280) === 65280 || first === 100 || first === 256 || first === 8193 && !Number.isNaN(second) && second <= 511 || first === 8193 && second === 3512 || first === 8194 || first === 16382 || first === 16383 && !Number.isNaN(second) && (second & 61440) === 0 || first === 24320;
  }
  return true;
}
function isPrivateHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  if (normalized === "localhost" || normalized === "localhost.localdomain")
    return true;
  if (privateHostnameSuffixes.some((suffix) => normalized.endsWith(suffix)))
    return true;
  return isIP(normalized) !== 0 && isPrivateAddress(normalized);
}
async function systemResolveHostname(hostname) {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.flatMap((answer) => answer.family === 4 || answer.family === 6 ? [{ address: answer.address, family: answer.family }] : []);
}
async function beforeDeadline(promise, deadline, timeoutMessage) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0)
    throw new FetchFailure("timeout", timeoutMessage);
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new FetchFailure("timeout", timeoutMessage)), remainingMs);
      })
    ]);
  } finally {
    if (timeout !== undefined)
      clearTimeout(timeout);
  }
}
async function resolveNetworkTarget(url, allowPrivateNetwork, resolveHostname, getLocalNetworkAddresses, deadline, timeoutMs) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchFailure("invalid-url", `unsupported URL protocol: ${url.protocol}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new FetchFailure("invalid-url", "credential-bearing URLs are not accepted; use a local cookie file or browser session");
  }
  const hostname = normalizeHostname(url.hostname);
  if (!allowPrivateNetwork && isPrivateHostname(hostname)) {
    throw new FetchFailure("private-network", `private-network URL requires --allow-private-network: ${url.origin}`);
  }
  const assignedLocalAddresses = allowPrivateNetwork ? new Set : localAddressKeys(getLocalNetworkAddresses);
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    if (isAssignedLocalAddress(hostname, assignedLocalAddresses)) {
      throw new FetchFailure("private-network", `address ${hostname} is assigned to a local interface; use --allow-private-network only when intended`);
    }
    return [{ address: hostname, family: literalFamily }];
  }
  let answers;
  try {
    answers = await beforeDeadline(resolveHostname(hostname), deadline, `request timed out after ${timeoutMs}ms while resolving ${hostname}`);
  } catch (error) {
    if (error instanceof FetchFailure)
      throw error;
    throw new FetchFailure("dns", `could not resolve ${hostname}`, { cause: error });
  }
  if (answers.length === 0)
    throw new FetchFailure("dns", `could not resolve ${hostname}`);
  if (!allowPrivateNetwork) {
    for (const key of localAddressKeys(getLocalNetworkAddresses))
      assignedLocalAddresses.add(key);
  }
  const unique = new Map;
  for (const answer of answers) {
    const address = normalizeHostname(answer.address);
    const actualFamily = isIP(address);
    if (actualFamily !== 4 && actualFamily !== 6 || actualFamily !== answer.family) {
      throw new FetchFailure("dns", `${hostname} returned an invalid DNS answer`);
    }
    if (!allowPrivateNetwork && isPrivateAddress(address)) {
      throw new FetchFailure("private-network", `${hostname} resolves to private or reserved address ${address}; use --allow-private-network only when intended`);
    }
    if (!allowPrivateNetwork && isAssignedLocalAddress(address, assignedLocalAddresses)) {
      throw new FetchFailure("private-network", `${hostname} resolves to an address assigned to a local interface; use --allow-private-network only when intended`);
    }
    unique.set(`${answer.family}:${address}`, { address, family: answer.family });
  }
  return [...unique.values()];
}
async function resolveSafeNetworkTarget(url, options) {
  const timeoutMs = options.timeoutMs ?? 30000;
  return await resolveNetworkTarget(url, options.allowPrivateNetwork, options.resolveHostname ?? systemResolveHostname, options.getLocalNetworkAddresses ?? systemLocalNetworkAddresses, Date.now() + timeoutMs, timeoutMs);
}
async function assertSafeNetworkUrl(url, allowPrivateNetwork, timeoutMs = 30000) {
  await resolveSafeNetworkTarget(url, { allowPrivateNetwork, timeoutMs });
}
function createPinnedLookup(pinned) {
  const address = pinned.address;
  const family = pinned.family;
  return (_hostname, options, callback) => {
    queueMicrotask(() => {
      if (options.all === true) {
        callback(null, [{ address, family }]);
        return;
      }
      callback(null, address, family);
    });
  };
}
function responseHeaders(headers) {
  const result = new Headers;
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string")
      result.append(name, value);
    else if (Array.isArray(value)) {
      for (const item of value)
        result.append(name, item);
    }
  }
  return result;
}
function requestHeaders(headers) {
  const result = {};
  headers.forEach((value, name) => {
    result[name] = value;
  });
  return result;
}
function nodeTransport(request) {
  const hostname = normalizeHostname(request.url.hostname);
  const requestOptions = {
    protocol: request.url.protocol,
    hostname,
    method: "GET",
    path: `${request.url.pathname}${request.url.search}`,
    headers: requestHeaders(request.headers),
    lookup: createPinnedLookup(request.address),
    family: request.address.family,
    agent: false,
    signal: request.signal,
    ...request.url.port === "" ? {} : { port: request.url.port }
  };
  return new Promise((resolve3, reject) => {
    const onResponse = (response) => {
      if (response.statusCode === undefined) {
        response.destroy();
        reject(new Error("HTTP response omitted a status code"));
        return;
      }
      resolve3({
        status: response.statusCode,
        headers: responseHeaders(response.headers),
        body: response,
        cancel: () => response.destroy()
      });
    };
    const clientRequest = request.url.protocol === "https:" ? requestHttps({
      ...requestOptions,
      ...isIP(hostname) === 0 ? { servername: hostname } : {}
    }, onResponse) : requestHttp(requestOptions, onResponse);
    clientRequest.once("error", reject);
    clientRequest.end();
  });
}
function retryDelay(response, attempt) {
  const header = response?.headers.get("retry-after")?.trim();
  if (header !== undefined && header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.min(seconds * 1000, 5000);
    const date = Date.parse(header);
    if (!Number.isNaN(date))
      return Math.min(Math.max(date - Date.now(), 0), 5000);
  }
  return Math.min(250 * 2 ** attempt, 2000);
}
var retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
async function readBounded(response, maxBytes) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) {
      response.cancel();
      throw new FetchFailure("too-large", `response declares ${length} bytes; limit is ${maxBytes}`);
    }
  }
  if (response.body === null)
    return new Uint8Array;
  const bytes = new BoundedByteBuffer(maxBytes);
  for await (const value of response.body) {
    if (!(value instanceof Uint8Array)) {
      response.cancel();
      throw new FetchFailure("network", "response body yielded a non-byte chunk");
    }
    if (!bytes.append(value)) {
      response.cancel();
      throw new FetchFailure("too-large", `response exceeded ${maxBytes} bytes`);
    }
  }
  return bytes.toUint8Array();
}
function buildHeaders(current, originalUrl, options) {
  const headers = new Headers({
    Accept: options.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    "Accept-Encoding": "identity",
    "User-Agent": options.userAgent
  });
  if (options.referer !== undefined) {
    try {
      const referer = new URL(options.referer);
      headers.set("Referer", referer.origin === current.origin ? referer.href : `${referer.origin}/`);
    } catch {}
  }
  if (options.cookieHeader !== undefined && current.href === originalUrl.href) {
    headers.set("Cookie", options.cookieHeader);
  }
  return headers;
}
function createSafeFetch(dependencies = {}) {
  const resolveHostname = dependencies.resolveHostname ?? systemResolveHostname;
  const transport = dependencies.transport ?? nodeTransport;
  const getLocalNetworkAddresses = dependencies.getLocalNetworkAddresses ?? systemLocalNetworkAddresses;
  return async (url, options) => {
    const maxRedirects = options.maxRedirects ?? 8;
    const retries = options.retries ?? 2;
    const deadline = Date.now() + options.timeoutMs;
    const originalUrl = new URL(url);
    let current = new URL(url);
    for (let redirects = 0;redirects <= maxRedirects; redirects += 1) {
      const addresses = await resolveNetworkTarget(current, options.allowPrivateNetwork, resolveHostname, getLocalNetworkAddresses, deadline, options.timeoutMs);
      let response = null;
      let lastError;
      let finalController = null;
      let finalTimeout = null;
      for (let attempt = 0;attempt <= retries; attempt += 1) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new FetchFailure("timeout", `request timed out after ${options.timeoutMs}ms: ${current.href}`);
        }
        const controller = new AbortController;
        const timeout = setTimeout(() => controller.abort(), remainingMs);
        try {
          const address = addresses[attempt % addresses.length];
          if (address === undefined)
            throw new FetchFailure("dns", `could not resolve ${current.hostname}`);
          response = await beforeDeadline(transport({
            url: new URL(current),
            address,
            headers: buildHeaders(current, originalUrl, options),
            signal: controller.signal
          }), deadline, `request timed out after ${options.timeoutMs}ms: ${current.href}`);
          if (!retryableStatuses.has(response.status) || attempt === retries) {
            finalController = controller;
            finalTimeout = timeout;
            break;
          }
          controller.abort();
          response.cancel();
          clearTimeout(timeout);
        } catch (error) {
          lastError = error;
          controller.abort();
          clearTimeout(timeout);
          if (error instanceof FetchFailure && error.code === "timeout")
            throw error;
          if (attempt === retries) {
            if (controller.signal.aborted) {
              throw new FetchFailure("timeout", `request timed out after ${options.timeoutMs}ms: ${current.href}`, {
                cause: error
              });
            }
            if (error instanceof FetchFailure)
              throw error;
            throw new FetchFailure("network", `request failed: ${current.href}`, { cause: error });
          }
        }
        const delay = Math.min(retryDelay(response, attempt), Math.max(0, deadline - Date.now()));
        if (delay > 0)
          await Bun.sleep(delay);
      }
      if (response === null) {
        throw new FetchFailure("network", `request failed: ${current.href}`, { cause: lastError });
      }
      if (response.status >= 300 && response.status < 400) {
        try {
          const location = response.headers.get("location");
          if (location === null)
            throw new FetchFailure("redirect", `HTTP ${response.status} omitted Location`);
          if (redirects === maxRedirects)
            throw new FetchFailure("redirect", `more than ${maxRedirects} redirects`);
          try {
            current = new URL(location, current);
          } catch (error) {
            throw new FetchFailure("redirect", `invalid redirect target: ${location}`, { cause: error });
          }
          finalController?.abort();
          response.cancel();
          continue;
        } finally {
          if (finalTimeout !== null)
            clearTimeout(finalTimeout);
        }
      }
      if (response.status < 200 || response.status >= 300) {
        if (finalTimeout !== null)
          clearTimeout(finalTimeout);
        finalController?.abort();
        response.cancel();
        throw new FetchFailure("http", `HTTP ${response.status} for ${current.href}`);
      }
      try {
        const bytes = await beforeDeadline(readBounded(response, options.maxBytes), deadline, `response body timed out after ${options.timeoutMs}ms: ${current.href}`);
        return {
          bytes,
          finalUrl: current,
          status: response.status,
          contentType: response.headers.get("content-type"),
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified")
        };
      } catch (error) {
        if (finalController?.signal.aborted === true || error instanceof FetchFailure && error.code === "timeout") {
          response.cancel();
          throw new FetchFailure("timeout", `response body timed out after ${options.timeoutMs}ms: ${current.href}`, {
            cause: error
          });
        }
        if (error instanceof FetchFailure)
          throw error;
        throw new FetchFailure("network", `response body failed: ${current.href}`, { cause: error });
      } finally {
        if (finalTimeout !== null)
          clearTimeout(finalTimeout);
      }
    }
    throw new FetchFailure("redirect", `more than ${maxRedirects} redirects`);
  };
}
async function safeFetch(url, options) {
  return await createSafeFetch()(url, options);
}
function decodeBytes(bytes, contentType) {
  const charset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase();
  const supported = charset === "iso-8859-1" || charset === "windows-1252" ? "windows-1252" : "utf-8";
  return new TextDecoder(supported, { fatal: false }).decode(bytes);
}

// src/clip/network-proxy.ts
import {
  createServer,
  request as requestHttp2
} from "http";
import { connect as connectTcp, Socket } from "net";
var defaultTimeoutMs = 30000;
var defaultMaxHeaderBytes = 32 * 1024;
var defaultMaxConnections = 64;
var defaultMaxRequestBodyBytes = 16 * 1024 * 1024;
var defaultMaxTransferredBytes = 1024 * 1024 * 1024;
var maxConnectAddresses = 16;
var hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

class ProxyRequestTooLarge extends Error {
  constructor() {
    super("proxy request body exceeded its limit");
    this.name = "ProxyRequestTooLarge";
  }
}
function positiveBoundedInteger(value, fallback, maximum) {
  if (value === undefined)
    return fallback;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("network proxy limits must be positive integers");
  return Math.min(value, maximum);
}
function connectionNamedHeaders(headers) {
  const names = new Set;
  const connection = headers["connection"];
  const values = Array.isArray(connection) ? connection : connection === undefined ? [] : [connection];
  for (const value of values) {
    if (typeof value !== "string")
      continue;
    for (const name of value.split(",")) {
      const normalized = name.trim().toLowerCase();
      if (normalized !== "")
        names.add(normalized);
    }
  }
  return names;
}
function forwardedHeaders(headers) {
  const named = connectionNamedHeaders(headers);
  const forwarded = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (hopByHopHeaders.has(normalized) || named.has(normalized) || normalized === "host")
      continue;
    if (value !== undefined)
      forwarded[normalized] = value;
  }
  return forwarded;
}
function responseHeaders2(headers) {
  const named = connectionNamedHeaders(headers);
  const forwarded = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (hopByHopHeaders.has(normalized) || named.has(normalized))
      continue;
    if (value !== undefined)
      forwarded[normalized] = value;
  }
  return forwarded;
}
function proxyStatusFor(error) {
  if (error instanceof ProxyRequestTooLarge)
    return 413;
  if (error instanceof FetchFailure && (error.code === "private-network" || error.code === "invalid-url"))
    return 403;
  if (error instanceof FetchFailure && error.code === "timeout")
    return 504;
  return 502;
}
function readRequestBody(incoming, maxBytes) {
  return new Promise((resolve3, reject) => {
    const bytes = new BoundedByteBuffer(maxBytes);
    let settled = false;
    const cleanup = () => {
      incoming.off("data", onData);
      incoming.off("end", onEnd);
      incoming.off("error", onError);
      incoming.off("aborted", onAborted);
    };
    const fail = (error) => {
      if (settled)
        return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (value) => {
      const chunk = Buffer.isBuffer(value) ? value : typeof value === "string" ? Buffer.from(value) : value instanceof Uint8Array ? Buffer.from(value) : null;
      if (chunk === null) {
        fail(new Error("proxy request yielded a non-byte chunk"));
        return;
      }
      if (!bytes.append(chunk)) {
        fail(new ProxyRequestTooLarge);
        return;
      }
    };
    const onEnd = () => {
      if (settled)
        return;
      settled = true;
      cleanup();
      const body = bytes.toUint8Array();
      resolve3(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
    };
    const onError = (error) => fail(error);
    const onAborted = () => fail(new Error("proxy request was aborted"));
    incoming.on("data", onData);
    incoming.once("end", onEnd);
    incoming.once("error", onError);
    incoming.once("aborted", onAborted);
  });
}
function finishSocket(socket, status) {
  if (socket.destroyed)
    return;
  const reason = status === 403 ? "Forbidden" : status === 504 ? "Gateway Timeout" : "Bad Gateway";
  socket.end(`HTTP/1.1 ${status} ${reason}\r
Connection: close\r
Content-Length: 0\r
\r
`);
}
function finishResponse(response, status) {
  if (response.headersSent || response.destroyed) {
    response.destroy();
    return;
  }
  response.writeHead(status, {
    "Cache-Control": "no-store",
    Connection: "close",
    "Content-Length": "0"
  });
  response.end();
}
function connectAuthority(authority) {
  if (authority === "" || authority.length > 1024 || /[\s\\/?#@]/.test(authority)) {
    throw new FetchFailure("invalid-url", "invalid CONNECT authority");
  }
  let target;
  try {
    target = new URL(`https://${authority}/`);
  } catch (error) {
    throw new FetchFailure("invalid-url", "invalid CONNECT authority", { cause: error });
  }
  if (target.hostname === "" || target.username !== "" || target.password !== "") {
    throw new FetchFailure("invalid-url", "invalid CONNECT authority");
  }
  return target;
}
function targetPort(target) {
  const raw = target.port;
  const fallback = target.protocol === "https:" ? 443 : 80;
  const port = raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new FetchFailure("invalid-url", "destination port is invalid");
  }
  return port;
}
function trackSocket(socket, sockets, timeoutMs) {
  sockets.add(socket);
  if (socket instanceof Socket)
    socket.setTimeout(timeoutMs, () => socket.destroy());
  socket.once("close", () => sockets.delete(socket));
}
async function connectPinned(addresses, port, timeoutMs, sockets, connectAddress, isClosing) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (const address of addresses.slice(0, maxConnectAddresses)) {
    if (isClosing())
      throw new FetchFailure("network", "proxy is closing");
    try {
      const socket = await new Promise((resolve3, reject) => {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          reject(new FetchFailure("timeout", "proxy connection timed out"));
          return;
        }
        const candidate = connectAddress(address, port);
        trackSocket(candidate, sockets, timeoutMs);
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled)
            return;
          settled = true;
          candidate.destroy();
          reject(new FetchFailure("timeout", "proxy connection timed out"));
        }, remainingMs);
        candidate.once("connect", () => {
          if (settled)
            return;
          settled = true;
          clearTimeout(timeout);
          resolve3(candidate);
        });
        candidate.once("error", (error) => {
          if (settled)
            return;
          settled = true;
          clearTimeout(timeout);
          candidate.destroy();
          reject(error);
        });
        candidate.once("close", () => {
          if (settled)
            return;
          settled = true;
          clearTimeout(timeout);
          reject(new FetchFailure("network", "proxy connection closed before it was established"));
        });
      });
      if (isClosing()) {
        socket.destroy();
        throw new FetchFailure("network", "proxy is closing");
      }
      return socket;
    } catch (error) {
      if (isClosing())
        throw new FetchFailure("network", "proxy is closing", { cause: error });
      if (error instanceof FetchFailure && error.code === "timeout")
        throw error;
      lastError = error;
    }
  }
  if (Date.now() >= deadline) {
    throw new FetchFailure("timeout", "proxy connection timed out", { cause: lastError });
  }
  throw new FetchFailure("network", "could not connect to validated destination", { cause: lastError });
}
function parseAbsoluteHttpTarget(raw) {
  if (raw === undefined || raw.length > 16 * 1024) {
    throw new FetchFailure("invalid-url", "invalid proxy request target");
  }
  let target;
  try {
    target = new URL(raw);
  } catch (error) {
    throw new FetchFailure("invalid-url", "proxy requests require an absolute HTTP URL", { cause: error });
  }
  if (target.protocol !== "http:" || target.hash !== "") {
    throw new FetchFailure("invalid-url", "absolute proxy requests must use HTTP");
  }
  return target;
}
async function startNetworkProxy(options) {
  const timeoutMs = positiveBoundedInteger(options.timeoutMs, defaultTimeoutMs, 10 * 60000);
  const maxHeaderBytes = positiveBoundedInteger(options.maxHeaderBytes, defaultMaxHeaderBytes, 1024 * 1024);
  const maxConnections = positiveBoundedInteger(options.maxConnections, defaultMaxConnections, 1024);
  const maxRequestBodyBytes = positiveBoundedInteger(options.maxRequestBodyBytes, defaultMaxRequestBodyBytes, 1024 * 1024 * 1024);
  const maxTransferredBytes = positiveBoundedInteger(options.maxTransferredBytes, defaultMaxTransferredBytes, Number.MAX_SAFE_INTEGER);
  const sockets = new Set;
  const httpUpstreams = new Set;
  let activeRequests = 0;
  let transferredBytes = 0;
  let closing = false;
  const reserveRequest = () => {
    if (closing || activeRequests >= maxConnections)
      return false;
    activeRequests += 1;
    return true;
  };
  const releaseRequest = () => {
    activeRequests = Math.max(0, activeRequests - 1);
  };
  const accountTransfer = (bytes) => {
    transferredBytes += bytes;
    return transferredBytes <= maxTransferredBytes;
  };
  const forgetHttpUpstream = (upstream) => {
    if (upstream.settled)
      return;
    upstream.settled = true;
    httpUpstreams.delete(upstream);
    upstream.detachDownstream();
  };
  const destroyHttpUpstream = (upstream) => {
    if (upstream.settled)
      return;
    upstream.settled = true;
    httpUpstreams.delete(upstream);
    upstream.detachDownstream();
    upstream.response?.destroy();
    upstream.request.destroy();
    upstream.socket?.destroy();
  };
  const resolveTarget = (target) => resolveSafeNetworkTarget(target, {
    allowPrivateNetwork: options.allowPrivateNetwork,
    timeoutMs,
    ...options.resolveHostname === undefined ? {} : { resolveHostname: options.resolveHostname }
  });
  const connectAddress = options.connectAddress ?? ((address2, port) => connectTcp({ host: address2.address, port, family: address2.family }));
  const server = createServer({
    maxHeaderSize: maxHeaderBytes,
    headersTimeout: timeoutMs,
    requestTimeout: timeoutMs,
    keepAliveTimeout: Math.min(timeoutMs, 5000)
  });
  server.maxConnections = maxConnections;
  server.on("request", (incoming, outgoing) => {
    if (!reserveRequest()) {
      finishResponse(outgoing, 503);
      return;
    }
    let released = false;
    const release = () => {
      if (released)
        return;
      released = true;
      releaseRequest();
    };
    let httpUpstream = null;
    let downstreamClosed = false;
    let detachDownstream = () => {
      return;
    };
    const closeHttpUpstream = () => {
      downstreamClosed = true;
      if (httpUpstream === null) {
        detachDownstream();
        return;
      }
      destroyHttpUpstream(httpUpstream);
    };
    const closeIncompleteIncoming = () => {
      if (incoming.aborted || !incoming.complete)
        closeHttpUpstream();
    };
    detachDownstream = () => {
      incoming.off("aborted", closeHttpUpstream);
      incoming.off("error", closeHttpUpstream);
      incoming.off("close", closeIncompleteIncoming);
      incoming.socket.off("error", closeHttpUpstream);
      incoming.socket.off("close", closeHttpUpstream);
      outgoing.off("error", closeHttpUpstream);
    };
    incoming.once("aborted", closeHttpUpstream);
    incoming.once("error", closeHttpUpstream);
    incoming.once("close", closeIncompleteIncoming);
    incoming.socket.once("error", closeHttpUpstream);
    incoming.socket.once("close", closeHttpUpstream);
    outgoing.once("error", closeHttpUpstream);
    outgoing.once("close", () => {
      release();
      closeHttpUpstream();
    });
    outgoing.once("finish", release);
    (async () => {
      let target;
      try {
        target = parseAbsoluteHttpTarget(incoming.url);
        const declared = incoming.headers["content-length"];
        if (typeof declared === "string") {
          const length = Number(declared);
          if (!Number.isSafeInteger(length) || length < 0 || length > maxRequestBodyBytes) {
            finishResponse(outgoing, 413);
            incoming.destroy();
            return;
          }
        }
        const bodyPromise = readRequestBody(incoming, maxRequestBodyBytes);
        const [addresses, body] = await Promise.all([resolveTarget(target), bodyPromise]);
        const address2 = addresses[0];
        if (address2 === undefined)
          throw new FetchFailure("dns", "destination had no validated address");
        if (downstreamClosed || incoming.aborted || outgoing.destroyed || closing)
          return;
        const hostname = target.hostname.startsWith("[") && target.hostname.endsWith("]") ? target.hostname.slice(1, -1) : target.hostname;
        const headers = forwardedHeaders(incoming.headers);
        headers.host = target.host;
        const requestOptions = {
          protocol: "http:",
          hostname,
          port: targetPort(target),
          method: incoming.method ?? "GET",
          path: `${target.pathname}${target.search}`,
          headers,
          lookup: createPinnedLookup(address2),
          family: address2.family,
          agent: false,
          maxHeaderSize: maxHeaderBytes
        };
        const upstream = requestHttp2(requestOptions, (response) => {
          const tracked2 = httpUpstream;
          if (tracked2 === null || tracked2.settled) {
            response.destroy();
            return;
          }
          tracked2.response = response;
          response.once("close", () => forgetHttpUpstream(tracked2));
          if (outgoing.destroyed || closing) {
            destroyHttpUpstream(tracked2);
            return;
          }
          outgoing.writeHead(response.statusCode ?? 502, response.statusMessage, responseHeaders2(response.headers));
          response.on("data", (chunk) => {
            const size = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk instanceof Uint8Array ? chunk.byteLength : 0;
            if (!accountTransfer(size)) {
              response.destroy(new Error("proxy transfer limit exceeded"));
              outgoing.destroy();
            }
          });
          response.once("error", () => {
            destroyHttpUpstream(tracked2);
            outgoing.destroy();
          });
          response.pipe(outgoing);
        });
        httpUpstream = {
          request: upstream,
          detachDownstream,
          response: null,
          socket: null,
          settled: false
        };
        httpUpstreams.add(httpUpstream);
        const tracked = httpUpstream;
        upstream.once("socket", (socket) => {
          if (tracked.settled || closing) {
            socket.destroy();
            return;
          }
          tracked.socket = socket;
          trackSocket(socket, sockets, timeoutMs);
        });
        upstream.setTimeout(timeoutMs, () => upstream.destroy(new Error("proxy request timed out")));
        upstream.once("error", () => {
          destroyHttpUpstream(tracked);
          finishResponse(outgoing, 502);
        });
        upstream.once("close", () => {
          if (tracked.response === null)
            forgetHttpUpstream(tracked);
        });
        if (downstreamClosed || outgoing.destroyed || closing) {
          destroyHttpUpstream(tracked);
          return;
        }
        if (!accountTransfer(body.byteLength)) {
          upstream.destroy(new Error("proxy transfer limit exceeded"));
          finishResponse(outgoing, 413);
          return;
        }
        upstream.end(body);
      } catch (error) {
        finishResponse(outgoing, proxyStatusFor(error));
      }
    })();
  });
  server.on("connect", (request, client, head) => {
    if (!reserveRequest()) {
      finishSocket(client, 503);
      return;
    }
    let released = false;
    const release = () => {
      if (released)
        return;
      released = true;
      releaseRequest();
    };
    client.once("close", release);
    trackSocket(client, sockets, timeoutMs);
    (async () => {
      try {
        const target = connectAuthority(request.url ?? "");
        const addresses = await resolveTarget(target);
        if (client.destroyed)
          return;
        const upstream = await connectPinned(addresses, targetPort(target), timeoutMs, sockets, connectAddress, () => closing);
        if (client.destroyed || closing) {
          upstream.destroy();
          return;
        }
        client.write(`HTTP/1.1 200 Connection Established\r
Proxy-Agent: cclrte-kb\r
\r
`);
        if (head.byteLength > 0) {
          if (!accountTransfer(head.byteLength)) {
            client.destroy();
            upstream.destroy();
            return;
          }
          upstream.write(head);
        }
        client.on("data", (chunk) => {
          if (!accountTransfer(chunk.byteLength)) {
            client.destroy();
            upstream.destroy();
          }
        });
        upstream.on("data", (chunk) => {
          if (!accountTransfer(chunk.byteLength)) {
            client.destroy();
            upstream.destroy();
          }
        });
        client.once("error", () => upstream.destroy());
        upstream.once("error", () => client.destroy());
        client.pipe(upstream);
        upstream.pipe(client);
      } catch (error) {
        finishSocket(client, proxyStatusFor(error));
      }
    })();
  });
  server.on("upgrade", (_request, socket) => finishSocket(socket, 501));
  server.on("clientError", (_error, socket) => finishSocket(socket, 400));
  server.on("connection", (socket) => trackSocket(socket, sockets, timeoutMs));
  await new Promise((resolve3, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve3();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("network proxy did not bind a TCP port");
  }
  let closePromise = null;
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () => {
      if (closePromise !== null)
        return closePromise;
      closing = true;
      for (const upstream of [...httpUpstreams])
        destroyHttpUpstream(upstream);
      for (const socket of sockets)
        socket.destroy();
      closePromise = new Promise((resolveClose) => {
        server.close(() => resolveClose());
        server.closeAllConnections?.();
        server.closeIdleConnections?.();
      });
      return closePromise;
    }
  };
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
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { createRequire } from "module";
import { dirname as dirname2, join as join2, resolve as resolve3 } from "path";
function isPackageManifest(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function findKbPackageRoot(startDirectory = import.meta.dir, dependencies = {}) {
  const exists = dependencies.exists ?? existsSync2;
  const readText = dependencies.readText ?? ((path) => readFileSync2(path, "utf8"));
  let directory = resolve3(startDirectory);
  for (let depth = 0;depth < 8; depth += 1) {
    const manifestPath = join2(directory, "package.json");
    if (exists(manifestPath)) {
      try {
        const parsed = JSON.parse(readText(manifestPath));
        if (isPackageManifest(parsed) && typeof parsed.name === "string" && parsed.name.endsWith("/kb") && typeof parsed.version === "string")
          return directory;
      } catch {}
    }
    const parent = dirname2(directory);
    if (parent === directory)
      break;
    directory = parent;
  }
  throw new Error("Could not locate the kb package root.");
}
function resolvePackageDirectory(packageName, parentUrl = import.meta.url) {
  const manifest = createRequire(parentUrl).resolve(`${packageName}/package.json`);
  return dirname2(manifest);
}

// src/clip/acquire.ts
var agentBrowserBinDirectory = join3(resolvePackageDirectory("agent-browser"), "bin");
function agentBrowserCommand() {
  const platform = process.platform === "win32" ? "win32" : process.platform;
  const extension = process.platform === "win32" ? ".exe" : "";
  const native = join3(agentBrowserBinDirectory, `agent-browser-${platform}-${process.arch}${extension}`);
  return existsSync3(native) ? [native] : [process.execPath, join3(agentBrowserBinDirectory, "agent-browser.js")];
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
  const configPath = join3(directory, "agent-browser.config.json");
  const socketRoot = process.platform === "win32" ? tmpdir() : "/tmp";
  const socketDirectory = mkdtempSync2(join3(socketRoot, "jc-ab-"));
  try {
    chmodSync2(socketDirectory, 448);
    writeFileSync2(configPath, `{}
`, { encoding: "utf8", flag: "wx", mode: 384 });
    chmodSync2(configPath, 384);
    return {
      configPath,
      cwd: directory,
      socketDirectory,
      environment: isolatedAgentBrowserEnvironment(process.env, socketDirectory)
    };
  } catch (error) {
    rmSync2(socketDirectory, { recursive: true, force: true });
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
  const directory = mkdtempSync2(join3(tmpdir(), "cclrte-kb-profiles-"));
  chmodSync2(directory, 448);
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
      rmSync2(socketDirectory, { recursive: true, force: true });
    rmSync2(directory, { recursive: true, force: true });
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
  return platform === "x" || platform === "hacker-news" || platform === "reddit" || platform === "bluesky" || platform === "linkedin" || platform === "facebook" || platform === "instagram" || platform === "tiktok" || platform === "threads" || platform === "youtube" || platform === "substack";
}
var safeExpansionControlPattern = /^(?:(?:show|view|load|see|read)\s+(?:(?:all|more|additional|previous|next|older|newer|this|\d+(?:[.,]\d+)?[km]?)\s+){0,3}(?:repl(?:y|ies)|comments?|thread)|(?:show|view|load|see|read)\s+more)$/i;
function browserExpansionLimits(maxItems) {
  const boundedItems = Number.isSafeInteger(maxItems) ? Math.max(1, Math.min(maxItems, 1e4)) : 500;
  return {
    maxScrolls: Math.max(3, Math.min(40, Math.ceil(boundedItems / 20))),
    maxVisitedElements: Math.max(2048, Math.min(50000, boundedItems * 32)),
    maxClicks: Math.max(16, Math.min(256, Math.ceil(boundedItems / 2)))
  };
}
function browserExpansionScript(limits) {
  return `(async () => {
    const patterns = new RegExp(${JSON.stringify(safeExpansionControlPattern.source)}, 'i');
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clickedControls = new WeakSet();
    let visitedElements = 0;
    let eligibleControls = 0;
    let clicks = 0;
    let clickFailures = 0;
    let inspectionFailures = 0;
    let stable = 0;
    let previousHeight = 0;
    let scrolls = 0;
    let settled = false;
    let elementBudgetReached = false;
    let clickBudgetReached = false;
    for (let pass = 0; pass < ${limits.maxScrolls}; pass += 1) {
      if (!elementBudgetReached && !clickBudgetReached) {
        const walker = document.createTreeWalker(document.documentElement, 1);
        while (visitedElements < ${limits.maxVisitedElements}) {
          const control = walker.nextNode();
          if (control === null) break;
          visitedElements += 1;
          if (clickedControls.has(control)) continue;
          try {
            const name = (control.localName || '').toLowerCase();
            if (name !== 'button' && name !== 'summary' && control.getAttribute('role') !== 'button') continue;
            const text = (control.textContent || control.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
            if (!text || text.length >= 80 || !patterns.test(text)) continue;
            eligibleControls += 1;
            const rect = control.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            // Mark before dispatch: a throwing handler must not be retried on every pass.
            clickedControls.add(control);
            clicks += 1;
            try {
              control.click();
            } catch {
              clickFailures += 1;
            }
            if (clicks >= ${limits.maxClicks}) {
              clickBudgetReached = true;
              break;
            }
          } catch {
            inspectionFailures += 1;
          }
        }
        if (visitedElements >= ${limits.maxVisitedElements}) elementBudgetReached = true;
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      scrolls += 1;
      await sleep(700);
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
      visitedElements,
      eligibleControls,
      clicks,
      clickFailures,
      inspectionFailures,
      scrolls,
      elementBudgetReached,
      clickBudgetReached,
      scrollBudgetReached: !settled && scrolls >= ${limits.maxScrolls}
    };
  })()`;
}
var nonNegativeInteger = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
function readBrowserExpansionTelemetry(value, limits) {
  if (!isRecord3(value))
    return null;
  const visitedElements = nonNegativeInteger(value.visitedElements);
  const eligibleControls = nonNegativeInteger(value.eligibleControls);
  const clicks = nonNegativeInteger(value.clicks);
  const clickFailures = nonNegativeInteger(value.clickFailures);
  const inspectionFailures = nonNegativeInteger(value.inspectionFailures);
  const scrolls = nonNegativeInteger(value.scrolls);
  if (visitedElements === null || eligibleControls === null || clicks === null || clickFailures === null || inspectionFailures === null || scrolls === null || visitedElements > limits.maxVisitedElements || eligibleControls > visitedElements || clicks > limits.maxClicks || clickFailures > clicks || inspectionFailures > visitedElements || scrolls > limits.maxScrolls || typeof value.elementBudgetReached !== "boolean" || typeof value.clickBudgetReached !== "boolean" || typeof value.scrollBudgetReached !== "boolean")
    return null;
  return {
    visitedElements,
    eligibleControls,
    clicks,
    clickFailures,
    inspectionFailures,
    scrolls,
    elementBudgetReached: value.elementBudgetReached,
    clickBudgetReached: value.clickBudgetReached,
    scrollBudgetReached: value.scrollBudgetReached
  };
}
function browserExpansionWarnings(telemetry, limits) {
  const warnings = [];
  if (telemetry.elementBudgetReached) {
    warnings.push(`Browser expansion reached its ${limits.maxVisitedElements}-element inspection budget; additional disclosure controls may remain unexpanded.`);
  }
  if (telemetry.clickBudgetReached) {
    warnings.push(`Browser expansion reached its ${limits.maxClicks}-click budget; additional disclosure controls may remain unexpanded.`);
  }
  if (telemetry.scrollBudgetReached) {
    warnings.push(`Browser expansion reached its ${limits.maxScrolls}-scroll budget before the document stabilized; lazy content may remain unloaded.`);
  }
  if (telemetry.clickFailures > 0 || telemetry.inspectionFailures > 0) {
    warnings.push(`Browser expansion skipped ${telemetry.clickFailures} failed click attempt(s) and ${telemetry.inspectionFailures} unreadable control(s).`);
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
  const pidPath = join3(socketDirectory, `${session}.pid`);
  if (!existsSync3(pidPath))
    return;
  const rawPid = readFileSync3(pidPath, "utf8").trim();
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
  const child = relative2(root, target);
  return child === "" || !isAbsolute2(child) && child !== ".." && !child.startsWith(`..${sep2}`);
}
function canonicalPotentialPath(value, label) {
  const suffix = [];
  let ancestor = resolve4(value);
  while (true) {
    try {
      lstatSync2(ancestor);
      let canonicalAncestor;
      try {
        canonicalAncestor = realpathSync2(ancestor);
      } catch {
        throw new Error(`${label} contains an unresolved symbolic link.`);
      }
      return resolve4(canonicalAncestor, ...suffix);
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
    }
    const parent = dirname3(ancestor);
    if (parent === ancestor)
      throw new Error(`${label} has no resolvable filesystem ancestor.`);
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
}
function profilePath(value) {
  const pathLike = isAbsolute2(value) || value.startsWith(`.${sep2}`) || value.startsWith(`..${sep2}`) || value.startsWith(`~${sep2}`) || value.includes("/") || value.includes("\\");
  if (!pathLike)
    return null;
  const expanded = value.startsWith(`~${sep2}`) ? join3(homedir2(), value.slice(2)) : resolve4(value);
  return canonicalPotentialPath(expanded, "Persistent browser profile");
}
function assertSafePersistentProfile(options) {
  if (options.browserProfile === undefined)
    return null;
  const path = profilePath(options.browserProfile);
  if (path === null)
    return null;
  const repositoryRoot = realpathSync2(findKbPackageRoot());
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
  const result = await (dependencies.readCookies ?? acquireCookieRecords)(options, options.url);
  await (dependencies.runBatch ?? runAgentBrowserBatch)(globalArgs, browserCookieCommands(result.cookies, options.url), commandOptions);
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
async function acquireBrowser(options, temporaryDirectory, useDiscoveredProfile = false) {
  if ((options.cdp !== undefined || options.browserLive) && !options.trustAttachedBrowserEgress) {
    throw new Error("Attached browser sessions cannot be forced through the private-network filter; " + "rerun with --trust-attached-browser-egress only when you explicitly trust that live browser's network access.");
  }
  await assertSafeNetworkUrl(options.url, options.allowPrivateNetwork, options.timeoutMs);
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
      try {
        await runAgentBrowser(globalArgs, ["open", "about:blank"], commandOptions);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Browser startup did not settle cleanly; attempted to use the isolated session: ${message}`);
      }
      if (ownsBrowser && (method === "browser-fresh" || ownedProfile)) {
        warnings.push(...await seedOwnedBrowserCookies(options, globalArgs, commandOptions));
      } else if (options.cookieSources.length > 0 || options.cookiesFile !== undefined) {
        warnings.push("Explicit cookie input remained a separate HTTP/media lane and was not imported into the selected profile or attached browser.");
      }
      if (!ownsBrowser) {
        warnings.push("Attached browser capture navigated, clicked eligible disclosure controls, and scrolled the active tab; the external browser itself was left open.");
      }
      let beforeNavigation = null;
      try {
        beforeNavigation = readBrowserUrl(await runAgentBrowser(globalArgs, ["get", "url"], commandOptions));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Could not establish a pre-navigation browser URL: ${message}`);
      }
      let navigationCommandSucceeded = false;
      try {
        await runAgentBrowserBatch(globalArgs, [["open", options.url.href]], commandOptions);
        navigationCommandSucceeded = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Browser navigation command ended during page transition: ${message}`);
      }
      await Bun.sleep(Math.min(5000, Math.max(1500, Math.floor(options.timeoutMs / 6))));
      let readable;
      try {
        readable = readBrowserContent(await runAgentBrowser(globalArgs, ["read"], commandOptions));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Rendered readable text was unavailable; continuing with the bounded DOM: ${message}`);
        readable = {
          content: "",
          finalUrl: readBrowserUrl(await runAgentBrowser(globalArgs, ["get", "url"], commandOptions)),
          truncated: false
        };
      }
      if (!browserNavigationReachedTarget(options.url, beforeNavigation, readable.finalUrl, navigationCommandSucceeded)) {
        throw new Error("browser did not establish the requested navigation; refusing to capture a pre-existing tab");
      }
      let browserPageProvenanceIntact = true;
      if (shouldExpand(readable.finalUrl, options, method)) {
        const expansionLimits = browserExpansionLimits(options.maxItems);
        try {
          const expansion = await runAgentBrowser(globalArgs, ["eval", browserExpansionScript(expansionLimits)], {
            ...commandOptions,
            timeoutMs: Math.min(commandOptions.timeoutMs, 30000)
          });
          const telemetry = readBrowserExpansionTelemetry(expansion.result, expansionLimits);
          if (telemetry === null) {
            warnings.push("Browser expansion returned no trustworthy bounded-work telemetry; conversation completeness cannot be confirmed.");
          } else {
            warnings.push(...browserExpansionWarnings(telemetry, expansionLimits));
          }
          const expandedReadable = readBrowserContent(await runAgentBrowser(globalArgs, ["read"], commandOptions));
          if (browserExpansionStayedOnPage(readable.finalUrl, expandedReadable.finalUrl)) {
            readable = expandedReadable;
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
      await assertSafeNetworkUrl(readable.finalUrl, options.allowPrivateNetwork, options.timeoutMs);
      const renderedText = readable.content;
      let body = renderedText;
      let contentType = "text/plain; charset=utf-8";
      let contentTruncated = readable.truncated;
      let sourceEvidence;
      let browserTitle;
      if (browserPageProvenanceIntact) {
        try {
          const capture = await runAgentBrowser(globalArgs, ["eval", browserCaptureScript()], commandOptions);
          if (isRecord3(capture.result)) {
            const html = capture.result.html;
            const title = capture.result.title;
            const captureUrl = typeof capture.result.url === "string" ? new URL(capture.result.url) : null;
            if (captureUrl === null || !browserExpansionStayedOnPage(readable.finalUrl, captureUrl)) {
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
      if (contentTruncated)
        warnings.push("agent-browser truncated rendered text at its configured output boundary.");
      let screenshotPath;
      if ((options.evidence === "screenshot" || options.evidence === "all") && browserPageProvenanceIntact) {
        const requestedScreenshotPath = join3(temporaryDirectory, "page.png");
        screenshotPath = requestedScreenshotPath;
        try {
          await runAgentBrowser(globalArgs, ["screenshot", requestedScreenshotPath], {
            ...commandOptions,
            timeoutMs: options.timeoutMs,
            maxOutputBytes: 2 * 1024 * 1024
          });
          const afterScreenshot = readBrowserUrl(await runAgentBrowser(globalArgs, ["get", "url"], commandOptions));
          if (!browserExpansionStayedOnPage(readable.finalUrl, afterScreenshot)) {
            rmSync2(requestedScreenshotPath, { force: true });
            warnings.push("Browser screenshot changed pages during capture and was discarded.");
            screenshotPath = undefined;
          } else if (!existsSync3(requestedScreenshotPath)) {
            warnings.push("Browser screenshot was requested but agent-browser did not create it.");
            screenshotPath = undefined;
          }
        } catch (error) {
          rmSync2(requestedScreenshotPath, { force: true });
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
        finalUrl: readable.finalUrl,
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
            await runAgentBrowser(["--config", isolation.configPath, "--session", session], ["close"], {
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
    rmSync2(isolation.socketDirectory, { recursive: true, force: true });
  }
}
async function acquireHttp(options) {
  const response = await safeFetch(options.url, {
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
  const cookieResult = await acquireCookieHeader(options, options.url);
  const response = await safeFetch(options.url, {
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
    return readFileSync3(options.htmlFile, "utf8");
  })();
  return {
    body,
    contentType: "text/html; charset=utf-8",
    finalUrl: options.url,
    method: "file",
    warnings: options.htmlFile === "-" ? [] : [`Parsed rendered HTML from ${basename(options.htmlFile)}.`]
  };
}

// src/clip/assets.ts
import { createHash } from "crypto";
import { mkdirSync as mkdirSync2, writeFileSync as writeFileSync3 } from "fs";
import { join as join4 } from "path";
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
  mkdirSync2(options.assetsDirectory, { recursive: true });
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
    writeFileSync3(join4(options.assetsDirectory, filename), result.bytes, { mode: 420 });
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
var isRecord4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
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
function boundedMetadata2(value, maxCodeUnits) {
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
    const result = await new Promise((resolve5, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`Defuddle exceeded the ${timeoutMs}ms extraction deadline.`));
      }, timeoutMs);
      worker.onmessage = (event) => {
        const message = event.data;
        if (!isRecord4(message) || typeof message.ok !== "boolean") {
          reject(new Error("Defuddle worker returned malformed data."));
          return;
        }
        if (message.ok === true && isRecord4(message.value)) {
          resolve5({ ok: true, value: message.value });
          return;
        }
        resolve5({
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
    if (!isRecord4(current))
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
  const browserTitle = boundedMetadata2(acquisition.browserTitle, articleMetadataLimits.title);
  const firstHeading = browserTitle === null ? firstMarkdownHeading(content) : null;
  const pathname = acquisition.finalUrl.pathname;
  let pathEnd = pathname.length;
  while (pathEnd > 0 && pathname.charCodeAt(pathEnd - 1) === 47)
    pathEnd -= 1;
  const pathStart = pathname.lastIndexOf("/", pathEnd - 1) + 1;
  const lastSegment = boundedTrimmedSlice(pathname, pathStart, pathEnd, articleMetadataLimits.title);
  return {
    content,
    title: browserTitle ?? firstHeading ?? lastSegment ?? boundedMetadata2(acquisition.finalUrl.hostname, articleMetadataLimits.title),
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
  const platform = detectPlatform(acquisition.finalUrl);
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
      const content = nonEmpty(response.contentMarkdown) ?? nonEmpty(response.content);
      if (content !== null) {
        const description = boundedMetadata2(response.description, articleMetadataLimits.description);
        article = {
          content: platform === "x" ? restoreXPostLineBreaks(content, description) : content,
          title: boundedMetadata2(response.title, articleMetadataLimits.title) ?? boundedMetadata2(acquisition.browserTitle, articleMetadataLimits.title),
          author: boundedMetadata2(response.author, articleMetadataLimits.author),
          published: boundedMetadata2(response.published, articleMetadataLimits.published),
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
  chmodSync as chmodSync3,
  existsSync as existsSync4,
  lstatSync as lstatSync3,
  mkdirSync as mkdirSync3,
  mkdtempSync as mkdtempSync3,
  readFileSync as readFileSync4,
  readdirSync as readdirSync2,
  realpathSync as realpathSync3,
  renameSync as renameSync2,
  rmSync as rmSync3,
  statSync as statSync2,
  unlinkSync,
  writeFileSync as writeFileSync4
} from "fs";
import { homedir as homedir3, tmpdir as tmpdir2 } from "os";
import { basename as basename2, extname, join as join5, resolve as resolve5 } from "path";
import { getCookies as getCookies2 } from "@steipete/sweet-cookie";
var metadataPrefix = "CLIP_MEDIA_JSON\t";
var isRecord5 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
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
async function readBoundedStream2(stream, maxBytes) {
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
    entries = readdirSync2(directory, { withFileTypes: true });
  } catch (error) {
    return `could not inspect media staging directory: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (entries.length > maxFiles)
    return `media capture created more than ${maxFiles} files`;
  let totalBytes = 0;
  for (const entry of entries) {
    const path = join5(directory, entry.name);
    let stats;
    try {
      stats = lstatSync3(path);
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
      readBoundedStream2(child.stdout, specification.maxOutputBytes),
      readBoundedStream2(child.stderr, specification.maxOutputBytes),
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
  const exists = options.exists ?? existsSync4;
  const which = options.which ?? ((name) => Bun.which(name));
  const fromPath = which("yt-dlp");
  if (fromPath !== null && exists(fromPath))
    return fromPath;
  const homeDirectory = options.homeDirectory ?? homedir3();
  return [
    join5(homeDirectory, ".local", "bin", "yt-dlp"),
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
      if (!isRecord5(parsed))
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
var readMediaCookies = createMediaCookieProvider((options) => getCookies2(options));
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
  const path = join5(directory, "cookies.txt");
  try {
    writeFileSync4(path, body, { encoding: "utf8", flag: "wx", mode: 384 });
    chmodSync3(path, 384);
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
  const output = join5(runDirectory, "media-%(id).80B.%(ext)s");
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
  for (const entry of readdirSync2(runDirectory, { withFileTypes: true })) {
    if (!entry.isFile())
      continue;
    const extension = extname(entry.name).toLowerCase();
    const source = join5(runDirectory, entry.name);
    const stats = statSync2(source);
    if (!stats.isFile() || stats.size > maxFileBytes) {
      warnings.push(`Ignored invalid or oversized yt-dlp output ${basename2(entry.name)}.`);
      continue;
    }
    const bytes = readFileSync4(source);
    const mimeType = sniffMediaMimeType(bytes, extension);
    if (mimeType === null) {
      warnings.push(`Ignored unrecognized or mislabeled yt-dlp output ${basename2(entry.name)}.`);
      continue;
    }
    const digest = sha2562(bytes);
    const filename = `${digest}${extension}`;
    const destination = join5(outputDirectory, filename);
    if (existsSync4(destination)) {
      const destinationStats = lstatSync3(destination);
      if (!destinationStats.isFile() || destinationStats.isSymbolicLink()) {
        warnings.push(`Refused unsafe existing media destination ${filename}.`);
        continue;
      }
      const destinationDigest = sha2562(readFileSync4(destination));
      if (destinationDigest !== digest) {
        warnings.push(`Refused conflicting existing media destination ${filename}.`);
        continue;
      }
      unlinkSync(source);
    } else
      renameSync2(source, destination);
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
      const cookieFileStats = lstatSync3(resolve5(options.cookiesFile));
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
  const exists = options.exists ?? existsSync4;
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
  const outputDirectory = resolve5(options.outputDirectory);
  try {
    mkdirSync3(outputDirectory, { recursive: true, mode: 493 });
    const outputStats = lstatSync3(outputDirectory);
    if (!outputStats.isDirectory() || outputStats.isSymbolicLink()) {
      return { status: "failed", records: [], metadata: null, warnings: ["Media destination must be a real directory, not a symlink."] };
    }
  } catch {
    return { status: "failed", records: [], metadata: null, warnings: ["Could not create the media destination directory."] };
  }
  const realOutputDirectory = realpathSync3(outputDirectory);
  const runDirectory = mkdtempSync3(join5(realOutputDirectory, ".clip-media-"));
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
        file: resolve5(options.cookiesFile),
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
      authDirectory = mkdtempSync3(join5(tmpdir2(), "cclrte-kb-auth-"));
      chmodSync3(authDirectory, 448);
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
    const metadata2 = parseMediaMetadata(result.stdout);
    if (result.exitCode !== 0) {
      const classification = errorClassification(result.stderr);
      return {
        status: classification.status,
        records: [],
        metadata: metadata2,
        warnings: [...authenticationWarnings, classification.warning]
      };
    }
    const promoted = promoteMediaFiles(runDirectory, realOutputDirectory, normalizePrefix(options.relativePrefix), maxFiles, options.maxFileBytes, options.maxTotalBytes);
    if (promoted.records.length === 0) {
      return {
        status: "unsupported",
        records: [],
        metadata: metadata2,
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
      metadata: metadata2,
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
        rmSync3(authDirectory, { recursive: true, force: true });
      rmSync3(runDirectory, { recursive: true, force: true });
    }
  }
}

// src/clip/structured.ts
var isRecord6 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var itemId = (value) => {
  if (typeof value === "string" && /^\d+$/.test(value))
    return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  return null;
};
var enqueueHackerNewsChildren = (value, depth, maximumQueueSize, queue, scheduled) => {
  if (!isRecord6(value) || !Array.isArray(value.kids))
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
    finalUrl: options.url,
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
  if (!isRecord6(root) || itemId(root.id) === null)
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
    if (!isRecord6(resolution) || typeof resolution.did !== "string" || !resolution.did.startsWith("did:")) {
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
  if (!isRecord6(comments))
    return false;
  const data = isRecord6(comments.data) ? comments.data : null;
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
  const classified = classifyPlatformUrl(options.url.href);
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
  if (platform === "hacker-news" || platform === "reddit")
    return "comments";
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
  const base = slugify(extraction.article.title ?? fallback);
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
  if (screenshotPath === null || !existsSync5(screenshotPath))
    return null;
  const stats = statSync3(screenshotPath);
  if (!stats.isFile() || stats.size > maxBytes)
    return null;
  const bytes = readFileSync5(screenshotPath);
  if (sniffImage(bytes)?.mimeType !== "image/png")
    return null;
  const evidenceDirectory = join6(transaction.stagingDirectory, "evidence");
  mkdirSync4(evidenceDirectory, { recursive: true, mode: 448 });
  const destination = join6(evidenceDirectory, "page.png");
  copyFileSync(screenshotPath, destination);
  chmodSync4(destination, 384);
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
  const profile = options.cookieSources.length > 0 ? options.cookieProfile : options.browserProfile;
  return {
    ...source === undefined ? {} : { cookieBrowser: { source, ...profile === undefined ? {} : { profile } } },
    ...options.cookiesFile === undefined ? {} : { cookiesFile: options.cookiesFile }
  };
}
function assetCookieProvider(options, reader, authorizedUrl) {
  const explicit = options.cookieSources.length > 0 || options.cookiesFile !== undefined;
  if (!explicit && options.browserProfile === undefined)
    return;
  const effective = explicit ? options : { ...options, cookieSources: ["chrome"], cookieProfile: options.browserProfile };
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
  const platform = classifyPlatformUrl(rawOptions.url.href)?.platform ?? "generic";
  const sourceUrl = canonicalizeUrl(rawOptions.url, platform).href;
  const scope = effectiveScope(platform, rawOptions.scope);
  const options = { ...rawOptions, scope };
  const candidates = [];
  const attempts = [];
  const browserOperationalWarnings = [];
  let structuredCapture = null;
  const browserScreenshots = new Map;
  const browserTemporaryDirectory = mkdtempSync4(join6(tmpdir3(), "cclrte-kb-browser-"));
  chmodSync4(browserTemporaryDirectory, 448);
  try {
    const eagerBrowserCandidates = [];
    const eagerBrowserAttempts = [];
    const eagerBrowserRequested = options.mode === "auto" && browserFirstPlatforms.has(platform);
    if (eagerBrowserRequested && (options.browserLive || options.cdp !== undefined)) {
      browserOperationalWarnings.push("An attached browser attempt may have navigated, clicked eligible disclosure controls, and scrolled the active tab even if that candidate was not selected.");
    } else if (eagerBrowserRequested && options.browserProfile !== undefined && options.browserProfileOwnership !== "owned") {
      browserOperationalWarnings.push("A selected browser profile was exercised even if that candidate was not selected; a path-backed persistent profile may have been updated by page activity.");
    }
    const eagerBrowser = eagerBrowserRequested ? tryAcquisition(options.browserLive ? "browser-live" : options.cdp === undefined ? "browser" : "browser-cdp", () => deps.acquireBrowser(options, browserTemporaryDirectory, false), scope, options.timeoutMs, deps.extractPage, eagerBrowserCandidates, eagerBrowserAttempts) : null;
    if (options.mode === "file") {
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
          browserOperationalWarnings.push("An attached browser attempt may have navigated, clicked eligible disclosure controls, and scrolled the active tab even if that candidate was not selected.");
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
          outputDirectory: join6(transaction.assetsDirectory, "media"),
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
        markdownPath: join6(outputDirectory, `${slug}.md`),
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
    rmSync4(browserTemporaryDirectory, { recursive: true, force: true });
  }
}

// src/clip/doctor.ts
import { chmodSync as chmodSync5, existsSync as existsSync6, mkdtempSync as mkdtempSync5, readFileSync as readFileSync6, rmSync as rmSync5, writeFileSync as writeFileSync5 } from "fs";
import { homedir as homedir4, tmpdir as tmpdir4 } from "os";
import { dirname as dirname4, join as join7, resolve as resolve6 } from "path";
var expectedBunVersion = "1.3.14";
var dependencyVersions = {
  defuddle: "0.19.1",
  "agent-browser": "0.32.3",
  "@steipete/sweet-cookie": "0.4.0"
};
var dependencyNames = [
  "defuddle",
  "agent-browser",
  "@steipete/sweet-cookie"
];
var isRecord7 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
async function readBoundedStream3(stream, maxBytes) {
  const reader = stream.getReader();
  const bytes = new BoundedByteBuffer(maxBytes);
  try {
    for (;; ) {
      const result = await reader.read();
      if (result.done)
        break;
      if (!bytes.append(result.value))
        throw new Error(`diagnostic output exceeded ${maxBytes} bytes`);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(bytes.toUint8Array());
}
var runDiagnosticCommand = async (specification) => {
  const child = Bun.spawn([...specification.command], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ...specification.cwd === undefined ? {} : { cwd: specification.cwd },
    ...specification.environment === undefined ? {} : { env: specification.environment }
  });
  let timedOut = false;
  let forceKillTimer = null;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
  }, specification.timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readBoundedStream3(child.stdout, specification.maxOutputBytes),
      readBoundedStream3(child.stderr, specification.maxOutputBytes),
      child.exited
    ]);
    if (timedOut)
      throw new Error(`diagnostic command timed out after ${specification.timeoutMs}ms`);
    return { stdout, stderr, exitCode };
  } catch (error) {
    child.kill("SIGKILL");
    await child.exited;
    throw error;
  } finally {
    clearTimeout(timer);
    if (forceKillTimer !== null)
      clearTimeout(forceKillTimer);
  }
};
function parseJson2(value) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1;index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined || line[0] !== "{" && line[0] !== "[")
      continue;
    try {
      return JSON.parse(line);
    } catch {}
  }
  return null;
}
function readJsonRecord(path, readText) {
  try {
    const parsed = JSON.parse(readText(path));
    return isRecord7(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function dependencyVersion(manifest, name) {
  if (manifest === null)
    return null;
  for (const key of ["dependencies", "devDependencies"]) {
    const section = manifest[key];
    if (!isRecord7(section))
      continue;
    const value = section[name];
    if (typeof value === "string")
      return value;
  }
  return null;
}
function packageDirectory(name) {
  return name.startsWith("@") ? name.split("/") : [name];
}
function installedDependencyDirectory(name, packageRoot, readText) {
  const segments = packageDirectory(name);
  let directory = resolve6(packageRoot);
  for (let depth = 0;depth < 12; depth += 1) {
    const candidate = join7(directory, "node_modules", ...segments);
    const manifest = readJsonRecord(join7(candidate, "package.json"), readText);
    if (manifest !== null)
      return { directory: candidate, manifest };
    const parent = dirname4(directory);
    if (parent === directory)
      break;
    directory = parent;
  }
  return null;
}
function reportDependency(name, packageRoot, rootManifest, readText) {
  const expectedVersion = dependencyVersions[name];
  const declaredVersion = dependencyVersion(rootManifest, name);
  const installed = installedDependencyDirectory(name, packageRoot, readText);
  const installedVersion = typeof installed?.manifest.version === "string" ? installed.manifest.version : null;
  const status = installedVersion === expectedVersion && declaredVersion !== null ? "ready" : installedVersion === null ? "unavailable" : "partial";
  return { name, expectedVersion, declaredVersion, installedVersion, status };
}
var browserDefinitions = [
  {
    name: "Google Chrome",
    macApplications: ["Google Chrome"],
    executableNames: {
      darwin: ["google-chrome"],
      linux: ["google-chrome", "google-chrome-stable"],
      win32: ["chrome"]
    },
    linuxPaths: [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/local/bin/google-chrome",
      "/opt/google/chrome/google-chrome"
    ]
  },
  {
    name: "Chromium",
    macApplications: ["Chromium"],
    executableNames: {
      darwin: ["chromium"],
      linux: ["chromium", "chromium-browser"],
      win32: ["chromium"]
    },
    linuxPaths: [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/local/bin/chromium",
      "/snap/bin/chromium"
    ]
  },
  {
    name: "Microsoft Edge",
    macApplications: ["Microsoft Edge"],
    executableNames: {
      darwin: ["microsoft-edge"],
      linux: ["microsoft-edge", "microsoft-edge-stable"],
      win32: ["msedge"]
    },
    linuxPaths: [
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable",
      "/opt/microsoft/msedge/msedge"
    ]
  },
  {
    name: "Arc",
    macApplications: ["Arc"],
    executableNames: {},
    linuxPaths: []
  }
];
function browserPaths(definition, platform, homeDirectory, which, exists) {
  const candidates = [];
  if (platform === "darwin") {
    for (const applicationName of definition.macApplications) {
      candidates.push(`/Applications/${applicationName}.app`, join7(homeDirectory, "Applications", `${applicationName}.app`));
    }
  }
  if (platform === "linux")
    candidates.push(...definition.linuxPaths);
  for (const executable of definition.executableNames[platform] ?? []) {
    const path = which(executable);
    if (path !== null)
      candidates.push(path);
  }
  return [...new Set(candidates.filter((path) => exists(path)))];
}
function findExecutable(name, commonPaths, which, exists) {
  const fromPath = which(name);
  if (fromPath !== null && exists(fromPath))
    return fromPath;
  return commonPaths.find((path) => exists(path)) ?? null;
}
async function commandVersion(path, arguments_, run) {
  if (path === null)
    return null;
  try {
    const result = await run({ command: [path, ...arguments_], timeoutMs: 30000, maxOutputBytes: 128 * 1024 });
    if (result.exitCode !== 0)
      return null;
    const firstLine2 = result.stdout.trim().split(/\r?\n/, 1)[0] ?? "";
    return firstLine2 === "" ? null : firstLine2;
  } catch {
    return null;
  }
}
async function inspectAgentBrowser(agentBrowserDirectory, exists, run) {
  if (agentBrowserDirectory === null)
    return { deriveClient: false, profiles: [] };
  const executable = join7(agentBrowserDirectory, "bin", "agent-browser.js");
  if (!exists(executable))
    return { deriveClient: false, profiles: [] };
  const directory = mkdtempSync5(join7(tmpdir4(), "cclrte-kb-doctor-"));
  const socketRoot = process.platform === "win32" ? tmpdir4() : "/tmp";
  const socketDirectory = mkdtempSync5(join7(socketRoot, "jc-ab-doctor-"));
  chmodSync5(directory, 448);
  chmodSync5(socketDirectory, 448);
  const configPath = join7(directory, "agent-browser.config.json");
  writeFileSync5(configPath, `{}
`, { encoding: "utf8", flag: "wx", mode: 384 });
  chmodSync5(configPath, 384);
  const base = [process.execPath, executable, "--config", configPath];
  const isolatedCommand = {
    cwd: directory,
    environment: isolatedAgentBrowserEnvironment(process.env, socketDirectory),
    timeoutMs: 20000,
    maxOutputBytes: 2 * 1024 * 1024
  };
  let skillsResult;
  let profilesResult;
  try {
    [skillsResult, profilesResult] = await Promise.all([
      run({ ...isolatedCommand, command: [...base, "skills", "list", "--json"] }).catch(() => null),
      run({ ...isolatedCommand, command: [...base, "profiles", "--json"] }).catch(() => null)
    ]);
  } finally {
    rmSync5(socketDirectory, { recursive: true, force: true });
    rmSync5(directory, { recursive: true, force: true });
  }
  let deriveClient = false;
  if (skillsResult?.exitCode === 0) {
    const parsed = parseJson2(skillsResult.stdout);
    if (isRecord7(parsed) && parsed.success === true && Array.isArray(parsed.data)) {
      deriveClient = parsed.data.some((entry) => isRecord7(entry) && entry.name === "derive-client");
    }
  }
  const profiles = new Set;
  if (profilesResult?.exitCode === 0) {
    const parsed = parseJson2(profilesResult.stdout);
    if (isRecord7(parsed) && parsed.success === true && Array.isArray(parsed.data)) {
      for (const entry of parsed.data) {
        if (!isRecord7(entry) || typeof entry.name !== "string")
          continue;
        const name = entry.name.trim();
        if (name !== "")
          profiles.add(name);
      }
    }
  }
  return { deriveClient, profiles: [...profiles].sort((left, right) => left.localeCompare(right)) };
}
async function inspectClipEnvironment(options = {}) {
  const packageRoot = resolve6(options.packageRoot ?? findKbPackageRoot());
  const homeDirectory = options.homeDirectory ?? homedir4();
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync6;
  const readText = options.readText ?? ((path) => readFileSync6(path, "utf8"));
  const which = options.which ?? ((name) => Bun.which(name));
  const run = options.run ?? runDiagnosticCommand;
  const rootManifest = readJsonRecord(join7(packageRoot, "package.json"), readText);
  const dependencies = dependencyNames.map((name) => reportDependency(name, packageRoot, rootManifest, readText));
  const agentBrowserDirectory = installedDependencyDirectory("agent-browser", packageRoot, readText)?.directory ?? null;
  const browsers = browserDefinitions.map((definition) => {
    const paths = browserPaths(definition, platform, homeDirectory, which, exists);
    return { name: definition.name, paths, status: paths.length === 0 ? "unavailable" : "ready" };
  });
  const ytDlpPath = findExecutable("yt-dlp", [
    join7(homeDirectory, ".local", "bin", "yt-dlp"),
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp"
  ], which, exists);
  const ffmpegPath = findExecutable("ffmpeg", [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg"
  ], which, exists);
  const [agentBrowser, ytDlpVersion, ffmpegVersion] = await Promise.all([
    inspectAgentBrowser(agentBrowserDirectory, exists, run),
    commandVersion(ytDlpPath, ["--version"], run),
    commandVersion(ffmpegPath, ["-version"], run)
  ]);
  const tools = [
    {
      name: "yt-dlp",
      path: ytDlpPath,
      version: ytDlpVersion,
      status: ytDlpPath === null ? "unavailable" : ytDlpVersion === null ? "partial" : "ready"
    },
    {
      name: "ffmpeg",
      path: ffmpegPath,
      version: ffmpegVersion,
      status: ffmpegPath === null ? "unavailable" : ffmpegVersion === null ? "partial" : "ready"
    }
  ];
  const warnings = [];
  const currentBunVersion = options.currentBunVersion ?? Bun.version;
  if (currentBunVersion !== expectedBunVersion) {
    warnings.push(`Use Bun ${expectedBunVersion}; current runtime is ${currentBunVersion}.`);
  }
  for (const dependency of dependencies) {
    if (dependency.status === "unavailable") {
      warnings.push(`${dependency.name} ${dependency.expectedVersion} is not installed; reinstall @cclrte/kb with Bun.`);
    } else if (dependency.status === "partial") {
      warnings.push(`${dependency.name} must resolve to ${dependency.expectedVersion} for this kb release.`);
    }
  }
  if (!agentBrowser.deriveClient) {
    warnings.push("agent-browser does not expose the derive-client skill; reinstall the pinned dependency before HAR-based client work.");
  }
  const renderedBrowserAvailable = browsers.some(({ name, status }) => (name === "Google Chrome" || name === "Chromium") && status === "ready");
  if (!renderedBrowserAvailable) {
    warnings.push("Install Google Chrome or Chromium for rendered capture; Microsoft Edge can also be used through an explicitly selected CDP session, while Arc remains an explicit cookie or CDP source.");
  }
  if (agentBrowser.profiles.length === 0) {
    warnings.push("No discoverable Chrome profile names were reported; use --browser-live, --cdp, or an explicit profile path when needed.");
  }
  if (ytDlpPath === null)
    warnings.push("Install yt-dlp to enable --media all for supported public or authorized pages.");
  if (ffmpegPath === null)
    warnings.push("Install ffmpeg for yt-dlp formats that require audio/video merging or remuxing.");
  return {
    schemaVersion: 1,
    generatedAt: (options.now ?? (() => new Date))().toISOString(),
    bun: {
      expectedVersion: expectedBunVersion,
      currentVersion: currentBunVersion,
      status: currentBunVersion === expectedBunVersion ? "ready" : "partial"
    },
    dependencies,
    deriveClient: {
      available: agentBrowser.deriveClient,
      status: agentBrowser.deriveClient ? "ready" : "unavailable"
    },
    browsers,
    chromeProfileNames: agentBrowser.profiles,
    tools,
    warnings
  };
}
function versionSummary(report) {
  const installed = report.installedVersion ?? "not installed";
  return `${report.name}: ${report.status} (installed ${installed}; expected ${report.expectedVersion})`;
}
function renderDoctorReport(report) {
  const lines = [
    "Clip environment",
    `Bun: ${report.bun.status} (${report.bun.currentVersion}; expected ${report.bun.expectedVersion})`,
    ...report.dependencies.map(versionSummary),
    `agent-browser derive-client: ${report.deriveClient.status}`,
    ...report.browsers.map((browser) => `${browser.name}: ${browser.status}${browser.paths.length === 0 ? "" : ` (${browser.paths.join(", ")})`}`),
    `Chrome profiles: ${report.chromeProfileNames.length === 0 ? "none discovered" : report.chromeProfileNames.join(", ")}`,
    ...report.tools.map((tool) => `${tool.name}: ${tool.status}${tool.version === null ? "" : ` (${tool.version})`}${tool.path === null ? "" : ` at ${tool.path}`}`),
    "Cookie/keychain probe: not performed"
  ];
  if (report.warnings.length > 0) {
    lines.push("", "Warnings:", ...report.warnings.map((warning) => `- ${warning}`));
  }
  return `${lines.join(`
`)}
`;
}
var adapterCapabilities = [
  {
    platform: "Generic web",
    preferredModes: ["HTTP + Defuddle", "rendered browser fallback", "saved HTML"],
    page: "best-effort",
    conversations: "best-effort",
    media: "best-effort",
    limitations: [
      "JavaScript-only regions require a browser",
      "visible conversation prose can be retained, but site-specific item trees are not inferred generically"
    ]
  },
  {
    platform: "X",
    preferredModes: ["rendered Chrome profile/live session", "Defuddle X extractor"],
    page: "best-effort",
    conversations: "best-effort",
    media: "best-effort",
    limitations: ["Only posts and replies loaded into the rendered page are captured", "virtualized or unloaded replies remain partial", "private GraphQL clients are not invoked automatically"]
  },
  {
    platform: "Substack",
    preferredModes: ["HTTP + Defuddle", "authorized rendered session for subscriber pages"],
    page: "access-dependent",
    conversations: "best-effort",
    media: "best-effort",
    limitations: ["Subscriber-only text is captured only when the selected session can already view it", "visible comments are retained as unstructured rendered context with conservative counts", "email/app-only or virtualized comments can be absent"]
  },
  {
    platform: "Instagram",
    preferredModes: ["authorized rendered session", "yt-dlp for accessible media"],
    page: "best-effort",
    conversations: "best-effort",
    media: "best-effort",
    limitations: ["Generic rendered context; no dedicated item adapter", "Login walls, virtualization, and lazy-loaded comments limit completeness", "private accounts require the user's authorized session"]
  },
  {
    platform: "LinkedIn",
    preferredModes: ["authorized rendered session", "saved rendered HTML"],
    page: "best-effort",
    conversations: "best-effort",
    media: "best-effort",
    limitations: ["Generic rendered fallback; no dedicated adapter", "UI changes and collapsed comment branches can reduce completeness", "no automated private API derivation"]
  },
  {
    platform: "Paywalled sites",
    preferredModes: ["authorized rendered session", "origin-filtered cookie HTTP fallback"],
    page: "access-dependent",
    conversations: "access-dependent",
    media: "access-dependent",
    limitations: ["Never bypasses a paywall, DRM, login, or other access control", "captures only content the supplied session is authorized to view"]
  },
  {
    platform: "Hacker News",
    preferredModes: ["official Firebase API", "rendered/Defuddle fallback"],
    page: "complete",
    conversations: "bounded",
    media: "unsupported",
    limitations: ["Comment count and depth obey CLI bounds", "deleted and dead items remain represented only as exposed by the service"]
  },
  {
    platform: "Reddit",
    preferredModes: ["best-effort public listing JSON", "rendered session", "Defuddle Reddit extractor"],
    page: "best-effort",
    conversations: "bounded",
    media: "best-effort",
    limitations: ["The unofficial JSON surface can be denied or changed and falls back automatically", "collapsed/deleted branches and configured item/depth bounds remain explicit"]
  },
  {
    platform: "Facebook",
    preferredModes: ["authorized rendered session", "yt-dlp for accessible media"],
    page: "best-effort",
    conversations: "best-effort",
    media: "best-effort",
    limitations: ["Generic rendered context; no dedicated item adapter", "Only visible, loaded content is captured", "private audiences require the user's authorized session"]
  },
  {
    platform: "TikTok",
    preferredModes: ["rendered session", "yt-dlp for accessible media"],
    page: "best-effort",
    conversations: "best-effort",
    media: "best-effort",
    limitations: ["Generic rendered context; no dedicated thread adapter", "Regional/login gates, virtualization, and lazy-loaded comments can reduce completeness", "DRM and access controls are never bypassed"]
  },
  {
    platform: "Bluesky",
    preferredModes: ["public AT Protocol thread API", "rendered/Defuddle fallback"],
    page: "complete",
    conversations: "bounded",
    media: "best-effort",
    limitations: ["Thread count and depth obey CLI bounds", "moderation labels and unavailable records are preserved only as exposed"]
  }
];
function renderAdapterCapabilities(capabilities = adapterCapabilities) {
  const lines = [
    "Clip adapters",
    "Statuses: complete, bounded, best-effort, access-dependent, unsupported.",
    ""
  ];
  for (const capability of capabilities) {
    lines.push(`${capability.platform}: page=${capability.page}, conversations=${capability.conversations}, media=${capability.media}`, `  modes: ${capability.preferredModes.join("; ")}`, ...capability.limitations.map((limitation) => `  - ${limitation}`));
  }
  lines.push("", "Authentication is explicit. Cookie replay is request-filtered; a selected full browser profile retains that profile's broader browser state.", "The tool never bypasses paywalls, DRM, logins, or other access controls.", "HAR-derived clients are an explicit advanced workflow and require separate policy/legal review; they are not generated during capture.");
  return `${lines.join(`
`)}
`;
}

// src/clip/args.ts
var captureModes = ["auto", "http", "browser", "file"];
var captureScopes = ["auto", "page", "thread", "comments"];
var mediaModes = ["none", "images", "all"];
var evidenceModes = ["none", "source", "screenshot", "all"];
var cookieSources = ["chrome", "arc", "brave", "chromium", "edge", "firefox", "safari"];
var DEFAULT_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " + "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var defaults = {
  timeoutMs: 30000,
  maxItems: 500,
  maxDepth: 16,
  maxHtmlBytes: 25 * 1024 * 1024,
  maxAssetBytes: 100 * 1024 * 1024,
  maxTotalAssetBytes: 500 * 1024 * 1024
};
var valueOptions = new Set([
  "--mode",
  "--scope",
  "--media",
  "--evidence",
  "--html",
  "--output",
  "--browser-profile",
  "--cdp",
  "--cookie-profile",
  "--cookies-file",
  "--user-agent",
  "--cookie-source",
  "--timeout-ms",
  "--max-items",
  "--max-depth",
  "--max-html-bytes",
  "--max-asset-bytes",
  "--max-total-asset-bytes"
]);
function enumValue(value, values, label) {
  const match = values.find((candidate) => candidate === value);
  return match === undefined ? { ok: false, message: `${label} must be one of ${values.join(", ")}` } : { ok: true, value: match };
}
function positiveInteger(value, label, maximum) {
  if (!/^\d+$/.test(value))
    return `${label} must be a positive integer`;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    return `${label} must be between 1 and ${maximum}`;
  }
  return parsed;
}
function byteSize(value, label) {
  const match = /^(\d+)(b|kb|mb|gb)?$/i.exec(value);
  if (match === null || match[1] === undefined) {
    return `${label} must be an integer byte size such as 500000, 25mb, or 1gb`;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  const multiplier = unit === "gb" ? 1024 ** 3 : unit === "mb" ? 1024 ** 2 : unit === "kb" ? 1024 : 1;
  const parsed = amount * multiplier;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 8 * 1024 ** 3) {
    return `${label} must be between 1 byte and 8gb`;
  }
  return parsed;
}
function readOptionValue(args, index, flag) {
  const value = args[index + 1];
  return value === undefined || value.startsWith("--") ? { ok: false, message: `${flag} requires a value` } : value;
}
function parseUrl(value, label = "URL") {
  if (value.length > 64 * 1024)
    return `${label} exceeds the 65536 code-unit safety limit`;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return `${label} must use http or https`;
    if (url.username !== "" || url.password !== "") {
      return `${label} must not contain embedded credentials; use --cookies-file or a browser session`;
    }
    return url;
  } catch {
    return `${label} is not a valid URL`;
  }
}
function parseArguments(rawArgs, environment = {}) {
  if (rawArgs.length === 0 || rawArgs[0] === "help" || rawArgs[0] === "--help" || rawArgs[0] === "-h") {
    return { ok: true, value: { command: "help" } };
  }
  const first = rawArgs[0];
  if (first === "doctor" || first === "adapters") {
    const extra = rawArgs.slice(1);
    if (extra.some((value) => value !== "--json")) {
      return { ok: false, message: `${first} only accepts --json` };
    }
    return { ok: true, value: { command: first, json: extra.includes("--json") } };
  }
  let command = "capture";
  let cursor = 0;
  if (first === "capture" || first === "inspect") {
    command = first;
    cursor += 1;
  }
  const positional = [];
  let mode = "auto";
  let scope = "auto";
  let media = command === "inspect" ? "none" : "images";
  let evidence = "none";
  let mediaExplicit = false;
  let evidenceExplicit = false;
  let htmlFile;
  let outputBase = environment.KB_CLIP_OUTPUT ?? "kb/articles";
  let force = false;
  let stdout = command === "inspect";
  let stdoutExplicit = false;
  let json = false;
  let quiet = false;
  let browserProfile;
  let browserLive = false;
  let cdp;
  let trustAttachedBrowserEgress = false;
  const selectedCookieSources = [];
  let cookieProfile;
  let cookiesFile;
  let timeoutMs = defaults.timeoutMs;
  let maxItems = defaults.maxItems;
  let maxDepth = defaults.maxDepth;
  let maxHtmlBytes = defaults.maxHtmlBytes;
  let maxAssetBytes = defaults.maxAssetBytes;
  let maxTotalAssetBytes = defaults.maxTotalAssetBytes;
  let allowPrivateNetwork = false;
  let userAgent = environment.KB_CLIP_USER_AGENT ?? DEFAULT_USER_AGENT;
  for (;cursor < rawArgs.length; cursor += 1) {
    const argument = rawArgs[cursor];
    if (argument === undefined)
      continue;
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    if (argument === "--force")
      force = true;
    else if (argument === "--stdout") {
      stdout = true;
      stdoutExplicit = true;
    } else if (argument === "--json")
      json = true;
    else if (argument === "--quiet")
      quiet = true;
    else if (argument === "--browser-live")
      browserLive = true;
    else if (argument === "--trust-attached-browser-egress")
      trustAttachedBrowserEgress = true;
    else if (argument === "--allow-private-network")
      allowPrivateNetwork = true;
    else {
      if (!valueOptions.has(argument))
        return { ok: false, message: `unknown option: ${argument}` };
      const value = readOptionValue(rawArgs, cursor, argument);
      if (typeof value !== "string")
        return value;
      cursor += 1;
      if (argument === "--mode") {
        const parsed = enumValue(value, captureModes, "--mode");
        if (!parsed.ok)
          return { ok: false, message: parsed.message };
        mode = parsed.value;
      } else if (argument === "--scope") {
        const parsed = enumValue(value, captureScopes, "--scope");
        if (!parsed.ok)
          return { ok: false, message: parsed.message };
        scope = parsed.value;
      } else if (argument === "--media") {
        const parsed = enumValue(value, mediaModes, "--media");
        if (!parsed.ok)
          return { ok: false, message: parsed.message };
        media = parsed.value;
        mediaExplicit = true;
      } else if (argument === "--evidence") {
        const parsed = enumValue(value, evidenceModes, "--evidence");
        if (!parsed.ok)
          return { ok: false, message: parsed.message };
        evidence = parsed.value;
        evidenceExplicit = true;
      } else if (argument === "--html")
        htmlFile = value;
      else if (argument === "--output")
        outputBase = value;
      else if (argument === "--browser-profile")
        browserProfile = value;
      else if (argument === "--cdp") {
        const parsed = positiveInteger(value, "--cdp", 65535);
        if (typeof parsed === "string") {
          return { ok: false, message: "--cdp accepts only a local remote-debugging port between 1 and 65535" };
        }
        cdp = String(parsed);
      } else if (argument === "--cookie-profile")
        cookieProfile = value;
      else if (argument === "--cookies-file")
        cookiesFile = value;
      else if (argument === "--user-agent")
        userAgent = value;
      else if (argument === "--cookie-source") {
        const parsed = enumValue(value, cookieSources, "--cookie-source");
        if (!parsed.ok)
          return { ok: false, message: parsed.message };
        selectedCookieSources.push(parsed.value);
      } else if (argument === "--timeout-ms") {
        const parsed = positiveInteger(value, argument, 10 * 60000);
        if (typeof parsed === "string")
          return { ok: false, message: parsed };
        timeoutMs = parsed;
      } else if (argument === "--max-items") {
        const parsed = positiveInteger(value, argument, 1e4);
        if (typeof parsed === "string")
          return { ok: false, message: parsed };
        maxItems = parsed;
      } else if (argument === "--max-depth") {
        const parsed = positiveInteger(value, argument, 64);
        if (typeof parsed === "string")
          return { ok: false, message: parsed };
        maxDepth = parsed;
      } else if (argument === "--max-html-bytes") {
        const parsed = byteSize(value, argument);
        if (typeof parsed === "string")
          return { ok: false, message: parsed };
        maxHtmlBytes = parsed;
      } else if (argument === "--max-asset-bytes") {
        const parsed = byteSize(value, argument);
        if (typeof parsed === "string")
          return { ok: false, message: parsed };
        maxAssetBytes = parsed;
      } else if (argument === "--max-total-asset-bytes") {
        const parsed = byteSize(value, argument);
        if (typeof parsed === "string")
          return { ok: false, message: parsed };
        maxTotalAssetBytes = parsed;
      }
    }
  }
  if (positional.length === 0)
    return { ok: false, message: `${command} requires a URL` };
  if (positional.length > 2)
    return { ok: false, message: `${command} accepts one URL and one optional slug` };
  const parsedUrl = parseUrl(positional[0] ?? "");
  if (typeof parsedUrl === "string")
    return { ok: false, message: parsedUrl };
  if (mode === "file" && htmlFile === undefined)
    return { ok: false, message: "--mode file requires --html <path|->" };
  if (htmlFile !== undefined && mode !== "auto" && mode !== "file") {
    return { ok: false, message: "--html can only be used with --mode auto or --mode file" };
  }
  if (browserLive && browserProfile !== undefined) {
    return { ok: false, message: "--browser-live and --browser-profile are mutually exclusive" };
  }
  if (cdp !== undefined && (browserLive || browserProfile !== undefined)) {
    return { ok: false, message: "--cdp cannot be combined with --browser-live or --browser-profile" };
  }
  const hasBrowserSelection = browserLive || cdp !== undefined || browserProfile !== undefined;
  if (hasBrowserSelection && (mode === "http" || mode === "file" || htmlFile !== undefined)) {
    return { ok: false, message: "browser selection requires --mode auto or --mode browser and cannot be combined with --html" };
  }
  if ((browserLive || cdp !== undefined) && !trustAttachedBrowserEgress) {
    return {
      ok: false,
      message: "--browser-live and --cdp require --trust-attached-browser-egress to acknowledge the attached browser's unfiltered network access"
    };
  }
  if ((evidence === "screenshot" || evidence === "all") && (mode === "http" || mode === "file" || htmlFile !== undefined)) {
    return { ok: false, message: "screenshot evidence requires --mode auto or --mode browser" };
  }
  if (selectedCookieSources.length > 1) {
    return { ok: false, message: "select at most one --cookie-source so profile and media behavior stay unambiguous" };
  }
  if (selectedCookieSources.length > 0 && cookiesFile !== undefined) {
    return { ok: false, message: "--cookie-source and --cookies-file are mutually exclusive authentication sources" };
  }
  if (cookieProfile !== undefined && selectedCookieSources.length === 0) {
    return { ok: false, message: "--cookie-profile requires at least one --cookie-source" };
  }
  if (maxTotalAssetBytes < maxAssetBytes) {
    return { ok: false, message: "--max-total-asset-bytes cannot be smaller than --max-asset-bytes" };
  }
  if (stdoutExplicit && json)
    return { ok: false, message: "--stdout and --json cannot be combined" };
  if (stdout && force)
    return { ok: false, message: "--stdout and --force cannot be combined" };
  if (command === "inspect" && media !== "none") {
    return { ok: false, message: "inspect does not persist media; use capture or pass --media none" };
  }
  if (command === "inspect" && evidence !== "none") {
    return { ok: false, message: "inspect does not persist evidence; use capture or pass --evidence none" };
  }
  if (stdout && mediaExplicit && media !== "none") {
    return { ok: false, message: "--stdout does not persist media; use capture without --stdout or pass --media none" };
  }
  if (stdout && evidenceExplicit && evidence !== "none") {
    return { ok: false, message: "--stdout does not persist evidence; use capture without --stdout or pass --evidence none" };
  }
  return {
    ok: true,
    value: {
      command,
      url: parsedUrl,
      slug: positional[1],
      mode: htmlFile === undefined ? mode : "file",
      scope,
      media: stdout ? "none" : media,
      evidence: stdout ? "none" : evidence,
      htmlFile,
      outputBase,
      force,
      stdout,
      json,
      quiet,
      browserProfile,
      browserLive,
      cdp,
      trustAttachedBrowserEgress,
      cookieSources: selectedCookieSources,
      cookieProfile,
      cookiesFile,
      timeoutMs,
      maxItems,
      maxDepth,
      maxHtmlBytes,
      maxAssetBytes,
      maxTotalAssetBytes,
      allowPrivateNetwork,
      userAgent
    }
  };
}
var usage = `Usage:
  kb clip <url> [slug] [options]
  kb clip capture <url> [slug] [options]
  kb clip inspect <url> [options]
  kb doctor [--json]
  kb adapters [--json]

Capture options:
  --mode auto|http|browser|file     Acquisition strategy (default: auto)
  --scope auto|page|thread|comments Content scope (default: platform-aware)
  --html <path|->                  Parse saved/rendered HTML; - reads stdin
  --browser-profile <name|path>    Use a signed-in or persistent Chrome profile
  --browser-live                   Attach to and navigate user-approved live Chrome
  --cdp <loopback-port>            Attach to a local CDP-capable browser
  --trust-attached-browser-egress  Acknowledge that live/CDP traffic cannot be filtered
  --cookie-source <browser>        chrome|arc|brave|chromium|edge|firefox|safari
  --cookie-profile <name|path>     Browser profile; Safari expects a Cookies.binarycookies path
  --cookies-file <path>            Cookie-Editor JSON/base64, Netscape, Cookie header, or cURL input
  --media none|images|all          Localize images or all supported media
  --evidence none|source|screenshot|all
  --output <directory>             Output base (default: kb/articles)
  --stdout                         Print Markdown without writing a clip
  --json                           Print a machine-readable result summary
  --force                          Atomically replace an existing clip
  --timeout-ms <n>                 Per-request/process/extraction timeout
  --max-items <n>                  Bound comments/thread items (default: 500)
  --max-depth <n>                  Bound nested replies (default: 16)
  --max-html-bytes <size>          HTML cap (default: 25mb)
  --max-asset-bytes <size>         Per-asset cap (default: 100mb)
  --max-total-asset-bytes <size>   Total asset cap (default: 500mb)
  --allow-private-network          Permit private targets in every network lane
  --user-agent <value>             Override the browser-like user agent
  --quiet                          Suppress progress output
`;

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
    output.stderr(`Capturing ${safe(arguments_.url.href)} (${arguments_.mode}, ${arguments_.scope}) ...
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
if (false)
  ;

export { sanitizeTerminalText, sanitizeTerminalLine, redactSensitiveText, runCapture, inspectClipEnvironment, adapterCapabilities, captureSummary, captureSucceeded, captureExitCode, main };
