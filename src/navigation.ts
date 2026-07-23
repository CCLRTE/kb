import {
  type Note,
  type NoteConnections,
  type ResolvedLink,
  type VaultAnalysis,
} from "./graph.js";

export type LinkDirection = "in" | "out" | "both";

export type NavigateLinksOptions = {
  readonly direction?: LinkDirection;
  readonly depth?: number;
  readonly limit?: number;
};

export type LinkNeighborhoodNode = {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly distance: number;
  readonly inboundContextualCount: number;
  readonly outboundContextualCount: number;
};

export type LinkNeighborhood = {
  readonly note: string;
  readonly direction: LinkDirection;
  readonly depth: number;
  readonly limit: number;
  readonly truncated: boolean;
  readonly nodes: readonly LinkNeighborhoodNode[];
  readonly edges: readonly ResolvedLink[];
};

function checkedDepth(value: number | undefined): number {
  const depth = value ?? 1;
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 10) {
    throw new RangeError("Link depth must be an integer from 1 through 10.");
  }
  return depth;
}

function checkedLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError("Link result limit must be an integer from 1 through 1000.");
  }
  return limit;
}

function connectionNode(
  note: Note,
  connection: NoteConnections | undefined,
  distance: number,
): LinkNeighborhoodNode {
  return {
    id: note.id,
    path: note.path,
    title: note.title,
    distance,
    inboundContextualCount: connection?.inboundContextualCount ?? 0,
    outboundContextualCount: connection?.outboundContextualCount ?? 0,
  };
}

function edgeKey(edge: ResolvedLink): string {
  return `${edge.source}\0${edge.target}\0${edge.line}`;
}

/** Traverse explicit contextual edges without deriving relationships from similarity. */
export function navigateLinks(
  notes: readonly Note[],
  analysis: VaultAnalysis,
  start: Note,
  options: NavigateLinksOptions = {},
): LinkNeighborhood {
  const direction = options.direction ?? "both";
  const depth = checkedDepth(options.depth);
  const limit = checkedLimit(options.limit);
  const notesByPath = new Map(notes.map((note) => [note.path, note]));
  const connectionsById = new Map(
    analysis.noteConnections.map((connection) => [connection.id, connection]),
  );
  const inbound = new Map<string, ResolvedLink[]>();
  const outbound = new Map<string, ResolvedLink[]>();
  for (const edge of analysis.contextualLinks) {
    const incoming = inbound.get(edge.target) ?? [];
    incoming.push(edge);
    inbound.set(edge.target, incoming);
    const outgoing = outbound.get(edge.source) ?? [];
    outgoing.push(edge);
    outbound.set(edge.source, outgoing);
  }

  const distanceByPath = new Map<string, number>([[start.path, 0]]);
  let frontier = [start.path];
  let truncated = false;
  const selectedEdges = new Map<string, ResolvedLink>();
  for (let distance = 0; distance < depth && frontier.length > 0; distance += 1) {
    const next = new Set<string>();
    for (const path of frontier.toSorted()) {
      const candidates = [
        ...(direction === "out" || direction === "both" ? outbound.get(path) ?? [] : []),
        ...(direction === "in" || direction === "both" ? inbound.get(path) ?? [] : []),
      ].toSorted((left, right) =>
        left.source.localeCompare(right.source)
        || left.target.localeCompare(right.target)
        || left.line - right.line);
      for (const edge of candidates) {
        const neighborPath = edge.source === path ? edge.target : edge.source;
        if (!notesByPath.has(neighborPath)) continue;
        if (distanceByPath.has(neighborPath)) {
          selectedEdges.set(edgeKey(edge), edge);
          continue;
        }
        if (distanceByPath.size >= limit) {
          truncated = true;
          continue;
        }
        selectedEdges.set(edgeKey(edge), edge);
        distanceByPath.set(neighborPath, distance + 1);
        next.add(neighborPath);
      }
    }
    frontier = [...next];
  }

  const nodes = [...distanceByPath]
    .map(([path, distance]) => {
      const note = notesByPath.get(path);
      return note === undefined
        ? null
        : connectionNode(note, connectionsById.get(note.id), distance);
    })
    .filter((node): node is LinkNeighborhoodNode => node !== null)
    .toSorted((left, right) => left.distance - right.distance || left.path.localeCompare(right.path));
  const edges = [...selectedEdges.values()].toSorted((left, right) =>
    left.source.localeCompare(right.source)
    || left.target.localeCompare(right.target)
    || left.line - right.line);
  return { note: start.path, direction, depth, limit, truncated, nodes, edges };
}
