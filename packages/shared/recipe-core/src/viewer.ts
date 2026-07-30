/**
 * @module @kitchensink/recipe-core/viewer — the `Viewer` value object + `Tier` authority (P4).
 *
 * `Viewer` is the single, immutable value object the access-policy predicates (`recipeAccessPolicy.ts`)
 * read — a branded, OPTIONAL {@link UserId} (absent for a signed-out/unresolved viewer) plus a {@link Tier}
 * that always has a value (there is no "unknown tier" state; an unrecognized or absent subscription tier
 * maps to `'free'`, never left `undefined`, so every tier-gated predicate stays TOTAL). Both web and mobile
 * build a `Viewer` via {@link makeViewer} from their own platform-specific identity signal (Clerk session
 * claims on web, the profile query on mobile), so the two platforms can never diverge on what a "viewer"
 * means to the shared predicates.
 */
import { z } from 'zod';

import { userId, type UserId } from './ids.js';

/**
 * The subscription tier a viewer holds. `'premium'` unlocks tier-gated recipe capabilities (C-004); every
 * other/unknown value is `'free'`. This is the SINGLE tier authority — other tier vocabularies (e.g. the
 * Home-widget `'free' | 'pro'` ladder) map onto this one rather than re-deriving their own.
 */
export type Tier = 'free' | 'premium';

/**
 * Runtime validator for {@link Tier}.
 */
export const tierSchema = z.enum(['free', 'premium']);

/** Rank order of each {@link Tier}, lowest first — `free` (0) < `premium` (1). */
const TIER_RANK: Readonly<Record<Tier, number>> = { free: 0, premium: 1 };

/**
 * Rank of a {@link Tier} for a `>=` minimum-tier comparison (higher is more capable). Pure and total: every
 * `Tier` value has a rank, so a tier-gated predicate built on this can never throw or fall through.
 *
 * @param tier - The tier to rank.
 * @returns The tier's rank; `free` < `premium`.
 */
export function rankTier(tier: Tier): number {
    return TIER_RANK[tier];
}

/**
 * The authenticated (or anonymous) actor the access-policy predicates evaluate against. Immutable and
 * total: `tier` is never absent (an unresolved viewer is `'free'`, the least-privileged state — fail
 * closed), and `id` is absent exactly when the viewer is signed out or not yet resolved.
 */
export interface Viewer {
    /** The viewer's app-user ULID, or ABSENT for a signed-out/unresolved viewer. Never a bare string. */
    readonly id?: UserId;
    /** The viewer's subscription tier. Always present — fails closed to `'free'` (see {@link makeViewer}). */
    readonly tier: Tier;
}

/**
 * Map an arbitrary (possibly absent, possibly unrecognized) subscription-tier string onto the {@link Tier}
 * authority, failing CLOSED to `'free'` for anything that is not exactly `'premium'`. Pure.
 *
 * @param subscriptionTier - The raw subscription-tier signal (e.g. identity's `account.subscriptionTier`).
 * @returns `'premium'` iff the input is exactly `'premium'`; `'free'` otherwise (including absent/unknown).
 */
function toTier(subscriptionTier: string | undefined): Tier {
    return subscriptionTier === 'premium' ? 'premium' : 'free';
}

/**
 * Build a {@link Viewer} from a platform's raw identity signal. Never throws: an empty/invalid `id` is
 * treated as absent (a malformed id must never accidentally satisfy an ownership check downstream) rather
 * than raising, and an absent/unrecognized `subscriptionTier` fails closed to `'free'` (see {@link toTier}).
 * Pure.
 *
 * @param params - The raw viewer id (optional) and raw subscription-tier signal (optional).
 * @returns The resulting {@link Viewer}.
 */
export function makeViewer(params: { id?: string; subscriptionTier?: string }): Viewer {
    const tier = toTier(params.subscriptionTier);

    if (params.id === undefined || params.id.length === 0) {
        return { tier };
    }

    return { id: userId(params.id), tier };
}
