import { describe, expect, test } from "bun:test";

import { analyzeVault, parseNote } from "./graph.js";
import { navigateLinks } from "./navigation.js";

const notes = [
  parseNote("notes/a.md", "# A\n\n[[notes/b]]\n"),
  parseNote("notes/b.md", "# B\n\n[[notes/c]]\n"),
  parseNote("notes/c.md", "# C\n\n[[notes/a]]\n"),
  parseNote("notes/d.md", "# D\n\n[[notes/b]]\n"),
];
const analysis = analyzeVault(notes);

describe("structural link navigation", () => {
  test("traverses inbound, outbound, or both directions to a bounded depth", () => {
    expect(navigateLinks(notes, analysis, notes[1]!, { direction: "in" }).nodes.map(({ path }) => path))
      .toEqual(["notes/b.md", "notes/a.md", "notes/d.md"]);
    expect(navigateLinks(notes, analysis, notes[1]!, { direction: "out" }).nodes.map(({ path }) => path))
      .toEqual(["notes/b.md", "notes/c.md"]);
    expect(navigateLinks(notes, analysis, notes[1]!, { direction: "both", depth: 2 }).nodes)
      .toEqual([
        expect.objectContaining({ path: "notes/b.md", distance: 0 }),
        expect.objectContaining({ path: "notes/a.md", distance: 1 }),
        expect.objectContaining({ path: "notes/c.md", distance: 1 }),
        expect.objectContaining({ path: "notes/d.md", distance: 1 }),
      ]);
  });

  test("deduplicates cycles and returns only edges encountered within the traversal", () => {
    const neighborhood = navigateLinks(notes, analysis, notes[0]!, { direction: "out", depth: 3 });
    expect(neighborhood.nodes.map(({ path, distance }) => ({ path, distance }))).toEqual([
      { path: "notes/a.md", distance: 0 },
      { path: "notes/b.md", distance: 1 },
      { path: "notes/c.md", distance: 2 },
    ]);
    expect(neighborhood.edges).toHaveLength(3);
  });

  test("rejects unbounded depths", () => {
    expect(() => navigateLinks(notes, analysis, notes[0]!, { depth: 0 })).toThrow("1 through 10");
    expect(() => navigateLinks(notes, analysis, notes[0]!, { depth: 11 })).toThrow("1 through 10");
  });

  test("caps high-degree neighborhoods deterministically and reports truncation", () => {
    const hub = parseNote(
      "notes/hub.md",
      `# Hub\n\n${Array.from({ length: 100 }, (_, index) => `[[notes/leaf-${String(index).padStart(3, "0")}]]`).join("\n")}\n`,
    );
    const leaves = Array.from({ length: 100 }, (_, index) =>
      parseNote(`notes/leaf-${String(index).padStart(3, "0")}.md`, `# Leaf ${index}\n`));
    const crowded = [hub, ...leaves];
    const neighborhood = navigateLinks(crowded, analyzeVault(crowded), hub, {
      direction: "out",
      depth: 1,
      limit: 5,
    });

    expect(neighborhood.truncated).toBeTrue();
    expect(neighborhood.limit).toBe(5);
    expect(neighborhood.nodes.map(({ path }) => path)).toEqual([
      "notes/hub.md",
      "notes/leaf-000.md",
      "notes/leaf-001.md",
      "notes/leaf-002.md",
      "notes/leaf-003.md",
    ]);
    expect(neighborhood.edges).toHaveLength(4);
    expect(() => navigateLinks(crowded, analyzeVault(crowded), hub, { limit: 0 }))
      .toThrow("1 through 1000");
  });
});
