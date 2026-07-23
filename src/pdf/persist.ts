import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { redactSensitiveText } from "../clip/persist.js";
import type {
  PdfCaptureManifest,
  PdfImageCandidate,
} from "./model.js";
import {
  PDF_CAPTURE_ANNOTATIONS_FILENAME,
  PDF_CAPTURE_MANIFEST_FILENAME,
  PDF_CAPTURE_MANIFEST_SCHEMA_VERSION,
  PDF_CAPTURE_SOURCE_FILENAME,
} from "./model.js";

function isConfinedChild(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== "" && !isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`);
}

function assertConfinedChild(root: string, path: string, label: string): void {
  if (!isConfinedChild(root, path)) throw new Error(`${label} escapes the PDF capture root`);
}

function safeSlug(slug: string): string {
  if (
    slug.length === 0
    || slug.length > 240
    || [...slug].length > 80
    || slug !== slug.normalize("NFKC")
    || !/^[\p{Letter}\p{Number}](?:[\p{Letter}\p{Number}._-]*[\p{Letter}\p{Number}])?$/u.test(slug)
  ) throw new Error("unsafe PDF capture slug");
  return slug;
}

function outputRoot(path: string): string {
  const absolute = resolve(path);
  mkdirSync(absolute, { recursive: true, mode: 0o755 });
  const stats = lstatSync(absolute);
  if (!stats.isDirectory() && !stats.isSymbolicLink()) {
    throw new Error("PDF capture output root is not a directory");
  }
  const canonical = realpathSync(absolute);
  if (!lstatSync(canonical).isDirectory()) throw new Error("PDF capture output root is not a directory");
  if (dirname(canonical) === canonical || canonical === realpathSync(homedir())) {
    throw new Error("refusing dangerous PDF capture output root");
  }
  return canonical;
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    case "image/avif": return "avif";
    default: throw new Error(`unsupported PDF image MIME type: ${mimeType}`);
  }
}

/** Derive a stable, content-addressed path for a retained PDF image. */
export function pdfImageAssetPath(image: Pick<PdfImageCandidate, "sha256" | "mimeType">): string {
  if (!/^[0-9a-f]{64}$/u.test(image.sha256)) throw new Error("invalid PDF image sha256");
  return `assets/${image.sha256}.${extensionForMimeType(image.mimeType)}`;
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertSourceIdentity(path: string, expectedBytes: number, expectedSha256: string, label: string): void {
  const stats = statSync(path);
  if (!stats.isFile() || stats.size !== expectedBytes || hashFile(path) !== expectedSha256) {
    throw new Error(`${label} changed after PDF inspection`);
  }
}

function ownedPdfTarget(targetDirectory: string, slug: string): { readonly device: number; readonly inode: number } {
  const directory = lstatSync(targetDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error("PDF --force only replaces a regular PDF capture directory");
  }
  const manifestPath = join(targetDirectory, PDF_CAPTURE_MANIFEST_FILENAME);
  const markdownPath = join(targetDirectory, `${safeSlug(slug)}.md`);
  const sourcePath = join(targetDirectory, PDF_CAPTURE_SOURCE_FILENAME);
  for (const path of [manifestPath, markdownPath, sourcePath]) {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("PDF --force refused a target without its owned files");
    }
  }
  if (lstatSync(manifestPath).size > 16 * 1024 * 1024) {
    throw new Error("PDF --force refused an oversized capture manifest");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    throw new Error("PDF --force refused an invalid capture manifest");
  }
  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
    || !("schemaVersion" in parsed)
    || parsed.schemaVersion !== PDF_CAPTURE_MANIFEST_SCHEMA_VERSION
    || !("kind" in parsed)
    || parsed.kind !== "pdf"
  ) throw new Error("PDF --force refused an incompatible capture manifest");
  return { device: directory.dev, inode: directory.ino };
}

function assertStagingTreeSafe(root: string, directory = root): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assertConfinedChild(root, path, "staged PDF artifact");
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) throw new Error("staged PDF artifacts must not be symbolic links");
    if (stats.isDirectory()) assertStagingTreeSafe(root, path);
    else if (!stats.isFile()) throw new Error("staged PDF artifacts must be regular files");
  }
}

function unusedBackupPath(root: string): string {
  for (;;) {
    const candidate = join(root, `.pdf-capture-backup-${randomUUID()}`);
    assertConfinedChild(root, candidate, "PDF capture backup");
    if (!existsSync(candidate)) return candidate;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type PersistPdfCaptureInput = {
  readonly outputBase: string;
  readonly slug: string;
  readonly force: boolean;
  readonly sourcePath: string;
  readonly markdown: string;
  readonly manifest: PdfCaptureManifest;
  readonly images: readonly PdfImageCandidate[];
  readonly annotationsJson?: string;
  readonly afterBackup?: () => void;
  readonly afterInstall?: () => void;
};

/** Stage and atomically install a complete PDF source bundle. */
export function persistPdfCapture(input: PersistPdfCaptureInput): string {
  const slug = safeSlug(input.slug);
  const root = outputRoot(input.outputBase);
  const targetDirectory = join(root, slug);
  assertConfinedChild(root, targetDirectory, "PDF capture target");
  const targetExists = existsSync(targetDirectory);
  if (targetExists && !input.force) {
    throw new Error(`PDF capture already exists: ${targetDirectory}; pass --force to replace it`);
  }
  const expectedIdentity = targetExists ? ownedPdfTarget(targetDirectory, slug) : null;
  const stagingDirectory = mkdtempSync(join(root, ".pdf-capture-staging-"));
  chmodSync(stagingDirectory, 0o700);
  assertConfinedChild(root, stagingDirectory, "PDF capture staging directory");

  try {
    assertSourceIdentity(
      input.sourcePath,
      input.manifest.source.bytes,
      input.manifest.source.sha256,
      "PDF source",
    );
    const sourceDestination = join(stagingDirectory, PDF_CAPTURE_SOURCE_FILENAME);
    copyFileSync(input.sourcePath, sourceDestination);
    chmodSync(sourceDestination, 0o644);
    const assetsDirectory = join(stagingDirectory, "assets");
    mkdirSync(assetsDirectory, { recursive: true, mode: 0o755 });

    const imagesByPath = new Map<string, PdfImageCandidate>();
    for (const image of input.images) {
      const assetPath = pdfImageAssetPath(image);
      const existing = imagesByPath.get(assetPath);
      if (existing !== undefined) {
        if (existing.bytes !== image.bytes || existing.sha256 !== image.sha256) {
          throw new Error("conflicting PDF image assets have the same destination");
        }
        continue;
      }
      imagesByPath.set(assetPath, image);
    }
    for (const [assetPath, image] of [...imagesByPath.entries()].sort(([left], [right]) =>
      left.localeCompare(right))) {
      assertSourceIdentity(image.sourcePath, image.bytes, image.sha256, "PDF image");
      const destination = join(stagingDirectory, assetPath);
      assertConfinedChild(stagingDirectory, destination, "PDF image destination");
      copyFileSync(image.sourcePath, destination);
      chmodSync(destination, 0o644);
    }

    writeFileSync(
      join(stagingDirectory, `${slug}.md`),
      `${redactSensitiveText(input.markdown).trimEnd()}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o644 },
    );
    if (input.manifest.annotations === null) {
      if (input.annotationsJson !== undefined) {
        throw new Error("PDF annotations were supplied without manifest provenance");
      }
    } else {
      const annotationsJson = input.annotationsJson;
      if (annotationsJson === undefined) {
        throw new Error("PDF annotation provenance is missing its retained input");
      }
      if (
        Buffer.byteLength(annotationsJson) !== input.manifest.annotations.bytes
        || createHash("sha256").update(annotationsJson).digest("hex")
          !== input.manifest.annotations.sha256
      ) {
        throw new Error("PDF annotation input does not match its manifest provenance");
      }
      let annotations: unknown;
      try {
        annotations = JSON.parse(annotationsJson) as unknown;
      } catch {
        throw new Error("PDF annotation input is not valid JSON");
      }
      if (
        !Array.isArray(annotations)
        || annotations.length !== input.manifest.annotations.count
      ) {
        throw new Error("PDF annotation input count does not match its manifest provenance");
      }
      writeFileSync(
        join(stagingDirectory, PDF_CAPTURE_ANNOTATIONS_FILENAME),
        annotationsJson,
        { encoding: "utf8", flag: "wx", mode: 0o644 },
      );
    }
    writeFileSync(
      join(stagingDirectory, PDF_CAPTURE_MANIFEST_FILENAME),
      `${JSON.stringify(input.manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o644 },
    );
    assertStagingTreeSafe(stagingDirectory);

    if (existsSync(targetDirectory) !== (expectedIdentity !== null)) {
      throw new Error("PDF capture target changed during the transaction");
    }
    if (expectedIdentity !== null) {
      const current = ownedPdfTarget(targetDirectory, slug);
      if (current.device !== expectedIdentity.device || current.inode !== expectedIdentity.inode) {
        throw new Error("PDF capture target changed during the transaction");
      }
    }

    const backupDirectory = expectedIdentity === null ? null : unusedBackupPath(root);
    let installed = false;
    let backedUp = false;
    try {
      if (backupDirectory !== null) {
        renameSync(targetDirectory, backupDirectory);
        backedUp = true;
        input.afterBackup?.();
      }
      renameSync(stagingDirectory, targetDirectory);
      installed = true;
      input.afterInstall?.();
      if (backupDirectory !== null) rmSync(backupDirectory, { recursive: true, force: true });
      return targetDirectory;
    } catch (error) {
      let rollbackError: unknown;
      try {
        if (installed && existsSync(targetDirectory)) {
          rmSync(targetDirectory, { recursive: true, force: true });
        }
        if (backedUp && backupDirectory !== null && existsSync(backupDirectory)) {
          if (existsSync(targetDirectory)) throw new Error("target was recreated before rollback");
          renameSync(backupDirectory, targetDirectory);
        }
      } catch (caught) {
        rollbackError = caught;
      }
      if (rollbackError !== undefined) {
        throw new Error(
          `PDF capture commit failed (${errorMessage(error)}) and rollback failed (${errorMessage(rollbackError)})`,
          { cause: error },
        );
      }
      throw error;
    }
  } catch (error) {
    if (existsSync(stagingDirectory)) rmSync(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function pdfMarkdownFilename(slug: string): string {
  return `${safeSlug(slug)}.md`;
}
