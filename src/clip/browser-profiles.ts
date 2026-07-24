import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmSync,
  type Stats,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

const profileSkipNames = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "GrShaderCache",
  "GraphiteDawnCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Crashpad",
]);

const maxProfileEntries = 100_000;
const maxProfileBytes = 5 * 1024 * 1024 * 1024;
const maxLocalStateBytes = 16 * 1024 * 1024;

export class BrowserProfileSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserProfileSnapshotError";
  }
}

export function isSafeNamedProfile(value: string): boolean {
  if (
    value.length < 1
    || value.length > 256
    || value.trim() !== value
    || value.startsWith("-")
    || value === "."
    || value === ".."
  ) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f
      || (code >= 0x7f && code <= 0x9f)
      || code === 0x061c
      || code === 0x200e
      || code === 0x200f
      || (code >= 0x2028 && code <= 0x202e)
      || (code >= 0x2066 && code <= 0x2069)
    ) return false;
  }
  return !value.includes("/") && !value.includes("\\");
}

/** Resolve a path-backed profile without treating a browser profile name as a path. */
export function profilePath(value: string): string | null {
  const pathLike = isAbsolute(value)
    || value.startsWith(`.${sep}`)
    || value.startsWith(`..${sep}`)
    || value.startsWith(`~${sep}`)
    || value.includes("/")
    || value.includes("\\");
  if (!pathLike && !isSafeNamedProfile(value)) throw new Error("browser profile name is unsafe");
  if (!pathLike) return null;
  try {
    const expanded = value.startsWith(`~${sep}`) ? join(homedir(), value.slice(2)) : resolve(value);
    const entry = lstatSync(expanded);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new BrowserProfileSnapshotError("browser profile path must be a real directory");
    }
    return realpathSync(expanded);
  } catch (error) {
    if (error instanceof BrowserProfileSnapshotError) throw error;
    throw new BrowserProfileSnapshotError("browser profile path is unavailable or unsafe");
  }
}

type CopyBudget = { entries: number; bytes: number };

