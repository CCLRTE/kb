import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main, parseArguments } from "./cli.js";

function captureOutput(): {
  readonly output: { stdout: (value: string) => void; stderr: (value: string) => void };
  readonly stdout: () => string;
  readonly stderr: () => string;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    output: {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
  };
}

describe("kb argument parsing", () => {
  test("delegates capture commands and rejects secret-shaped unknown values without echoing them", () => {
    expect(parseArguments(["clip", "https://example.com"])).toEqual({
      ok: true,
      value: { kind: "clip", arguments: ["capture", "https://example.com"] },
    });
    expect(parseArguments(["inspect", "https://example.com"])).toEqual({
      ok: true,
      value: { kind: "clip", arguments: ["inspect", "https://example.com"] },
    });
    expect(parseArguments(["clip", "--help"])).toEqual({
      ok: true,
      value: { kind: "clip", arguments: ["help"] },
    });
    expect(parseArguments(["check", "--secret=do-not-print"])).toEqual({
      ok: false,
      message: "unknown check option",
    });
  });

  test("parses vault roots, custom indexes, and backlink queries", () => {
    expect(parseArguments(["backlinks", "Context design", "--root", "vault", "--index", "home.md", "--json"]))
      .toEqual({
        ok: true,
        value: {
          kind: "backlinks",
          root: "vault",
          options: { index: "home.md" },
          json: true,
          note: "Context design",
        },
      });
  });
});

describe("kb vault commands", () => {
  test("initializes, refreshes, checks, graphs, and derives backlinks without editing notes", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "cclrte-kb-cli-"));
    const vault = join(temporary, "vault");
    try {
      const initOutput = captureOutput();
      expect(await main(["init", vault], initOutput.output)).toBe(0);
      expect(initOutput.stdout()).toContain("Initialized");

      await mkdir(join(vault, "notes"), { recursive: true });
      const alphaPath = join(vault, "notes", "alpha.md");
      await writeFile(alphaPath, "# Alpha\n\nSee [[notes/beta]].\n", "utf8");
      await writeFile(join(vault, "notes", "beta.md"), "# Beta\n", "utf8");

      const staleOutput = captureOutput();
      expect(await main(["check", "--root", vault], staleOutput.output)).toBe(3);
      expect(staleOutput.stdout()).toContain("catalog is stale");

      const refreshOutput = captureOutput();
      expect(await main(["refresh", "--root", vault], refreshOutput.output)).toBe(0);
      expect(refreshOutput.stdout()).toContain("Index: updated");

      const graphOutput = captureOutput();
      expect(await main(["graph", "--root", vault, "--json"], graphOutput.output)).toBe(0);
      expect(JSON.parse(graphOutput.stdout())).toMatchObject({
        noteCount: 2,
        contextualLinkCount: 1,
      });

      const backlinkOutput = captureOutput();
      expect(await main(["backlinks", "Beta", "--root", vault], backlinkOutput.output)).toBe(0);
      expect(backlinkOutput.stdout()).toContain("notes/alpha.md:3");
      expect(await Bun.file(alphaPath).text()).toBe("# Alpha\n\nSee [[notes/beta]].\n");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("delegates clip arguments and preserves its exit code", async () => {
    const captured: string[][] = [];
    const output = captureOutput();
    const exitCode = await main(["clip", "https://example.com", "--json"], output.output, {
      runClipCommand: (arguments_) => {
        captured.push([...(arguments_ ?? [])]);
        return Promise.resolve(3);
      },
    });
    expect(exitCode).toBe(3);
    expect(captured).toEqual([["capture", "https://example.com", "--json"]]);
  });

  test("reports broken links as check failures and sanitizes thrown terminal text", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "cclrte-kb-cli-"));
    try {
      await writeFile(join(temporary, "index.md"), "# Index\n", "utf8");
      await writeFile(join(temporary, "note.md"), "# Note\n\n[[missing]]\n", "utf8");
      await writeFile(
        join(temporary, "clean.md\nREADY: forged.md"),
        "# Untrusted filename\n",
        "utf8",
      );
      await main(["refresh", "--root", temporary], captureOutput().output);
      const checked = captureOutput();
      expect(await main(["check", "--root", temporary], checked.output)).toBe(3);
      expect(checked.stdout()).toContain("broken wikilink [[missing]]");

      const graph = captureOutput();
      expect(await main(["graph", "--root", temporary], graph.output)).toBe(0);
      expect(graph.stdout()).not.toContain("\nREADY: forged.md");
      expect(graph.stdout()).toContain("clean.md READY: forged.md");

      const failed = captureOutput();
      expect(await main(["check"], failed.output, {
        scanVault: () => Promise.reject(new Error("bad\u001b]8;;https://evil.example\u0007path\u001b]8;;\u0007")),
      })).toBe(1);
      expect(failed.stderr()).toBe("error: badpath\n");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
