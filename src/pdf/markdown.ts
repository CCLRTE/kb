import { redactSensitiveText } from "../clip/persist.js";
import { sanitizeTerminalText } from "../clip/terminal.js";
import { yamlString } from "../clip/lib.js";
import type {
  PdfCaptureStatus,
  PdfDocumentMetadata,
  PdfImageCandidate,
  PdfImageSemanticMetadata,
} from "./model.js";
import type { PdfLayoutBlock } from "./layout.js";
import { pdfImageAssetPath } from "./persist.js";

export type ResolvedPdfImage = {
  readonly image: PdfImageCandidate;
  readonly kind: "text" | "mixed" | "visual";
  readonly method: "agent" | "manual" | "tesseract" | "unclassified";
  readonly markdown: string;
  readonly alt: string | null;
  readonly confidence: number | null;
  readonly wordCount: number;
  readonly metadata: PdfImageSemanticMetadata | null;
};

function escapeInline(value: string): string {
  return sanitizeTerminalText(value)
    .replace(/\\/gu, "\\\\")
    .replace(/([`*_[\]{}<>#])/gu, "\\$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function metadataLine(metadata: PdfImageSemanticMetadata | null): string | null {
  if (metadata === null) return null;
  const values = [
    metadata.platform === undefined ? null : `platform: ${metadata.platform}`,
    metadata.contentType === undefined ? null : `type: ${metadata.contentType}`,
    metadata.channel === undefined ? null : `channel: ${metadata.channel}`,
    metadata.author === undefined ? null : `author: ${metadata.author}`,
    metadata.timestamp === undefined ? null : `timestamp: ${metadata.timestamp}`,
    metadata.participants === undefined ? null : `participants: ${metadata.participants.join(", ")}`,
  ].filter((value): value is string => value !== null);
  return values.length === 0 ? null : `*Image metadata — ${escapeInline(values.join("; "))}*`;
}

function imageMarkdown(image: ResolvedPdfImage): string {
  const assetPath = pdfImageAssetPath(image.image);
  const semantic = image.metadata?.contentType ?? image.metadata?.platform;
  const fallbackAlt = semantic === undefined
    ? `PDF image from page ${image.image.page}`
    : `${semantic} from page ${image.image.page}`;
  const alt = escapeInline(image.alt ?? fallbackAlt);
  const lines = [`![${alt}](${assetPath})`];
  const metadata = metadataLine(image.metadata);
  if (metadata !== null) lines.push("", metadata);
  if (image.kind === "text" || image.kind === "mixed") {
    const heading = image.metadata?.platform === undefined
      ? "Text visible in image"
      : `Text visible in ${escapeInline(image.metadata.platform)} image`;
    lines.push("", `#### ${heading}`, "", image.markdown.trim());
  }
  return lines.join("\n");
}

function markdownContent(
  blocks: readonly PdfLayoutBlock[],
  images: ReadonlyMap<string, ResolvedPdfImage>,
): { readonly content: string; readonly headingCount: number; readonly textBlockCount: number } {
  const lines: string[] = [];
  let currentPage: number | null = null;
  let headingCount = 0;
  let textBlockCount = 0;
  for (const block of blocks) {
    if (currentPage !== block.page) {
      if (lines.length > 0) lines.push("");
      lines.push(`<!-- pdf-page: ${block.page} -->`, "");
      currentPage = block.page;
    }
    if (block.kind === "image") {
      const resolved = images.get(block.image.id);
      if (resolved === undefined) continue;
      lines.push(imageMarkdown(resolved), "");
      continue;
    }
    if (block.kind === "heading") {
      headingCount += 1;
      lines.push(`${"#".repeat(Math.max(2, Math.min(6, block.level)))} ${escapeInline(block.text)}`, "");
      continue;
    }
    textBlockCount += 1;
    if (block.kind === "list-item") lines.push(`- ${escapeInline(block.text)}`, "");
    else lines.push(escapeInline(block.text), "");
  }
  return {
    content: lines.join("\n").trim(),
    headingCount,
    textBlockCount,
  };
}

export type BuildPdfMarkdownOptions = {
  readonly slug: string;
  readonly originalFilename: string;
  readonly sourceSha256: string;
  readonly sourceUrl?: string;
  readonly capturedDate: string;
  readonly status: PdfCaptureStatus;
  readonly metadata: PdfDocumentMetadata;
  readonly blocks: readonly PdfLayoutBlock[];
  readonly images: ReadonlyMap<string, ResolvedPdfImage>;
  readonly embeddedPlatforms: readonly string[];
};

/** Build one deterministic PDF note; only capturedDate varies between reruns. */
export function buildPdfMarkdown(options: BuildPdfMarkdownOptions): {
  readonly markdown: string;
  readonly headingCount: number;
  readonly textBlockCount: number;
} {
  const filenameTitle = options.originalFilename.replace(/\.pdf$/iu, "").trim();
  const title = options.metadata.title ?? (filenameTitle === "" ? options.slug : filenameTitle);
  const body = markdownContent(options.blocks, options.images);
  const frontmatter = [
    "---",
    `title: ${yamlString(title)}`,
    `source: ${yamlString("source.pdf")}`,
    `source_type: ${yamlString("pdf")}`,
    `source_original_filename: ${yamlString(options.originalFilename)}`,
    `source_sha256: ${yamlString(options.sourceSha256)}`,
    ...(options.sourceUrl === undefined ? [] : [`source_url: ${yamlString(options.sourceUrl)}`]),
    `pages: ${options.metadata.pageCount}`,
    `clipped: ${yamlString(options.capturedDate)}`,
    `capture_status: ${yamlString(options.status)}`,
    `capture_method: ${yamlString("poppler")}`,
    ...(options.metadata.author === null ? [] : [`author: ${yamlString(options.metadata.author)}`]),
    ...(options.metadata.subject === null ? [] : [`description: ${yamlString(options.metadata.subject)}`]),
    ...(options.metadata.createdAt === null ? [] : [`created: ${yamlString(options.metadata.createdAt)}`]),
    ...(options.embeddedPlatforms.length === 0
      ? []
      : [`embedded_platforms: [${options.embeddedPlatforms.map(yamlString).join(", ")}]`]),
    "---",
    "",
    `# ${escapeInline(title)}`,
    "",
    "[Open the source PDF](source.pdf)",
    "",
    body.content,
    "",
  ].join("\n");
  return {
    markdown: `${redactSensitiveText(frontmatter).trimEnd()}\n`,
    headingCount: body.headingCount,
    textBlockCount: body.textBlockCount,
  };
}
