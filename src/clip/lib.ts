import { sanitizeTerminalText } from "./terminal.js";

/** Defuddle fields consumed after narrowing its JSON output. */
export type Article = {
  content: string;
  title: string | null;
  author: string | null;
  published: string | null;
  description: string | null;
};

export const articleMetadataLimits = {
  title: 2_048,
  author: 1_024,
  published: 256,
  description: 8_192,
} as const;

const MAX_SLUG_INPUT_CODE_UNITS = 4_096;
const MAX_YAML_SCALAR_CODE_UNITS = 16_384;

function boundedPrefix(value: string, maxCodeUnits: number, marker = ""): string {
  if (value.length <= maxCodeUnits) return value;
  const markerLength = Math.min(marker.length, maxCodeUnits);
  let end = maxCodeUnits - markerLength;
  const finalCode = value.charCodeAt(end - 1);
  if (finalCode >= 0xd800 && finalCode <= 0xdbff) end -= 1;
  return value.slice(0, Math.max(0, end)) + marker.slice(0, markerLength);
}

function boundedMetadata(value: string | null, maxCodeUnits: number): string | null {
  return value === null ? null : boundedPrefix(value, maxCodeUnits, "…");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmptyString = (value: unknown, maxCodeUnits?: number): string | null => {
  if (typeof value !== "string" || !/\S/u.test(value)) return null;
  return maxCodeUnits === undefined ? value : boundedPrefix(value, maxCodeUnits, "…");
};

/** Narrow Defuddle JSON; return null when it contains no usable Markdown. */
export function parseArticle(parsed: unknown): Article | null {
  if (!isRecord(parsed)) return null;
  const content = nonEmptyString(parsed.content);
  if (content === null) return null;
  return {
    content,
    title: nonEmptyString(parsed.title, articleMetadataLimits.title),
    author: nonEmptyString(parsed.author, articleMetadataLimits.author),
    published: nonEmptyString(parsed.published, articleMetadataLimits.published),
    description: nonEmptyString(parsed.description, articleMetadataLimits.description),
  };
}

/** Collapse input to one lowercase, filesystem-safe path segment of at most 80 characters. */
export function slugify(value: string): string {
  const normalized = boundedPrefix(value, MAX_SLUG_INPUT_CODE_UNITS)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+$/g, "");
  let end = 0;
  let characters = 0;
  for (const character of normalized) {
    if (characters === 80) break;
    end += character.length;
    characters += 1;
  }
  return normalized.slice(0, end).replace(/-+$/g, "");
}

/** Encode a valid double-quoted, single-line YAML scalar. */
export function yamlString(value: string): string {
  const sanitized = sanitizeTerminalText(boundedPrefix(value, MAX_YAML_SCALAR_CODE_UNITS, "…"));
  const chunks: string[] = ['"'];
  let unchangedStart = 0;
  for (let cursor = 0; cursor < sanitized.length; cursor += 1) {
    const character = sanitized[cursor] ?? "";
    const codePoint = sanitized.charCodeAt(cursor);
    let replacement: string | null = null;
    if (character === "\\") replacement = "\\\\";
    else if (character === '"') replacement = '\\"';
    else if (character === "\n") replacement = "\\n";
    else if (character === "\r") replacement = "\\r";
    else if (character === "\t") replacement = "\\t";
    else if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      replacement = `\\x${codePoint.toString(16).padStart(2, "0")}`;
    } else if (codePoint === 0x2028 || codePoint === 0x2029 || codePoint === 0xfeff) {
      replacement = `\\u${codePoint.toString(16).padStart(4, "0")}`;
    }
    if (replacement === null) continue;
    chunks.push(sanitized.slice(unchangedStart, cursor), replacement);
    unchangedStart = cursor + 1;
  }
  chunks.push(sanitized.slice(unchangedStart), '"');
  return chunks.join("");
}

