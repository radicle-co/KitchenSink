/**
 * Fixture factory for an {@link ActingPrincipal} — the owner key plus ADR-0040's containment facts.
 *
 * Defaults to a REAL principal on an ENFORCING stage: the production case, in which containment must change nothing.
 * A suite about containment overrides `principalKind` / `containment` explicitly, so the case it is about is visible
 * at the call site.
 */
import type { ActingPrincipal, TieredActingPrincipal } from '../principal.js';

/**
 * Build an acting principal for `userId`.
 *
 * @param userId - The owner key.
 * @param overrides - Any of the containment facts to change.
 * @returns The acting principal. Pure.
 */
export function makeActingPrincipal(
    userId: string,
    overrides: Partial<Omit<ActingPrincipal, 'userId'>> = {},
): ActingPrincipal {
    return { userId, principalKind: 'real', containment: 'enforce', ...overrides };
}

/**
 * Build a tier-aware acting principal for a write whose rule depends on the tier (a private collection).
 *
 * Defaults to PREMIUM so the suites that are about something else (membership, pull, clone seeding) keep working with
 * private collections; a suite about the tier rule sets `isPremium` explicitly, so the case it is about is visible.
 *
 * @param userId - The owner key.
 * @param overrides - Any of the containment facts or the tier.
 * @returns The tiered acting principal. Pure.
 */
export function makeCollectionsActor(
    userId: string,
    overrides: Partial<Omit<TieredActingPrincipal, 'userId'>> = {},
): TieredActingPrincipal {
    return { ...makeActingPrincipal(userId), isPremium: true, ...overrides };
}
