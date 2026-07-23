import { Defuddle } from "defuddle/node";

type WorkerResponse =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

type WorkerGlobal = {
  onmessage: ((event: MessageEvent<unknown>) => void | Promise<void>) | null;
  postMessage: (value: WorkerResponse) => void;
};

const workerGlobal = globalThis as unknown as WorkerGlobal;

function asciiCaseEqualAt(value: string, offset: number, expected: string, end = value.length): boolean {
  if (offset < 0 || offset + expected.length > end) return false;
  for (let index = 0; index < expected.length; index += 1) {
    const actual = value.charCodeAt(offset + index);
    const folded = actual >= 0x41 && actual <= 0x5a ? actual + 0x20 : actual;
    if (folded !== expected.charCodeAt(index)) return false;
  }
  return true;
}

function isTagBoundary(code: number): boolean {
  return code === 0x3e
    || code === 0x2f
    || code === 0x20
    || code === 0x09
    || code === 0x0a
    || code === 0x0c
    || code === 0x0d;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(?:x([0-9a-f]{1,6})|(\d{1,7}));/gi, (_match, hexadecimal: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hexadecimal ?? decimal ?? "", hexadecimal === undefined ? 10 : 16);
      return Number.isSafeInteger(codePoint)
        && codePoint > 0
        && codePoint <= 0x10ffff
        && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : "";
    });
}

/** Defuddle can retain a video element while dropping its poster attribute; collect those bounded sidecars first. */
function collectVideoPosters(html: string): readonly string[] {
  const posters: string[] = [];
  let cursor = 0;
  while (cursor < html.length && posters.length < 64) {
    const start = html.indexOf("<", cursor);
    if (start < 0) break;
    cursor = start + 1;
    if (!asciiCaseEqualAt(html, start + 1, "video")) continue;
    const afterName = start + 6;
    if (afterName >= html.length || !isTagBoundary(html.charCodeAt(afterName))) continue;
    const unboundedEnd = html.indexOf(">", afterName);
    if (unboundedEnd < 0) break;
    cursor = unboundedEnd + 1;
    if (unboundedEnd - afterName > 16_384) continue;
    const tag = html.slice(afterName, unboundedEnd);
    const match = /(?:^|\s)poster\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag);
    const candidate = match?.[1] ?? match?.[2] ?? match?.[3];
    if (candidate === undefined || candidate.trim() === "") continue;
    const decoded = decodeHtmlAttribute(candidate.trim());
    if (decoded.length <= 8_192 && !posters.includes(decoded)) posters.push(decoded);
  }
  return posters;
}

workerGlobal.onmessage = async (event: MessageEvent<unknown>): Promise<void> => {
  const request = event.data;
  if (
    typeof request !== "object"
    || request === null
    || Array.isArray(request)
    || !("html" in request)
    || typeof request.html !== "string"
    || !("url" in request)
    || typeof request.url !== "string"
    || !("includeReplies" in request)
    || (request.includeReplies !== true && request.includeReplies !== false && request.includeReplies !== "extractors")
  ) {
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
      removeImages: false,
    });
    const enriched = typeof value === "object" && value !== null && !Array.isArray(value)
      ? { ...value, captureVideoPosters: videoPosters }
      : value;
    workerGlobal.postMessage({ ok: true, value: enriched });
  } catch {
    workerGlobal.postMessage({ ok: false, message: "Defuddle could not parse this acquisition." });
  }
};
