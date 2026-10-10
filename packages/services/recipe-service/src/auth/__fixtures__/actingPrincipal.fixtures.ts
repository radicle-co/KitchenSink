/**
 * Fixture factory for an {@link ActingPrincipal} — the owner key plus ADR-0040's containment facts.
 *
 * Defaults to a REAL principal on an ENFORCING stage: the production case, in which containment must change nothing.
 * A suite about containment overrides `principalKind` / `containment` explicitly, so the case it is about is visible
 * at the call site.
 */
import type { ActingPrincipal } from '../principal.js';

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
