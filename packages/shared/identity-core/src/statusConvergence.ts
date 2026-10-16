/**
 * What it means for an identity's provider to still OWE an erased account a deletion (plan U10, R26/R27).
 *
 * Closure and reactivation (a ban or an unban) are NOT decided here: their rule is the `status_applied_version
 * IS DISTINCT FROM status_version AND status <> 'erased'` predicate of migration 0014's partial index, spelled
 * once in the U12 backstop's read (`IDENTITY_OWED_SQL`, identity-webhooks `queueCheck.ts`) and excluding erased
 * rows. {@link providerDeletionIsOwed} covers exactly those erased rows, so every account has one owner of its
 * provider debt and none has two.
 */

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
 * account is supposed to exist. The convergence read excludes erased rows because THIS predicate owns them.
 *
 * @param state - The user's status and provider-deletion confirmation.
 * @returns Whether a provider deletion is still outstanding. Pure.
 */
export function providerDeletionIsOwed(state: ProviderDeletionState): boolean {
    return state.status === 'erased' && state.providerDeletedAt === null;
}
