import { describe, expect, test } from "bun:test";

import { main } from "./cli.js";
import type { PdfCaptureOptions, PdfCaptureOutcome } from "./model.js";

function partialOutcome(): PdfCaptureOutcome {
  const manifest: PdfCaptureOutcome["manifest"] = {
    schemaVersion: 1,
    kind: "pdf",
    capturedAt: "2026-07-23T12:00:00.000Z",
    status: "partial",
    source: {
      originalFilename: "document.pdf",
      path: "source.pdf",
      mimeType: "application/pdf",
      bytes: 16,
      sha256: "0".repeat(64),
    },
    document: {
      title: "Bounded",
      author: null,
      subject: null,
      keywords: null,
      creator: null,
      producer: null,
      createdAt: null,
      modifiedAt: null,
      pageCount: 43,
      encrypted: false,
      processedPages: 6,
    },
    extraction: {
      layout: "pdftohtml-xml",
      popplerVersion: null,
      ocr: "unavailable",
      headingCount: 1,
      textBlockCount: 1,
      imageCount: 5,
      textImageCount: 0,
      mixedImageCount: 0,
      visualImageCount: 5,
    },
    images: [],
    annotations: null,
    embeddedPlatforms: [],
    warnings: ["PDF extraction stopped at 6 of 43 pages."],
  };
  return {
    status: "partial",
    slug: "bounded",
    outputDirectory: "/tmp/articles/bounded",
    markdownPath: "/tmp/articles/bounded/bounded.md",
    sourcePath: "/tmp/articles/bounded/source.pdf",
    wordCount: 42,
    pageCount: 43,
    processedPages: 6,
    imageCount: 5,
    warnings: ["PDF extraction stopped at 6 of 43 pages."],
    markdown: "# Bounded\n",
    manifest,
  };
}

describe("PDF CLI output", () => {
  test("distinguishes processed pages from the document page count", async () => {
    let stdout = "";
    let stderr = "";
    const exitCode = await main(
      ["document.pdf", "--output", "articles"],
      {},
      {
        stdout: (value) => {
          stdout += value;
        },
        stderr: (value) => {
          stderr += value;
        },
      },
      {
        runPdfCapture: () => Promise.resolve(partialOutcome()),
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("6 of 43 pages processed");
    expect(stdout).not.toContain("; 43 pages;");
    expect(stderr).toContain("PDF extraction stopped at 6 of 43 pages.");
  });

  test("downloads a remote source, passes URL provenance, and disposes it after capture", async () => {
    let disposed = false;
    let received: PdfCaptureOptions | null = null;
    const exitCode = await main(
      ["https://example.com/paper.pdf", "--output", "articles", "--quiet"],
      {},
      { stdout: () => {}, stderr: () => {} },
      {
        preparePdfSource: () => Promise.resolve({
          inputPath: "/tmp/downloaded.pdf",
          remoteSource: {
            requestedUrl: "https://example.com/paper.pdf",
            finalUrl: "https://cdn.example.com/paper.pdf",
          },
          dispose: () => {
            disposed = true;
          },
        }),
        runPdfCapture: (options) => {
          received = options;
          return Promise.resolve(partialOutcome());
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(received).toMatchObject({
      inputPath: "/tmp/downloaded.pdf",
      remoteSource: {
        requestedUrl: "https://example.com/paper.pdf",
        finalUrl: "https://cdn.example.com/paper.pdf",
      },
    });
    expect(disposed).toBe(true);
  });
});
