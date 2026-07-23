// @bun
// src/clip/defuddle-worker.ts
import { Defuddle } from "defuddle/node";
var workerGlobal = globalThis;
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
function isTagBoundary(code) {
  return code === 62 || code === 47 || code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
}
function decodeHtmlAttribute(value) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(?:x([0-9a-f]{1,6})|(\d{1,7}));/gi, (_match, hexadecimal, decimal) => {
    const codePoint = Number.parseInt(hexadecimal ?? decimal ?? "", hexadecimal === undefined ? 10 : 16);
    return Number.isSafeInteger(codePoint) && codePoint > 0 && codePoint <= 1114111 && !(codePoint >= 55296 && codePoint <= 57343) ? String.fromCodePoint(codePoint) : "";
  });
}
function collectVideoPosters(html) {
  const posters = [];
  let cursor = 0;
  while (cursor < html.length && posters.length < 64) {
    const start = html.indexOf("<", cursor);
    if (start < 0)
      break;
    cursor = start + 1;
    if (!asciiCaseEqualAt(html, start + 1, "video"))
      continue;
    const afterName = start + 6;
    if (afterName >= html.length || !isTagBoundary(html.charCodeAt(afterName)))
      continue;
    const unboundedEnd = html.indexOf(">", afterName);
    if (unboundedEnd < 0)
      break;
    cursor = unboundedEnd + 1;
    if (unboundedEnd - afterName > 16384)
      continue;
    const tag = html.slice(afterName, unboundedEnd);
    const match = /(?:^|\s)poster\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag);
    const candidate = match?.[1] ?? match?.[2] ?? match?.[3];
    if (candidate === undefined || candidate.trim() === "")
      continue;
    const decoded = decodeHtmlAttribute(candidate.trim());
    if (decoded.length <= 8192 && !posters.includes(decoded))
      posters.push(decoded);
  }
  return posters;
}
var domGlobal = globalThis;
domGlobal.Node ??= Object.freeze({
  DOCUMENT_POSITION_DISCONNECTED: 1,
  DOCUMENT_POSITION_PRECEDING: 2,
  DOCUMENT_POSITION_FOLLOWING: 4,
  DOCUMENT_POSITION_CONTAINS: 8,
  DOCUMENT_POSITION_CONTAINED_BY: 16,
  DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32
});
workerGlobal.onmessage = async (event) => {
  const request = event.data;
  if (typeof request !== "object" || request === null || Array.isArray(request) || !("html" in request) || typeof request.html !== "string" || !("url" in request) || typeof request.url !== "string" || !("includeReplies" in request) || request.includeReplies !== true && request.includeReplies !== false && request.includeReplies !== "extractors") {
    workerGlobal.postMessage({ ok: false, message: "Defuddle worker received an invalid request." });
    return;
  }
  try {
    const videoPosters = collectVideoPosters(request.html);
    const value = await Defuddle(request.html, request.url, {
      markdown: false,
      separateMarkdown: true,
      includeReplies: request.includeReplies,
      useAsync: false,
      removeImages: false
    });
    const enriched = typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value, captureVideoPosters: videoPosters } : value;
    workerGlobal.postMessage({ ok: true, value: enriched });
  } catch {
    workerGlobal.postMessage({ ok: false, message: "Defuddle could not parse this acquisition." });
  }
};