/** Resolve an HTTP target and reject data, fragment, non-web, and invalid values. */
export function resolveRemote(source: string, base: URL): URL | null {
  if (
    source.length > MAX_REMOTE_SOURCE_CODE_UNITS
    || source.startsWith("data:")
    || source.startsWith("#")
  ) return null;
  try {
    const url = new URL(source, base);
    return (url.protocol === "http:" || url.protocol === "https:")
      && url.href.length <= MAX_RESOLVED_URL_CODE_UNITS
      ? url
      : null;
  } catch {
    return null;
  }
}

function inertRemoteImageHref(url: URL): string {
  const inert = new URL(url);
  inert.username = "";
  inert.password = "";
  inert.search = "";
  inert.hash = "";
  return inert.href.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

const balancedParentheses = /[^()\s]*(?:\([^()\s]*(?:\([^()\s]*(?:\([^()\s]*\)[^()\s]*)?\)[^()\s]*)?\)[^()\s]*)*/;
const markdownImage = new RegExp(
  `!\\[([^\\]]*)\\]\\((?:<([^<>]*)>|(${balancedParentheses.source}))((?:\\s+"[^"]*")?)\\)`,
  "g",
);
const htmlImage = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
const plainLink = new RegExp(
  `(\\]\\()(?:<([^<>]*)>|(${balancedParentheses.source}))((?:\\s+"[^"]*")?)(\\))`,
  "g",
);
const referenceImage = /!\[([^\]\r\n]*)\]\[([^\]\r\n]*)\]/g;
const referenceDefinition = /^([ \t]{0,3}\[([^\]\r\n]+)\]:[ \t]*)(?:<([^<>\r\n]*)>|(\S+))([^\r\n]*)$/gm;
const obsidianEmbed = /!\[\[([^\]\r\n]+)\]\]/g;

const safeMarkdownHtmlElements = new Set([
  "abbr", "b", "bdi", "bdo", "blockquote", "br", "caption", "cite", "code", "col", "colgroup",
  "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2",
  "h3", "h4", "h5", "h6", "hr", "i", "kbd", "li", "mark", "ol", "p", "pre", "q", "rp",
  "rt", "ruby", "s", "samp", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody",
  "td", "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr",
]);
const rawHtmlTag = /<\s*(?!https?:\/\/)(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)\b[^>]*>/gi;
const unsafeMarkdownImage = /!\[([^\]]*)\]\(\s*<?\s*(?:data|javascript|vbscript|file|blob):[^\r\n]*\)/gi;
const protectedPlaceholder = /\0PROTECTED(\d+)\0/g;
const MAX_PROTECTED_MARKDOWN_SPANS = 4_096;
const MAX_INLINE_CODE_RUNS_PER_LINE = 4_096;
const MAX_IMAGE_CANDIDATES = 250_000;
const MAX_MARKUP_CANDIDATES = 50_000;
const MAX_INERT_OVERFLOW_PREVIEW_CODE_UNITS = 256 * 1024;
const MAX_IMAGE_SOURCES = 10_001;
const MAX_REFERENCE_LABELS = 10_001;
const MAX_REFERENCE_LABEL_CODE_UNITS = 1_024;
const MAX_REMOTE_SOURCE_CODE_UNITS = 8_192;
const MAX_RESOLVED_URL_CODE_UNITS = 16_384;
const MAX_IMAGE_ALT_CODE_UNITS = 2_048;

type FenceDelimiter = {
  readonly marker: "`" | "~";
  readonly length: number;
};

function openingFence(content: string, lineStart: number, lineEnd: number): FenceDelimiter | null {
  let cursor = lineStart;
  let indentation = 0;
  while (indentation < 3 && content[cursor] === " ") {
    cursor += 1;
    indentation += 1;
  }
  const marker = content[cursor];
  if (marker !== "`" && marker !== "~") return null;
  const runStart = cursor;
  while (cursor < lineEnd && content[cursor] === marker) cursor += 1;
  const length = cursor - runStart;
  if (length < 3) return null;
  // CommonMark forbids a backtick in a backtick fence's info string.
  const laterBacktick = marker === "`" ? content.indexOf("`", cursor) : -1;
  if (laterBacktick !== -1 && laterBacktick < lineEnd) return null;
  return { marker, length };
}

