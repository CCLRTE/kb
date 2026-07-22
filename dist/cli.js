#!/usr/bin/env bun
// @bun
import {
  initVault,
  refreshVault,
  scanVault
} from "./index-et2vjvnz.js";
import {
  main,
  redactSensitiveText,
  sanitizeTerminalLine,
  sanitizeTerminalText
} from "./index-71w4dbh2.js";
import {
  lookupNote
} from "./index-41mfx0qy.js";

// src/cli.ts
import { relative } from "path";
var defaultOutput = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value)
};
var usage = `kb \u2014 auditable capture and derived links for Markdown vaults

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
function safe(value) {
  return sanitizeTerminalLine(redactSensitiveText(value));
}
function terminalSafeJson(value) {
  return `${JSON.stringify(value, (_key, candidate) => typeof candidate === "string" ? sanitizeTerminalText(redactSensitiveText(candidate)) : candidate, 2)}
`;
}
function readValue(arguments_, index) {
  const value = arguments_[index + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}
function parseVaultCommand(command, arguments_) {
  let root = ".";
  let index;
  let json = false;
  const positional = [];
  for (let cursor = 0;cursor < arguments_.length; cursor += 1) {
    const argument = arguments_[cursor];
    if (argument === undefined)
      continue;
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--root" || argument === "--index") {
      const value = readValue(arguments_, cursor);
      if (value === null)
        return { ok: false, message: `${argument} requires a value` };
      if (argument === "--root")
        root = value;
      else
        index = value;
      cursor += 1;
      continue;
    }
    if (argument.startsWith("--"))
      return { ok: false, message: `unknown ${command} option` };
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
        note
      }
    };
  }
  if (positional.length !== 0)
    return { ok: false, message: `${command} does not accept positional arguments` };
  return {
    ok: true,
    value: {
      kind: command,
      root,
      options: index === undefined ? {} : { index },
      json
    }
  };
}
function parseArguments(arguments_) {
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
    const positional = [];
    for (const argument of arguments_.slice(1)) {
      if (argument === "--json")
        json = true;
      else if (argument.startsWith("--"))
        return { ok: false, message: "unknown init option" };
      else
        positional.push(argument);
    }
    if (positional.length > 1)
      return { ok: false, message: "init accepts at most one directory" };
    if (positional[0] !== undefined)
      directory = positional[0];
    return { ok: true, value: { kind: "init", directory, json } };
  }
  if (command === "refresh" || command === "check" || command === "graph" || command === "backlinks") {
    return parseVaultCommand(command, arguments_.slice(1));
  }
  return { ok: false, message: "unknown command" };
}
function issueJson(issue) {
  return issue.kind === "broken" ? { kind: issue.kind, source: issue.source, line: issue.line, target: issue.target } : {
    kind: issue.kind,
    source: issue.source,
    line: issue.line,
    target: issue.target,
    candidates: issue.candidates
  };
}
function summary(snapshot) {
  return {
    root: snapshot.root,
    indexPath: snapshot.indexPath,
    index: snapshot.index,
    noteCount: snapshot.analysis.noteCount,
    contextualLinkCount: snapshot.analysis.contextualLinks.length,
    backlinkCount: snapshot.analysis.backlinks.length,
    issues: snapshot.analysis.issues.map(issueJson),
    orphans: snapshot.analysis.orphans,
    mentions: snapshot.analysis.mentions
  };
}
function renderIssue(issue) {
  if (issue.kind === "broken") {
    return `${safe(issue.source)}:${issue.line}: broken wikilink [[${safe(issue.target)}]]`;
  }
  return `${safe(issue.source)}:${issue.line}: ambiguous wikilink [[${safe(issue.target)}]] (${issue.candidates.map(safe).join(", ")})`;
}
function renderAdvisories(analysis) {
  const lines = [];
  if (analysis.orphans.length > 0) {
    lines.push(`Advisory: ${analysis.orphans.length} contextual orphan${analysis.orphans.length === 1 ? "" : "s"}.`);
    for (const orphan of analysis.orphans)
      lines.push(`  ${safe(orphan)}`);
  }
  if (analysis.mentions.length > 0) {
    lines.push(`Advisory: ${analysis.mentions.length} exact unlinked title or alias mention${analysis.mentions.length === 1 ? "" : "s"}.`);
    for (const mention of analysis.mentions) {
      lines.push(`  ${safe(mention.source)}:${mention.line} mentions \u201C${safe(mention.phrase)}\u201D (${safe(mention.target)})`);
    }
  }
  return lines;
}
function checkExitCode(snapshot) {
  return snapshot.index === "stale" || snapshot.analysis.issues.length > 0 ? 3 : 0;
}
function renderSnapshot(command, snapshot) {
  const lines = [
    `${command === "refresh" ? "Refreshed" : "Checked"} ${safe(snapshot.root)}`,
    `Index: ${snapshot.index}; notes: ${snapshot.analysis.noteCount}; contextual links: ${snapshot.analysis.contextualLinks.length}.`
  ];
  if (snapshot.index === "stale")
    lines.push(`error: generated catalog is stale (${safe(snapshot.indexPath)})`);
  for (const issue of snapshot.analysis.issues)
    lines.push(`error: ${renderIssue(issue)}`);
  lines.push(...renderAdvisories(snapshot.analysis));
  return `${lines.join(`
`)}
`;
}
function graphJson(snapshot) {
  return { ...summary(snapshot), notes: snapshot.analysis.noteConnections };
}
function renderGraph(snapshot) {
  const lines = [
    `Graph: ${snapshot.analysis.noteCount} notes; ${snapshot.analysis.contextualLinks.length} contextual links.`
  ];
  for (const note of snapshot.analysis.noteConnections) {
    lines.push(`${safe(note.path)}  \u2190 ${note.inboundContextualCount}  \u2192 ${note.outboundContextualCount}`);
  }
  if (snapshot.analysis.contextualLinks.length > 0) {
    lines.push("Contextual edges:");
    for (const link of snapshot.analysis.contextualLinks) {
      lines.push(`  ${safe(link.source)}:${link.line} \u2192 ${safe(link.target)}`);
    }
  }
  for (const issue of snapshot.analysis.issues)
    lines.push(`error: ${renderIssue(issue)}`);
  lines.push(...renderAdvisories(snapshot.analysis));
  return `${lines.join(`
`)}
`;
}
function backlinkPayload(notePath, backlinks) {
  return { note: notePath, count: backlinks.length, backlinks };
}
function renderBacklinks(notePath, backlinks) {
  const lines = [`Backlinks to ${safe(notePath)} (${backlinks.length})`];
  if (backlinks.length === 0)
    lines.push("  None.");
  else
    for (const backlink of backlinks)
      lines.push(`  ${safe(backlink.source)}:${backlink.line}`);
  return `${lines.join(`
`)}
`;
}
async function runInit(command, output, initialize) {
  const result = await initialize(command.directory);
  if (command.json)
    output.stdout(terminalSafeJson(result));
  else {
    const relativeRoot = relative(process.cwd(), result.root) || ".";
    output.stdout(`Initialized ${safe(relativeRoot)} with ${result.files.length} files.
