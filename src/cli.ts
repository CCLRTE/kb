#!/usr/bin/env bun
import { relative } from "node:path";

import { main as runClipCommand } from "./clip/cli.js";
import { redactSensitiveText } from "./clip/persist.js";
import { sanitizeTerminalLine, sanitizeTerminalText } from "./clip/terminal.js";
import { main as runPdfCommand } from "./pdf/cli.js";
import {
  lookupNote,
  type Backlink,
  type LinkIssue,
  type MetadataScalar,
  type VaultAnalysis,
} from "./graph.js";
import { initVault, type InitVaultResult } from "./init.js";
import { navigateLinks, type LinkDirection, type LinkNeighborhood } from "./navigation.js";
import {
  queryVault,
  type MetadataFilter,
  type QueryDirection,
  type QueryRow,
  type QuerySort,
} from "./query.js";
import {
  indexSemanticVault,
  searchSemanticVault,
  type SemanticIndexResult,
  type SemanticSearchMode,
  type SemanticSearchResult,
} from "./semantic.js";
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

export const usage = `info — auditable capture and derived links for Markdown vaults

Usage:
  info init [directory] [--json]
  info clip <url|current> [capture options]
  info inspect <url> [capture options]
  info pdf <file-or-url> [PDF options]
  info refresh [--root <directory>] [--index <path>] [--json]
  info check [--root <directory>] [--index <path>] [--json]
  info graph [--root <directory>] [--index <path>] [--json]
  info backlinks <note> [--root <directory>] [--index <path>] [--json]
  info links <note> [--root <directory>] [--direction <in|out|both>] [--depth <count>] [--limit <count>] [--json]
  info list [--root <directory>] [--where <path=value>] [--has <path>] [--tag <tag>] [--sort <field>] [--order <asc|desc>] [--limit <count>] [--json]
  info index [--root <directory>] [--database <path>] [--force] [--json]
  info search <query> [--root <directory>] [--database <path>] [--mode <semantic|keyword>] [--limit <count>] [--min-score <score>] [--json]
  info doctor [--json]
  info adapters [--json]

Run \`info clip --help\` for web capture options or \`info pdf --help\` for PDF conversion options.
`;

type VaultCommand = "refresh" | "check" | "graph" | "backlinks" | "links";

type ParsedCommand =
  | { readonly kind: "help" }
  | { readonly kind: "clip"; readonly arguments: readonly string[] }
  | { readonly kind: "pdf"; readonly arguments: readonly string[] }
  | { readonly kind: "init"; readonly directory: string; readonly json: boolean }
  | {
      readonly kind: "index";
      readonly root: string;
      readonly database?: string;
      readonly force: boolean;
      readonly json: boolean;
    }
  | {
      readonly kind: "search";
      readonly root: string;
      readonly database?: string;
      readonly mode: SemanticSearchMode;
      readonly limit?: number;
      readonly minScore?: number;
      readonly query: string;
      readonly json: boolean;
    }
  | {
      readonly kind: "list";
      readonly root: string;
      readonly options: ScanVaultOptions;
      readonly filters: readonly MetadataFilter[];
      readonly tags: readonly string[];
      readonly sort: QuerySort;
      readonly direction: QueryDirection;
      readonly limit?: number;
      readonly json: boolean;
    }
  | {
      readonly kind: VaultCommand;
      readonly root: string;
      readonly options: ScanVaultOptions;
      readonly json: boolean;
      readonly note?: string;
      readonly direction?: LinkDirection;
      readonly depth?: number;
      readonly limit?: number;
    };

type ParseResult =
  | { readonly ok: true; readonly value: ParsedCommand }
  | { readonly ok: false; readonly message: string };

