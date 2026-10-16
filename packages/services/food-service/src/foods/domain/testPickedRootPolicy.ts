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
 * by the purge. A root a real cook later answers (a pick of the same item, or of a hit the root now hides) is marked
 * held, and a held root is kept: a normal cook's flow may now depend on it.
 *
 * ⚠️ What this cannot see: a real cook who binds the root through an ordinary catalog search hit calls no pick, so
 * nothing marks it. The residual exposure is a non-production stage where test and real traffic share a catalog.
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
 * Whether the caller's answer places a hold on the root it was answered. Pure.
 *
 * @param principal - The verified principal's `testPrincipal` claim.
 * @returns `true` for anyone who is not a test principal.
 */
export function marksRealHold(principal: HoldInput): boolean {
    return principal.testPrincipal !== true;
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
