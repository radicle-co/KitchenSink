/**
 * The refusal the verifier's COPY loader can raise (curated catalog plan U6, KTD-3).
 */

/**
 * Thrown when a committed file holds a byte the loader's COPY framing reserves, so a line could not arrive as itself.
 *
 * The framing reads each line as one CSV value whose delimiter and quote are control bytes no committed text file
 * holds. A quote byte would open a quoted section that swallows the following newlines, merging lines silently, so
 * either byte is refused before the server sees it.
 */
export class CopyFramingByteError extends Error {
    /**
     * @param table - The temp table being loaded.
     * @param byte - The reserved byte found.
     * @param offset - Its zero-based byte offset in the file.
     */
    public constructor(
        public readonly table: string,
        public readonly byte: number,
        public readonly offset: number,
    ) {
        super(
            `The bytes for '${table}' hold the reserved byte 0x${byte.toString(16).padStart(2, '0')} at offset ${offset}.`,
        );
        this.name = 'CopyFramingByteError';
        Object.setPrototypeOf(this, CopyFramingByteError.prototype);
    }
}

/**
 * Type guard for {@link CopyFramingByteError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a framing refusal.
 */
export function isCopyFramingByteError(error: unknown): error is CopyFramingByteError {
    return error instanceof CopyFramingByteError;
}