type CliDependencies = {
  readonly runClipCommand?: typeof runClipCommand;
  readonly runPdfCommand?: typeof runPdfCommand;
  readonly initVault?: typeof initVault;
  readonly scanVault?: typeof scanVault;
  readonly refreshVault?: typeof refreshVault;
  readonly indexSemanticVault?: typeof indexSemanticVault;
  readonly searchSemanticVault?: typeof searchSemanticVault;
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
  let direction: LinkDirection = "both";
  let depth = 1;
  let limit: number | undefined;
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
    if (command === "links" && (argument === "--direction" || argument === "--depth" || argument === "--limit")) {
      const value = readValue(arguments_, cursor);
      if (value === null) return { ok: false, message: `${argument} requires a value` };
      if (argument === "--direction") {
        if (value !== "in" && value !== "out" && value !== "both") {
          return { ok: false, message: "--direction must be in, out, or both" };
        }
        direction = value;
      } else if (argument === "--depth") {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10) {
          return { ok: false, message: "--depth must be an integer from 1 through 10" };
        }
        depth = parsed;
      } else {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
          return { ok: false, message: "--limit must be an integer from 1 through 1000" };
        }
        limit = parsed;
      }
      cursor += 1;
      continue;
    }
    if (argument.startsWith("--")) return { ok: false, message: `unknown ${command} option` };
    positional.push(argument);
  }

  if (command === "backlinks" || command === "links") {
    const note = positional[0];
    if (positional.length !== 1 || note === undefined) {
      return { ok: false, message: `${command} requires exactly one note path, title, or alias` };
    }
    return {
      ok: true,
      value: {
        kind: command,
        root,
        options: index === undefined ? {} : { index },
        json,
        note,
        ...(command === "links"
          ? { direction, depth, ...(limit === undefined ? {} : { limit }) }
          : {}),
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

type MetadataScalarParse =
  | { readonly ok: true; readonly value: MetadataScalar }
  | { readonly ok: false; readonly message: string };

function metadataScalar(raw: string): MetadataScalarParse {
  const value = raw.trim();
  if (value.startsWith('"') || value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "string"
        ? { ok: true, value: parsed }
        : { ok: false, message: "quoted --where values must be strings" };
    } catch {
      return { ok: false, message: "double-quoted --where values must be valid JSON strings" };
    }
  }
  if (value.startsWith("'") || value.endsWith("'")) {
    if (!(value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      return { ok: false, message: "single-quoted --where values must have a closing quote" };
    }
    return { ok: true, value: value.slice(1, -1).replaceAll("''", "'") };
  }
  if (value === "null") return { ok: true, value: null };
  if (value === "true") return { ok: true, value: true };
  if (value === "false") return { ok: true, value: false };
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      if (Number.isInteger(number) && !Number.isSafeInteger(number)) {
        return { ok: false, message: "numeric --where values must be safe integers; quote large identifiers" };
      }
      return { ok: true, value: number };
    }
  }
  return { ok: true, value };
}

function querySort(raw: string): QuerySort | null {
  const value = raw.trim();
  if (value === "title" || value === "path" || value === "inbound" || value === "outbound") {
    return { kind: "builtin", field: value };
  }
  const path = value.replace(/^(?:meta|metadata)\./u, "");
  return path === "" ? null : { kind: "metadata", path };
}

function parseListCommand(arguments_: readonly string[]): ParseResult {
  let root = ".";
  let index: string | undefined;
  let json = false;
  let sort: QuerySort = { kind: "builtin", field: "path" };
  let direction: QueryDirection = "asc";
  let limit: number | undefined;
  const filters: MetadataFilter[] = [];
  const tags: string[] = [];

  for (let cursor = 0; cursor < arguments_.length; cursor += 1) {
    const argument = arguments_[cursor];
    if (argument === undefined) continue;
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (
      argument === "--root"
      || argument === "--index"
      || argument === "--where"
      || argument === "--has"
      || argument === "--tag"
      || argument === "--sort"
      || argument === "--order"
      || argument === "--limit"
    ) {
      const value = readValue(arguments_, cursor);
      if (value === null) return { ok: false, message: `${argument} requires a value` };
      if (argument === "--root") root = value;
      else if (argument === "--index") index = value;
      else if (argument === "--tag") tags.push(value);
      else if (argument === "--has") {
        if (value.trim() === "") return { ok: false, message: "--has requires a metadata path" };
        filters.push({ kind: "exists", path: value });
      } else if (argument === "--where") {
        const equals = value.indexOf("=");
        const path = equals === -1 ? "" : value.slice(0, equals).trim();
        if (path === "") return { ok: false, message: "--where requires path=value" };
        const scalar = metadataScalar(value.slice(equals + 1));
        if (!scalar.ok) return scalar;
        filters.push({ kind: "equals", path, value: scalar.value });
      } else if (argument === "--sort") {
        const parsed = querySort(value);
        if (parsed === null) return { ok: false, message: "--sort requires a field" };
        sort = parsed;
      } else if (argument === "--order") {
        if (value !== "asc" && value !== "desc") {
          return { ok: false, message: "--order must be asc or desc" };
        }
        direction = value;
      } else {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 0) {
          return { ok: false, message: "--limit must be a non-negative integer" };
        }
        limit = parsed;
      }
      cursor += 1;
      continue;
    }
    return {
      ok: false,
      message: argument.startsWith("--")
        ? "unknown list option"
        : "list does not accept positional arguments",
    };
  }

  return {
    ok: true,
    value: {
      kind: "list",
      root,
      options: index === undefined ? {} : { index },
      filters,
      tags,
      sort,
      direction,
      ...(limit === undefined ? {} : { limit }),
      json,
    },
  };
}

