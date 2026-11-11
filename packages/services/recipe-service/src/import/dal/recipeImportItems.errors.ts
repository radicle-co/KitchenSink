/**
 * The errors the save claim can raise inside the recipe's own transaction (ADR-0072 §3).
 *
 * An error taxonomy of ONE boundary (`claimSave`): the caller discriminates the two in a single `catch` and the answers are
 * opposite, so they live together (CODING_STANDARDS §1's "error taxonomy" ruling). Both roll the recipe back.
 */

/** Thrown inside the recipe's transaction when the item was saved by someone else first: it rolls the recipe back. */
export class ImportItemAlreadyClaimedError extends Error {
    public readonly ordinal: number;

    public constructor(ordinal: number) {
        super(`import item ${String(ordinal)} was already saved`);
        this.name = 'ImportItemAlreadyClaimedError';
        this.ordinal = ordinal;
        Object.setPrototypeOf(this, ImportItemAlreadyClaimedError.prototype);
    }
}

/**
 * Thrown inside the recipe's transaction when a decision (a statement, a visibility, a review mark, a pick) was written after the
 * save read the item: it rolls the recipe back, and the next call saves from the new state. NOT the same as "already claimed".
 */
export class ImportItemChangedError extends Error {
    public readonly ordinal: number;

    public constructor(ordinal: number) {
        super(`import item ${String(ordinal)} changed while its recipe was being built`);
        this.name = 'ImportItemChangedError';
        this.ordinal = ordinal;
        Object.setPrototypeOf(this, ImportItemChangedError.prototype);
    }
}

/** Type guard for {@link ImportItemChangedError}. */
export function isImportItemChangedError(error: unknown): error is ImportItemChangedError {
    return error instanceof ImportItemChangedError;
}

/** Type guard for {@link ImportItemAlreadyClaimedError}. */
export function isImportItemAlreadyClaimedError(error: unknown): error is ImportItemAlreadyClaimedError {
    return error instanceof ImportItemAlreadyClaimedError;
}
