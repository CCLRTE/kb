// @bun
// src/query.ts
function isMetadataArray(value) {
  return Array.isArray(value);
}
function isMetadataObject(value) {
  return value !== null && typeof value === "object" && !isMetadataArray(value);
}
function pathSegments(path) {
  return (typeof path === "string" ? path.split(".") : [...path]).map((segment) => segment.trim());
}
function normalizedString(value) {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}
function normalizedTag(value) {
  return normalizedString(value.trim().replace(/^#+/u, ""));
}
function objectValue(value, segment) {
  if (Object.hasOwn(value, segment)) {
    const candidate2 = value[segment];
    return candidate2 === undefined ? { found: false } : { found: true, value: candidate2 };
  }
  const normalizedSegment = normalizedString(segment);
  const matches = Object.keys(value).filter((key) => normalizedString(key) === normalizedSegment);
  if (matches.length !== 1)
    return { found: false };
  const candidate = value[matches[0] ?? ""];
  return candidate === undefined ? { found: false } : { found: true, value: candidate };
}
function metadataAtPath(metadata, path) {
  const segments = pathSegments(path);
  if (segments.length === 0 || segments.some((segment) => segment === "")) {
    return { found: false };
  }
  let current = metadata;
  for (const segment of segments) {
    if (isMetadataArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(segment))
        return { found: false };
      const index = Number(segment);
      const candidate = current[index];
      if (candidate === undefined)
        return { found: false };
      current = candidate;
      continue;
    }
    if (!isMetadataObject(current))
      return { found: false };
    const lookup = objectValue(current, segment);
    if (!lookup.found)
      return lookup;
    current = lookup.value;
  }
  return { found: true, value: current };
}
function equalsScalar(value, expected) {
  if (isMetadataArray(value))
    return value.some((candidate) => equalsScalar(candidate, expected));
  if (isMetadataObject(value))
    return false;
  if (typeof value === "string" && typeof expected === "string") {
    return normalizedString(value) === normalizedString(expected);
  }
  return Object.is(value, expected);
}
function matchesFilter(note, filter) {
  const lookup = metadataAtPath(note.metadata, filter.path);
  if (filter.kind === "exists")
    return lookup.found;
  return lookup.found && equalsScalar(lookup.value, filter.value);
}
function matchesTags(note, tags) {
  const noteTags = new Set(note.tags.map(normalizedTag));
  return tags.every((tag) => {
    const normalized = normalizedTag(tag);
    return normalized !== "" && noteTags.has(normalized);
  });
}
function compareText(left, right) {
  const normalizedLeft = normalizedString(left);
  const normalizedRight = normalizedString(right);
  if (normalizedLeft < normalizedRight)
    return -1;
  if (normalizedLeft > normalizedRight)
    return 1;
  return 0;
}
function canonicalMetadata(value) {
  if (value === null)
    return "null";
  if (typeof value === "boolean")
    return value ? "true" : "false";
  if (typeof value === "number")
    return String(value);
  if (typeof value === "string")
    return JSON.stringify(value);
  if (isMetadataArray(value))
    return `[${value.map(canonicalMetadata).join(",")}]`;
  return `{${Object.keys(value).toSorted(compareText).map((key) => `${JSON.stringify(key)}:${canonicalMetadata(value[key] ?? null)}`).join(",")}}`;
}
function metadataRank(value) {
  if (value === null)
    return 0;
  if (typeof value === "boolean")
    return 1;
  if (typeof value === "number")
    return 2;
  if (typeof value === "string")
    return 3;
  if (isMetadataArray(value))
    return 4;
  return 5;
}
function compareMetadata(left, right) {
  const rank = metadataRank(left) - metadataRank(right);
  if (rank !== 0)
    return rank;
  if (typeof left === "number" && typeof right === "number")
    return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  if (typeof left === "string" && typeof right === "string")
    return compareText(left, right);
  return compareText(canonicalMetadata(left), canonicalMetadata(right));
}
function rowSortValue(row, sort) {
  if (sort.kind === "metadata")
    return metadataAtPath(row.metadata, sort.path);
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
function compareRows(left, right, sort, direction) {
  const leftValue = rowSortValue(left, sort);
  const rightValue = rowSortValue(right, sort);
  if (!leftValue.found && !rightValue.found)
    return 0;
  if (!leftValue.found)
    return 1;
  if (!rightValue.found)
    return -1;
  const compared = compareMetadata(leftValue.value, rightValue.value);
  return direction === "desc" ? -compared : compared;
}
function queryRow(note, connection) {
  if (connection === undefined)
    return null;
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
    backlinks: connection.backlinks
  };
}
function queryVault(notes, analysis, options = {}) {
  const filters = options.filters ?? [];
  const tags = options.tags ?? [];
  const sort = options.sort ?? { kind: "builtin", field: "path" };
  const direction = options.direction ?? "asc";
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 0)) {
    throw new RangeError("Query limit must be a non-negative safe integer.");
  }
  const connections = new Map(analysis.noteConnections.map((connection) => [connection.id, connection]));
  const indexed = notes.map((note, index) => ({ index, row: queryRow(note, connections.get(note.id)) })).filter((candidate) => candidate.row !== null).filter(({ row }) => filters.every((filter) => matchesFilter(row, filter)) && matchesTags(row, tags));
  const sorted = indexed.toSorted((left, right) => compareRows(left.row, right.row, sort, direction) || compareText(left.row.path, right.row.path) || left.index - right.index);
  const rows = sorted.map(({ row }) => row);
  return options.limit === undefined ? rows : rows.slice(0, options.limit);
}

export { metadataAtPath, queryVault };