`);
  }
  return 0;
}
async function runVault(command, output, dependencies) {
  const snapshot = command.kind === "refresh" ? await (dependencies.refreshVault ?? refreshVault)(command.root, command.options) : await (dependencies.scanVault ?? scanVault)(command.root, command.options);
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
    output.stderr(`error: note was not found
`);
    return 3;
  }
  if (lookup.kind === "ambiguous") {
    if (command.json) {
      output.stdout(terminalSafeJson({ ok: false, kind: "ambiguous", candidates: lookup.candidates.map(({ path }) => path) }));
    } else {
      output.stderr(`error: note is ambiguous (${lookup.candidates.map(({ path }) => safe(path)).join(", ")})
`);
    }
    return 3;
  }
  const connection = snapshot.analysis.noteConnections.find(({ id }) => id === lookup.note.id);
  const backlinks = connection?.backlinks ?? [];
  output.stdout(command.json ? terminalSafeJson(backlinkPayload(lookup.note.path, backlinks)) : sanitizeTerminalText(renderBacklinks(lookup.note.path, backlinks)));
  return 0;
}
async function main2(rawArguments = process.argv.slice(2), output = defaultOutput, dependencies = {}) {
  const parsed = parseArguments(rawArguments);
  if (!parsed.ok) {
    output.stderr(`error: ${safe(parsed.message)}

${sanitizeTerminalText(usage)}`);
    return 2;
  }
  const command = parsed.value;
  if (command.kind === "help") {
    output.stdout(sanitizeTerminalText(usage));
    return 0;
  }
  try {
    if (command.kind === "clip") {
      return await (dependencies.runClipCommand ?? main)(command.arguments, process.env, output);
    }
    if (command.kind === "init") {
      return await runInit(command, output, dependencies.initVault ?? initVault);
    }
    return await runVault(command, output, dependencies);
  } catch (error) {
    output.stderr(`error: ${safe(error instanceof Error ? error.message : String(error))}
`);
    return 1;
  }
}
if (import.meta.main)
  process.exitCode = await main2();
export {
  usage,
  parseArguments,
  main2 as main
};