function sameEntry(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function copyProfileFile(
  sourcePath: string,
  destinationPath: string,
  observed: Stats,
  budget: CopyBudget,
): void {
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const nonBlock = "O_NONBLOCK" in constants ? constants.O_NONBLOCK : 0;
  let input: number | null = null;
  let output: number | null = null;
  let completed = false;
  try {
    input = openSync(sourcePath, constants.O_RDONLY | noFollow | nonBlock);
    const opened = fstatSync(input);
    if (!opened.isFile() || !sameEntry(observed, opened)) {
      throw new BrowserProfileSnapshotError("browser profile entry changed before it could be copied");
    }
    if (opened.size > maxProfileBytes - budget.bytes) {
      throw new BrowserProfileSnapshotError("browser profile clone exceeded its safety bounds");
    }
    output = openSync(
      destinationPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    );
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let copied = 0;
    for (;;) {
      const count = readSync(input, buffer, 0, buffer.byteLength, null);
      if (count === 0) break;
      if (count > maxProfileBytes - budget.bytes - copied) {
        throw new BrowserProfileSnapshotError("browser profile clone exceeded its safety bounds");
      }
      let offset = 0;
      while (offset < count) {
        const written = writeSync(output, buffer, offset, count - offset);
        if (written < 1) throw new BrowserProfileSnapshotError("browser profile file copy made no progress");
        offset += written;
      }
      copied += count;
    }
    const after = fstatSync(input);
    if (
      !sameEntry(observed, after)
      || after.size !== observed.size
      || copied !== observed.size
      || after.mtimeMs !== observed.mtimeMs
    ) throw new BrowserProfileSnapshotError("browser profile entry changed while it was copied");
    fsyncSync(output);
    budget.bytes += copied;
    completed = true;
  } catch (error) {
    if (error instanceof BrowserProfileSnapshotError) throw error;
    throw new BrowserProfileSnapshotError("browser profile file could not be copied");
  } finally {
    if (output !== null) closeSync(output);
    if (input !== null) closeSync(input);
    if (!completed) {
      try {
        unlinkSync(destinationPath);
      } catch {
        // The owned destination tree is removed by cloneProfile on failure.
      }
    }
  }
}

function copyProfileEntry(
  sourcePath: string,
  destinationPath: string,
  budget: CopyBudget,
  root = false,
): void {
  const name = basename(sourcePath);
  if (
    !root
    && (name.startsWith("Singleton") || name === "DevToolsActivePort" || profileSkipNames.has(name))
  ) return;
  const observed = lstatSync(sourcePath);
  if (observed.isSymbolicLink()) {
    if (root) throw new BrowserProfileSnapshotError("browser profile path must be a real directory");
    return;
  }
  if (!observed.isFile() && !observed.isDirectory()) {
    throw new BrowserProfileSnapshotError("browser profile contains an unsupported nonregular entry");
  }
  if (root && !observed.isDirectory()) {
    throw new BrowserProfileSnapshotError("browser profile path must be a real directory");
  }
  budget.entries += 1;
  if (budget.entries > maxProfileEntries) {
    throw new BrowserProfileSnapshotError("browser profile clone exceeded its safety bounds");
  }
  if (observed.isFile()) {
    copyProfileFile(sourcePath, destinationPath, observed, budget);
    return;
  }
  mkdirSync(destinationPath, { mode: 0o700 });
  chmodSync(destinationPath, 0o700);
  for (const child of readdirSync(sourcePath).sort()) {
    copyProfileEntry(join(sourcePath, child), join(destinationPath, child), budget);
  }
  const after = lstatSync(sourcePath);
  if (
    !after.isDirectory()
    || after.isSymbolicLink()
    || !sameEntry(observed, after)
    || after.size !== observed.size
    || after.mtimeMs !== observed.mtimeMs
    || after.ctimeMs !== observed.ctimeMs
  ) throw new BrowserProfileSnapshotError("browser profile directory changed while it was copied");
}

/** Copy a profile into a new private directory without caches, lock files, or links. */
export function cloneProfile(source: string, destination: string): void {
  if (existsSync(destination)) throw new BrowserProfileSnapshotError("browser profile destination already exists");
  try {
    copyProfileEntry(source, destination, { entries: 0, bytes: 0 }, true);
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    if (error instanceof BrowserProfileSnapshotError) throw error;
    throw new BrowserProfileSnapshotError("browser profile snapshot failed");
  }
}

function missingFile(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { readonly code?: unknown }).code === "ENOENT";
}

function localStateEntry(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (missingFile(error)) return null;
    throw new BrowserProfileSnapshotError("Chromium Local State is unavailable or unsafe");
  }
}

function assertChromiumUserDataIdle(userDataRoot: string): void {
  let names: string[];
  try {
    names = readdirSync(userDataRoot);
  } catch {
    throw new BrowserProfileSnapshotError("Chromium user-data root could not be inspected");
  }
  if (names.some((name) => name.startsWith("Singleton") || name === "DevToolsActivePort")) {
    throw new BrowserProfileSnapshotError(
      "Chromium profile is active or retains a stale process lock; fully quit the browser and retry",
    );
  }
}

