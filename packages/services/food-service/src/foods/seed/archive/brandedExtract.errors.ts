/**
 * The refusal the Branded extract's parser and extractor raise (plan U1, KTD-20).
 */

/** Thrown when the committed Branded extract, or the upstream rows it is rebuilt from, is not the format. */
export class BrandedExtractFormatError extends Error {
    /** Where the problem is: `line N` of the extract, or an upstream file name. */
    public readonly where: string;

    /**
     * @param where - `line N` of the extract, or an upstream file name.
     * @param detail - What is wrong there.
     */
    public constructor(where: string, detail: string) {
        super(`Branded extract, ${where}: ${detail}`);
        this.name = 'BrandedExtractFormatError';
        this.where = where;
        Object.setPrototypeOf(this, BrandedExtractFormatError.prototype);
    }
}

/**
 * Type guard for {@link BrandedExtractFormatError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a Branded extract format error.
 */
export function isBrandedExtractFormatError(error: unknown): error is BrandedExtractFormatError {
    return error instanceof BrandedExtractFormatError;
}
