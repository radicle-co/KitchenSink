/**
 * The apply's one refusal (curated catalog plan U6): a plan its rows cannot be resolved from, or a statement that
 * wrote a different number of rows than were staged for it.
 *
 * `CatalogApplyRule` is a closed union with one member per refusal, so a test asserts the NAMED cause. Either way the
 * transaction the apply runs in rolls back, so the previous seed stays in place (R32, R37).
 */

/** Every rule an apply can break. */
export type CatalogApplyRule =
    // A root or variant the plan writes to is neither held by the snapshot nor inserted by the plan.
    | 'unresolvedOwner'
    // An item the plan writes to is neither held by the snapshot nor inserted by the plan.
    | 'unresolvedItem'
    // A portion or category cites a source row its own item does not have.
    | 'unresolvedSource'
    // A statement touched a different number of rows than the apply staged for it: a join dropped a row (a missing
    // dictionary entry, owner or citation), or a row changed under the apply.
    | 'rowCountMismatch';

/** Thrown when an apply cannot resolve a plan, or a statement's row count differs from what was staged. */
export class CatalogApplyError extends Error {
    public readonly rule: CatalogApplyRule;
    /** The natural key, owner or statement the refusal is about. */
    public readonly where: string;

    /**
     * @param rule - The rule broken.
     * @param where - What it is about.
     * @param detail - A sentence for the person fixing it.
     */
    public constructor(rule: CatalogApplyRule, where: string, detail: string) {
        super(`The catalog apply is refused at ${where} [${rule}]: ${detail}`);
        this.name = 'CatalogApplyError';
        this.rule = rule;
        this.where = where;
        Object.setPrototypeOf(this, CatalogApplyError.prototype);
    }
}

/**
 * Type guard for {@link CatalogApplyError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is an apply refusal.
 */
export function isCatalogApplyError(error: unknown): error is CatalogApplyError {
    return error instanceof CatalogApplyError;
}
