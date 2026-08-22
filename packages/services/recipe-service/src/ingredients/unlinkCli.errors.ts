/**
 * Errors raised by the recipe-side ingredient UNLINK task (U12a).
 *
 * Both are terminal by design. This is a destructive operator task with no retry loop: a refusal means
 * the operator has not yet said what they are about to do, and an incomplete run means the database is in
 * a state the next step (the food-side catalog clear) must not be allowed to build on.
 */
import type { UnlinkFacts, UnlinkRefusalReason } from './unlinkCli.js';

/** Human-readable explanation per refusal reason — the operator's next action, not a restatement. */
const REFUSAL_EXPLANATIONS: Readonly<Record<UnlinkRefusalReason, string>> = {
    'confirmation-missing':
        'no --confirm <stage> was given. Re-run with --confirm set to the stage you intend to unlink, ' +
        'or with --dry-run to see the counts first.',
    'confirmation-mismatch':
        'the stage named by --confirm is not the stage this process is configured for. Check STAGE / --stage ' +
        'and the database this process is pointed at before re-running.',
    'production-requires-flag':
        'this is the PRODUCTION stage. Re-run with --allow-prod as well, once you are certain every recipe ' +
        'losing its food link is intended.',
    'production-flag-off-production':
        '--allow-prod was given on a stage that is not production. The flag is rejected rather than ignored ' +
        'so it cannot become something an operator types by habit.',
};

/** Thrown when the destructive-operation guard declines to run — nothing has been read or written. */
export class UnlinkRefusedError extends Error {
    /** Which guard declined. */
    public readonly reason: UnlinkRefusalReason;
    /** The stage the run was configured for. */
    public readonly stage: string;

    /**
     * @param reason - Which guard declined.
     * @param stage - The stage the run was configured for.
     */
    public constructor(reason: UnlinkRefusalReason, stage: string) {
        super(`Refusing to unlink ingredients on stage "${stage}" — ${REFUSAL_EXPLANATIONS[reason]}`);
        this.name = 'UnlinkRefusedError';
        this.reason = reason;
        this.stage = stage;
        Object.setPrototypeOf(this, UnlinkRefusedError.prototype);
    }
}

/**
 * Type guard for {@link UnlinkRefusedError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is an unlink refusal.
 */
export function isUnlinkRefusedError(error: unknown): error is UnlinkRefusedError {
    return error instanceof UnlinkRefusedError;
}

/**
 * Thrown when the unlink transaction's own post-conditions do not hold: a linked row survived, or the
 * number of `recipe_ingredients` lines moved.
 *
 * Raised INSIDE the transaction, so the offending work is rolled back rather than committed and reported
 * as a partial success. A surviving link would leave the food-side clear's precondition unsatisfiable; a
 * moved line count means something other than this task was writing, which is not the quiescent state a
 * catalog reset requires.
 */
export class IngredientUnlinkIncompleteError extends Error {
    /** The counts the transaction observed, for the operator's report. */
    public readonly facts: UnlinkFacts;

    /**
     * @param detail - What specifically did not hold.
     * @param facts - The counts the transaction observed.
     */
    public constructor(detail: string, facts: UnlinkFacts) {
        super(`Ingredient unlink did not complete — ${detail}. The transaction was rolled back; nothing changed.`);
        this.name = 'IngredientUnlinkIncompleteError';
        this.facts = facts;
        Object.setPrototypeOf(this, IngredientUnlinkIncompleteError.prototype);
    }
}

/**
 * Type guard for {@link IngredientUnlinkIncompleteError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is an incomplete unlink.
 */
export function isIngredientUnlinkIncompleteError(error: unknown): error is IngredientUnlinkIncompleteError {
    return error instanceof IngredientUnlinkIncompleteError;
}
