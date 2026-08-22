/**
 * Errors raised by the food-catalog CLEAR task (U12a).
 *
 * Every one of them is terminal and every one of them fires BEFORE or INSTEAD OF a delete — this task has
 * no partial-success state to report. {@link RecipeLinkageRemainingError} and
 * {@link RecipeLinkageUnreadableError} are the two halves of the ordering precondition: links that are
 * still there, and a linkage count that could not be obtained at all. The second fails CLOSED for the same
 * reason ADR-0024's spend counter does — an unanswerable question is not a "no".
 */
import type { CatalogResidual, ClearRefusalReason } from './clearCli.js';

/** Human-readable explanation per refusal reason — the operator's next action, not a restatement. */
const REFUSAL_EXPLANATIONS: Readonly<Record<ClearRefusalReason, string>> = {
    'confirmation-missing':
        'no --confirm <stage> was given. Re-run with --confirm set to the stage you intend to clear, ' +
        'or with --dry-run to see the counts first.',
    'confirmation-mismatch':
        'the stage named by --confirm is not the stage this process is configured for. Check STAGE / --stage ' +
        'and the database this process is pointed at before re-running.',
    'production-requires-flag':
        'this is the PRODUCTION stage, and the food catalog is a shared, live service. Re-run with ' +
        '--allow-prod as well, once the reseed that follows is ready to run immediately.',
    'production-flag-off-production':
        '--allow-prod was given on a stage that is not production. The flag is rejected rather than ignored ' +
        'so it cannot become something an operator types by habit.',
};

/** Thrown when the destructive-operation guard declines to run — nothing has been read or written. */
export class CatalogClearRefusedError extends Error {
    /** Which guard declined. */
    public readonly reason: ClearRefusalReason;
    /** The stage the run was configured for. */
    public readonly stage: string;

    /**
     * @param reason - Which guard declined.
     * @param stage - The stage the run was configured for.
     */
    public constructor(reason: ClearRefusalReason, stage: string) {
        super(`Refusing to clear the food catalog on stage "${stage}" — ${REFUSAL_EXPLANATIONS[reason]}`);
        this.name = 'CatalogClearRefusedError';
        this.reason = reason;
        this.stage = stage;
        Object.setPrototypeOf(this, CatalogClearRefusedError.prototype);
    }
}

/**
 * Type guard for {@link CatalogClearRefusedError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a clear refusal.
 */
export function isCatalogClearRefusedError(error: unknown): error is CatalogClearRefusedError {
    return error instanceof CatalogClearRefusedError;
}

/**
 * ⛔ The ordering guard. Thrown when the recipe database still holds ingredient rows pointing at the food
 * catalog — i.e. the recipe-side unlink has not run, or did not finish.
 *
 * Deleting anyway would leave every one of those rows referencing a food id that no longer exists, and
 * `ingredients.food_id` has NO foreign key, so nothing downstream would ever notice.
 */
export class RecipeLinkageRemainingError extends Error {
    /** How many recipe-side ingredient rows still carry a food link. */
    public readonly remaining: number;

    /** @param remaining - How many recipe-side ingredient rows still carry a food link. */
    public constructor(remaining: number) {
        super(
            `Refusing to clear the food catalog: ${remaining} recipe ingredient row(s) still reference it. ` +
                'Run the recipe-side unlink FIRST (npm run ingredients:unlink --workspace=@kitchensink/recipe-service) ' +
                'and re-run this once it reports zero — reversed, every recipe would carry a food_id pointing at a ' +
                'deleted row, and there is no foreign key to catch it.',
        );
        this.name = 'RecipeLinkageRemainingError';
        this.remaining = remaining;
        Object.setPrototypeOf(this, RecipeLinkageRemainingError.prototype);
    }
}

/**
 * Type guard for {@link RecipeLinkageRemainingError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a remaining-linkage abort.
 */
export function isRecipeLinkageRemainingError(error: unknown): error is RecipeLinkageRemainingError {
    return error instanceof RecipeLinkageRemainingError;
}

/**
 * Thrown when the linkage probe cannot answer at all — the recipe database it was pointed at has no
 * `ingredients.food_id`/`food_resolution_status` to read.
 *
 * Fails CLOSED. A probe pointed at the wrong database, or at one whose columns have been renamed, would
 * otherwise report "no rows" and read as permission to delete the entire catalog.
 */
export class RecipeLinkageUnreadableError extends Error {
    /** @param detail - What was missing. */
    public constructor(detail: string) {
        super(
            `Refusing to clear the food catalog: the recipe-linkage probe could not be answered — ${detail}. ` +
                'This fails closed: an unanswerable probe is never read as "nothing is linked". Check ' +
                '--recipe-database-url (or RECIPE_DATABASE_URL) points at the recipe service database for this stage.',
        );
        this.name = 'RecipeLinkageUnreadableError';
        Object.setPrototypeOf(this, RecipeLinkageUnreadableError.prototype);
    }
}

/**
 * Type guard for {@link RecipeLinkageUnreadableError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is an unreadable-probe abort.
 */
export function isRecipeLinkageUnreadableError(error: unknown): error is RecipeLinkageUnreadableError {
    return error instanceof RecipeLinkageUnreadableError;
}

/**
 * Thrown INSIDE the clear's transaction when a dependent table still holds rows after `DELETE FROM food`.
 *
 * Every catalog table hangs off `food.id` with `ON DELETE CASCADE`, so this should be unreachable — which
 * is exactly why it is asserted rather than assumed. A residue means the schema changed underneath this
 * task, and the transaction rolls back rather than leaving a half-cleared catalog behind.
 */
export class CatalogClearIncompleteError extends Error {
    /** Table name → rows still present. Only non-empty tables appear. */
    public readonly residual: CatalogResidual;

    /** @param residual - Table name → rows still present. */
    public constructor(residual: CatalogResidual) {
        const detail = Object.entries(residual)
            .map(([table, rows]) => `${table}=${rows}`)
            .join(', ');

        super(
            `Food catalog clear did not complete — rows remain after DELETE FROM food (${detail}). ` +
                'The expected cascade did not happen, so the transaction was rolled back; nothing changed.',
        );
        this.name = 'CatalogClearIncompleteError';
        this.residual = residual;
        Object.setPrototypeOf(this, CatalogClearIncompleteError.prototype);
    }
}

/**
 * Type guard for {@link CatalogClearIncompleteError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is an incomplete clear.
 */
export function isCatalogClearIncompleteError(error: unknown): error is CatalogClearIncompleteError {
    return error instanceof CatalogClearIncompleteError;
}
