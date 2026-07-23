#!/usr/bin/env bun
/** Generic, bounded, authenticated-when-explicit web capture CLI. */
import { parseArguments, usage, type CliArguments } from "./args.js";
import { runCapture, type CaptureOutcome } from "./capture.js";
import {
  adapterCapabilities,
  inspectClipEnvironment,
  renderAdapterCapabilities,
  renderDoctorReport,
} from "./doctor.js";
import { redactSensitiveText } from "./persist.js";
import { sanitizeTerminalLine, sanitizeTerminalText } from "./terminal.js";

type Output = {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
};

const defaultOutput: Output = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

function line(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function safe(value: string): string {
  return sanitizeTerminalLine(redactSensitiveText(value));
}

function redacted(value: string): string {
  return redactSensitiveText(value);
}

function terminalSafeJson(value: unknown): string {
  return `${JSON.stringify(
    value,
    (_key, candidate: unknown) => typeof candidate === "string" ? sanitizeTerminalText(candidate) : candidate,
    2,
  )}\n`;
}

type CliDependencies = {
  readonly runCapture?: typeof runCapture;
  readonly inspectClipEnvironment?: typeof inspectClipEnvironment;
};

export type ClipRuntimeOptions = {
  /** Trusted embedding hint; never parsed from public CLI arguments. */
  readonly ownedBrowserProfile?: {
    readonly path: string;
    readonly profileDirectory?: "Default";
  };
  /** Trusted embedding hint; never parsed from public CLI arguments. */
  readonly browserExecutable?: string;
};

export function captureSummary(outcome: CaptureOutcome): Record<string, unknown> {
  return {
    ok: captureSucceeded(outcome),
    status: outcome.status,
    sourceUrl: redacted(outcome.sourceUrl),
    canonicalUrl: redacted(outcome.canonicalUrl),
    platform: outcome.platform,
    scope: outcome.scope,
    slug: outcome.slug,
    acquisitionMethod: outcome.acquisitionMethod,
    extractor: outcome.extractor,
    wordCount: outcome.wordCount,
    capturedItems: outcome.capturedItems,
    expectedItems: outcome.expectedItems,
    outputDirectory: outcome.outputDirectory,
    markdownPath: outcome.markdownPath,
    assetCount: outcome.assetCount,
    warnings: outcome.warnings.map((warning) => redacted(warning)),
    attempts: outcome.attempts.map((attempt) => ({ ...attempt, message: redacted(attempt.message) })),
    manifest: outcome.manifest,
  };
}

export function captureSucceeded(outcome: CaptureOutcome): boolean {
  return outcome.status === "complete" || outcome.status === "partial";
}

export function captureExitCode(outcome: CaptureOutcome): number {
  return captureSucceeded(outcome) ? 0 : 3;
}

async function diagnosticCommand(
  arguments_: Extract<CliArguments, { readonly command: "doctor" }>,
  output: Output,
  inspectEnvironment: typeof inspectClipEnvironment,
): Promise<number> {
  const report = await inspectEnvironment();
  output.stdout(arguments_.json
    ? terminalSafeJson(report)
    : sanitizeTerminalText(renderDoctorReport(report)));
  const requiredReady = report.bun.status === "ready"
    && report.dependencies.every(({ status }) => status === "ready");
  return requiredReady ? 0 : 4;
}

/** CLI entry point, split out so argument and output behavior can be forward-tested. */
export async function main(
  rawArguments: readonly string[] = process.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = process.env,
  output: Output = defaultOutput,
  dependencies: CliDependencies = {},
  runtimeOptions: ClipRuntimeOptions = {},
): Promise<number> {
  const parsed = parseArguments(rawArguments, environment);
  if (!parsed.ok) {
    output.stderr(`error: ${safe(parsed.message)}\n\n${sanitizeTerminalText(usage)}`);
    return 2;
  }
  const arguments_ = parsed.value;
  if (arguments_.command === "help") {
    output.stdout(sanitizeTerminalText(usage));
    return 0;
  }
  if (arguments_.command === "doctor") {
    return diagnosticCommand(arguments_, output, dependencies.inspectClipEnvironment ?? inspectClipEnvironment);
  }
  if (arguments_.command === "adapters") {
    output.stdout(arguments_.json
      ? terminalSafeJson({ schemaVersion: 1, adapters: adapterCapabilities })
      : sanitizeTerminalText(renderAdapterCapabilities()));
    return 0;
  }

  if (!arguments_.quiet && !arguments_.json) {
    const target = arguments_.currentTab ? "the current browser tab" : safe(arguments_.url?.href ?? "current");
    output.stderr(`Capturing ${target} (${arguments_.mode}, ${arguments_.scope}) ...\n`);
  }
  try {
    if (
      runtimeOptions.ownedBrowserProfile !== undefined
      && arguments_.browserProfile !== runtimeOptions.ownedBrowserProfile.path
    ) {
      throw new Error("owned browser-profile execution does not match the selected private profile path");
    }
    const captureArguments = runtimeOptions.ownedBrowserProfile === undefined
      ? {
          ...arguments_,
          ...(runtimeOptions.browserExecutable === undefined
            ? {}
            : { browserExecutable: runtimeOptions.browserExecutable }),
        }
      : {
          ...arguments_,
          browserProfileOwnership: "owned" as const,
          ...(runtimeOptions.browserExecutable === undefined
            ? {}
            : { browserExecutable: runtimeOptions.browserExecutable }),
          ...(runtimeOptions.ownedBrowserProfile.profileDirectory === undefined
            ? {}
            : { browserProfileDirectory: runtimeOptions.ownedBrowserProfile.profileDirectory }),
        };
    const outcome = await (dependencies.runCapture ?? runCapture)(captureArguments);
    if (arguments_.json) {
      output.stdout(terminalSafeJson(captureSummary(outcome)));
    } else if (arguments_.stdout) {
      output.stdout(sanitizeTerminalText(outcome.markdown));
    } else {
      output.stdout(line(safe(`Done: ${outcome.markdownPath ?? outcome.outputDirectory ?? outcome.slug}`)));
      output.stdout(line(safe(`Status: ${outcome.status}; ${outcome.wordCount} words; ${outcome.capturedItems}${outcome.expectedItems === null ? "" : `/${outcome.expectedItems}`} items; ${outcome.assetCount} assets.`)));
    }
    if (!arguments_.quiet && outcome.warnings.length > 0) {
      for (const warning of outcome.warnings) output.stderr(`warning: ${safe(warning)}\n`);
    }
    return captureExitCode(outcome);
  } catch (error) {
    const message = safe(error instanceof Error ? error.message : String(error));
    if (arguments_.json) output.stdout(terminalSafeJson({ ok: false, error: message }));
    else output.stderr(`error: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main();
