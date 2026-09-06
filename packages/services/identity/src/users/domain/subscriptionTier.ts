/**
 * A viewer's subscription tier, derived from the ONE authority the system already had for every other
 * grant: the Clerk-signed token's `public_metadata`.
 *
 * ## Why this is a derivation and not a column read
 *
 * `accounts.subscription_tier` exists, defaults to `'free'`, and is written by nothing — no production
 * caller of `updateSubscriptionTier`, no `subscription.*` webhook handler, and an account insert that never
 * sets it. Meanwhile `recipe-service` decides the same question from `permissions` (its
 * `PREMIUM_PERMISSION`). Two authorities for one fact, disagreeing totally rather than occasionally: the
 * apps could never offer the private-recipe option to anyone, while the service would have accepted the
 * write, and the profile screen told a premium viewer they were free.
 *
 * Grants in this system come from the signed token — admin scopes, ADR-0023's `recipes:import:public`
 * field-level grant, every `permissions`/`scopes` read in three services. Tier now joins them, which is the
 * smaller and more consistent of the two available reconciliations: the alternative puts a cross-service DB
 * read on a hot authorization path, and 005's dependency graph already recorded that read as an
 * unrepresentable defect rather than a design.
 *
 * ⚠️ This does NOT decide how a tier is SOLD. When billing arrives it writes the grant into Clerk's
 * `public_metadata`, exactly as an admin scope is granted today, and every consumer here is already correct.
 * The column is left in place, unread, for that decision to settle rather than being dropped by a change
 * whose subject is the divergence.
 */
import type { AccountTier } from '../../types/account.js';

/**
 * The permission that grants premium.
 *
 * ⛔ It MUST stay the literal `recipe-service`'s `PREMIUM_PERMISSION` reads. The two services are the two
 * halves of one contract, and a divergence shows up as a UI offering an option the service refuses —
 * asserted in `__tests__/subscriptionTier.test.ts`.
 */
export const PREMIUM_PERMISSION = 'premium';

/**
 * The tier the given signed permissions grant. Pure.
 *
 * Exact membership, never a substring test: a prefix match would make `premium:trial` an entitlement, the
 * same class of bug the delimiter-aware `pr-{N}` matcher exists to prevent elsewhere in this repository.
 */
export function subscriptionTierFor(permissions: readonly string[] | undefined): AccountTier {
    return (permissions ?? []).includes(PREMIUM_PERMISSION) ? 'premium' : 'free';
}
