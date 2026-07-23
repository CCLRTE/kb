import { describe, expect, test } from "bun:test";

import { analyzeVault, parseNote } from "./graph.js";
import { metadataAtPath, queryVault } from "./query.js";

function fixture() {
  const notes = [
    parseNote("index.md", "# Index\n\n[[notes/alpha]]\n"),
    parseNote("notes/alpha.md", [
      "---",
      "title: Alpha",
      "tags: [Knowledge, Tools]",
      "status: Active",
      "priority: 2",
      "owner:",
      "  name: Alice",
      "  teams: [Research, Platform]",
      "metrics:",
      "  score: 10",
      "---",
      "# Alpha",
      "",
      "See [[notes/beta]].",
    ].join("\n")),
    parseNote("notes/beta.md", [
      "---",
      "title: beta",
      "tags:",
      "  - knowledge",
      "  - archive",
      "status: active",
      "priority: 1",
      "owner:",
      "  name: Bob",
      "  teams: [Operations]",
      "---",
      "# Beta",
      "",
      "See [[notes/gamma]].",
    ].join("\n")),
    parseNote("notes/gamma.md", [
      "---",
      "title: Gamma",
      "tags: [Archive]",
      "status: parked",
      "owner:",
      "  name: Alice",
      "  teams: [Platform]",
      "metrics:",
      "  score: 10",
      "---",
      "# Gamma",
    ].join("\n")),
  ];
  return { notes, analysis: analyzeVault(notes) };
}

describe("metadata lookup", () => {
  test("resolves nested fields, arrays, and unambiguous key casing", () => {
    const { notes } = fixture();
    const alpha = notes[1];
    if (alpha === undefined) throw new Error("fixture is missing Alpha");

    expect(metadataAtPath(alpha.metadata, "OWNER.name")).toEqual({
      found: true,
      value: "Alice",
    });
    expect(metadataAtPath(alpha.metadata, ["owner", "teams", "1"])).toEqual({
      found: true,
      value: "Platform",
    });
    expect(metadataAtPath(alpha.metadata, "owner.missing")).toEqual({ found: false });
    expect(metadataAtPath(alpha.metadata, "owner..name")).toEqual({ found: false });
  });
});

describe("vault metadata queries", () => {
  test("combines repeated nested filters and list membership case-insensitively", () => {
    const { notes, analysis } = fixture();
    const rows = queryVault(notes, analysis, {
      filters: [
        { kind: "equals", path: "owner.name", value: "ALICE" },
        { kind: "equals", path: "owner.teams", value: "platform" },
        { kind: "exists", path: "metrics.score" },
      ],
    });

    expect(rows.map(({ path }) => path)).toEqual(["notes/alpha.md", "notes/gamma.md"]);
  });

  test("requires every repeated tag and enriches rows with graph counts", () => {
    const { notes, analysis } = fixture();
    const rows = queryVault(notes, analysis, { tags: ["#KNOWLEDGE", "tools"] });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      path: "notes/alpha.md",
      tags: ["knowledge", "tools"],
      inboundContextualCount: 0,
      outboundContextualCount: 1,
      backlinks: [],
    });
  });

  test("sorts nested metadata in either direction while keeping missing values last", () => {
    const { notes, analysis } = fixture();

    expect(queryVault(notes, analysis, {
      sort: { kind: "metadata", path: "priority" },
    }).map(({ path }) => path)).toEqual([
      "notes/beta.md",
      "notes/alpha.md",
      "notes/gamma.md",
    ]);
    expect(queryVault(notes, analysis, {
      sort: { kind: "metadata", path: "priority" },
      direction: "desc",
    }).map(({ path }) => path)).toEqual([
      "notes/alpha.md",
      "notes/beta.md",
      "notes/gamma.md",
    ]);
  });

  test("supports stable built-in graph sorting and a bounded result", () => {
    const { notes, analysis } = fixture();
    const rows = queryVault(notes, analysis, {
      sort: { kind: "builtin", field: "inbound" },
      direction: "desc",
      limit: 2,
    });

    expect(rows.map(({ path }) => path)).toEqual(["notes/beta.md", "notes/gamma.md"]);
    expect(() => queryVault(notes, analysis, { limit: -1 })).toThrow(
      "non-negative safe integer",
    );
  });

  test("uses path as the deterministic tie-breaker for equal metadata values", () => {
    const first = parseNote("notes/zeta.md", "---\nrank: 1\n---\n# Zeta\n");
    const second = parseNote("notes/alpha.md", "---\nrank: 1\n---\n# Alpha\n");
    const missing = parseNote("notes/missing.md", "# Missing\n");
    const notes = [first, second, missing];
    const rows = queryVault(notes, analyzeVault(notes), {
      sort: { kind: "metadata", path: "rank" },
      direction: "desc",
    });

    expect(rows.map(({ path }) => path)).toEqual([
      "notes/alpha.md",
      "notes/zeta.md",
      "notes/missing.md",
    ]);
  });
});
