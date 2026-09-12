/**
 * The refusal of a pinned file whose bytes are not the ones it was pinned to (plan U1, R2, U28). It names no source:
 * the seed's archives and extracts and the mirror's committed snapshots all raise it, so nothing downstream reads
 * bytes that were not reviewed.
 */

/** Thrown when a pinned file's bytes do not hash to its pin, or the file is absent. */
export class SourcePinMismatchError extends Error {
    /** The path that was read. */
    public readonly file: string;
    /** The pinned SHA-256. */
    public readonly expected: string;
    /** The SHA-256 of the bytes found, or `null` when there was no file. */
    public readonly actual: string | null;

    /**
     * @param file - The path that was read.
     * @param expected - The pinned SHA-256.
     * @param actual - The digest of the bytes found, or `null` when the file is absent.
     */
    public constructor(file: string, expected: string, actual: string | null) {
        super(
            actual === null
                ? `Pinned file '${file}' is absent (pinned sha256 ${expected}).`
                : `Pinned file '${file}' hashes to ${actual}, but its pin is ${expected}.`,
        );
        this.name = 'SourcePinMismatchError';
        this.file = file;
        this.expected = expected;
        this.actual = actual;
        Object.setPrototypeOf(this, SourcePinMismatchError.prototype);
    }
}

/**
 * Type guard for {@link SourcePinMismatchError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a pin mismatch.
 */
export function isSourcePinMismatchError(error: unknown): error is SourcePinMismatchError {
    return error instanceof SourcePinMismatchError;
}