function finiteNumber(raw: string, option: string): ParseResult | number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : { ok: false, message: `${option} requires a number` };
}

function parseSemanticCommand(command: "index" | "search", arguments_: readonly string[]): ParseResult {
  let root = ".";
  let database: string | undefined;
  let force = false;
  let json = false;
  let mode: SemanticSearchMode = "semantic";
  let limit: number | undefined;
  let minScore: number | undefined;
  const positional: string[] = [];

  for (let cursor = 0; cursor < arguments_.length; cursor += 1) {
    const argument = arguments_[cursor];
    if (argument === undefined) continue;
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--force" && command === "index") {
      force = true;
      continue;
    }
    if (argument === "--root" || argument === "--database") {
      const value = readValue(arguments_, cursor);
      if (value === null) return { ok: false, message: `${argument} requires a value` };
      if (argument === "--root") root = value;
      else database = value;
      cursor += 1;
      continue;
    }
    if (command === "search" && (argument === "--mode" || argument === "--limit" || argument === "--min-score")) {
      const value = readValue(arguments_, cursor);
      if (value === null) return { ok: false, message: `${argument} requires a value` };
      if (argument === "--mode") {
        if (value !== "semantic" && value !== "keyword") {
          return { ok: false, message: "--mode must be semantic or keyword" };
        }
        mode = value;
      } else {
        const parsed = finiteNumber(value, argument);
        if (typeof parsed !== "number") return parsed;
        if (argument === "--limit") limit = parsed;
        else minScore = parsed;
      }
      cursor += 1;
      continue;
    }
    if (argument.startsWith("--")) return { ok: false, message: `unknown ${command} option` };
    positional.push(argument);
  }

  if (command === "index") {
    if (positional.length > 0) return { ok: false, message: "index does not accept positional arguments" };
    return {
      ok: true,
      value: { kind: "index", root, ...(database === undefined ? {} : { database }), force, json },
    };
  }
  const query = positional.join(" ").trim();
  if (query === "") return { ok: false, message: "search requires a query" };
  return {
    ok: true,
    value: {
      kind: "search",
      root,
      ...(database === undefined ? {} : { database }),
      mode,
      ...(limit === undefined ? {} : { limit }),
      ...(minScore === undefined ? {} : { minScore }),
      query,
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
  if (command === "pdf") {
    return { ok: true, value: { kind: "pdf", arguments: arguments_.slice(1) } };
  }
  if (command === "doctor" || command === "adapters") {
    return { ok: true, value: { kind: "clip", arguments: arguments_ } };
  }
  if (command === "init") {
    let directory = "info";
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
  if (command === "refresh" || command === "check" || command === "graph" || command === "backlinks" || command === "links") {
    return parseVaultCommand(command, arguments_.slice(1));
  }
  if (command === "list" || command === "notes") return parseListCommand(arguments_.slice(1));
  if (command === "index" || command === "search") {
    return parseSemanticCommand(command, arguments_.slice(1));
  }
  return { ok: false, message: "unknown command" };
}

function embeddingCount(result: SemanticIndexResult | SemanticSearchResult): number {
  return result.embedding?.chunksEmbedded ?? 0;
}

function renderSemanticIndex(result: SemanticIndexResult): string {
  const changed = result.update.indexed + result.update.updated;
  return [
    `Indexed ${safe(result.root)} with QMD.`,
    `Documents: ${changed} changed, ${result.update.unchanged} unchanged, ${result.update.removed} removed.`,
    `Embeddings: ${embeddingCount(result)} chunks; model: ${safe(result.model)}.`,
    `Database: ${safe(result.database)}`,
    "",
  ].join("\n");
}

function renderSemanticSearch(result: SemanticSearchResult): string {
  const lines = [
    `${result.mode === "semantic" ? "Semantic" : "Keyword"} results for “${safe(result.query)}” (${result.results.length})`,
  ];
  if (result.results.length === 0) lines.push("  None.");
  for (const hit of result.results) {
    const location = `${safe(hit.path)}${hit.line === undefined ? "" : `:${hit.line}`}`;
    lines.push(`  ${hit.score.toFixed(3)}  ${location} — ${safe(hit.title)}`);
    if (hit.snippet !== "") lines.push(`    ${safe(hit.snippet)}`);
  }
  return `${lines.join("\n")}\n`;
}

async function runSemantic(
  command: Extract<ParsedCommand, { readonly kind: "index" | "search" }>,
  output: Output,
  dependencies: CliDependencies,
): Promise<number> {
  if (command.kind === "index") {
    const result = await (dependencies.indexSemanticVault ?? indexSemanticVault)({
      root: command.root,
      ...(command.database === undefined ? {} : { database: command.database }),
      force: command.force,
    });
    output.stdout(command.json ? terminalSafeJson(result) : sanitizeTerminalText(renderSemanticIndex(result)));
    return 0;
  }
  const result = await (dependencies.searchSemanticVault ?? searchSemanticVault)({
    root: command.root,
    query: command.query,
    mode: command.mode,
    ...(command.database === undefined ? {} : { database: command.database }),
    ...(command.limit === undefined ? {} : { limit: command.limit }),
    ...(command.minScore === undefined ? {} : { minScore: command.minScore }),
  });
  output.stdout(command.json ? terminalSafeJson(result) : sanitizeTerminalText(renderSemanticSearch(result)));
  return 0;
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

function renderLinks(neighborhood: LinkNeighborhood): string {
  const lines = [
    `Links around ${safe(neighborhood.note)} (${neighborhood.direction}, depth ${neighborhood.depth}, limit ${neighborhood.limit})`,
  ];
  for (const node of neighborhood.nodes) {
    lines.push(
      `  ${node.distance}  ${safe(node.path)} — ${safe(node.title)}  ← ${node.inboundContextualCount}  → ${node.outboundContextualCount}`,
    );
  }
  if (neighborhood.edges.length > 0) {
    lines.push("Edges:");
    for (const edge of neighborhood.edges) {
      lines.push(`  ${safe(edge.source)}:${edge.line} → ${safe(edge.target)}`);
    }
  }
  if (neighborhood.truncated) lines.push(`Truncated at ${neighborhood.limit} notes; lower the depth or raise --limit.`);
  return `${lines.join("\n")}\n`;
}

function renderList(rows: readonly QueryRow[]): string {
  const lines = [`Notes (${rows.length})`];
  if (rows.length === 0) lines.push("  None.");
  for (const row of rows) {
    const tags = row.tags.length === 0 ? "" : `  #${row.tags.map(safe).join(" #")}`;
    lines.push(
      `  ${safe(row.path)} — ${safe(row.title)}  ← ${row.inboundContextualCount}  → ${row.outboundContextualCount}${tags}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function runList(
  command: Extract<ParsedCommand, { readonly kind: "list" }>,
  output: Output,
  dependencies: CliDependencies,
): Promise<number> {
  const snapshot = await (dependencies.scanVault ?? scanVault)(command.root, command.options);
  const rows = queryVault(snapshot.notes, snapshot.analysis, {
    filters: command.filters,
    tags: command.tags,
    sort: command.sort,
    direction: command.direction,
    ...(command.limit === undefined ? {} : { limit: command.limit }),
  });
  output.stdout(command.json
    ? terminalSafeJson({ root: snapshot.root, count: rows.length, notes: rows })
    : sanitizeTerminalText(renderList(rows)));
  return 0;
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
  if (command.kind === "links") {
    const neighborhood = navigateLinks(snapshot.notes, snapshot.analysis, lookup.note, {
      direction: command.direction ?? "both",
      depth: command.depth ?? 1,
      ...(command.limit === undefined ? {} : { limit: command.limit }),
    });
    output.stdout(command.json
      ? terminalSafeJson(neighborhood)
      : sanitizeTerminalText(renderLinks(neighborhood)));
    return 0;
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
    if (command.kind === "pdf") {
      return await (dependencies.runPdfCommand ?? runPdfCommand)(command.arguments, process.env, output);
    }
    if (command.kind === "init") {
      return await runInit(command, output, dependencies.initVault ?? initVault);
    }
    if (command.kind === "index" || command.kind === "search") {
      return await runSemantic(command, output, dependencies);
    }
    if (command.kind === "list") return await runList(command, output, dependencies);
    return await runVault(command, output, dependencies);
  } catch (error) {
    output.stderr(`error: ${safe(error instanceof Error ? error.message : String(error))}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main();
