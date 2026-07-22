#!/usr/bin/env bun
import { relative } from "node:path";

import { main as runClipCommand } from "./clip/cli.js";
import { redactSensitiveText } from "./clip/persist.js";
import { sanitizeTerminalLine, sanitizeTerminalText } from "./clip/terminal.js";
import { lookupNote, type Backlink, type LinkIssue, type VaultAnalysis } from "./graph.js";
import { initVault, type InitVaultResult } from "./init.js";
import {
  refreshVault,
  scanVault,
  type ScanVaultOptions,
  type VaultSnapshot,
} from "./vault.js";

type Output = {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
};

const defaultOutput: Output = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export const usage = `kb — auditable capture and derived links for Markdown vaults

Usage:
  kb init [directory] [--json]
  kb clip <url> [capture options]
  kb inspect <url> [capture options]
  kb refresh [--root <directory>] [--index <path>] [--json]
  kb check [--root <directory>] [--index <path>] [--json]
  kb graph [--root <directory>] [--index <path>] [--json]
  kb backlinks <note> [--root <directory>] [--index <path>] [--json]
  kb doctor [--json]
  kb adapters [--json]

Run \`kb clip --help\` for capture, authentication, evidence, and resource-bound options.
`;

type VaultCommand = "refresh" | "check" | "graph" | "backlinks";

type ParsedCommand =
  | { readonly kind: "help" }
  | { readonly kind: "clip"; readonly arguments: readonly string[] }
  | { readonly kind: "init"; readonly directory: string; readonly json: boolean }
  | {
      readonly kind: VaultCommand;
      readonly root: string;
      readonly options: ScanVaultOptions;
      readonly json: boolean;
      readonly note?: string;
    };

type ParseResult =
  | { readonly ok: true; readonly value: ParsedCommand }
  | { readonly ok: false; readonly message: string };

type CliDependencies = {
  readonly runClipCommand?: typeof runClipCommand;
  readonly initVault?: typeof initVault;
  readonly scanVault?: typeof scanVault;
  readonly refreshVault?: typeof refreshVault;
};

function safe(value: string): string {
  return sanitizeTerminalLine(redactSensitiveText(value));
}

function terminalSafeJson(value: unknown): string {
  return `${JSON.stringify(
    value,
    (_key, candidate: unknown) => typeof candidate === "string"
      ? sanitizeTerminalText(redactSensitiveText(candidate))
      : candidate,
    2,
  )}\n`;
}

function readValue(arguments_: readonly string[], index: number): string | null {
  const value = arguments_[index + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

function parseVaultCommand(command: VaultCommand, arguments_: readonly string[]): ParseResult {
  let root = ".";
  let index: string | undefined;
  let json = false;
  const positional: string[] = [];

  for (let cursor = 0; cursor < arguments_.length; cursor += 1) {
    const argument = arguments_[cursor];
    if (argument === undefined) continue;
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--root" || argument === "--index") {
      const value = readValue(arguments_, cursor);
      if (value === null) return { ok: false, message: `${argument} requires a value` };
      if (argument === "--root") root = value;
      else index = value;
      cursor += 1;
      continue;
    }
    if (argument.startsWith("--")) return { ok: false, message: `unknown ${command} option` };
    positional.push(argument);
  }

  if (command === "backlinks") {
    const note = positional[0];
    if (positional.length !== 1 || note === undefined) {
      return { ok: false, message: "backlinks requires exactly one note path, title, or alias" };
    }
    return {
      ok: true,
      value: {
        kind: command,
        root,
        options: index === undefined ? {} : { index },
        json,
        note,
      },
    };
  }
  if (positional.length !== 0) return { ok: false, message: `${command} does not accept positional arguments` };
  return {
    ok: true,
    value: {
      kind: command,
      root,
      options: index === undefined ? {} : { index },
      json,
    },
  };
}

export function parseArguments(arguments_: readonly string[]): ParseResult {
  const command = arguments_[0];
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    return { ok: true, value: { kind: "help" } };
  }
  if (command === "clip" || command === "capture" || command === "inspect") {
    if (arguments_[1] === "--help" || arguments_[1] === "-h" || arguments_[1] === "help") {
      return { ok: true, value: { kind: "clip", arguments: ["help"] } };
    }
    const delegated = command === "inspect" ? "inspect" : "capture";
    return { ok: true, value: { kind: "clip", arguments: [delegated, ...arguments_.slice(1)] } };
  }
  if (command === "doctor" || command === "adapters") {
    return { ok: true, value: { kind: "clip", arguments: arguments_ } };
  }
  if (command === "init") {
    let directory = "kb";
    let json = false;
    const positional: string[] = [];
    for (const argument of arguments_.slice(1)) {
      if (argument === "--json") json = true;
      else if (argument.startsWith("--")) return { ok: false, message: "unknown init option" };
      else positional.push(argument);
    }
    if (positional.length > 1) return { ok: false, message: "init accepts at most one directory" };
    if (positional[0] !== undefined) directory = positional[0];
    return { ok: true, value: { kind: "init", directory, json } };
  }
  if (command === "refresh" || command === "check" || command === "graph" || command === "backlinks") {
    return parseVaultCommand(command, arguments_.slice(1));
  }
  return { ok: false, message: "unknown command" };
}

