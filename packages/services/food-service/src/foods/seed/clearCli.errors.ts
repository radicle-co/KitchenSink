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
    'target-confirmation-missing':
        'no --confirm-target was given. --stage and --confirm are both YOUR words, checked against each ' +
        'other; nothing in them names the database this process actually opened. Re-run with --dry-run, ' +
        'read the target it prints, and pass it back as --confirm-target <database@host:port>.',
    'target-mismatch':
        'the --confirm-target you gave is not the database this process actually opened. This is the guard ' +
        'that catches a production stage declared against a sandbox connection (and the reverse). Do NOT ' +
        'retype it from memory — run --dry-run and paste the target it reports.',
    'stage-database-mismatch':
        'the stage you named and the database this connection reached cannot both be true: a pr-{N} stage ' +
        'belongs on a {base}_pr_{N} database and a named stage does not belong on a per-PR one (ADR-0006). ' +
        'Check STAGE / --stage against DATABASE_URL before re-running.',
    'probe-off-server':
        'the recipe-linkage probe reached a DIFFERENT server than the food catalog. Those are two logical ' +
        'databases on one shared instance per stage, so a probe answering from elsewhere is reporting some ' +
        'other stage’s linkage — and "zero links remain" from the wrong stage reads as permission to delete ' +
        'this one’s entire catalog. Check --recipe-database-url against DATABASE_URL.',
};

/** Thrown when the destructive-operation guard declines to run — nothing has been read or written. */
export class CatalogClearRefusedError extends Error {
    /** Which guard declined. */
    public readonly reason: ClearRefusalReason;
    /** The stage the run was configured for. */
    public readonly stage: string;
    /**
     * The target the process actually reached, when one had been established — the four target-binding
     * refusals are ABOUT it, so the message that reports them has to name it or the operator is left
     * guessing at what to type.
     */
    public readonly target: string | undefined;

    /**
     * @param reason - Which guard declined.
     * @param stage - The stage the run was configured for.
     * @param target - Where the connection actually landed, when it had been read.
     */
    public constructor(reason: ClearRefusalReason, stage: string, target?: string) {
        const observed = target === undefined ? '' : ` The connection actually reached ${target}.`;

        super(`Refusing to clear the food catalog on stage "${stage}" — ${REFUSAL_EXPLANATIONS[reason]}${observed}`);
        this.name = 'CatalogClearRefusedError';
        this.reason = reason;
        this.stage = stage;
        this.target = target;
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
