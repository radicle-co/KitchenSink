/**
 * Errors raised by the food-catalog RESEED task (U12b).
 *
 * Two of them, and they differ in something the operator must not have to infer — **whether anything was
 * written**. {@link CatalogReseedRefusedError} fires BEFORE any port is touched; nothing happened.
 * {@link CatalogReseedUnverifiedError} fires AFTER the import, because a seed of ~8k foods is thousands of
 * transactions and cannot be one — so unlike U12a's clear, whose post-condition runs inside the
 * transaction and rolls a residue back, this one can only report. Its message says so, and says the remedy:
 * the import is idempotent, so fixing the cause and re-running is always safe.
 */
import type { ReseedRefusalReason } from './reseedCli.js';

/** Human-readable explanation per refusal reason — the operator's next action, not a restatement. */
const REFUSAL_EXPLANATIONS: Readonly<Record<ReseedRefusalReason, string>> = {
    'confirmation-missing':
        'no --confirm <stage> was given. Re-run with --confirm set to the stage you intend to reseed, ' +
        'or with --dry-run to see what would be imported first.',
    'confirmation-mismatch':
        'the stage named by --confirm is not the stage this process is configured for. Check STAGE / --stage ' +
        'and the database this process is pointed at before re-running.',
    'production-requires-flag':
        'this is the PRODUCTION stage, and the food catalog is a shared, live service. A reseed mints FRESH ' +
        'ULIDs, so every recipe-side food_id must already have been unlinked (U12a). Re-run with --allow-prod ' +
        'once that is true.',
    'production-flag-off-production':
        '--allow-prod was given on a stage that is not production. The flag is rejected rather than ignored ' +
        'so it cannot become something an operator types by habit.',
    'target-confirmation-missing':
        'no --confirm-target was given. --stage and --confirm are both YOUR words, checked against each ' +
        'other; nothing in them names the database this process actually opened, and a reseed mints FRESH ' +
        'ULIDs into it. Re-run with --dry-run and pass back the target it prints.',
    'target-mismatch':
        'the --confirm-target you gave is not the database this process actually opened — the guard that ' +
        'catches a production stage declared against a sandbox connection, and the reverse. Run --dry-run ' +
        'and paste the target it reports rather than retyping it from memory.',
    'stage-database-mismatch':
        'the stage you named and the database this connection reached cannot both be true: a pr-{N} stage ' +
        'belongs on a {base}_pr_{N} database and a named stage does not belong on a per-PR one (ADR-0006).',
    'no-dataset-enabled':
        'the catalog roster enables no dataset, so this run would import nothing and then fail its own ' +
        'post-condition. Check src/foods/seed/catalogDatasets.ts.',
};

/** Thrown when the destructive-operation guard declines to run — nothing has been read or written. */
export class CatalogReseedRefusedError extends Error {
    /** Which guard declined. */
    public readonly reason: ReseedRefusalReason;
    /** The stage the run was configured for. */
    public readonly stage: string;

    /**
     * @param reason - Which guard declined.
     * @param stage - The stage the run was configured for.
     */
    public constructor(reason: ReseedRefusalReason, stage: string, target?: string) {
        const observed = target === undefined ? '' : ` The connection actually reached ${target}.`;

        super(`Refusing to reseed the food catalog on stage "${stage}" — ${REFUSAL_EXPLANATIONS[reason]}${observed}`);
        this.name = 'CatalogReseedRefusedError';
        this.reason = reason;
        this.stage = stage;
        Object.setPrototypeOf(this, CatalogReseedRefusedError.prototype);
    }
}

/**
 * Type guard for {@link CatalogReseedRefusedError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a reseed refusal.
 */
export function isCatalogReseedRefusedError(error: unknown): error is CatalogReseedRefusedError {
    return error instanceof CatalogReseedRefusedError;
}

/**
 * Thrown when the reseed finished but the catalog it produced does not satisfy the reseed's own
 * post-condition.
 *
 * ⚠️ **The write has already happened.** Every failure is reported at once rather than the first one
 * found, because the operator cannot re-run the assertion against a rolled-back state — the full list is
 * all the diagnosis they get from this run.
 */
export class CatalogReseedUnverifiedError extends Error {
    /** Every violated check, in the order the post-condition evaluates them. */
    public readonly failures: readonly string[];

    /** @param failures - Every violated check. */
    public constructor(failures: readonly string[]) {
        super(
            `Food catalog reseed did not verify — ${failures.join('; ')}. Nothing was rolled back (a seed of ` +
                'thousands of foods is not one transaction), so the catalog is in the state described above. ' +
                'The import is idempotent: fix the cause and re-run.',
        );
        this.name = 'CatalogReseedUnverifiedError';
        this.failures = failures;
        Object.setPrototypeOf(this, CatalogReseedUnverifiedError.prototype);
    }
}

/**
 * Type guard for {@link CatalogReseedUnverifiedError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is an unverified reseed.
 */
export function isCatalogReseedUnverifiedError(error: unknown): error is CatalogReseedUnverifiedError {
    return error instanceof CatalogReseedUnverifiedError;
}
