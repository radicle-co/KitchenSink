/**
 * The refusal a mirror feed raises (plan KTD-26).
 */

/** Thrown when a source's listing is not the shape its feed was written for. Nothing from the pull is written. */
export class MirrorFeedFormatError extends Error {
    /** Where the problem is: the document, or one item. */
    public readonly where: string;

    /**
     * @param where - The document, or one item by its key or position.
     * @param detail - What is wrong there.
     */
    public constructor(where: string, detail: string) {
        super(`Mirror feed, ${where}: ${detail}`);
        this.name = 'MirrorFeedFormatError';
        this.where = where;
        Object.setPrototypeOf(this, MirrorFeedFormatError.prototype);
    }
}

/**
 * Type guard for {@link MirrorFeedFormatError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a mirror feed format error.
 */
export function isMirrorFeedFormatError(error: unknown): error is MirrorFeedFormatError {
    return error instanceof MirrorFeedFormatError;
}
