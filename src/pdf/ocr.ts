import { redactSensitiveText } from "../clip/persist.js";
import { sanitizeTerminalText } from "../clip/terminal.js";
import type {
  PdfImageCandidate,
  PdfOcrResult,
  PdfToolRunner,
} from "./model.js";

type OcrWord = {
  readonly page: number;
  readonly block: number;
  readonly paragraph: number;
  readonly line: number;
  readonly word: number;
  readonly text: string;
  readonly confidence: number;
};

function parseInteger(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseConfidence(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/([`*_[\]{}<>#])/gu, "\\$1");
}

export type ParsedTesseractTsv = {
  readonly text: string;
  readonly markdown: string;
  readonly confidence: number | null;
  readonly wordCount: number;
  readonly substantive: boolean;
};

/** Parse Tesseract TSV into stable reading-order text and a quoted Markdown block. */
export function parseTesseractTsv(value: string): ParsedTesseractTsv {
  const lines = value.split(/\r?\n/gu);
  const header = lines[0]?.split("\t") ?? [];
  const positions = new Map(header.map((name, index) => [name, index]));
  const required = ["page_num", "block_num", "par_num", "line_num", "word_num", "conf", "text"] as const;
  if (!required.every((name) => positions.has(name))) {
    throw new Error("Tesseract TSV is missing required columns");
  }
  const words: OcrWord[] = [];
  for (const row of lines.slice(1)) {
    if (row === "") continue;
    const fields = row.split("\t");
    const at = (name: typeof required[number]): string | undefined => {
      const index = positions.get(name);
      return index === undefined ? undefined : fields[index];
    };
    const text = sanitizeTerminalText(at("text") ?? "").trim();
    const confidence = parseConfidence(at("conf"));
    const word = parseInteger(at("word_num"));
    const page = parseInteger(at("page_num"));
    const block = parseInteger(at("block_num"));
    const paragraph = parseInteger(at("par_num"));
    const line = parseInteger(at("line_num"));
    if (
      text === ""
      || confidence === null
      || word === null
      || page === null
      || block === null
      || paragraph === null
      || line === null
    ) continue;
    words.push({
      page,
      block,
      paragraph,
      line,
      word,
      text,
      confidence,
    });
    if (words.length >= 100_000) break;
  }
  words.sort((left, right) =>
    left.page - right.page
    || left.block - right.block
    || left.paragraph - right.paragraph
    || left.line - right.line
    || left.word - right.word);
  const grouped = new Map<string, string[]>();
  for (const word of words) {
    const lineIdentity = `${word.page}:${word.block}:${word.paragraph}:${word.line}`;
    const current = grouped.get(lineIdentity) ?? [];
    current.push(word.text);
    grouped.set(lineIdentity, current);
  }
  const textLines = [...grouped.values()]
    .map((entries) => entries.join(" ").replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  const text = redactSensitiveText(textLines.join("\n"));
  const weightedCharacters = words.reduce((sum, word) => sum + word.text.length, 0);
  const confidence = weightedCharacters === 0
    ? null
    : words.reduce((sum, word) => sum + word.confidence * word.text.length, 0) / weightedCharacters;
  const alphanumericCount = [...text].filter((character) => /[\p{Letter}\p{Number}]/u.test(character)).length;
  const substantive = words.length >= 3
    && alphanumericCount >= 12
    && confidence !== null
    && confidence >= 35;
  const markdown = substantive
    ? text.split("\n").map((line) => `> ${escapeMarkdownText(line)}`).join("\n")
    : "";
  return {
    text,
    markdown,
    confidence,
    wordCount: words.length,
    substantive,
  };
}

/** Classify one image with local OCR; substantive results remain mixed visual/text evidence. */
export async function ocrPdfImage(
  image: PdfImageCandidate,
  options: {
    readonly tesseractPath: string | null;
    readonly timeoutMs: number;
    readonly runTool: PdfToolRunner;
  },
): Promise<PdfOcrResult> {
  if (options.tesseractPath === null) {
    return {
      kind: "visual",
      text: "",
      markdown: "",
      confidence: null,
      wordCount: 0,
      warnings: ["Tesseract is unavailable; retained the image without OCR text."],
    };
  }
  try {
    const result = await options.runTool({
      command: [
        options.tesseractPath,
        image.sourcePath,
        "stdout",
        "--psm",
        "6",
        "tsv",
      ],
      timeoutMs: options.timeoutMs,
      maxOutputBytes: 16 * 1024 * 1024,
    });
    if (result.exitCode !== 0) {
      return {
        kind: "visual",
        text: "",
        markdown: "",
        confidence: null,
        wordCount: 0,
        warnings: ["Tesseract could not read this image; retained it as visual evidence."],
      };
    }
    const parsed = parseTesseractTsv(result.stdout);
    return {
      kind: parsed.substantive ? "mixed" : "visual",
      text: parsed.text,
      markdown: parsed.markdown,
      confidence: parsed.confidence,
      wordCount: parsed.wordCount,
      warnings: parsed.substantive
        ? []
        : ["Tesseract did not find sufficiently confident text; retained the image as visual evidence."],
    };
  } catch {
    return {
      kind: "visual",
      text: "",
      markdown: "",
      confidence: null,
      wordCount: 0,
      warnings: ["Tesseract OCR failed; retained the image as visual evidence."],
    };
  }
}