/** Copy Chromium encryption metadata without following links or exceeding the byte bound. */
export function copyBoundedLocalState(source: string, destination: string): void {
  const entry = localStateEntry(source);
  if (entry === null || entry.isSymbolicLink() || !entry.isFile()) {
    throw new BrowserProfileSnapshotError("Chromium Local State must be one regular file");
  }
  if (entry.size > maxLocalStateBytes) {
    throw new BrowserProfileSnapshotError("Chromium Local State exceeds its safety bound");
  }
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  let input: number | null = null;
  let output: number | null = null;
  let outputCreated = false;
  let completed = false;
  try {
    input = openSync(source, constants.O_RDONLY | noFollow);
    const opened = fstatSync(input);
    if (
      !opened.isFile()
      || !sameEntry(entry, opened)
      || opened.size !== entry.size
      || opened.size > maxLocalStateBytes
    ) throw new BrowserProfileSnapshotError("Chromium Local State changed before it could be copied");
    output = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    outputCreated = true;
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let copied = 0;
    for (;;) {
      const count = readSync(input, buffer, 0, Math.min(buffer.length, maxLocalStateBytes + 1 - copied), null);
      if (count === 0) break;
      copied += count;
      if (copied > maxLocalStateBytes) {
        throw new BrowserProfileSnapshotError("Chromium Local State exceeds its safety bound");
      }
      let offset = 0;
      while (offset < count) {
        const written = writeSync(output, buffer, offset, count - offset);
        if (written < 1) throw new BrowserProfileSnapshotError("Chromium Local State copy made no progress");
        offset += written;
      }
    }
    const after = fstatSync(input);
    if (
      copied !== entry.size
      || !sameEntry(entry, after)
      || after.size !== entry.size
      || after.mtimeMs !== entry.mtimeMs
    ) throw new BrowserProfileSnapshotError("Chromium Local State changed while it was copied");
    fsyncSync(output);
    completed = true;
  } catch (error) {
    if (error instanceof BrowserProfileSnapshotError) throw error;
    throw new BrowserProfileSnapshotError("Chromium Local State could not be copied");
  } finally {
    if (output !== null) closeSync(output);
    if (input !== null) closeSync(input);
    if (outputCreated && !completed) {
      try {
        unlinkSync(destination);
      } catch {
        // The caller removes the containing private snapshot on failure.
      }
    }
  }
}

export type ClonedBrowserProfile = {
  readonly userDataPath: string;
  readonly profileDirectory?: "Default";
};

/** Clone one selected profile while retaining Chromium's local encryption metadata. */
export function cloneBrowserProfile(source: string, privateDirectory: string): ClonedBrowserProfile {
  let selectedSource = source;
  let userDataRoot = dirname(source);
  let localState = join(userDataRoot, "Local State");
  let stateEntry = localStateEntry(localState);
  if (stateEntry === null) {
    const rootLocalState = join(source, "Local State");
    const rootStateEntry = localStateEntry(rootLocalState);
    if (rootStateEntry === null) {
      const destination = join(privateDirectory, "profile");
      cloneProfile(source, destination);
      return { userDataPath: destination };
    }
    const defaultProfile = join(source, "Default");
    let defaultEntry: Stats;
    try {
      defaultEntry = lstatSync(defaultProfile);
    } catch {
      throw new BrowserProfileSnapshotError("Chromium Default profile is unavailable or unsafe");
    }
    if (defaultEntry.isSymbolicLink() || !defaultEntry.isDirectory()) {
      throw new BrowserProfileSnapshotError("Chromium Default profile must be one real directory");
    }
    selectedSource = defaultProfile;
    userDataRoot = source;
    localState = rootLocalState;
    stateEntry = rootStateEntry;
  }
  if (stateEntry.isSymbolicLink() || !stateEntry.isFile()) {
    throw new BrowserProfileSnapshotError("Chromium Local State must be one regular file");
  }
  if (stateEntry.size > maxLocalStateBytes) {
    throw new BrowserProfileSnapshotError("Chromium Local State exceeds its safety bound");
  }
  assertChromiumUserDataIdle(userDataRoot);
  const userData = join(privateDirectory, "profile-user-data");
  mkdirSync(userData, { mode: 0o700 });
  chmodSync(userData, 0o700);
  const selectedProfile = join(userData, "Default");
  try {
    cloneProfile(selectedSource, selectedProfile);
    copyBoundedLocalState(localState, join(userData, "Local State"));
    return { userDataPath: userData, profileDirectory: "Default" };
  } catch (error) {
    rmSync(userData, { recursive: true, force: true });
    throw error;
  }
}
