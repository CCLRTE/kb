import {
  type Backlink,
  type MetadataObject,
  type MetadataScalar,
  type MetadataValue,
  type Note,
  type NoteConnections,
  type VaultAnalysis,
} from "./graph.js";

export type MetadataPath = string | readonly string[];

export type MetadataFilter =
  | {
      readonly kind: "equals";
      readonly path: MetadataPath;
      readonly value: MetadataScalar;
    }
  | {
      readonly kind: "exists";
      readonly path: MetadataPath;
    };

export type QuerySort =
  | {
      readonly kind: "builtin";
      readonly field: "title" | "path" | "inbound" | "outbound";
    }
  | {
      readonly kind: "metadata";
      readonly path: MetadataPath;
    };

export type QueryDirection = "asc" | "desc";

export type QueryOptions = {
  /** Repeated filters are combined with AND semantics. */
  readonly filters?: readonly MetadataFilter[];
  /** Repeated tags are combined with AND semantics. */
  readonly tags?: readonly string[];
  readonly sort?: QuerySort;
  readonly direction?: QueryDirection;
  readonly limit?: number;
};

export type QueryRow = {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly properties: Readonly<Record<string, string>>;
  readonly metadata: MetadataObject;
  readonly summary: string;
  readonly inboundContextualCount: number;
  readonly outboundContextualCount: number;
  readonly backlinks: readonly Backlink[];
};

export type MetadataLookup =
  | { readonly found: true; readonly value: MetadataValue }
  | { readonly found: false };

function isMetadataArray(value: MetadataValue): value is readonly MetadataValue[] {
  return Array.isArray(value);
}

function isMetadataObject(value: MetadataValue): value is MetadataObject {
  return value !== null && typeof value === "object" && !isMetadataArray(value);
}

function pathSegments(path: MetadataPath): readonly string[] {
  return (typeof path === "string" ? path.split(".") : [...path])
    .map((segment) => segment.trim());
}

