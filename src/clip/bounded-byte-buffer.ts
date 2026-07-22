/** Incrementally collect a byte stream without retaining one object per input chunk. */
export class BoundedByteBuffer {
  readonly #maxBytes: number;
  #storage = new Uint8Array();
  #length = 0;

  constructor(maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new RangeError("byte buffer limit must be a non-negative safe integer");
    }
    this.#maxBytes = maxBytes;
  }

  get byteLength(): number {
    return this.#length;
  }

  /** Copy one chunk into owned geometric storage. False leaves the buffer unchanged. */
  append(chunk: Uint8Array): boolean {
    if (chunk.byteLength > this.#maxBytes - this.#length) return false;
    if (chunk.byteLength === 0) return true;
    const required = this.#length + chunk.byteLength;
    if (required > this.#storage.byteLength) this.#grow(required);
    this.#storage.set(chunk, this.#length);
    this.#length = required;
    return true;
  }

  /** Return an exact-length owned byte array. */
  toUint8Array(): Uint8Array {
    if (this.#length === this.#storage.byteLength) return this.#storage;
    return this.#storage.slice(0, this.#length);
  }

  #grow(required: number): void {
    let capacity = this.#storage.byteLength;
    if (capacity === 0) capacity = Math.min(this.#maxBytes, Math.max(1_024, required));
    while (capacity < required) {
      capacity = capacity <= Math.floor(this.#maxBytes / 2)
        ? capacity * 2
        : this.#maxBytes;
    }
    const grown = new Uint8Array(capacity);
    grown.set(this.#storage.subarray(0, this.#length));
    this.#storage = grown;
  }
}
