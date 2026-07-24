export const PDF_CAPTURE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const PDF_CAPTURE_MANIFEST_FILENAME = "capture.json";
export const PDF_CAPTURE_SOURCE_FILENAME = "source.pdf";
export const PDF_CAPTURE_ANNOTATIONS_FILENAME = "annotations.json";

export type PdfCaptureStatus = "complete" | "partial";

export type PdfBounds = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
};

export type PdfDocumentMetadata = {
  readonly title: string | null;
  readonly author: string | null;
  readonly subject: string | null;
  readonly keywords: string | null;
  readonly creator: string | null;
  readonly producer: string | null;
  readonly createdAt: string | null;
  readonly modifiedAt: string | null;
  readonly pageCount: number;
  readonly encrypted: boolean;
};

export type PdfRemoteSource = {
  readonly requestedUrl: string;
  readonly finalUrl: string;
};

export type PdfTextFragment = PdfBounds & {
  readonly text: string;
  readonly fontId: string;
  readonly fontSize: number;
  readonly bold: boolean;
  readonly italic: boolean;
};

export type PdfImageCandidate = PdfBounds & {
  readonly id: string;
  readonly page: number;
  readonly sourcePath: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly mimeType: string;
};

export type PdfPageLayout = {
  readonly page: number;
  readonly width: number;
  readonly height: number;
  readonly text: readonly PdfTextFragment[];
  readonly images: readonly PdfImageCandidate[];
};

export type PdfInspection = {
  readonly inputPath: string;
  readonly originalFilename: string;
  readonly sourceBytes: number;
  readonly sourceSha256: string;
  readonly metadata: PdfDocumentMetadata;
  readonly processedPages: number;
  readonly pages: readonly PdfPageLayout[];
  readonly popplerVersion: string | null;
  readonly warnings: readonly string[];
  /**
   * The caller owns this directory. Image candidate paths remain valid until
   * the caller removes it.
   */
  readonly workspaceDirectory: string;
};

export type PdfImageSemanticMetadata = {
  readonly platform?: string;
  readonly contentType?: string;
  readonly channel?: string;
  readonly author?: string;
  readonly timestamp?: string;
  readonly participants?: readonly string[];
};

export type PdfImageInterpretation =
  | {
      readonly id: string;
      readonly sha256: string;
      readonly kind: "text" | "mixed";
      readonly markdown: string;
      readonly metadata?: PdfImageSemanticMetadata;
      readonly method?: "agent" | "manual";
    }
  | {
      readonly id: string;
      readonly sha256: string;
      readonly kind: "visual";
      readonly alt?: string;
      readonly metadata?: PdfImageSemanticMetadata;
      readonly method?: "agent" | "manual";
    };

export type PdfOcrResult = {
  readonly kind: "mixed" | "visual";
  readonly text: string;
  readonly markdown: string;
  readonly confidence: number | null;
  readonly wordCount: number;
  readonly warnings: readonly string[];
};

export type PdfManifestAsset = {
  readonly path: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly sha256: string;
};

export type PdfManifestImage = PdfBounds & {
  readonly id: string;
  readonly page: number;
  readonly asset: PdfManifestAsset;
  readonly kind: "text" | "mixed" | "visual";
  readonly method: "agent" | "manual" | "tesseract" | "unclassified";
  readonly confidence: number | null;
  readonly wordCount: number;
  readonly metadata: PdfImageSemanticMetadata | null;
};

export type PdfCaptureManifest = {
  readonly schemaVersion: typeof PDF_CAPTURE_MANIFEST_SCHEMA_VERSION;
  readonly kind: "pdf";
  readonly capturedAt: string;
  readonly status: PdfCaptureStatus;
  readonly source: {
    readonly originalFilename: string;
    readonly path: typeof PDF_CAPTURE_SOURCE_FILENAME;
    readonly mimeType: "application/pdf";
    readonly bytes: number;
    readonly sha256: string;
    readonly requestedUrl?: string;
    readonly finalUrl?: string;
  };
  readonly document: PdfDocumentMetadata & {
    readonly processedPages: number;
  };
  readonly extraction: {
    readonly layout: "pdftohtml-xml";
    readonly popplerVersion: string | null;
    readonly ocr: "tesseract" | "annotations" | "mixed" | "unavailable";
    readonly headingCount: number;
    readonly textBlockCount: number;
    readonly imageCount: number;
    readonly textImageCount: number;
    readonly mixedImageCount: number;
    readonly visualImageCount: number;
  };
  readonly images: readonly PdfManifestImage[];
  readonly annotations: {
    readonly path: typeof PDF_CAPTURE_ANNOTATIONS_FILENAME;
    readonly count: number;
    readonly bytes: number;
    readonly sha256: string;
  } | null;
  readonly embeddedPlatforms: readonly string[];
  readonly warnings: readonly string[];
};

export type PdfCaptureOptions = {
  readonly inputPath: string;
  readonly outputBase: string;
  readonly remoteSource?: PdfRemoteSource;
  readonly slug?: string;
  readonly force?: boolean;
  readonly interpretations?: readonly PdfImageInterpretation[];
  readonly timeoutMs?: number;
  readonly maxPdfBytes?: number;
  readonly maxPages?: number;
  readonly maxImages?: number;
  readonly maxAssetBytes?: number;
  readonly maxTotalAssetBytes?: number;
  readonly workspaceDirectory?: string;
};

export type PdfInspectOptions = Pick<
  PdfCaptureOptions,
  "inputPath" | "timeoutMs" | "maxPdfBytes" | "maxPages" | "maxImages" | "maxAssetBytes" | "maxTotalAssetBytes"
> & {
  readonly workspaceDirectory: string;
};

export type PdfCaptureOutcome = {
  readonly status: PdfCaptureStatus;
  readonly slug: string;
  readonly outputDirectory: string;
  readonly markdownPath: string;
  readonly sourcePath: string;
  readonly wordCount: number;
  readonly pageCount: number;
  readonly processedPages: number;
  readonly imageCount: number;
  readonly warnings: readonly string[];
  readonly markdown: string;
  readonly manifest: PdfCaptureManifest;
};

export type PdfToolCommand = {
  readonly command: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
};

export type PdfToolCommandResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

export type PdfToolRunner = (specification: PdfToolCommand) => Promise<PdfToolCommandResult>;

export type PdfToolPaths = {
  readonly pdfinfo: string;
  readonly pdftohtml: string;
  readonly tesseract: string | null;
};

export type PdfCaptureDependencies = {
  readonly runTool?: PdfToolRunner;
  readonly tools?: Partial<PdfToolPaths>;
  readonly which?: (name: string) => string | null;
  readonly exists?: (path: string) => boolean;
  readonly now?: () => Date;
};
