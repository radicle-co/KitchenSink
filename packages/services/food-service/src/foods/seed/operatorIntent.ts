/**
 * How an operator proves intent for a destructive task against a named stage.
 *
 * ## Why this is one piece of knowledge and not three similar-looking ones
 *
 * `clearCli`, `reseedCli` and recipe-service's `unlinkCli` each ask the same question before writing: has
 * the operator NAMED the stage, typed it back, and — for production — passed the extra flag? That is a
 * single policy with a single reason to change (the bar for proving intent), not three coincidentally
 * similar chains. U12a wrote it, U12b copied it, and U12a's own note said to extract at the third
 * occurrence. This is that extraction, for the two occurrences inside this package.
 *
 * ## ⚠️ Why it is TWO functions rather than one
 *
 * The chains are not identical: the reseed refuses an empty dataset roster BETWEEN the misplaced-flag check
 * and the dry-run check. Extracting the whole sequence would have moved that check to one end or the other,
 * silently changing which refusal an operator sees first — and adding a `skipDatasetCheck`-shaped parameter
 * to preserve it would be the flag-riddled shared helper that is worse than the duplication it replaces.
 *
 * So the shared knowledge is split at its real seam and each caller sequences its own preconditions:
 *
 * ```text
 * clear:  refuseMisplacedProdFlag() ?? decideConfirmation()
 * reseed: refuseMisplacedProdFlag() ?? refuseEmptyRoster() ?? decideConfirmation()
 * ```
 *
 * ## What is deliberately NOT shared
 *
 * recipe-service's `unlinkCli` keeps its own copy. Extracting across the service boundary needs a home
 * neither service owns — `recipe-core` is the recipe domain's types and an operator-CLI policy does not
 * belong in it — and inventing a package for ~20 lines buys less than it costs. The drift also fails SAFE:
 * the two halves of the reset are ordered so the clear aborts when the unlink refused, so a guard that
 * relaxed on one side alone cannot open a path. Each of the three docstrings names the other two.
 */

/** The stage name that means production, shared by both of this package's destructive tasks. */
export const PRODUCTION_STAGE = 'prod';

/** What an operator must supply to prove intent. */
export interface OperatorIntent {
    /** The deploy stage this process is pointed at, as DECLARED by the operator. */
    readonly stage: string;
    /** The stage name typed back, or `undefined` when none was. */
    readonly confirm: string | undefined;
    /** Whether the production escape hatch was passed. */
    readonly allowProd: boolean;
    /** Whether this run only reports. */
    readonly dryRun: boolean;
}

/** Why a task refused before writing anything. */
export type IntentRefusal =
    | 'production-flag-off-production'
    | 'confirmation-missing'
    | 'confirmation-mismatch'
    | 'production-requires-flag';

/**
 * Refuse a production flag passed anywhere but production.
 *
 * ⚠️ This is not pedantry. A flag that is harmless when wrong is a flag operators paste into every command
 * until it stops meaning anything, and it must still mean something the one time it is aimed at prod. Run
 * this FIRST, before the dry-run branch, so even a look-only run rejects the misplaced flag rather than
 * teaching the habit.
 *
 * @param intent - What the operator supplied.
 * @returns The refusal, or `undefined` when the flag is placed correctly. Pure.
 */
export function refuseMisplacedProdFlag(intent: OperatorIntent): IntentRefusal | undefined {
    return intent.allowProd && intent.stage !== PRODUCTION_STAGE ? 'production-flag-off-production' : undefined;
}

/**
 * Decide whether a run may write, only report, or must be refused.
 *
 * A dry run needs no confirmation on purpose: making a look harder than a delete is how operators learn to
 * skip the look.
 *
 * @param intent - What the operator supplied.
 * @returns `'report'` for a dry run, `'proceed'` when intent is proven, else the refusal. Pure.
 */
export function decideConfirmation(intent: OperatorIntent): 'report' | 'proceed' | IntentRefusal {
    if (intent.dryRun) {
        return 'report';
    }

    if (intent.confirm === undefined) {
        return 'confirmation-missing';
    }

    if (intent.confirm !== intent.stage) {
        return 'confirmation-mismatch';
    }

    if (intent.stage === PRODUCTION_STAGE && !intent.allowProd) {
        return 'production-requires-flag';
    }

    return 'proceed';
}
