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

/** Which server and database a connection actually reached, as the SERVER itself reports it. */
export interface DatabaseTarget {
    /** The server's address as the server reports it, or `local` for a unix-socket connection. */
    readonly host: string;
    /** The server's port. */
    readonly port: number;
    /** The database this connection is attached to. */
    readonly database: string;
    /** The role the connection authenticated as. */
    readonly user: string;
}

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
    /**
     * The target the operator typed back, in {@link describeTargetToken}'s form, or `undefined` when none was.
     *
     * ⛔ This is the field that makes the confirmation name the THING rather than the operator's belief about
     * it. `stage`/`confirm` above are both the operator's own words, checked against each other.
     */
    readonly confirmTarget?: string | undefined;
}

/** Why a task refused before writing anything. */
export type IntentRefusal =
    | 'production-flag-off-production'
    | 'confirmation-missing'
    | 'confirmation-mismatch'
    | 'production-requires-flag'
    | 'target-confirmation-missing'
    | 'target-mismatch'
    | 'stage-database-mismatch';

/**
 * A per-PR logical database, and the stage whose name it is derived from.
 *
 * Every service names its per-PR database `{base}_pr_{N}` from the `pr-{N}` stage (ADR-0006;
 * `foodDatabaseNameForStage`, `recipeDatabaseNameForStage`). The suffix is therefore a fact about the
 * database that can be compared against the stage WITHOUT the operator typing anything.
 */
const PER_PR_DATABASE = /_pr_(?<number>[0-9]+)$/u;

/** A per-PR stage: `pr-{N}`, the form the deploy pipeline and the teardown script both use. */
const PER_PR_STAGE = /^pr-(?<number>[0-9]+)$/u;

/**
 * The exact string an operator must type back to name the database this process actually opened.
 *
 * `database@host:port` — the three fields that distinguish one server's logical database from another's,
 * and every one of them comes from the SERVER (`current_database()`, `inet_server_addr()`,
 * `inet_server_port()`), never from the connection string the operator supplied.
 *
 * @param target - Where the connection landed.
 * @returns The token to print and to require. Pure.
 */
export function describeTargetToken(target: DatabaseTarget): string {
    return `${target.database}@${target.host}:${target.port}`;
}

/**
 * Refuse a run whose declared stage and actual database cannot both be true.
 *
 * @param stage - The stage the operator declared.
 * @param target - Where the connection landed.
 * @returns The refusal, or `undefined` when the pairing is possible. Pure.
 */
function refuseStageDatabaseMismatch(stage: string, target: DatabaseTarget): IntentRefusal | undefined {
    const stageNumber = PER_PR_STAGE.exec(stage)?.groups?.['number'];
    const databaseNumber = PER_PR_DATABASE.exec(target.database)?.groups?.['number'];

    return stageNumber === databaseNumber ? undefined : 'stage-database-mismatch';
}

/**
 * ⛔ BIND THE OPERATOR'S DECLARATION TO THE DATABASE THE PROCESS ACTUALLY OPENED (PR #91 review).
 *
 * `--stage` and `--confirm` are BOTH the operator's own words, checked against each other — so
 * `--stage prod --allow-prod --confirm prod` was accepted with `DATABASE_URL` pointed at sandbox, and the
 * destructive run then applied to whichever database the URL had really opened. The commands printed the
 * real target before proceeding and their own docstrings called that "the honest limit of the guard, made
 * visible"; a printed target is a courtesy, not a check, and nothing consumed it.
 *
 * Two mechanisms, in this order, and the order matters:
 *
 *  1. **The stage and the database must be able to be true together** — a `pr-{N}` stage belongs on a
 *     `_pr_{N}` database and a named stage does not belong on a per-PR one (ADR-0006). This needs no typing,
 *     so it also guards a DRY RUN: an impossible pairing is wrong before it is harmless, exactly as a
 *     misplaced `--allow-prod` is, and reporting on a run that could never be permitted is a lie of its own.
 *     It runs FIRST so an impossible pairing is never reported as a mistyped target.
 *  2. **A run that WRITES must name the target the server reported** ({@link describeTargetToken}). This is
 *     the half that catches prod-versus-sandbox, which mechanism 1 structurally cannot: both stages use the
 *     same logical database name (`kitchensink_food`), so only the host distinguishes them, and only the
 *     operator can say which one they meant. A dry run is never asked to type it — making a LOOK harder than
 *     a delete is how operators learn to skip the look.
 *
 * ⚠️ THE HOST IS DISCRIMINATING BECAUSE OF ADR-0002, not by luck: the per-stage VPC CIDRs put prod's RDS on
 * `10.0.x.x` and sandbox's on `10.1.x.x`, so the two can never report the same address. If those CIDRs are
 * ever collapsed into one range, mechanism 2 weakens to "same database name, same host" and this guard must
 * be revisited. ⚠️ And `inet_server_addr()` is a private IP, so an RDS failover between the dry run and the
 * destructive run invalidates the token — that fails CLOSED (the run is refused, and the message says to
 * re-run the dry run), which is the correct direction for a guard to break in.
 *
 * @param intent - What the operator supplied.
 * @param target - Where the connection landed, as the server reports it.
 * @returns The refusal, or `undefined` when the declaration is bound to the target. Pure.
 */
export function refuseUnboundTarget(intent: OperatorIntent, target: DatabaseTarget): IntentRefusal | undefined {
    const impossiblePairing = refuseStageDatabaseMismatch(intent.stage, target);

    if (impossiblePairing !== undefined) {
        return impossiblePairing;
    }

    if (intent.dryRun) {
        return undefined;
    }

    if (intent.confirmTarget === undefined) {
        return 'target-confirmation-missing';
    }

    return intent.confirmTarget.trim() === describeTargetToken(target) ? undefined : 'target-mismatch';
}

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
