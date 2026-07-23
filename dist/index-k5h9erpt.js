// @bun
import {
  sanitizeTerminalText
} from "./index-q32a8bfd.js";

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
var isUnknownArray = (value) => Array.isArray(value);
var isRecord = (value) => typeof value === "object" && value !== null && !isUnknownArray(value);
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
  return isRecord(value) ? value : null;
};
var readArray = (record, key) => {
  const value = record[key];
  return isUnknownArray(value) ? value : null;
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
var domainMatches = (hostname, domain) => hostname === domain || hostname.endsWith(`.${domain}`);
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
  if (domainMatches(hostname, "x.com") || domainMatches(hostname, "twitter.com")) {
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
  if (domainMatches(hostname, "reddit.com")) {
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
  if (hostname === "substack.com" || domainMatches(hostname, "substack.com")) {
    const publication = hostname === "substack.com" ? null : hostname.slice(0, -".substack.com".length);
    return { platform: "substack", href: canonicalWithoutFragment(url), publication };
  }
  if (domainMatches(hostname, "instagram.com")) {
    const contentId = ["p", "reel", "tv"].includes(segments[0] ?? "") ? segments[1] ?? null : null;
    return { platform: "instagram", href: canonicalWithoutFragment(url), contentId };
  }
  if (domainMatches(hostname, "linkedin.com")) {
    const contentId = segments.find((segment) => /(?:activity|ugcPost|share)[:-]?\d+/.test(segment)) ?? segments[1] ?? null;
    return { platform: "linkedin", href: canonicalWithoutFragment(url), contentId };
  }
  if (domainMatches(hostname, "facebook.com") || hostname === "fb.com" || hostname === "fb.watch") {
    const contentId = url.searchParams.get("story_fbid") ?? url.searchParams.get("v") ?? segments.at(-1) ?? null;
    return { platform: "facebook", href: canonicalWithoutFragment(url), contentId };
  }
  if (domainMatches(hostname, "tiktok.com")) {
    const videoIndex = segments.indexOf("video");
    const contentId = videoIndex >= 0 ? segments[videoIndex + 1] ?? null : segments[0] ?? null;
    return { platform: "tiktok", href: canonicalWithoutFragment(url), contentId };
  }
  if (domainMatches(hostname, "threads.com") || domainMatches(hostname, "threads.net")) {
    const postIndex = segments.indexOf("post");
    const contentId = postIndex >= 0 ? segments[postIndex + 1] ?? null : null;
    return { platform: "threads", href: canonicalWithoutFragment(url), contentId };
  }
  if (hostname === "web.whatsapp.com") {
    return { platform: "whatsapp", href: canonicalWithoutFragment(url), contentId: null };
  }
  if (domainMatches(hostname, "youtube.com") || hostname === "youtu.be") {
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
  if (isUnknownArray(input)) {
    const [root2, ...descendants2] = input;
    return root2 === undefined ? null : { root: root2, descendants: descendants2 };
  }
  if (!isRecord(input))
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
  if (envelope === null || !isRecord(envelope.root)) {
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
    if (!isRecord(value)) {
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
  if (!isRecord(value))
    return null;
  if (value.kind === "Listing") {
    const data2 = readRecord(value, "data");
    return data2 === null ? null : readArray(data2, "children");
  }
  const data = readRecord(value, "data");
  return data === null ? null : readArray(data, "children");
};
var redditEnvelope = (input) => {
  if (isUnknownArray(input)) {
    const post = input[0];
    if (post === undefined)
      return null;
    return { post, comments: input[1] ?? null };
  }
  if (!isRecord(input) || input.post === undefined)
    return null;
  return { post: input.post, comments: input.comments ?? null };
};
var redditPostData = (value, maxItems) => {
  if (isRecord(value) && value.kind === "t3")
    return readRecord(value, "data");
  const children = redditListingChildren(value);
  if (children === null)
    return null;
  const limit = Math.min(children.length, maxItems);
  for (let index = 0;index < limit; index += 1) {
    const child = children[index];
    if (isRecord(child) && child.kind === "t3")
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
    if (!isRecord(value))
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
  if (!isRecord(value))
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
    if (!isRecord(value) || depth > Math.min(8, context.limits.maxDepth) || active.has(value))
      return;
    active.add(value);
    const images = readArray(value, "images");
    if (images !== null) {
      const limit = Math.min(images.length, context.limits.maxMediaPerEntry);
      for (let index = 0;index < limit; index += 1) {
        const image = images[index];
        if (!isRecord(image))
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
  if (!isRecord(embed))
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
  if (!isRecord(value))
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
  if (!isRecord(value))
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
  if (!isRecord(input))
    return invalidShape("Bluesky output must be an object containing a thread.");
  const thread = input.thread ?? input;
  if (!isRecord(thread))
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
    if (!isRecord(parent))
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

export { articleMetadataLimits, slugify, yamlString, resolveRemote, scanImageSources, CONTENT_REWRITE_TRUNCATION_WARNING, rewriteContentWithStatus, buildClipMarkdown, classifyPlatformUrl, parseHackerNewsCapture, parseRedditCapture, parseBlueskyCapture, renderCapturedDocument };
