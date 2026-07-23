// @bun
// src/clip/terminal.ts
var ESCAPE = 27;
var BELL = 7;
var STRING_TERMINATOR = 156;
var MAX_PENDING_LENGTH = 64 * 1024;
var MAX_PENDING_SEGMENTS = 4096;
function chunkBuilder() {
  const chunks = [];
  let pending = [];
  let pendingLength = 0;
  const flush = () => {
    if (pending.length === 0)
      return;
    chunks.push(pending.join(""));
    pending = [];
    pendingLength = 0;
  };
  return {
    append: (value) => {
      if (value === "")
        return;
      if (value.length >= MAX_PENDING_LENGTH) {
        flush();
        chunks.push(value);
        return;
      }
      pending.push(value);
      pendingLength += value.length;
      if (pendingLength >= MAX_PENDING_LENGTH || pending.length >= MAX_PENDING_SEGMENTS)
        flush();
    },
    finish: () => {
      flush();
      if (chunks.length === 0)
        return "";
      if (chunks.length === 1)
        return chunks[0] ?? "";
      return chunks.join("");
    }
  };
}
function isEscapeStringIntroducer(code) {
  return code === 80 || code === 88 || code === 93 || code === 94 || code === 95;
}
function isC1StringIntroducer(code) {
  return code === 144 || code === 152 || code === 157 || code === 158 || code === 159;
}
function controlStringEnd(value, start) {
  for (let cursor = start;cursor < value.length; cursor += 1) {
    const code = value.charCodeAt(cursor);
    if (code === BELL || code === STRING_TERMINATOR)
      return cursor + 1;
    if (code === ESCAPE && value.charCodeAt(cursor + 1) === 92)
      return cursor + 2;
  }
  return value.length;
}
function controlSequenceEnd(value, start) {
  for (let cursor = start;cursor < value.length; cursor += 1) {
    const code = value.charCodeAt(cursor);
    if (code >= 64 && code <= 126)
      return cursor + 1;
  }
  return value.length;
}
function escapeSequenceEnd(value, start) {
  const introducer = value.charCodeAt(start + 1);
  if (Number.isNaN(introducer))
    return start + 1;
  if (introducer === 91)
    return controlSequenceEnd(value, start + 2);
  if (isEscapeStringIntroducer(introducer)) {
    return controlStringEnd(value, start + 2);
  }
  let cursor = start + 1;
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code >= 32 && code <= 47) {
      cursor += 1;
      continue;
    }
    return code >= 48 && code <= 126 ? cursor + 1 : start + 1;
  }
  return value.length;
}
function isBidiFormatControl(code) {
  return code === 1564 || code === 8206 || code === 8207 || code >= 8234 && code <= 8238 || code >= 8294 && code <= 8297;
}
function hasUnsafeTerminalCharacters(value) {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 9 || code >= 11 && code <= 31 || code >= 127 && code <= 159 || isBidiFormatControl(code))
      return true;
  }
  return false;
}
function sanitizeTerminalText(value) {
  let builder = null;
  let unchangedStart = 0;
  const replace = (start, end, replacement = "") => {
    builder ??= chunkBuilder();
    builder.append(value.slice(unchangedStart, start));
    builder.append(replacement);
    unchangedStart = end;
  };
  for (let cursor = 0;cursor < value.length; ) {
    const code = value.charCodeAt(cursor);
    if (code === ESCAPE) {
      const end = escapeSequenceEnd(value, cursor);
      replace(cursor, end);
      cursor = end;
      continue;
    }
    if (code === 155) {
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
    if (code === 13) {
      const end = value.charCodeAt(cursor + 1) === 10 ? cursor + 2 : cursor + 1;
      replace(cursor, end, `
`);
      cursor = end;
      continue;
    }
    if (code === 10) {
      cursor += 1;
      continue;
    }
    if (code === 8232 || code === 8233) {
      replace(cursor, cursor + 1, `
`);
      cursor += 1;
      continue;
    }
    if (code === 9) {
      replace(cursor, cursor + 1, "    ");
      cursor += 1;
      continue;
    }
    if (code <= 31 || code >= 127 && code <= 159 || isBidiFormatControl(code)) {
      replace(cursor, cursor + 1);
      cursor += 1;
      continue;
    }
    cursor += 1;
  }
  const completedBuilder = builder;
  if (completedBuilder === null)
    return value;
  completedBuilder.append(value.slice(unchangedStart));
  return completedBuilder.finish();
}
function sanitizeTerminalLine(value) {
  return sanitizeTerminalText(value).replace(/\n/g, " ");
}

export { hasUnsafeTerminalCharacters, sanitizeTerminalText, sanitizeTerminalLine };
