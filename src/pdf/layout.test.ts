import { describe, expect, test } from "bun:test";

import {
  decodePopplerText,
  layoutBlocks,
  parsePdfImageInterpretations,
  parsePdfInfo,
  parsePopplerXml,
} from "./layout.js";
import type { PdfImageCandidate, PdfPageLayout } from "./model.js";

describe("PDF layout parsing", () => {
  test("parses bounded pdfinfo metadata", () => {
    expect(parsePdfInfo([
      "Title:          A document",
      "Author:         Example",
      "Pages:          43",
      "Encrypted:      no",
      "CreationDate:   Tue Jul 21 12:00:00 2026 EDT",
    ].join("\n"))).toEqual({
      title: "A document",
      author: "Example",
      subject: null,
      keywords: null,
      creator: null,
      producer: null,
      createdAt: "Tue Jul 21 12:00:00 2026 EDT",
      modifiedAt: null,
      pageCount: 43,
      encrypted: false,
    });
  });

  test("decodes Poppler XML text, geometry, emphasis, and images", () => {
    const parsed = parsePopplerXml(`<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml producer="poppler" version="25.05.0">
<page number="1" position="absolute" top="0" left="0" height="1000" width="800">
<fontspec id="0" size="24" family="Helvetica" color="#000000"/>
<fontspec id="1" size="12" family="Helvetica" color="#000000"/>
<text top="80" left="70" width="400" height="30" font="0"><b>A &amp; ﬁne title</b></text>
<text top="140" left="70" width="500" height="16" font="1">A body paragraph.</text>
<image top="220" left="70" width="500" height="300" src="layout-1_1.png"/>
</page>
</pdf2xml>`, { maxPages: 10, maxImages: 10 });

    expect(parsed.popplerVersion).toBe("25.05.0");
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.pages[0]?.text[0]).toMatchObject({
      text: "A & fine title",
      fontSize: 24,
      bold: true,
    });
    expect(parsed.pages[0]?.images[0]).toMatchObject({
      page: 1,
      sourcePath: "layout-1_1.png",
      top: 220,
    });
    expect(decodePopplerText("one&#32;&lt;two&gt;")).toBe("one <two>");
  });

  test("orders headings, paragraphs, list items, and retained images", () => {
    const image: PdfImageCandidate = {
      id: `page-1-image-1-${"a".repeat(12)}`,
      page: 1,
      sourcePath: "/tmp/image.png",
      top: 230,
      left: 70,
      width: 500,
      height: 300,
      bytes: 12,
      sha256: "a".repeat(64),
      mimeType: "image/png",
    };
    const page: PdfPageLayout = {
      page: 1,
      width: 800,
      height: 1000,
      text: [
        {
          top: 80,
          left: 70,
          width: 300,
          height: 30,
          text: "Document title",
          fontId: "0",
          fontSize: 24,
          bold: true,
          italic: false,
        },
        {
          top: 140,
          left: 70,
          width: 500,
          height: 16,
          text: "A body paragraph",
          fontId: "1",
          fontSize: 12,
          bold: false,
          italic: false,
        },
        {
          top: 180,
          left: 70,
          width: 500,
          height: 16,
          text: "• An item",
          fontId: "1",
          fontSize: 12,
          bold: false,
          italic: false,
        },
      ],
      images: [image],
    };
    expect(layoutBlocks([page])).toEqual([
      { kind: "heading", page: 1, level: 2, text: "Document title" },
      { kind: "paragraph", page: 1, text: "A body paragraph" },
      { kind: "list-item", page: 1, text: "An item" },
      { kind: "image", page: 1, image },
    ]);
  });

  test("does not turn a bold continuation before whitespace into a heading", () => {
    const fragment = (
      top: number,
      text: string,
      bold: boolean,
    ): PdfPageLayout["text"][number] => ({
      top,
      left: 70,
      width: 500,
      height: 16,
      text,
      fontId: "1",
      fontSize: 12,
      bold,
      italic: false,
    });
    const blocks = layoutBlocks([{
      page: 1,
      width: 800,
      height: 1000,
      text: [
        fragment(100, "The only", false),
        fragment(125, "way to find the right hill is by talking.", true),
        fragment(175, "A new paragraph.", false),
      ],
      images: [],
    }]);
    expect(blocks).toEqual([
      {
        kind: "paragraph",
        page: 1,
        text: "The only way to find the right hill is by talking. A new paragraph.",
      },
    ]);
  });

  test("validates hash-bound mixed image interpretations and semantic metadata", () => {
    const sha256 = "b".repeat(64);
    expect(parsePdfImageInterpretations([{
      id: "page-7-image-2-abcdef012345",
      sha256,
      kind: "mixed",
      markdown: "> Ben: I am leaving Zo.",
      method: "agent",
      metadata: {
        platform: "Slack",
        contentType: "message screenshot",
        channel: "#company",
        participants: ["Ben", "Ada"],
      },
    }])).toEqual([{
      id: "page-7-image-2-abcdef012345",
      sha256,
      kind: "mixed",
      markdown: "> Ben: I am leaving Zo.",
      method: "agent",
      metadata: {
        platform: "Slack",
        contentType: "message screenshot",
        channel: "#company",
        participants: ["Ben", "Ada"],
      },
    }]);
    expect(() => parsePdfImageInterpretations([{
      id: "page-7-image-2-abcdef012345",
      sha256: "not-a-hash",
      kind: "mixed",
      markdown: "text",
    }])).toThrow("invalid sha256");
    expect(() => parsePdfImageInterpretations([{
      id: "page-7-image-2-abcdef012345",
      sha256,
      kind: "mixed",
      markdown: "text",
      method: "angent",
    }])).toThrow("method must be agent or manual");
  });
});
