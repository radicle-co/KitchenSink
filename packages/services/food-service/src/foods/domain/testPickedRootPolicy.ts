/**
 * What a TEST PRINCIPAL's remote pick leaves behind, and when its purge may take it back (ADR-0040, food half; owner
 * ruling 2026-10-16: "Clean up test-picked foods").
 *
 * A remote pick turns a source's hit into a new CATALOG root (ADR-0055 point 4). That root then hides the hit for
 * everyone, so a fixed pool slot that picks the same word on every run meets a hidden hit on every run after the
 * first. The purge removes such a root, and only such a root: this module is the one place that says which.
 *
 * @pattern Specification — three pure questions over facts the DAO reads: who a creation is attributed to, who holds
 *   a root, and whether one root may be deleted. No DB, no request, no I/O, so each rule is a truth table.
 *
 * ## ⛔ The rule is "created by this caller, and relied on by nobody else"
 *
 * A catalog root has no author (`food.user_id IS NULL` defines it), so attribution lives in its own table, written
 * only when a TEST PRINCIPAL's pick CREATES a root. A real cook's root is never recorded and so can never be named
 * by the purge. A root is marked held when ANY answer that names it reaches anyone but a test principal: a pick, a
 * search hit, an add or batch answer, a read by id, a resolve, a recipe line's ref check. Food-service cannot see
 * which recipes bind a food id, so "a real cook was told this id" is the only fact it can hold, and it is written
 * BEFORE the answer leaves (`answeredRoots.ts`). A held root is kept: a normal cook's flow may now depend on it.
 *
 * An answer no principal shaped (the shared catalog search, which the edge serves to every caller from one cached
 * body) holds as a real cook's does: its audience is not knowable, and a test principal that reads it loses only the
 * cleanup of that one root.
 */
import {
    isServicePrincipalSub,
    resolveRequesterId,
    type AuthenticatedPrincipal,
} from '../../auth/authenticatedPrincipal.js';

/** The facts the creation attribution reads. */
export type AttributionInput = Pick<AuthenticatedPrincipal, 'sub' | 'userId' | 'testPrincipal'>;

/** The one fact a hold reads. */
export type HoldInput = Pick<AuthenticatedPrincipal, 'testPrincipal'>;

/** Who an answer went to: a verified principal, or `undefined` for an answer no principal shaped. */
export type AnswerAudience = HoldInput | undefined;

/** What the purge reads about one attributed root. */
export interface PickedRootFacts {
    /** The test principal's app-user ULID that created the root. */
    readonly createdBy: string;
    /** A real cook has answered this root since. */
    readonly heldByRealUser: boolean;
    /** `food.user_id`: `null` for a catalog root. */
    readonly authorId: string | null;
    /** `food_item.seed_owned`: the curated seed owns the item. */
    readonly seedOwned: boolean;
    /** A `food_variant` hangs off the root (its foreign key does not cascade). */
    readonly hasVariants: boolean;
    /** `food.status`. */
    readonly status: string;
}

/**
 * The test principal a created root is attributed to. Pure and total.
 *
 * @param principal - The verified principal's `sub`, `userId` and `testPrincipal` claim.
 * @returns The principal's app-user ULID when it is a signed test principal that is a person with a synced ULID;
 *   otherwise `undefined`, and nothing is recorded.
 */
export function attributionOf(principal: AttributionInput): string | undefined {
    // A named service principal owns no root: whatever its token claims, it is not a person with a pool slot.
    if (principal.testPrincipal !== true || isServicePrincipalSub(principal.sub)) {
        return undefined;
    }

    const resolution = resolveRequesterId(principal);

    return resolution.status === 'resolved' ? resolution.requesterId : undefined;
}

/**
 * Whether an answer places a hold on the roots it names. Pure.
 *
 * @param audience - The verified principal's `testPrincipal` claim, or `undefined` for an answer no principal shaped.
 * @returns `true` for anyone who is not a test principal, and for an answer whose audience is not knowable.
 */
export function marksRealHold(audience: AnswerAudience): boolean {
    return audience?.testPrincipal !== true;
}

/**
 * Whether the caller's purge may delete this root. Pure and total.
 *
 * A mid-erasure root is the erasure protocol's until it completes. Every other status is deletable: a picked root
 * that the reader still sees as `PENDING` or `FAILED` is no safer to keep than a `RESOLVED` one.
 *
 * @param facts - What the DAO read about the attributed root.
 * @param callerId - The calling test principal's app-user ULID.
 * @returns `true` only for the caller's own creation that no one else, and no seed, depends on.
 */
export function isPurgeablePickedRoot(facts: PickedRootFacts, callerId: string): boolean {
    return (
        facts.createdBy === callerId &&
        !facts.heldByRealUser &&
        facts.authorId === null &&
        !facts.seedOwned &&
        !facts.hasVariants &&
        facts.status !== 'DELETING'
    );
}