function normalizedString(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function normalizedTag(value: string): string {
  return normalizedString(value.trim().replace(/^#+/u, ""));
}

function objectValue(
  value: MetadataObject,
  segment: string,
): MetadataLookup {
  if (Object.hasOwn(value, segment)) {
    const candidate = value[segment];
    return candidate === undefined ? { found: false } : { found: true, value: candidate };
  }
  const normalizedSegment = normalizedString(segment);
  const matches = Object.keys(value).filter(
    (key) => normalizedString(key) === normalizedSegment,
  );
  if (matches.length !== 1) return { found: false };
  const candidate = value[matches[0] ?? ""];
  return candidate === undefined ? { found: false } : { found: true, value: candidate };
}

/** Resolve an exact nested field, with unambiguous case-insensitive object keys. */
export function metadataAtPath(
  metadata: MetadataObject,
  path: MetadataPath,
): MetadataLookup {
  const segments = pathSegments(path);
  if (segments.length === 0 || segments.some((segment) => segment === "")) {
    return { found: false };
  }

  let current: MetadataValue = metadata;
  for (const segment of segments) {
    if (isMetadataArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(segment)) return { found: false };
      const index = Number(segment);
      const candidate: MetadataValue | undefined = current[index];
      if (candidate === undefined) return { found: false };
      current = candidate;
      continue;
    }
    if (!isMetadataObject(current)) return { found: false };
    const lookup = objectValue(current, segment);
    if (!lookup.found) return lookup;
    current = lookup.value;
  }
  return { found: true, value: current };
}

function equalsScalar(value: MetadataValue, expected: MetadataScalar): boolean {
  if (isMetadataArray(value)) return value.some((candidate) => equalsScalar(candidate, expected));
  if (isMetadataObject(value)) return false;
  if (typeof value === "string" && typeof expected === "string") {
    return normalizedString(value) === normalizedString(expected);
  }
  return Object.is(value, expected);
}

type QueryableMetadata = Pick<Note, "metadata" | "tags">;

function matchesFilter(note: QueryableMetadata, filter: MetadataFilter): boolean {
  const lookup = metadataAtPath(note.metadata, filter.path);
  if (filter.kind === "exists") return lookup.found;
  return lookup.found && equalsScalar(lookup.value, filter.value);
}

function matchesTags(note: QueryableMetadata, tags: readonly string[]): boolean {
  const noteTags = new Set(note.tags.map(normalizedTag));
  return tags.every((tag) => {
    const normalized = normalizedTag(tag);
    return normalized !== "" && noteTags.has(normalized);
  });
}

function compareText(left: string, right: string): number {
  const normalizedLeft = normalizedString(left);
  const normalizedRight = normalizedString(right);
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

function canonicalMetadata(value: MetadataValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (isMetadataArray(value)) return `[${value.map(canonicalMetadata).join(",")}]`;
  return `{${Object.keys(value)
    .toSorted(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonicalMetadata(value[key] ?? null)}`)
    .join(",")}}`;
}

function metadataRank(value: MetadataValue): number {
  if (value === null) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 2;
  if (typeof value === "string") return 3;
  if (isMetadataArray(value)) return 4;
  return 5;
}

function compareMetadata(left: MetadataValue, right: MetadataValue): number {
  const rank = metadataRank(left) - metadataRank(right);
  if (rank !== 0) return rank;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  if (typeof left === "string" && typeof right === "string") return compareText(left, right);
  return compareText(canonicalMetadata(left), canonicalMetadata(right));
}

type SortValue =
  | { readonly found: true; readonly value: MetadataValue }
  | { readonly found: false };

function rowSortValue(row: QueryRow, sort: QuerySort): SortValue {
  if (sort.kind === "metadata") return metadataAtPath(row.metadata, sort.path);
  switch (sort.field) {
    case "title":
      return { found: true, value: row.title };
    case "path":
      return { found: true, value: row.path };
    case "inbound":
      return { found: true, value: row.inboundContextualCount };
    case "outbound":
      return { found: true, value: row.outboundContextualCount };
  }
}

function compareRows(
  left: QueryRow,
  right: QueryRow,
  sort: QuerySort,
  direction: QueryDirection,
): number {
  const leftValue = rowSortValue(left, sort);
  const rightValue = rowSortValue(right, sort);
  if (!leftValue.found && !rightValue.found) return 0;
  if (!leftValue.found) return 1;
  if (!rightValue.found) return -1;
  const compared = compareMetadata(leftValue.value, rightValue.value);
  return direction === "desc" ? -compared : compared;
}

function queryRow(note: Note, connection: NoteConnections | undefined): QueryRow | null {
  if (connection === undefined) return null;
  return {
    id: note.id,
    path: note.path,
    title: note.title,
    aliases: note.aliases,
    tags: note.tags,
    properties: note.properties,
    metadata: note.metadata,
    summary: note.summary,
    inboundContextualCount: connection.inboundContextualCount,
    outboundContextualCount: connection.outboundContextualCount,
    backlinks: connection.backlinks,
  };
}

/** Query content notes while enriching every result with the deterministic graph view. */
export function queryVault(
  notes: readonly Note[],
  analysis: VaultAnalysis,
  options: QueryOptions = {},
): readonly QueryRow[] {
  const filters = options.filters ?? [];
  const tags = options.tags ?? [];
  const sort = options.sort ?? { kind: "builtin", field: "path" };
  const direction = options.direction ?? "asc";
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 0)) {
    throw new RangeError("Query limit must be a non-negative safe integer.");
  }

  const connections = new Map(
    analysis.noteConnections.map((connection) => [connection.id, connection]),
  );
  const indexed = notes
    .map((note, index) => ({ index, row: queryRow(note, connections.get(note.id)) }))
    .filter((candidate): candidate is { readonly index: number; readonly row: QueryRow } =>
      candidate.row !== null)
    .filter(({ row }) =>
      filters.every((filter) => matchesFilter(row, filter))
      && matchesTags(row, tags));

  const sorted = indexed.toSorted((left, right) =>
    compareRows(left.row, right.row, sort, direction)
    || compareText(left.row.path, right.row.path)
    || left.index - right.index);
  const rows = sorted.map(({ row }) => row);
  return options.limit === undefined ? rows : rows.slice(0, options.limit);
}
