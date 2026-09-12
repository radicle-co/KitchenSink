/**
 * Errors raised at the USDA bulk-download FILE boundary (ingredient-search plan §2 Stage 1).
 *
 * Deliberately distinct from `AdapterValidationError` (a bad VALUE inside an otherwise-well-formed
 * response, rejected at the value grain) — a {@link UsdaBulkFormatError} means the INPUT FILES are not
 * the dataset we were handed a contract for, so nothing can be safely imported and the run must abort
 * loudly rather than silently seed a partial catalog.
 *
 * This matters because FDC really does change the file schema between releases without notice:
 * `food_nutrient.csv` ships 11 columns in the per-dataset zips and 13 in the full download, and the same
 * logical `data_type` value is spelled `market_acquisition` in one file and `market_acquistion` in
 * another. Columns are therefore resolved by header NAME and the header is validated at load time.
 */

/** Thrown when a required bulk CSV is missing, unreadable, or missing a column the mapping requires. */
export class UsdaBulkFormatError extends Error {
    /** The bulk CSV filename the problem was found in. */
    public readonly file: string;

    /**
     * @param file - The offending bulk CSV filename (e.g. `food.csv`).
     * @param detail - A sanitized description of what is wrong.
     */
    public constructor(file: string, detail: string) {
        super(`USDA bulk file '${file}' is not usable: ${detail}`);
        this.name = 'UsdaBulkFormatError';
        this.file = file;
        Object.setPrototypeOf(this, UsdaBulkFormatError.prototype);
    }
}

/**
 * Type guard for {@link UsdaBulkFormatError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a bulk-format error.
 */
export function isUsdaBulkFormatError(error: unknown): error is UsdaBulkFormatError {
    return error instanceof UsdaBulkFormatError;
}