function isClosingFence(
  content: string,
  lineStart: number,
  lineEnd: number,
  delimiter: FenceDelimiter,
): boolean {
  let cursor = lineStart;
  let indentation = 0;
  while (indentation < 3 && content[cursor] === " ") {
    cursor += 1;
    indentation += 1;
  }
  const runStart = cursor;
  while (cursor < lineEnd && content[cursor] === delimiter.marker) cursor += 1;
  if (cursor - runStart < delimiter.length) return false;
  while (cursor < lineEnd && (content[cursor] === " " || content[cursor] === "\t" || content[cursor] === "\r")) {
    cursor += 1;
  }
  return cursor === lineEnd;
}

/** Protect fenced blocks with one forward line scan; malformed open fences fail closed. */
function protectMarkdownFences(content: string, protectedSpans: string[]): string | null {
  const chunks: string[] = [];
  let unchangedStart = 0;
  let lineStart = 0;
  let active: { readonly start: number; readonly delimiter: FenceDelimiter } | null = null;
  while (lineStart < content.length) {
    const newline = content.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? content.length : newline;
    if (active === null) {
      // The regex predecessor also required a newline after an opening fence.
      const delimiter = newline === -1 ? null : openingFence(content, lineStart, lineEnd);
      if (delimiter !== null) active = { start: lineStart, delimiter };
    } else if (isClosingFence(content, lineStart, lineEnd, active.delimiter)) {
      if (protectedSpans.length >= MAX_PROTECTED_MARKDOWN_SPANS) return null;
      chunks.push(content.slice(unchangedStart, active.start), `\0PROTECTED${protectedSpans.length}\0`);
      protectedSpans.push(content.slice(active.start, lineEnd));
      unchangedStart = lineEnd;
      active = null;
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  if (active !== null) return null;
  if (chunks.length === 0) return content;
  chunks.push(content.slice(unchangedStart));
  return chunks.join("");
}

type BacktickRun = { readonly start: number; readonly end: number; readonly length: number };

/** Protect inline code with bounded delimiter tables rather than a backtracking backreference. */
function protectInlineCodeSpans(content: string, protectedSpans: string[]): string | null {
  if (!content.includes("`")) return content;
  const chunks: string[] = [];
  let unchangedStart = 0;
  let lineStart = 0;
  while (lineStart < content.length) {
    const newline = content.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? content.length : newline;
    const runs: BacktickRun[] = [];
    let cursor = lineStart;
    for (;;) {
      const start = content.indexOf("`", cursor);
      if (start === -1 || start >= lineEnd) break;
      let end = start + 1;
      while (end < lineEnd && content[end] === "`") end += 1;
      if (runs.length >= MAX_INLINE_CODE_RUNS_PER_LINE) return null;
      runs.push({ start, end, length: end - start });
      cursor = end;
    }

    const nextSameLength: Array<number | undefined> = [];
    nextSameLength.length = runs.length;
    const laterByLength = new Map<number, number>();
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      const run = runs[index];
      if (run === undefined) continue;
      nextSameLength[index] = laterByLength.get(run.length);
      laterByLength.set(run.length, index);
    }
    for (let index = 0; index < runs.length;) {
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
      if (protectedSpans.length >= MAX_PROTECTED_MARKDOWN_SPANS) return null;
      chunks.push(content.slice(unchangedStart, opening.start), `\0PROTECTED${protectedSpans.length}\0`);
      protectedSpans.push(content.slice(opening.start, closing.end));
      unchangedStart = closing.end;
      index = closingIndex + 1;
    }

    if (newline === -1) break;
    lineStart = newline + 1;
  }
  if (chunks.length === 0) return content;
  chunks.push(content.slice(unchangedStart));
  return chunks.join("");
}

function restoreMarkdownSpans(content: string, protectedSpans: readonly string[]): string {
  return content.replace(protectedPlaceholder, (_whole, index: string) => protectedSpans[Number(index)] ?? "");
}

function inertProtectedOverflow(content: string): string {
  let previewEnd = Math.min(content.length, MAX_INERT_OVERFLOW_PREVIEW_CODE_UNITS);
  const finalCode = content.charCodeAt(previewEnd - 1);
  if (finalCode >= 0xd800 && finalCode <= 0xdbff) previewEnd -= 1;
  const escaped = content.slice(0, previewEnd).replace(
    /[&<>]/g,
    (character) => character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;",
  );
  const omitted = content.length - previewEnd;
  const omission = omitted === 0 ? "" : `\n\n[${omitted} source code unit(s) omitted]`;
  return `*[Content rendered inert because the protected Markdown span limit was exceeded.]*\n\n<pre>\n${escaped}${omission}\n</pre>`;
}

function inertCandidateOverflow(content: string): string {
  let previewEnd = Math.min(content.length, MAX_INERT_OVERFLOW_PREVIEW_CODE_UNITS);
  const finalCode = content.charCodeAt(previewEnd - 1);
  if (finalCode >= 0xd800 && finalCode <= 0xdbff) previewEnd -= 1;
  const escaped = content.slice(0, previewEnd).replace(
    /[&<>]/g,
    (character) => character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;",
  );
  const omitted = content.length - previewEnd;
  const omission = omitted === 0 ? "" : `\n\n[${omitted} source code unit(s) omitted]`;
  return `*[Content rendered inert because a markup/image-candidate safety limit was exceeded.]*\n\n<pre>\n${escaped}${omission}\n</pre>`;
}

function escapeMarkdownLabel(value: string): string {
  return boundedPrefix(value, MAX_IMAGE_ALT_CODE_UNITS, "…")
    .replace(/\\/g, "\\\\")
    .replace(/[[\]`]/g, "\\$&")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function normalizedReferenceLabel(value: string): string | null {
  if (value.length > MAX_REFERENCE_LABEL_CODE_UNITS) return null;
  return value.replace(/\\([\\[\]])/g, "$1").replace(/\s+/g, " ").trim().toLowerCase();
}

type ReferenceLabelScan = {
  readonly labels: ReadonlySet<string>;
  readonly truncated: boolean;
  readonly cardinalityExceeded: boolean;
};

function referenceLabels(content: string): ReferenceLabelScan {
  const labels = new Set<string>();
  let truncated = false;
  let cardinalityExceeded = false;
  referenceImage.lastIndex = 0;
  try {
    for (;;) {
      const match = referenceImage.exec(content);
      if (match === null) break;
      const alt = match[1] ?? "";
      const rawLabel = match[2] === "" ? alt : (match[2] ?? "");
      const label = normalizedReferenceLabel(rawLabel);
      if (label === null) {
        truncated = true;
        continue;
      }
      if (labels.has(label)) continue;
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

type ReferenceTargetScan = {
  readonly targets: ReadonlyMap<string, string>;
  readonly truncated: boolean;
};

/** Resolve only labels that an image reference actually uses; definitions elsewhere never enter the map. */
function referenceTargets(content: string, labels: ReadonlySet<string>): ReferenceTargetScan {
  const targets = new Map<string, string>();
  let truncated = false;
  if (labels.size === 0) return { targets, truncated };
  referenceDefinition.lastIndex = 0;
  try {
    for (;;) {
      const match = referenceDefinition.exec(content);
      if (match === null) break;
      const rawLabel = match[2];
      const target = match[3] ?? match[4];
      if (rawLabel === undefined || target === undefined) continue;
      const label = normalizedReferenceLabel(rawLabel);
      if (label === null || !labels.has(label)) continue;
      if (target.length > MAX_REMOTE_SOURCE_CODE_UNITS) {
        // A later invalid duplicate must not leave an earlier definition active.
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

/** Keep benign structural HTML but discard every attribute; expose unsupported tags as inert text. */
function sanitizeMarkdownHtml(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(rawHtmlTag, (_whole, closing: string, rawName: string) => {
      const name = rawName.toLowerCase();
      if (!safeMarkdownHtmlElements.has(name)) {
        return `&lt;${closing === "/" ? "/" : ""}${name}&gt;`;
      }
      return `<${closing === "/" ? "/" : ""}${name}>`;
    });
}

type ImageCandidateStructure = {
  readonly safeForRegexScan: boolean;
  readonly cardinalityExceeded: boolean;
};

/** Reject shared-suffix malformed image syntax before any regex can rescan that suffix. */
function imageCandidateStructure(content: string): ImageCandidateStructure {
  let cursor = 0;
  let count = 0;
  for (;;) {
    const start = content.indexOf("![", cursor);
    if (start === -1) return { safeForRegexScan: true, cardinalityExceeded: false };
    count += 1;
    if (count > MAX_IMAGE_CANDIDATES) {
      return { safeForRegexScan: false, cardinalityExceeded: true };
    }
    const altEnd = content.indexOf("]", start + 2);
    const nestedImage = content.indexOf("![", start + 2);
    if (altEnd === -1 || (nestedImage !== -1 && nestedImage < altEnd)) {
      return { safeForRegexScan: false, cardinalityExceeded: false };
    }

    const targetMarker = content[altEnd + 1];
    if (targetMarker === "(" || targetMarker === "[") {
      const targetEnd = content.indexOf(targetMarker === "(" ? ")" : "]", altEnd + 2);
      const nestedTargetImage = content.indexOf("![", altEnd + 2);
      if (targetEnd === -1 || (nestedTargetImage !== -1 && nestedTargetImage < targetEnd)) {
        return { safeForRegexScan: false, cardinalityExceeded: false };
      }
      cursor = targetEnd + 1;
      continue;
    }
    cursor = targetMarker === "]" ? altEnd + 2 : altEnd + 1;
  }
}

/** Bound malformed/nested tag and comment prefixes before HTML regex sanitization. */
function markupCandidateStructure(content: string): ImageCandidateStructure {
  let cursor = 0;
  let count = 0;
  for (;;) {
    const start = content.indexOf("<", cursor);
    if (start === -1) return { safeForRegexScan: true, cardinalityExceeded: false };

    if (content.startsWith("<!--", start)) {
      count += 1;
      if (count > MAX_MARKUP_CANDIDATES) {
        return { safeForRegexScan: false, cardinalityExceeded: true };
      }
      const end = content.indexOf("-->", start + 4);
      const nested = content.indexOf("<!--", start + 4);
      if (end === -1) {
        return nested === -1
          ? { safeForRegexScan: true, cardinalityExceeded: false }
          : { safeForRegexScan: false, cardinalityExceeded: false };
      }
      if (nested !== -1 && nested < end) {
        return { safeForRegexScan: false, cardinalityExceeded: false };
      }
      cursor = end + 3;
      continue;
    }

    let nameStart = start + 1;
    while (content[nameStart] === " " || content[nameStart] === "\t") nameStart += 1;
    if (content[nameStart] === "/") nameStart += 1;
    while (content[nameStart] === " " || content[nameStart] === "\t") nameStart += 1;
    const first = content.charCodeAt(nameStart);
    if (!((first >= 0x41 && first <= 0x5a) || (first >= 0x61 && first <= 0x7a))) {
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
      return nested === -1
        ? { safeForRegexScan: true, cardinalityExceeded: false }
        : { safeForRegexScan: false, cardinalityExceeded: false };
    }
    if (nested !== -1 && nested < end) {
      return { safeForRegexScan: false, cardinalityExceeded: false };
    }
    cursor = end + 1;
  }
}

export type ImageSourceScan = {
  readonly sources: Set<string>;
  /** True when a cardinality, code-span, label, or source-length safety limit was reached. */
  readonly truncated: boolean;
  /** True when continuing would require an attacker-controlled collection to grow further. */
  readonly cardinalityExceeded: boolean;
  /** True when regex rewriting must be replaced by a bounded inert preview. */
  readonly requiresInertFallback: boolean;
};

/** Collect a bounded set of Markdown and residual HTML image targets in source-text form. */
export function scanImageSources(content: string, requestedMaximum = MAX_IMAGE_SOURCES): ImageSourceScan {
  const maximum = Number.isSafeInteger(requestedMaximum)
    ? Math.max(0, Math.min(requestedMaximum, MAX_IMAGE_SOURCES))
    : MAX_IMAGE_SOURCES;
  const protectedSpans: string[] = [];
  const fenced = protectMarkdownFences(content, protectedSpans);
  if (fenced === null) {
    return { sources: new Set(), truncated: true, cardinalityExceeded: true, requiresInertFallback: true };
  }
  const searchable = protectInlineCodeSpans(fenced, protectedSpans);
  if (searchable === null) {
    return { sources: new Set(), truncated: true, cardinalityExceeded: true, requiresInertFallback: true };
  }
  const candidateStructure = imageCandidateStructure(searchable);
  if (!candidateStructure.safeForRegexScan) {
    return {
      sources: new Set(),
      truncated: true,
      cardinalityExceeded: candidateStructure.cardinalityExceeded,
      requiresInertFallback: true,
    };
  }
  const markupStructure = markupCandidateStructure(searchable);
  if (!markupStructure.safeForRegexScan) {
    return {
      sources: new Set(),
      truncated: true,
      cardinalityExceeded: markupStructure.cardinalityExceeded,
      requiresInertFallback: true,
    };
  }
  const sources = new Set<string>();
  let truncated = false;
  let cardinalityExceeded = false;
  const addSource = (source: string | undefined): boolean => {
    if (source === undefined || source === "") return true;
    if (source.length > MAX_REMOTE_SOURCE_CODE_UNITS) {
      truncated = true;
      return true;
    }
    if (sources.has(source)) return true;
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
    for (;;) {
      const match = markdownImage.exec(searchable);
      if (match === null) break;
      if (!addSource(match[2] ?? match[3])) break;
    }
  } finally {
    markdownImage.lastIndex = 0;
  }

  if (!truncated) {
    htmlImage.lastIndex = 0;
    try {
      for (;;) {
        const match = htmlImage.exec(searchable);
        if (match === null) break;
        if (!addSource(match[1])) break;
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
      if (!addSource(definitionScan.targets.get(label))) break;
    }
  }
  return {
    sources,
    truncated,
    cardinalityExceeded,
    requiresInertFallback: cardinalityExceeded,
  };
}

/** Compatibility wrapper with a hard 10,001-source ceiling. */
export function collectImageSources(content: string): Set<string> {
  return scanImageSources(content).sources;
}

const extensionByContentType: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

/** Pick a sanitized, collision-free local filename and add it to `taken`. */
export function pickAssetName(url: URL, contentType: string | null, taken: Set<string>): string {
  const encodedBase = url.pathname.split("/").filter(Boolean).pop() ?? "image";
  let base: string;
  try {
    base = decodeURIComponent(encodedBase);
  } catch {
    base = encodedBase;
  }
  base = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "") || "image";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).slice(0, 64);
  const mediaType = contentType?.split(";")[0]?.trim();
  const contentExtension = mediaType === undefined ? undefined : extensionByContentType[mediaType];
  let extension = contentExtension ?? (dot > 0 ? base.slice(dot + 1).toLowerCase() : "");
  if (extension === "" || !/^[a-z0-9]{1,8}$/.test(extension)) extension = "bin";

  let name = `${stem}.${extension}`;
  for (let suffix = 2; taken.has(name); suffix += 1) name = `${stem}-${suffix}.${extension}`;
  taken.add(name);
  return name;
}

export type RewriteContentResult = {
  readonly content: string;
  /** True when a safety bound omitted source content or replaced it with a bounded inert preview. */
  readonly truncated: boolean;
};

export const CONTENT_REWRITE_TRUNCATION_WARNING =
  "Content rewriting reached a safety limit; the final Markdown is truncated, so a complete extraction is reported as partial.";

/**
 * Localize downloaded images, absolutize web targets, neutralize active/non-web
 * targets and raw HTML attributes, and leave fenced examples untouched.
 */
export function rewriteContentWithStatus(
  content: string,
  base: URL,
  localBySource: ReadonlyMap<string, string>,
  options: {
    readonly remoteImages?: "embed" | "link";
    readonly maxImageSources?: number;
  } = {},
): RewriteContentResult {
  const sanitizedContent = sanitizeTerminalText(content);
  const protectedSpans: string[] = [];
  const fenced = protectMarkdownFences(sanitizedContent, protectedSpans);
  if (fenced === null) return { content: inertProtectedOverflow(sanitizedContent), truncated: true };
  let output = protectInlineCodeSpans(fenced, protectedSpans);
  if (output === null) return { content: inertProtectedOverflow(sanitizedContent), truncated: true };
  const imageSafety = scanImageSources(output, options.maxImageSources ?? MAX_IMAGE_SOURCES);
  if (imageSafety.requiresInertFallback) {
    return { content: inertCandidateOverflow(sanitizedContent), truncated: true };
  }
  let truncated = imageSafety.truncated;

  output = output.replace(unsafeMarkdownImage, (_whole, alt: string) =>
    `*[omitted unsafe image: ${escapeMarkdownLabel(alt) || "image"}]*`);
  output = output.replace(obsidianEmbed, (_whole, target: string) =>
    `*[omitted local embed: ${escapeMarkdownLabel(target) || "attachment"}]*`);

  const labelScan = referenceLabels(output);
  const definitionScan = referenceTargets(output, labelScan.labels);
  const definitions = definitionScan.targets;
  const referenceScanTruncated = labelScan.truncated || definitionScan.truncated;
  output = output.replace(referenceImage, (_whole, alt: string, rawLabel: string) => {
    const label = normalizedReferenceLabel(rawLabel === "" ? alt : rawLabel);
    if (label === null) {
      truncated = true;
      return `*[omitted over-limit image reference: ${escapeMarkdownLabel(alt) || "image"}]*`;
    }
    const source = definitions.get(label);
    if (source === undefined) return `*[omitted unresolved image reference: ${escapeMarkdownLabel(alt) || "image"}]*`;
    const local = localBySource.get(source);
    if (local !== undefined) return `![${alt}](${local})`;
    const absolute = resolveRemote(source, base);
    if (absolute === null) return `*[omitted unsafe image: ${escapeMarkdownLabel(alt) || "image"}]*`;
    const target = inertRemoteImageHref(absolute);
    return options.remoteImages === "embed"
      ? `![${alt}](${target})`
      : `[remote image: ${escapeMarkdownLabel(alt) || "image"}](${target})`;
  });

  const localPaths = new Set<string>();
  for (const localPath of localBySource.values()) {
    if (localPaths.size >= MAX_IMAGE_SOURCES) break;
    localPaths.add(localPath);
  }
  output = output.replace(
    markdownImage,
    (whole, alt: string, bracketed: string | undefined, bare: string | undefined, title: string) => {
      const source = bracketed ?? bare ?? "";
      if (source.length > MAX_REMOTE_SOURCE_CODE_UNITS) {
        truncated = true;
        return `*[omitted over-limit image: ${escapeMarkdownLabel(alt) || "image"}]*`;
      }
      const local = localBySource.get(source);
      if (local !== undefined) return `![${alt}](${local}${title})`;
      if (localPaths.has(source)) return whole;
      const absolute = resolveRemote(source, base);
      return absolute === null
        ? `*[omitted unsafe image: ${escapeMarkdownLabel(alt) || "image"}]*`
        : options.remoteImages === "embed"
          ? `![${alt}](${inertRemoteImageHref(absolute)}${title})`
          : `[remote image: ${escapeMarkdownLabel(alt) || "image"}](${inertRemoteImageHref(absolute)}${title})`;
    },
  );
  output = output.replace(htmlImage, (_whole, source: string) => {
    if (source.length > MAX_REMOTE_SOURCE_CODE_UNITS) {
      truncated = true;
      return "*[omitted over-limit image]*";
    }
    const local = localBySource.get(source);
    if (local !== undefined) return `![](${local})`;
    if (localPaths.has(source)) return `![](${source})`;
    const absolute = resolveRemote(source, base);
    return absolute === null
      ? "*[omitted unsafe image]*"
      : options.remoteImages === "embed"
        ? `![](${inertRemoteImageHref(absolute)})`
        : `[remote image](${inertRemoteImageHref(absolute)})`;
  });
  output = output.replace(
    plainLink,
    (
      whole,
      open: string,
      bracketed: string | undefined,
      bare: string | undefined,
      title: string,
      close: string,
    ) => {
      const target = bracketed ?? bare ?? "";
      if (target.length > MAX_REMOTE_SOURCE_CODE_UNITS) {
        truncated = true;
        return `${open}#${title}${close}`;
      }
      if (/^(https?:|mailto:|#)/i.test(target) || localPaths.has(target)) return whole;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return `${open}#${title}${close}`;
      const absolute = resolveRemote(target, base);
      return absolute === null
        ? `${open}#${title}${close}`
        : `${open}${absolute.href.replace(/\(/g, "%28").replace(/\)/g, "%29")}${title}${close}`;
    },
  );
  output = output.replace(
    referenceDefinition,
    (_whole, prefix: string, label: string, bracketed: string | undefined, bare: string | undefined, title: string) => {
      const target = bracketed ?? bare ?? "";
      if (label.length > MAX_REFERENCE_LABEL_CODE_UNITS || target.length > MAX_REMOTE_SOURCE_CODE_UNITS) {
        truncated = true;
        return `${prefix}#${title}`;
      }
      if (/^(?:https?:|mailto:|#)/i.test(target) || localPaths.has(target)) {
        return `${prefix}${bracketed === undefined ? target : `<${target}>`}${title}`;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return `${prefix}#${title}`;
      const absolute = resolveRemote(target, base);
      return `${prefix}${absolute === null ? "#" : absolute.href}${title}`;
    },
  );

  output = sanitizeMarkdownHtml(output);
  if (referenceScanTruncated) {
    truncated = true;
    output = "*[Some image references were omitted because capture safety limits were exceeded.]*\n\n" + output;
  }

  return { content: restoreMarkdownSpans(output, protectedSpans), truncated };
}

/** Compatibility wrapper for callers that only need rewritten Markdown. */
export function rewriteContent(
  content: string,
  base: URL,
  localBySource: ReadonlyMap<string, string>,
  options: {
    readonly remoteImages?: "embed" | "link";
    readonly maxImageSources?: number;
  } = {},
): string {
  return rewriteContentWithStatus(content, base, localBySource, options).content;
}

/** Build one complete clipped article with YAML metadata and optional title heading. */
export function buildClipMarkdown(
  article: Article,
  options: {
    slug: string;
    sourceHref: string;
    clipped: string;
    content: string;
    platform?: string;
    captureStatus?: string;
    captureMethod?: string;
    captureScope?: string;
  },
): string {
  const title = boundedMetadata(article.title, articleMetadataLimits.title);
  const author = boundedMetadata(article.author, articleMetadataLimits.author);
  const published = boundedMetadata(article.published, articleMetadataLimits.published);
  const description = boundedMetadata(article.description, articleMetadataLimits.description);
  const frontmatter = [
    "---",
    `title: ${yamlString(title ?? options.slug)}`,
    `source: ${yamlString(options.sourceHref)}`,
    ...(author === null ? [] : [`author: ${yamlString(author)}`]),
    ...(published === null ? [] : [`published: ${yamlString(published)}`]),
    ...(description === null ? [] : [`description: ${yamlString(description)}`]),
    `clipped: ${yamlString(options.clipped)}`,
    ...(options.platform === undefined ? [] : [`platform: ${yamlString(options.platform)}`]),
    ...(options.captureStatus === undefined ? [] : [`capture_status: ${yamlString(options.captureStatus)}`]),
    ...(options.captureMethod === undefined ? [] : [`capture_method: ${yamlString(options.captureMethod)}`]),
    ...(options.captureScope === undefined ? [] : [`capture_scope: ${yamlString(options.captureScope)}`]),
    "---",
    "",
  ].join("\n");
  const headingTitle = title === null
    ? null
    : escapeMarkdownLabel(title).replace(/\s+/g, " ").trim();
  const heading = headingTitle === null || headingTitle === "" ? "" : `# ${headingTitle}\n\n`;
  return sanitizeTerminalText(frontmatter + heading + options.content.trimEnd() + "\n");
}
