/**
 * What it means for an identity's provider state to be OWED (plan U10, R26/R27).
 *
 * ⛔ Pure, and shared, because two very different readers must agree on it: the deletion worker settles the
 * pair, and the U12 backstop escalates rows where it is still unequal. A predicate spelled twice is the drift
 * that makes a backstop report work nobody owes, or miss work somebody does.
 *
 * Two predicates live here, one per way the provider can owe an account something. {@link providerChangeIsOwed}
 * covers closure and reactivation (a ban or an unban) and deliberately excludes erased rows;
 * {@link providerDeletionIsOwed} covers exactly those erased rows, so every account has one owner of its
 * provider debt and none has two.
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

/** The fields of a user row {@link providerDeletionIsOwed} reads. */
export interface ProviderDeletionState {
    /** The account's lifecycle status. */
    readonly status: string;
    /** When the provider confirmed the account no longer exists, or `null` if it has not. */
    readonly providerDeletedAt: Date | null;
}

/**
 * Whether the identity provider still holds an account that an erasure said was destroyed.
 *
 * Only an `erased` row can owe this: closure bans rather than deletes, so a tombstoned account's provider
 * account is supposed to exist. This is the predicate {@link providerChangeIsOwed} hands erased rows to — it
 * excludes them because THIS one owns them.
 *
 * @param state - The user's status and provider-deletion confirmation.
 * @returns Whether a provider deletion is still outstanding. Pure.
 */
export function providerDeletionIsOwed(state: ProviderDeletionState): boolean {
    return state.status === 'erased' && state.providerDeletedAt === null;
}
