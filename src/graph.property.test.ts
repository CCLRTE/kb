import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  analyzeVault,
  catalogEnd,
  catalogStart,
  parseNote,
  renderCatalog,
  replaceCatalog,
} from "./graph.js";

const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,18}$/);
const noteIdentity = fc
  .tuple(segment, segment)
  .map(([directory, name]) => `${directory}/${name}`);

describe("vault graph properties", () => {
  test("catalog rendering is order-independent and replacement is idempotent", () => {
    fc.assert(fc.property(
      fc.uniqueArray(noteIdentity, { maxLength: 40 }),
      (identities) => {
        const notes = identities.map((identity) =>
          parseNote(`${identity}.md`, `# ${identity.replaceAll("/", " ")}\n\nA maintained note.\n`));
        const catalog = renderCatalog(notes);
        expect(renderCatalog([...notes].reverse())).toBe(catalog);

        const index = `# Vault\n\n${catalogStart}\nstale\n${catalogEnd}\n`;
        const replaced = replaceCatalog(index, catalog);
        expect(replaceCatalog(replaced, catalog)).toBe(replaced);
      },
    ));
  });

  test("every resolved contextual edge has exactly one matching derived backlink", () => {
    fc.assert(fc.property(
      fc.uniqueArray(noteIdentity, { minLength: 1, maxLength: 30 }),
      fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 100 }),
      (identities, rawEdges) => {
        const linksBySource = new Map<number, Set<number>>();
        for (const [rawSource, rawTarget] of rawEdges) {
          const source = rawSource % identities.length;
          const target = rawTarget % identities.length;
          if (source === target) continue;
          const targets = linksBySource.get(source) ?? new Set<number>();
          targets.add(target);
          linksBySource.set(source, targets);
        }
        const notes = identities.map((identity, source) => {
          const links = [...(linksBySource.get(source) ?? [])]
            .map((target) => `[[${identities[target] ?? ""}]]`)
            .join(" ");
          return parseNote(`${identity}.md`, `# ${identity}\n\n${links}\n`);
        });
        const analysis = analyzeVault(notes);

        expect(analysis.backlinks).toHaveLength(analysis.contextualLinks.length);
        expect(analysis.backlinks).toEqual(analysis.contextualLinks.toSorted((left, right) =>
          left.target.localeCompare(right.target)
          || left.source.localeCompare(right.source)
          || left.line - right.line));
        expect(analysis.issues).toEqual([]);
      },
    ));
  });
});
