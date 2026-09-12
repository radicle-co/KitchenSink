/**
 * The refusal a cited source's extract raises (plan U23, KTD-20).
 */

/** Thrown when a committed extract is not the format. An upstream table's refusal is `TableFormatError`. */
export class SourceExtractFormatError extends Error {
    /** Where the problem is: `line N` of the extract. */
    public readonly where: string;

    /**
     * @param where - `line N` of the extract.
     * @param detail - What is wrong there.
     */
    public constructor(where: string, detail: string) {
        super(`Source extract, ${where}: ${detail}`);
        this.name = 'SourceExtractFormatError';
        this.where = where;
        Object.setPrototypeOf(this, SourceExtractFormatError.prototype);
    }
}

/**
 * Type guard for {@link SourceExtractFormatError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a source extract format error.
 */
export function isSourceExtractFormatError(error: unknown): error is SourceExtractFormatError {
    return error instanceof SourceExtractFormatError;
}
