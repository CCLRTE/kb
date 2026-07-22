import { describe, expect, test } from "bun:test";

import { hasUnsafeTerminalCharacters, sanitizeTerminalLine, sanitizeTerminalText } from "./terminal.js";

describe("terminal-safe text", () => {
  test("removes OSC, ANSI, C0/C1, DEL, and bidi payloads while preserving prose", () => {
    const value = [
      "Café\t漢字 🙂",
      "before\u001b]52;c;c3RlYWwtY2xpcGJvYXJk\u0007after",
      "color\u001b[31mred\u001b[0m",
      "eight-bit\u009b31mred\u009b0m",
      "bidi\u061c\u200e\u202eexe.txt\u202c\u2066done\u2069",
      "del\u007f c1\u0085 end",
    ].join("\r\n");
    const sanitized = sanitizeTerminalText(value);
    expect(sanitized).toBe([
      "Café    漢字 🙂",
      "beforeafter",
      "colorred",
      "eight-bitred",
      "bidiexe.txtdone",
      "del c1 end",
    ].join("\n"));
    expect(sanitized).not.toContain("c3RlYWwtY2xpcGJvYXJk");
  });

  test("turns untrusted line breaks into spaces", () => {
    expect(sanitizeTerminalLine("one\r\ntwo\nthree\tfour")).toBe("one two three    four");
  });

  test("handles capture-sized ordinary and control-dense text with bounded builders", () => {
    const ordinary = "x".repeat(25 * 1024 * 1024);
    expect(sanitizeTerminalText(ordinary)).toBe(ordinary);

    const dense = "x\u0000".repeat((25 * 1024 * 1024) / 2);
    const sanitized = sanitizeTerminalText(dense);
    expect(sanitized).toHaveLength(25 * 1024 * 1024 / 2);
    expect(sanitized.startsWith("xxxx")).toBeTrue();
    expect(hasUnsafeTerminalCharacters(sanitized)).toBeFalse();
  });
});
