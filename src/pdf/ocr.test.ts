import { describe, expect, test } from "bun:test";

import { parseTesseractTsv } from "./ocr.js";

const header = [
  "level",
  "page_num",
  "block_num",
  "par_num",
  "line_num",
  "word_num",
  "left",
  "top",
  "width",
  "height",
  "conf",
  "text",
].join("\t");

function row(line: number, word: number, confidence: number, text: string): string {
  return [5, 1, 1, 1, line, word, 0, 0, 10, 10, confidence, text].join("\t");
}

describe("Tesseract OCR parsing", () => {
  test("uses numeric reading order and emits substantive quoted Markdown", () => {
    const parsed = parseTesseractTsv([
      header,
      row(10, 1, 91, "later"),
      row(2, 2, 88, "world"),
      row(2, 1, 90, "Hello"),
      row(10, 2, 92, "message"),
    ].join("\n"));
    expect(parsed.text).toBe("Hello world\nlater message");
    expect(parsed.markdown).toBe("> Hello world\n> later message");
    expect(parsed.substantive).toBe(true);
    expect(parsed.wordCount).toBe(4);
    expect(parsed.confidence).toBeGreaterThan(80);
  });

  test("does not promote sparse low-confidence noise into text", () => {
    const parsed = parseTesseractTsv([
      header,
      row(1, 1, 8, "x"),
      row(1, 2, 9, "y"),
    ].join("\n"));
    expect(parsed.substantive).toBe(false);
    expect(parsed.markdown).toBe("");
  });
});
