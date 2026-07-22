import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import {
  analyzeVault,
  parseNote,
  renderCatalog,
  replaceCatalog,
  type AnalyzeVaultOptions,
  type Note,
  type VaultAnalysis,
} from "./graph.js";

export const defaultIgnoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "node_modules",
]);

export type VaultIndexState = "current" | "stale" | "updated";

export type VaultSnapshot = {
  readonly root: string;
  readonly indexPath: string;
  readonly index: VaultIndexState;
  readonly notes: readonly Note[];
  readonly analysis: VaultAnalysis;
};

export type ScanVaultOptions = AnalyzeVaultOptions & {
  readonly index?: string;
  readonly ignoredDirectories?: ReadonlySet<string>;
};

export async function markdownFiles(
  directory: string,
  ignoredDirectories: ReadonlySet<string> = defaultIgnoredDirectories,
): Promise<readonly string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith(".")) continue;
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      files.push(...await markdownFiles(entryPath, ignoredDirectories));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "AGENTS.md") {
      files.push(entryPath);
    }
  }
  return files;
}

export async function readVaultNotes(
  root: string,
  ignoredDirectories: ReadonlySet<string> = defaultIgnoredDirectories,
): Promise<Note[]> {
  const notes: Note[] = [];
  for (const path of await markdownFiles(root, ignoredDirectories)) {
    const vaultPath = relative(root, path).split(sep).join("/");
    notes.push(parseNote(vaultPath, await readFile(path, "utf8")));
  }
  return notes;
}

type IndexRevision = {
  readonly content: string;
  readonly device: bigint;
  readonly inode: bigint;
  readonly mode: number;
};

function confined(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot !== ""
    && fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`);
}

async function assertConfinedIndexParents(root: string, path: string): Promise<void> {
  if (!confined(root, path)) throw new Error("The managed index must be a file inside the vault root.");
  const parent = dirname(path);
  const segments = relative(root, parent).split(sep).filter((segment) => segment !== "");
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new Error("The managed index path must not traverse a symbolic link.");
    }
    if (!metadata.isDirectory()) {
      throw new Error("Every managed index parent must be a directory.");
    }
  }
  const canonicalParent = await realpath(parent);
  if (!confined(root, join(canonicalParent, basename(path)))) {
    throw new Error("The managed index parent resolves outside the vault root.");
  }
}

async function readIndexRevision(root: string, path: string): Promise<IndexRevision> {
  await assertConfinedIndexParents(root, path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile()) throw new Error("The managed index must be a regular file.");
    if (metadata.nlink !== 1n) throw new Error("The managed index must not be hard-linked.");
    const canonicalPath = await realpath(path);
    if (!confined(root, canonicalPath)) {
      throw new Error("The managed index resolves outside the vault root.");
    }
    return {
      content: await handle.readFile({ encoding: "utf8" }),
      device: metadata.dev,
      inode: metadata.ino,
      mode: Number(metadata.mode & 0o777n),
    };
  } finally {
    await handle.close();
  }
}

function sameRevision(left: IndexRevision, right: IndexRevision): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.content === right.content;
}

async function atomicReplace(
  root: string,
  path: string,
  content: string,
  expected: IndexRevision,
): Promise<void> {
  const beforeWrite = await readIndexRevision(root, path);
  if (!sameRevision(beforeWrite, expected)) {
    throw new Error("The managed index changed during refresh; retry without overwriting the editor's changes.");
  }
  const directory = dirname(path);
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  await assertConfinedIndexParents(root, path);
  const handle = await open(
    temporaryPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    expected.mode,
  );
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
    if (!closed) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function snapshot(
  rootInput: string,
  options: ScanVaultOptions,
  writeIndex: boolean,
): Promise<VaultSnapshot> {
  const requestedRoot = resolve(rootInput);
  const root = await realpath(requestedRoot);
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory()) throw new Error("The vault root must be a directory.");
  const indexPath = resolve(root, options.index ?? "index.md");
  const relativeIndex = relative(root, indexPath);
  if (!confined(root, indexPath)) {
    throw new Error("The managed index must be a file inside the vault root.");
  }
  if (!indexPath.toLowerCase().endsWith(".md")) {
    throw new Error("The managed index must be a Markdown file.");
  }
  const vaultIndexPath = relativeIndex.split(sep).join("/");
  const catalogNoteId = vaultIndexPath.toLowerCase().endsWith(".md")
    ? vaultIndexPath.slice(0, -3)
    : vaultIndexPath;
  const indexRevision = await readIndexRevision(root, indexPath);
  const currentIndex = indexRevision.content;
  const notes = await readVaultNotes(root, options.ignoredDirectories);
  const expectedIndex = replaceCatalog(
    currentIndex,
    renderCatalog(notes, catalogNoteId),
  );
  const stale = currentIndex !== expectedIndex;
  let index: VaultIndexState = stale ? "stale" : "current";

  if (writeIndex && stale) {
    await atomicReplace(root, indexPath, expectedIndex, indexRevision);
    index = "updated";
    const parsed = parseNote(vaultIndexPath, expectedIndex);
    const noteIndex = notes.findIndex((note) => note.path === vaultIndexPath);
    if (noteIndex === -1) notes.push(parsed);
    else notes[noteIndex] = parsed;
  }

  return {
    root,
    indexPath,
    index,
    notes,
    analysis: analyzeVault(notes, {
      catalogNoteId,
      ...(options.includeInSuggestions === undefined
        ? {}
        : { includeInSuggestions: options.includeInSuggestions }),
    }),
  };
}

export async function scanVault(
  root = ".",
  options: ScanVaultOptions = {},
): Promise<VaultSnapshot> {
  return snapshot(root, options, false);
}

export async function refreshVault(
  root = ".",
  options: ScanVaultOptions = {},
): Promise<VaultSnapshot> {
  return snapshot(root, options, true);
}
