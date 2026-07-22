// @bun
import {
  analyzeVault,
  parseNote,
  renderCatalog,
  replaceCatalog
} from "./index-41mfx0qy.js";

// src/init.ts
import { mkdir, rm, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
var templates = {
  "index.md": `---
title: Knowledge base
---

# Knowledge base

This vault keeps captured sources separate from maintained notes. Catalog links are navigation; contextual links belong in prose when they help a reader follow a real relationship.

<!-- kb:catalog:start -->
## Note catalog

_No durable notes have been filed yet._

<!-- kb:catalog:end -->
`,
  "AGENTS.md": `# Contents

- \`index.md\` \u2013 the vault front door and deterministically refreshed note catalog.
- \`articles/\` \u2013 self-contained source captures with local attachments and capture metadata.
- \`notes/\` \u2013 maintained concept, entity, comparison, and synthesis notes.
- \`plans/\` \u2013 proposed through completed design and implementation plans.
- \`riffs/\` \u2013 cleaned first-person notes made from dictated or stream-of-consciousness source material.

# Guidelines

- Treat this directory as one Git-backed, Obsidian-compatible Markdown vault.
- Use vault-root wikilinks without \`.md\`, such as \`[[notes/context-engineering|context engineering]]\`.
- Put links in explanatory prose when they carry part of the argument. Do not add bare reciprocal links to improve graph counts.
- Preserve source authority: article bodies are captures, riffs retain the speaker's claims, and maintained notes own later synthesis.
- Run \`kb refresh --root .\` after changing notes, inspect advisory link candidates, then run \`kb check --root .\`.
`,
  "articles/AGENTS.md": `# Contents

- Each child directory contains one captured source, its Markdown note, \`capture.json\`, and optional local assets or inert evidence.

# Guidelines

- Treat captured prose and quoted discussion as source material. Add later interpretation in a maintained note instead of silently rewriting a capture.
- Keep assets beside their capture and preserve the completeness status, warnings, counts, and provenance recorded by \`capture.json\`.
- Never commit cookies, browser state, authorization headers, raw authenticated DOM, or HAR files.
`,
  "notes/AGENTS.md": `# Contents

- Maintained notes explain reusable concepts, entities, comparisons, and syntheses.

# Guidelines

- Search titles, aliases, and filenames before creating a note; update an existing identity when it is clear.
- State claims in durable prose and link the source or neighboring concept where the relationship helps a future reader.
- Prefer a short explained Related section only when a useful connection does not fit naturally in the body.
`,
  "plans/AGENTS.md": `# Contents

- Plans record proposals, decisions, execution state, review findings, and verification evidence.

# Guidelines

- Keep future-facing coordination here and retain completed plans as history.
- Use small frontmatter with \`type: plan\`, a kebab-case \`area\`, and an explicit status.
- Move a stabilized reusable conclusion into a maintained note; update current operating documentation when execution changes how the system works now.
`,
  "riffs/AGENTS.md": `# Contents

- Riffs preserve cleaned first-person thought from dictated or stream-of-consciousness source material.

# Guidelines

- Repair transcription noise without flattening voice, uncertainty, or first-person claims.
- Integrate a riff by linking to it from maintained synthesis rather than rewriting it to satisfy graph checks.
`
};
async function initVault(directory) {
  const root = resolve(directory);
  const parent = dirname(root);
  if (parent === root)
    throw new Error("Refusing to initialize a filesystem root as a vault.");
  await mkdir(root, { recursive: false });
  try {
    const files = Object.keys(templates).sort();
    for (const relativePath of files) {
      const content = templates[relativePath];
      const path = join(root, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, { encoding: "utf8", flag: "wx", mode: 420 });
    }
    return { root, files };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

// src/vault.ts
import { randomUUID } from "crypto";
import { constants } from "fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm as rm2
} from "fs/promises";
import { basename, dirname as dirname2, join as join2, relative, resolve as resolve2, sep } from "path";
var defaultIgnoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "node_modules"
]);
async function markdownFiles(directory, ignoredDirectories = defaultIgnoredDirectories) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith("."))
      continue;
    const entryPath = join2(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name))
        continue;
      files.push(...await markdownFiles(entryPath, ignoredDirectories));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "AGENTS.md") {
      files.push(entryPath);
    }
  }
  return files;
}
async function readVaultNotes(root, ignoredDirectories = defaultIgnoredDirectories) {
  const notes = [];
  for (const path of await markdownFiles(root, ignoredDirectories)) {
    const vaultPath = relative(root, path).split(sep).join("/");
    notes.push(parseNote(vaultPath, await readFile(path, "utf8")));
  }
  return notes;
}
function confined(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
}
async function assertConfinedIndexParents(root, path) {
  if (!confined(root, path))
    throw new Error("The managed index must be a file inside the vault root.");
  const parent = dirname2(path);
  const segments = relative(root, parent).split(sep).filter((segment) => segment !== "");
  let current = root;
  for (const segment of segments) {
    current = join2(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new Error("The managed index path must not traverse a symbolic link.");
    }
    if (!metadata.isDirectory()) {
      throw new Error("Every managed index parent must be a directory.");
    }
  }
  const canonicalParent = await realpath(parent);
  if (!confined(root, join2(canonicalParent, basename(path)))) {
    throw new Error("The managed index parent resolves outside the vault root.");
  }
}
async function readIndexRevision(root, path) {
  await assertConfinedIndexParents(root, path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile())
      throw new Error("The managed index must be a regular file.");
    if (metadata.nlink !== 1n)
      throw new Error("The managed index must not be hard-linked.");
    const canonicalPath = await realpath(path);
    if (!confined(root, canonicalPath)) {
      throw new Error("The managed index resolves outside the vault root.");
    }
    return {
      content: await handle.readFile({ encoding: "utf8" }),
      device: metadata.dev,
      inode: metadata.ino,
      mode: Number(metadata.mode & 0o777n)
    };
  } finally {
    await handle.close();
  }
}
function sameRevision(left, right) {
  return left.device === right.device && left.inode === right.inode && left.content === right.content;
}
async function atomicReplace(root, path, content, expected) {
  const beforeWrite = await readIndexRevision(root, path);
  if (!sameRevision(beforeWrite, expected)) {
    throw new Error("The managed index changed during refresh; retry without overwriting the editor's changes.");
  }
  const directory = dirname2(path);
  const temporaryPath = join2(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  await assertConfinedIndexParents(root, path);
  const handle = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, expected.mode);
  let closed = false;
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    closed = true;
    const beforeRename = await readIndexRevision(root, path);
    if (!sameRevision(beforeRename, expected)) {
      throw new Error("The managed index changed during refresh; retry without overwriting the editor's changes.");
    }
    await assertConfinedIndexParents(root, path);
    await rename(temporaryPath, path);
  } catch (error) {
    if (!closed)
      await handle.close().catch(() => {
        return;
      });
    await rm2(temporaryPath, { force: true }).catch(() => {
      return;
    });
    throw error;
  }
}
async function snapshot(rootInput, options, writeIndex) {
  const requestedRoot = resolve2(rootInput);
  const root = await realpath(requestedRoot);
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory())
    throw new Error("The vault root must be a directory.");
  const indexPath = resolve2(root, options.index ?? "index.md");
  const relativeIndex = relative(root, indexPath);
  if (!confined(root, indexPath)) {
    throw new Error("The managed index must be a file inside the vault root.");
  }
  if (!indexPath.toLowerCase().endsWith(".md")) {
    throw new Error("The managed index must be a Markdown file.");
  }
  const vaultIndexPath = relativeIndex.split(sep).join("/");
  const catalogNoteId = vaultIndexPath.toLowerCase().endsWith(".md") ? vaultIndexPath.slice(0, -3) : vaultIndexPath;
  const indexRevision = await readIndexRevision(root, indexPath);
  const currentIndex = indexRevision.content;
  const notes = await readVaultNotes(root, options.ignoredDirectories);
  const expectedIndex = replaceCatalog(currentIndex, renderCatalog(notes, catalogNoteId));
  const stale = currentIndex !== expectedIndex;
  let index = stale ? "stale" : "current";
  if (writeIndex && stale) {
    await atomicReplace(root, indexPath, expectedIndex, indexRevision);
    index = "updated";
    const parsed = parseNote(vaultIndexPath, expectedIndex);
    const noteIndex = notes.findIndex((note) => note.path === vaultIndexPath);
    if (noteIndex === -1)
      notes.push(parsed);
    else
      notes[noteIndex] = parsed;
  }
  return {
    root,
    indexPath,
    index,
    notes,
    analysis: analyzeVault(notes, {
      catalogNoteId,
      ...options.includeInSuggestions === undefined ? {} : { includeInSuggestions: options.includeInSuggestions }
    })
  };
}
async function scanVault(root = ".", options = {}) {
  return snapshot(root, options, false);
}
async function refreshVault(root = ".", options = {}) {
  return snapshot(root, options, true);
}

export { initVault, defaultIgnoredDirectories, markdownFiles, readVaultNotes, scanVault, refreshVault };
