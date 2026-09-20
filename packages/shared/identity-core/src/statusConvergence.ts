/**
 * What it means for an identity's provider state to be OWED (plan U10, R26/R27).
 *
 * ⛔ Pure, and shared, because two very different readers must agree on it: the deletion worker settles the
 * pair, and the U12 backstop escalates rows where it is still unequal. A predicate spelled twice is the drift
 * that makes a backstop report work nobody owes, or miss work somebody does.
 */

/** The fields of a user row this predicate reads — nothing else, so it cannot grow a dependency on the ORM. */
export interface StatusConvergenceState {
    /** The intent: incremented in the same transaction as every status change. */
    readonly statusVersion: number;
    /** The version the identity provider was last brought to. */
    readonly statusAppliedVersion: number;
    /** The account's lifecycle status. */
    readonly status: string;
}

/**
 * Whether the identity provider still owes this account a change.
 *
 * ⛔ AN ERASED ACCOUNT IS NEVER OWED, whatever the versions say, and the exclusion is explicit rather than
 * implied. Erasure has its own path — it deletes at Clerk and fans out to recipe and food — so converging an
 * erased identity would either fail against a deleted Clerk user or resurrect state the erasure removed.
 * Relying on the versions happening to match would make that safety an accident of bookkeeping.
 *
 * @param state - The user's version pair and status.
 * @returns Whether a closure or reactivation is still outstanding at the provider. Pure.
 */
export function providerChangeIsOwed(state: StatusConvergenceState): boolean {
    if (state.status === 'erased') {
        return false;
    }

    return state.statusAppliedVersion !== state.statusVersion;
}
