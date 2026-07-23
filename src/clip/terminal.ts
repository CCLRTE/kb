/**
 * Remove terminal control protocols from untrusted text while retaining prose.
 * Newlines remain structural and tabs are normalized to spaces; use the line
 * variant when an untrusted value must not create an additional output line.
 */

const ESCAPE = 0x1b;
const BELL = 0x07;
const STRING_TERMINATOR = 0x9c;
const MAX_PENDING_LENGTH = 64 * 1024;
const MAX_PENDING_SEGMENTS = 4_096;
const CONTEXT_FREE_TERMINAL_CONTROLS = new RegExp(
  String.raw`[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]`,
  "g",
);
const CONTEXT_SENSITIVE_TERMINAL_CONTROLS = new RegExp(
  String.raw`[\u0009\u000d\u001b\u0090\u0098\u009b\u009d-\u009f\u2028\u2029]`,
);

type ChunkBuilder = {
  readonly append: (value: string) => void;
  readonly finish: () => string;
};

function chunkBuilder(): ChunkBuilder {
  const chunks: string[] = [];
  let pending: string[] = [];
  let pendingLength = 0;

  const flush = (): void => {
    if (pending.length === 0) return;
    chunks.push(pending.join(""));
    pending = [];
    pendingLength = 0;
  };
  return {
    append: (value) => {
      if (value === "") return;
      if (value.length >= MAX_PENDING_LENGTH) {
        flush();
        chunks.push(value);
        return;
      }
      pending.push(value);
      pendingLength += value.length;
      if (pendingLength >= MAX_PENDING_LENGTH || pending.length >= MAX_PENDING_SEGMENTS) flush();
    },
    finish: () => {
      flush();
      if (chunks.length === 0) return "";
      if (chunks.length === 1) return chunks[0] ?? "";
      return chunks.join("");
    },
  };
}

function isEscapeStringIntroducer(code: number): boolean {
  return code === 0x50 || code === 0x58 || code === 0x5d || code === 0x5e || code === 0x5f;
}

function isC1StringIntroducer(code: number): boolean {
  return code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f;
}

function controlStringEnd(value: string, start: number): number {
  for (let cursor = start; cursor < value.length; cursor += 1) {
    const code = value.charCodeAt(cursor);
    if (code === BELL || code === STRING_TERMINATOR) return cursor + 1;
    if (code === ESCAPE && value.charCodeAt(cursor + 1) === 0x5c) return cursor + 2;
  }
  // An unterminated OSC/DCS payload remains terminal state, so discard its tail.
  return value.length;
}

function controlSequenceEnd(value: string, start: number): number {
  for (let cursor = start; cursor < value.length; cursor += 1) {
    const code = value.charCodeAt(cursor);
    if (code >= 0x40 && code <= 0x7e) return cursor + 1;
  }
  return value.length;
}

function escapeSequenceEnd(value: string, start: number): number {
  const introducer = value.charCodeAt(start + 1);
  if (Number.isNaN(introducer)) return start + 1;
  if (introducer === 0x5b) return controlSequenceEnd(value, start + 2); // CSI
  if (isEscapeStringIntroducer(introducer)) {
    return controlStringEnd(value, start + 2); // DCS, SOS, OSC, PM, APC
  }

  let cursor = start + 1;
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code >= 0x20 && code <= 0x2f) {
      cursor += 1;
      continue;
    }
    return code >= 0x30 && code <= 0x7e ? cursor + 1 : start + 1;
  }
  return value.length;
}

function isBidiFormatControl(code: number): boolean {
  return code === 0x061c
    || code === 0x200e
    || code === 0x200f
    || (code >= 0x202a && code <= 0x202e)
    || (code >= 0x2066 && code <= 0x2069);
}

/** True when text still contains a terminal control other than structural LF. */
export function hasUnsafeTerminalCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x09
      || (code >= 0x0b && code <= 0x1f)
      || (code >= 0x7f && code <= 0x9f)
      || isBidiFormatControl(code)) return true;
  }
  return false;
}

/** Strip ANSI/OSC payloads, C0/C1 controls, DEL, and bidi formatting controls. */
export function sanitizeTerminalText(value: string): string {
  // Let the string engine remove context-free controls in one bounded pass.
  // Escape strings, CSI, normalized whitespace, and line separators still use
  // the state machine below because their replacement depends on neighbors.
  if (!CONTEXT_SENSITIVE_TERMINAL_CONTROLS.test(value)) {
    return value.replace(CONTEXT_FREE_TERMINAL_CONTROLS, "");
  }

  let builder: ChunkBuilder | null = null;
  let unchangedStart = 0;
  const replace = (start: number, end: number, replacement = ""): void => {
    builder ??= chunkBuilder();
    builder.append(value.slice(unchangedStart, start));
    builder.append(replacement);
    unchangedStart = end;
  };

  for (let cursor = 0; cursor < value.length;) {
    const code = value.charCodeAt(cursor);
    if (code === ESCAPE) {
      const end = escapeSequenceEnd(value, cursor);
      replace(cursor, end);
      cursor = end;
      continue;
    }
    if (code === 0x9b) {
      const end = controlSequenceEnd(value, cursor + 1);
      replace(cursor, end);
      cursor = end;
      continue;
    }
    if (isC1StringIntroducer(code)) {
      const end = controlStringEnd(value, cursor + 1);
      replace(cursor, end);
      cursor = end;
      continue;
    }
    if (code === 0x0d) {
      const end = value.charCodeAt(cursor + 1) === 0x0a ? cursor + 2 : cursor + 1;
      replace(cursor, end, "\n");
      cursor = end;
      continue;
    }
    if (code === 0x0a) {
      cursor += 1;
      continue;
    }
    if (code === 0x2028 || code === 0x2029) {
      replace(cursor, cursor + 1, "\n");
      cursor += 1;
      continue;
    }
    if (code === 0x09) {
      replace(cursor, cursor + 1, "    ");
      cursor += 1;
      continue;
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || isBidiFormatControl(code)) {
      replace(cursor, cursor + 1);
      cursor += 1;
      continue;
    }
    cursor += 1;
  }
  const completedBuilder = builder as ChunkBuilder | null;
  if (completedBuilder === null) return value;
  completedBuilder.append(value.slice(unchangedStart));
  return completedBuilder.finish();
}

/** Sanitize one terminal field and prevent it from forging adjacent lines. */
export function sanitizeTerminalLine(value: string): string {
  return sanitizeTerminalText(value).replace(/\n/g, " ");
}
