import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { BoundedByteBuffer } from "../clip/bounded-byte-buffer.js";
import type {
  PdfCaptureDependencies,
  PdfToolCommand,
  PdfToolCommandResult,
  PdfToolPaths,
  PdfToolRunner,
} from "./model.js";

const commonExecutableDirectories = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
] as const;

async function readBoundedStream(stream: NodeJS.ReadableStream, maxBytes: number): Promise<string> {
  const bytes = new BoundedByteBuffer(maxBytes);
  const iterable: AsyncIterable<unknown> = stream;
  for await (const value of iterable) {
    let chunk: Uint8Array;
    if (typeof value === "string") chunk = new TextEncoder().encode(value);
    else if (value instanceof Uint8Array) chunk = value;
    else throw new Error("PDF tool returned an unsupported output chunk");
    if (!bytes.append(chunk)) throw new Error(`PDF tool output exceeded ${maxBytes} bytes`);
  }
  return new TextDecoder().decode(bytes.toUint8Array());
}

/** Run a local PDF tool without a shell and with bounded output and wall time. */
export const runPdfToolCommand: PdfToolRunner = async (
  specification: PdfToolCommand,
): Promise<PdfToolCommandResult> => {
  const executable = specification.command[0];
  if (executable === undefined) throw new Error("PDF tool command is empty");
  const useProcessGroup = process.platform !== "win32";
  const child = spawn(executable, specification.command.slice(1), {
    cwd: specification.cwd,
    detached: useProcessGroup,
    env: {
      ...process.env,
      LC_ALL: "C",
      LANG: "C",
      ...specification.environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const exited = new Promise<number>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (code) => resolveExit(code ?? 1));
  });
  const signalProcessTree = (signal: NodeJS.Signals): void => {
    if (useProcessGroup && child.pid !== undefined) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // The process may have exited before the group signal.
      }
    }
    try {
      child.kill(signal);
    } catch {
      // Killing an already exited direct child is harmless.
    }
  };

  const state: { failure: Error | null } = { failure: null };
  let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
  const requestStop = (error: Error): void => {
    state.failure ??= error;
    if (forceKillTimer !== null) return;
    signalProcessTree("SIGTERM");
    forceKillTimer = setTimeout(() => signalProcessTree("SIGKILL"), 1_000);
  };
  const timer = setTimeout(() => {
    requestStop(new Error(`PDF tool timed out after ${specification.timeoutMs}ms`));
  }, specification.timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readBoundedStream(child.stdout, specification.maxOutputBytes).catch((error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        requestStop(normalized);
        throw normalized;
      }),
      readBoundedStream(child.stderr, specification.maxOutputBytes).catch((error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        requestStop(normalized);
        throw normalized;
      }),
      exited,
    ]);
    if (state.failure !== null) throw state.failure;
    return { stdout, stderr, exitCode };
  } catch (error) {
    requestStop(error instanceof Error ? error : new Error(String(error)));
    await exited.catch(() => 1);
    throw error;
  } finally {
    clearTimeout(timer);
    if (forceKillTimer !== null) clearTimeout(forceKillTimer);
  }
};

function discoverExecutable(
  name: string,
  dependencies: Pick<PdfCaptureDependencies, "which" | "exists">,
): string | null {
  const exists = dependencies.exists ?? existsSync;
  const fromPath = (dependencies.which ?? ((value: string) => Bun.which(value)))(name);
  if (fromPath !== null && exists(fromPath)) return fromPath;
  const homeCandidates = name === "tesseract"
    ? [join(homedir(), ".local", "bin", name)]
    : [];
  for (const path of [
    ...homeCandidates,
    ...commonExecutableDirectories.map((directory) => join(directory, name)),
  ]) {
    if (exists(path)) return path;
  }
  return null;
}

/** Resolve required Poppler tools and the optional local OCR executable. */
export function resolvePdfTools(dependencies: PdfCaptureDependencies = {}): PdfToolPaths {
  const pdfinfo = dependencies.tools?.pdfinfo
    ?? discoverExecutable("pdfinfo", dependencies);
  const pdftohtml = dependencies.tools?.pdftohtml
    ?? discoverExecutable("pdftohtml", dependencies);
  const tesseract = dependencies.tools?.tesseract === undefined
    ? discoverExecutable("tesseract", dependencies)
    : dependencies.tools.tesseract;
  if (pdfinfo === null) {
    throw new Error("pdfinfo is required for PDF ingestion; install the Poppler command-line tools");
  }
  if (pdftohtml === null) {
    throw new Error("pdftohtml is required for PDF ingestion; install the Poppler command-line tools");
  }
  return { pdfinfo, pdftohtml, tesseract };
}