function issueJson(issue: LinkIssue): Record<string, unknown> {
  return issue.kind === "broken"
    ? { kind: issue.kind, source: issue.source, line: issue.line, target: issue.target }
    : {
        kind: issue.kind,
        source: issue.source,
        line: issue.line,
        target: issue.target,
        candidates: issue.candidates,
      };
}

function summary(snapshot: VaultSnapshot): Record<string, unknown> {
  return {
    root: snapshot.root,
    indexPath: snapshot.indexPath,
    index: snapshot.index,
    noteCount: snapshot.analysis.noteCount,
    contextualLinkCount: snapshot.analysis.contextualLinks.length,
    backlinkCount: snapshot.analysis.backlinks.length,
    issues: snapshot.analysis.issues.map(issueJson),
    orphans: snapshot.analysis.orphans,
    mentions: snapshot.analysis.mentions,
  };
}

function renderIssue(issue: LinkIssue): string {
  if (issue.kind === "broken") {
    return `${safe(issue.source)}:${issue.line}: broken wikilink [[${safe(issue.target)}]]`;
  }
  return `${safe(issue.source)}:${issue.line}: ambiguous wikilink [[${safe(issue.target)}]] (${issue.candidates.map(safe).join(", ")})`;
}

function renderAdvisories(analysis: VaultAnalysis): string[] {
  const lines: string[] = [];
  if (analysis.orphans.length > 0) {
    lines.push(`Advisory: ${analysis.orphans.length} contextual orphan${analysis.orphans.length === 1 ? "" : "s"}.`);
    for (const orphan of analysis.orphans) lines.push(`  ${safe(orphan)}`);
  }
  if (analysis.mentions.length > 0) {
    lines.push(`Advisory: ${analysis.mentions.length} exact unlinked title or alias mention${analysis.mentions.length === 1 ? "" : "s"}.`);
    for (const mention of analysis.mentions) {
      lines.push(`  ${safe(mention.source)}:${mention.line} mentions “${safe(mention.phrase)}” (${safe(mention.target)})`);
    }
  }
  return lines;
}

function checkExitCode(snapshot: VaultSnapshot): number {
  return snapshot.index === "stale" || snapshot.analysis.issues.length > 0 ? 3 : 0;
}

function renderSnapshot(command: "refresh" | "check", snapshot: VaultSnapshot): string {
  const lines = [
    `${command === "refresh" ? "Refreshed" : "Checked"} ${safe(snapshot.root)}`,
    `Index: ${snapshot.index}; notes: ${snapshot.analysis.noteCount}; contextual links: ${snapshot.analysis.contextualLinks.length}.`,
  ];
  if (snapshot.index === "stale") lines.push(`error: generated catalog is stale (${safe(snapshot.indexPath)})`);
  for (const issue of snapshot.analysis.issues) lines.push(`error: ${renderIssue(issue)}`);
  lines.push(...renderAdvisories(snapshot.analysis));
  return `${lines.join("\n")}\n`;
}

function graphJson(snapshot: VaultSnapshot): Record<string, unknown> {
  return { ...summary(snapshot), notes: snapshot.analysis.noteConnections };
}

