import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { refreshVault, scanVault } from "./vault.js";

const roots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "cclrte-kb-vault-test-"));
  roots.push(root);
  mkdirSync(join(root, "notes"));
  writeFileSync(
    join(root, "index.md"),
    "# Knowledge base\n\n<!-- kb:catalog:start -->\n<!-- kb:catalog:end -->\n",
  );
  writeFileSync(join(root, "notes", "alpha.md"), "# Alpha\n\nSee [[notes/beta|Beta]].\n");
  writeFileSync(join(root, "notes", "beta.md"), "---\naliases: [Second note]\n---\n# Beta\n\nA maintained note.\n");
  writeFileSync(join(root, "notes", "AGENTS.md"), "# Ignored\n");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("vault scan and refresh", () => {
  test("reports a stale catalog without changing the index", async () => {
    const root = fixture();
    const before = readFileSync(join(root, "index.md"), "utf8");
    const result = await scanVault(root);

    expect(result.index).toBe("stale");
    expect(result.notes.map(({ path }) => path)).toEqual([
      "index.md",
      "notes/alpha.md",
      "notes/beta.md",
    ]);
    expect(result.analysis.contextualLinks).toEqual([
      { source: "notes/alpha.md", target: "notes/beta.md", line: 3 },
    ]);
    expect(readFileSync(join(root, "index.md"), "utf8")).toBe(before);
  });

  test("atomically refreshes only the managed catalog", async () => {
    const root = fixture();
    const refreshed = await refreshVault(root);
    const current = await scanVault(root);
    const index = readFileSync(join(root, "index.md"), "utf8");

    expect(refreshed.index).toBe("updated");
    expect(current.index).toBe("current");
    expect(index).toContain("- [[notes/alpha|Alpha]]");
    expect(index).toContain("- [[notes/beta|Beta]] — A maintained note.");
    expect(readdirSync(root).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  test("keeps orphans and mention candidates advisory in the analysis", async () => {
    const root = fixture();
    writeFileSync(join(root, "notes", "gamma.md"), "# Gamma\n\nSecond note appears here without a link.\n");
    const result = await refreshVault(root);

    expect(result.analysis.orphans).toEqual(["notes/gamma.md"]);
    expect(result.analysis.mentions).toContainEqual({
      source: "notes/gamma.md",
      line: 3,
      target: "notes/beta.md",
      phrase: "Second note",
    });
  });

  test("supports a nested managed index without cataloging or counting it", async () => {
    const root = fixture();
    mkdirSync(join(root, "navigation"));
    writeFileSync(
      join(root, "navigation", "catalog.md"),
      "# Catalog\n\n<!-- kb:catalog:start -->\n<!-- kb:catalog:end -->\n",
    );

    const result = await refreshVault(root, { index: "navigation/catalog.md" });
    const catalog = readFileSync(join(root, "navigation", "catalog.md"), "utf8");

    expect(result.analysis.noteCount).toBe(3);
    expect(result.analysis.noteConnections.map(({ path }) => path).sort()).toEqual([
      "index.md",
      "notes/alpha.md",
      "notes/beta.md",
    ]);
    expect(catalog).not.toContain("[[navigation/catalog|Catalog]]");
  });

  test("rejects a symlinked index without copying outside content into the vault", async () => {
    const root = fixture();
    const outside = join(dirname(root), `${basename(root)}-outside.md`);
    writeFileSync(outside, "TOP-SECRET-OUTSIDE-VAULT\n", "utf8");
    roots.push(outside);
    unlinkSync(join(root, "index.md"));
    symlinkSync(outside, join(root, "index.md"));

    let rejection: unknown;
    try {
      await refreshVault(root);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(Error);
    expect(readFileSync(outside, "utf8")).toBe("TOP-SECRET-OUTSIDE-VAULT\n");
  });

  test("rejects a symlinked index parent without writing outside the vault", async () => {
    const root = fixture();
    const outside = `${root}-outside-directory`;
    mkdirSync(outside);
    roots.push(outside);
    writeFileSync(join(outside, "index.md"), "# Outside\n", "utf8");
    symlinkSync(outside, join(root, "navigation"));

    let rejection: unknown;
    try {
      await refreshVault(root, { index: "navigation/index.md" });
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(Error);
    if (!(rejection instanceof Error)) throw new Error("refresh unexpectedly succeeded");
    expect(rejection.message).toContain("must not traverse a symbolic link");
    expect(readFileSync(join(outside, "index.md"), "utf8")).toBe("# Outside\n");
  });
});
