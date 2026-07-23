import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import { sniffImage } from "../clip/assets.js";
import {
  parsePdfInfo,
  parsePopplerXml,
  type ParsedPdfImage,
} from "./layout.js";
import type {
  PdfCaptureDependencies,
  PdfImageCandidate,
  PdfInspectOptions,
  PdfInspection,
  PdfPageLayout,
} from "./model.js";
import { resolvePdfTools, runPdfToolCommand } from "./tools.js";

export const pdfCaptureDefaults = {
  timeoutMs: 120_000,
  maxPdfBytes: 512 * 1024 * 1024,
  maxPages: 500,
  maxImages: 1_000,
  maxAssetBytes: 100 * 1024 * 1024,
  maxTotalAssetBytes: 512 * 1024 * 1024,
  maxLayoutBytes: 128 * 1024 * 1024,
} as const;

function positiveBound(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
    throw new Error(`${label} must be an integer from 1 through ${maximum}`);
  }
  return selected;
}

function pathInside(root: string, target: string): boolean {
  const child = relative(root, target);
  return child !== ""
    && !isAbsolute(child)
    && child !== ".."
    && !child.startsWith(`..${sep}`);
}

function prepareWorkspace(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) {
    const stats = lstatSync(absolute);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("PDF inspection workspace must be a real directory");
    }
    if (readdirSync(absolute).length !== 0) {
      throw new Error("PDF inspection workspace must be empty");
    }
  } else {
    mkdirSync(absolute, { recursive: false, mode: 0o700 });
  }
  chmodSync(absolute, 0o700);
  return realpathSync(absolute);
}

function sourceIdentity(path: string, maxPdfBytes: number): {
  readonly inputPath: string;
  readonly originalFilename: string;
  readonly bytes: number;
} {
  const originalFilename = basename(path);
  const canonical = realpathSync(resolve(path));
  const stats = statSync(canonical);
  if (!stats.isFile()) throw new Error("PDF input must be a regular file");
  if (stats.size < 5) throw new Error("PDF input is too small to contain a PDF header");
  if (stats.size > maxPdfBytes) throw new Error(`PDF input exceeds the ${maxPdfBytes}-byte limit`);
  const descriptor = openSync(canonical, "r");
  try {
    const signature = Buffer.alloc(5);
    const count = readSync(descriptor, signature, 0, signature.length, 0);
    if (count !== signature.length || signature.toString("ascii") !== "%PDF-") {
      throw new Error("PDF input does not have a valid PDF signature");
    }
  } finally {
    closeSync(descriptor);
  }
  return { inputPath: canonical, originalFilename, bytes: stats.size };
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

function safeGeneratedImage(
  image: ParsedPdfImage,
  workspace: string,
  index: number,
  limits: {
    readonly maxAssetBytes: number;
    readonly remainingBytes: number;
  },
): PdfImageCandidate | { readonly warning: string } {
  const candidate = resolve(workspace, image.sourcePath);
  if (!pathInside(workspace, candidate)) {
    return { warning: `Skipped an image on page ${image.page} whose generated path escaped the workspace.` };
  }
  let canonical: string;
  try {
    canonical = realpathSync(candidate);
  } catch {
    return { warning: `Skipped a missing generated image on page ${image.page}.` };
  }
  if (!pathInside(workspace, canonical)) {
    return { warning: `Skipped an image on page ${image.page} whose canonical path escaped the workspace.` };
  }
  const stats = lstatSync(canonical);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return { warning: `Skipped a non-file generated image on page ${image.page}.` };
  }
  if (stats.size > limits.maxAssetBytes || stats.size > limits.remainingBytes) {
    return { warning: `Skipped an image on page ${image.page} because the configured asset byte limit was reached.` };
  }
  const bytes = readFileSync(canonical);
  const sniffed = sniffImage(bytes);
  if (sniffed === null) {
    return { warning: `Skipped an unsupported generated image on page ${image.page}.` };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    id: `page-${image.page}-image-${index + 1}-${sha256.slice(0, 12)}`,
    page: image.page,
    sourcePath: canonical,
    top: image.top,
    left: image.left,
    width: image.width,
    height: image.height,
    bytes: stats.size,
    sha256,
    mimeType: sniffed.mimeType,
  };
}

function generatedTreeSize(workspace: string, maximumFiles: number, maximumBytes: number): void {
  const entries = readdirSync(workspace, { withFileTypes: true });
  if (entries.length > maximumFiles) {
    throw new Error(`PDF extraction created more than ${maximumFiles} files`);
  }
  let totalBytes = 0;
  for (const entry of entries) {
    const path = join(workspace, entry.name);
    const stats = lstatSync(path);
    if (!entry.isFile() || stats.isSymbolicLink()) {
      throw new Error("PDF extraction created an unexpected non-file output");
    }
    totalBytes += stats.size;
    if (totalBytes > maximumBytes) {
      throw new Error(`PDF extraction exceeded the ${maximumBytes}-byte workspace limit`);
    }
  }
}