function renderGraph(snapshot: VaultSnapshot): string {
  const lines = [
    `Graph: ${snapshot.analysis.noteCount} notes; ${snapshot.analysis.contextualLinks.length} contextual links.`,
  ];
  for (const note of snapshot.analysis.noteConnections) {
    lines.push(`${safe(note.path)}  ← ${note.inboundContextualCount}  → ${note.outboundContextualCount}`);
  }
  if (snapshot.analysis.contextualLinks.length > 0) {
    lines.push("Contextual edges:");
    for (const link of snapshot.analysis.contextualLinks) {
      lines.push(`  ${safe(link.source)}:${link.line} → ${safe(link.target)}`);
    }
  }
  for (const issue of snapshot.analysis.issues) lines.push(`error: ${renderIssue(issue)}`);
  lines.push(...renderAdvisories(snapshot.analysis));
  return `${lines.join("\n")}\n`;
}

function backlinkPayload(notePath: string, backlinks: readonly Backlink[]): Record<string, unknown> {
  return { note: notePath, count: backlinks.length, backlinks };
}

function renderBacklinks(notePath: string, backlinks: readonly Backlink[]): string {
  const lines = [`Backlinks to ${safe(notePath)} (${backlinks.length})`];
  if (backlinks.length === 0) lines.push("  None.");
  else for (const backlink of backlinks) lines.push(`  ${safe(backlink.source)}:${backlink.line}`);
  return `${lines.join("\n")}\n`;
}

async function runInit(
  command: Extract<ParsedCommand, { readonly kind: "init" }>,
  output: Output,
  initialize: typeof initVault,
): Promise<number> {
  const result: InitVaultResult = await initialize(command.directory);
  if (command.json) output.stdout(terminalSafeJson(result));
  else {
    const relativeRoot = relative(process.cwd(), result.root) || ".";
    output.stdout(`Initialized ${safe(relativeRoot)} with ${result.files.length} files.\n`);
  }
  return 0;
}

async function runVault(
  command: Extract<ParsedCommand, { readonly kind: VaultCommand }>,
  output: Output,
  dependencies: CliDependencies,
): Promise<number> {
  const snapshot = command.kind === "refresh"
    ? await (dependencies.refreshVault ?? refreshVault)(command.root, command.options)
    : await (dependencies.scanVault ?? scanVault)(command.root, command.options);

  if (command.kind === "refresh" || command.kind === "check") {
    output.stdout(command.json ? terminalSafeJson(summary(snapshot)) : sanitizeTerminalText(renderSnapshot(command.kind, snapshot)));
    return checkExitCode(snapshot);
  }
  if (command.kind === "graph") {
    output.stdout(command.json ? terminalSafeJson(graphJson(snapshot)) : sanitizeTerminalText(renderGraph(snapshot)));
    return 0;
  }

  const lookup = lookupNote(snapshot.notes, command.note ?? "");
  if (lookup.kind === "missing") {
    output.stderr("error: note was not found\n");
    return 3;
  }
  if (lookup.kind === "ambiguous") {
    if (command.json) {
      output.stdout(terminalSafeJson({ ok: false, kind: "ambiguous", candidates: lookup.candidates.map(({ path }) => path) }));
    } else {
      output.stderr(`error: note is ambiguous (${lookup.candidates.map(({ path }) => safe(path)).join(", ")})\n`);
    }
    return 3;
  }
  const connection = snapshot.analysis.noteConnections.find(({ id }) => id === lookup.note.id);
  const backlinks = connection?.backlinks ?? [];
  output.stdout(command.json
    ? terminalSafeJson(backlinkPayload(lookup.note.path, backlinks))
    : sanitizeTerminalText(renderBacklinks(lookup.note.path, backlinks)));
  return 0;
}

/** Stable CLI entry point with injectable filesystem and capture boundaries. */
export async function main(
  rawArguments: readonly string[] = process.argv.slice(2),
  output: Output = defaultOutput,
  dependencies: CliDependencies = {},
): Promise<number> {
  const parsed = parseArguments(rawArguments);
  if (!parsed.ok) {
    output.stderr(`error: ${safe(parsed.message)}\n\n${sanitizeTerminalText(usage)}`);
    return 2;
  }
  const command = parsed.value;
  if (command.kind === "help") {
    output.stdout(sanitizeTerminalText(usage));
    return 0;
  }
  try {
    if (command.kind === "clip") {
      return await (dependencies.runClipCommand ?? runClipCommand)(command.arguments, process.env, output);
    }
    if (command.kind === "init") {
      return await runInit(command, output, dependencies.initVault ?? initVault);
    }
    return await runVault(command, output, dependencies);
  } catch (error) {
    output.stderr(`error: ${safe(error instanceof Error ? error.message : String(error))}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main();
