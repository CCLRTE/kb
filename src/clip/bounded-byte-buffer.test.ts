import { describe, expect, test } from "bun:test";

import { BoundedByteBuffer } from "./bounded-byte-buffer.js";

describe("BoundedByteBuffer", () => {
  test("copies chunks into owned storage and returns exact bytes", () => {
    const source = new Uint8Array([1, 2, 3]);
    const buffer = new BoundedByteBuffer(8);
    expect(buffer.append(source)).toBeTrue();
    source.fill(9);
    expect(buffer.append(new Uint8Array([4, 5]))).toBeTrue();
    expect(buffer.byteLength).toBe(5);
    expect([...buffer.toUint8Array()]).toEqual([1, 2, 3, 4, 5]);
  });

  test("rejects an overflowing chunk without changing retained content", () => {
    const buffer = new BoundedByteBuffer(4);
    expect(buffer.append(new Uint8Array([1, 2, 3]))).toBeTrue();
    expect(buffer.append(new Uint8Array([4, 5]))).toBeFalse();
    expect(buffer.byteLength).toBe(3);
    expect([...buffer.toUint8Array()]).toEqual([1, 2, 3]);
  });

  test("handles zero-byte limits and rejects invalid bounds", () => {
    const empty = new BoundedByteBuffer(0);
    expect(empty.append(new Uint8Array())).toBeTrue();
    expect(empty.append(new Uint8Array([1]))).toBeFalse();
    expect(empty.toUint8Array()).toHaveLength(0);
    expect(() => new BoundedByteBuffer(-1)).toThrow();
    expect(() => new BoundedByteBuffer(Number.POSITIVE_INFINITY)).toThrow();
  });
});
