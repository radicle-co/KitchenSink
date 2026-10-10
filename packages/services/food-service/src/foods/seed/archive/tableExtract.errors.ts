/**
 * The refusal a cited table's upstream file raises when an extractor reads it (plan U23).
 */

/** Thrown when an upstream table holds a layout, a cell or a row its extractor was not written for. */
export class TableFormatError extends Error {
    /** Where the problem is: the file, and the row and column where one applies. */
    public readonly where: string;

    /**
     * @param where - The file, and the row and column where one applies.
     * @param detail - What is wrong there.
     */
    public constructor(where: string, detail: string) {
        super(`Upstream table, ${where}: ${detail}`);
        this.name = 'TableFormatError';
        this.where = where;
        Object.setPrototypeOf(this, TableFormatError.prototype);
    }
}

/**
 * Type guard for {@link TableFormatError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a table format error.
 */
export function isTableFormatError(error: unknown): error is TableFormatError {
    return error instanceof TableFormatError;
}
