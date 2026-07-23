// @bun
// src/navigation.ts
function checkedDepth(value) {
  const depth = value ?? 1;
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 10) {
    throw new RangeError("Link depth must be an integer from 1 through 10.");
  }
  return depth;
}
function checkedLimit(value) {
  const limit = value ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("Link result limit must be an integer from 1 through 1000.");
  }
  return limit;
}
function connectionNode(note, connection, distance) {
  return {
    id: note.id,
    path: note.path,
    title: note.title,
    distance,
    inboundContextualCount: connection?.inboundContextualCount ?? 0,
    outboundContextualCount: connection?.outboundContextualCount ?? 0
  };
}
function edgeKey(edge) {
  return `${edge.source}\x00${edge.target}\x00${edge.line}`;
}
function navigateLinks(notes, analysis, start, options = {}) {
  const direction = options.direction ?? "both";
  const depth = checkedDepth(options.depth);
  const limit = checkedLimit(options.limit);
  const notesByPath = new Map(notes.map((note) => [note.path, note]));
  const connectionsById = new Map(analysis.noteConnections.map((connection) => [connection.id, connection]));
  const inbound = new Map;
  const outbound = new Map;
  for (const edge of analysis.contextualLinks) {
    const incoming = inbound.get(edge.target) ?? [];
    incoming.push(edge);
    inbound.set(edge.target, incoming);
    const outgoing = outbound.get(edge.source) ?? [];
    outgoing.push(edge);
    outbound.set(edge.source, outgoing);
  }
  const distanceByPath = new Map([[start.path, 0]]);
  let frontier = [start.path];
  let truncated = false;
  const selectedEdges = new Map;
  for (let distance = 0;distance < depth && frontier.length > 0; distance += 1) {
    const next = new Set;
    for (const path of frontier.toSorted()) {
      const candidates = [
        ...direction === "out" || direction === "both" ? outbound.get(path) ?? [] : [],
        ...direction === "in" || direction === "both" ? inbound.get(path) ?? [] : []
      ].toSorted((left, right) => left.source.localeCompare(right.source) || left.target.localeCompare(right.target) || left.line - right.line);
      for (const edge of candidates) {
        const neighborPath = edge.source === path ? edge.target : edge.source;
        if (!notesByPath.has(neighborPath))
          continue;
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
  const nodes = [...distanceByPath].map(([path, distance]) => {
    const note = notesByPath.get(path);
    return note === undefined ? null : connectionNode(note, connectionsById.get(note.id), distance);
  }).filter((node) => node !== null).toSorted((left, right) => left.distance - right.distance || left.path.localeCompare(right.path));
  const edges = [...selectedEdges.values()].toSorted((left, right) => left.source.localeCompare(right.source) || left.target.localeCompare(right.target) || left.line - right.line);
  return { note: start.path, direction, depth, limit, truncated, nodes, edges };
}

export { navigateLinks };
