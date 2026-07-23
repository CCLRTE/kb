import {
  parsePdfArguments as parsePdfArgumentsImplementation,
  pdfUsage as installedPdfUsage,
} from "./pdf/args.js";
import {
  main as runPdfCommandImplementation,
  pdfCaptureSummary as pdfCaptureSummaryImplementation,
} from "./pdf/cli.js";
import { runPdfCapture as runPdfCaptureImplementation } from "./pdf/capture.js";
import {
  inspectPdf as inspectPdfImplementation,
  pdfCaptureDefaults as installedPdfCaptureDefaults,
} from "./pdf/extract.js";
import {
  decodePopplerText as decodePopplerTextImplementation,
  layoutBlocks as layoutBlocksImplementation,
  parsePdfImageInterpretations as parsePdfImageInterpretationsImplementation,
  parsePdfInfo as parsePdfInfoImplementation,
  parsePopplerXml as parsePopplerXmlImplementation,
  type PdfLayoutBlock,
} from "./pdf/layout.js";
import { buildPdfMarkdown as buildPdfMarkdownImplementation } from "./pdf/markdown.js";
import {
  PDF_CAPTURE_ANNOTATIONS_FILENAME as installedAnnotationsFilename,
  PDF_CAPTURE_MANIFEST_FILENAME as installedManifestFilename,
  PDF_CAPTURE_MANIFEST_SCHEMA_VERSION as installedManifestSchemaVersion,
  PDF_CAPTURE_SOURCE_FILENAME as installedSourceFilename,
} from "./pdf/model.js";
import {
  ocrPdfImage as ocrPdfImageImplementation,
  parseTesseractTsv as parseTesseractTsvImplementation,
} from "./pdf/ocr.js";
import {
  pdfImageAssetPath as pdfImageAssetPathImplementation,
  pdfMarkdownFilename as pdfMarkdownFilenameImplementation,
  persistPdfCapture as persistPdfCaptureImplementation,
} from "./pdf/persist.js";
import {
  resolvePdfTools as resolvePdfToolsImplementation,
  runPdfToolCommand as runPdfToolCommandImplementation,
} from "./pdf/tools.js";

// Explicit value assignments avoid a Bun bundler bug that can drop bindings
// used only by a re-exporting entrypoint.
export const PDF_CAPTURE_MANIFEST_FILENAME = installedManifestFilename;
export const PDF_CAPTURE_MANIFEST_SCHEMA_VERSION = installedManifestSchemaVersion;
export const PDF_CAPTURE_SOURCE_FILENAME = installedSourceFilename;
export const PDF_CAPTURE_ANNOTATIONS_FILENAME = installedAnnotationsFilename;
export const buildPdfMarkdown = buildPdfMarkdownImplementation;
export const decodePopplerText = decodePopplerTextImplementation;
export const inspectPdf = inspectPdfImplementation;
export const layoutBlocks = layoutBlocksImplementation;
export const ocrPdfImage = ocrPdfImageImplementation;
export const parsePdfArguments = parsePdfArgumentsImplementation;
export const parsePdfImageInterpretations = parsePdfImageInterpretationsImplementation;
export const parsePdfInfo = parsePdfInfoImplementation;
export const parsePopplerXml = parsePopplerXmlImplementation;
export const parseTesseractTsv = parseTesseractTsvImplementation;
export const pdfCaptureDefaults = installedPdfCaptureDefaults;
export const pdfCaptureSummary = pdfCaptureSummaryImplementation;
export const pdfImageAssetPath = pdfImageAssetPathImplementation;
export const pdfMarkdownFilename = pdfMarkdownFilenameImplementation;
export const pdfUsage = installedPdfUsage;
export const persistPdfCapture = persistPdfCaptureImplementation;
export const resolvePdfTools = resolvePdfToolsImplementation;
export const runPdfCapture = runPdfCaptureImplementation;
export const runPdfCommand = runPdfCommandImplementation;
export const runPdfToolCommand = runPdfToolCommandImplementation;

export type { PdfLayoutBlock };
export type {
  PdfBounds,
  PdfCaptureDependencies,
  PdfCaptureManifest,
  PdfCaptureOptions,
  PdfCaptureOutcome,
  PdfCaptureStatus,
  PdfDocumentMetadata,
  PdfImageCandidate,
  PdfImageInterpretation,
  PdfImageSemanticMetadata,
  PdfInspection,
  PdfManifestAsset,
  PdfManifestImage,
  PdfOcrResult,
  PdfPageLayout,
  PdfTextFragment,
  PdfToolCommand,
  PdfToolCommandResult,
  PdfToolPaths,
  PdfToolRunner,
} from "./pdf/model.js";