/**
 * Inspect a PDF into a caller-owned workspace. The returned image paths remain
 * valid until that workspace is removed.
 */
export async function inspectPdf(
  options: PdfInspectOptions,
  dependencies: PdfCaptureDependencies = {},
): Promise<PdfInspection> {
  const timeoutMs = positiveBound(options.timeoutMs, pdfCaptureDefaults.timeoutMs, 10 * 60_000, "timeoutMs");
  const maxPdfBytes = positiveBound(options.maxPdfBytes, pdfCaptureDefaults.maxPdfBytes, 8 * 1024 ** 3, "maxPdfBytes");
  const maxPages = positiveBound(options.maxPages, pdfCaptureDefaults.maxPages, 10_000, "maxPages");
  const maxImages = positiveBound(options.maxImages, pdfCaptureDefaults.maxImages, 10_000, "maxImages");
  const maxAssetBytes = positiveBound(
    options.maxAssetBytes,
    pdfCaptureDefaults.maxAssetBytes,
    2 * 1024 ** 3,
    "maxAssetBytes",
  );
  const maxTotalAssetBytes = positiveBound(
    options.maxTotalAssetBytes,
    pdfCaptureDefaults.maxTotalAssetBytes,
    8 * 1024 ** 3,
    "maxTotalAssetBytes",
  );
  const source = sourceIdentity(options.inputPath, maxPdfBytes);
  const sourceSha256 = await sha256File(source.inputPath);
  const workspaceDirectory = prepareWorkspace(options.workspaceDirectory);
  const tools = resolvePdfTools(dependencies);
  const runTool = dependencies.runTool ?? runPdfToolCommand;

  const info = await runTool({
    command: [tools.pdfinfo, source.inputPath],
    timeoutMs,
    maxOutputBytes: 2 * 1024 * 1024,
    cwd: workspaceDirectory,
  });
  if (info.exitCode !== 0) {
    throw new Error("pdfinfo could not inspect the input PDF");
  }
  const metadata = parsePdfInfo(info.stdout);
  const processedPageLimit = Math.min(metadata.pageCount, maxPages);
  const layoutPath = join(workspaceDirectory, "layout.xml");
  const extracted = await runTool({
    command: [
      tools.pdftohtml,
      "-q",
      "-f",
      "1",
      "-l",
      String(processedPageLimit),
      "-xml",
      "-hidden",
      "-fmt",
      "png",
      source.inputPath,
      layoutPath,
    ],
    timeoutMs,
    maxOutputBytes: 2 * 1024 * 1024,
    cwd: workspaceDirectory,
  });
  if (extracted.exitCode !== 0) {
    throw new Error("pdftohtml could not extract the input PDF");
  }
  generatedTreeSize(
    workspaceDirectory,
    10_002,
    Math.min(
      Number.MAX_SAFE_INTEGER,
      8 * 1024 ** 3 + pdfCaptureDefaults.maxLayoutBytes,
    ),
  );
  const layoutStats = statSync(layoutPath);
  if (!layoutStats.isFile() || layoutStats.size > pdfCaptureDefaults.maxLayoutBytes) {
    throw new Error(`Poppler layout XML exceeds the ${pdfCaptureDefaults.maxLayoutBytes}-byte limit`);
  }
  const parsed = parsePopplerXml(readFileSync(layoutPath, "utf8"), {
    maxPages: processedPageLimit,
    maxImages,
  });
  const warnings: string[] = [];
  if (metadata.pageCount > processedPageLimit) {
    warnings.push(`PDF extraction stopped at ${processedPageLimit} of ${metadata.pageCount} pages.`);
  }
  if (parsed.truncated) {
    warnings.push("PDF layout extraction reached a configured page, image, or text-fragment limit.");
  }
  if (parsed.pages.length < processedPageLimit) {
    warnings.push(`Poppler returned ${parsed.pages.length} of ${processedPageLimit} requested pages.`);
  }

  let remainingBytes = maxTotalAssetBytes;
  const pages: PdfPageLayout[] = parsed.pages.map((page) => {
    const images: PdfImageCandidate[] = [];
    const sorted = [...page.images].sort((left, right) =>
      left.top - right.top || left.left - right.left || left.sourcePath.localeCompare(right.sourcePath));
    for (const [index, rawImage] of sorted.entries()) {
      const image = safeGeneratedImage(rawImage, workspaceDirectory, index, {
        maxAssetBytes,
        remainingBytes,
      });
      if ("warning" in image) {
        warnings.push(image.warning);
        continue;
      }
      images.push(image);
      remainingBytes -= image.bytes;
    }
    return {
      page: page.page,
      width: page.width,
      height: page.height,
      text: page.text,
      images,
    };
  });

  return {
    inputPath: source.inputPath,
    originalFilename: source.originalFilename,
    sourceBytes: source.bytes,
    sourceSha256,
    metadata,
    processedPages: pages.length,
    pages,
    popplerVersion: parsed.popplerVersion,
    warnings: [...new Set(warnings)],
    workspaceDirectory,
  };
}
