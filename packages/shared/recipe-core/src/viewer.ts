/**
 * @module @kitchensink/recipe-core/viewer — the `Viewer` value object (P4).
 *
 * `Viewer` is the single, immutable value object the access-policy predicates (`recipeAccessPolicy.ts`) read — a
 * branded, OPTIONAL {@link UserId}, absent for a signed-out/unresolved viewer. Both web and mobile build one via
 * {@link makeViewer}, so the two platforms can never diverge on what a "viewer" means to the shared predicates.
 *
 * ⛔ It carries NO tier. A tier here was the second authority for "may this viewer use a paid feature": the clients
 * read it from `account.subscriptionTier` while the services read a token grant. A client now renders paid features
 * and upsells from identity's `account.paidFeatures` alone, and the services authorize from roles (plan
 * `docs/plans/2026-10-14-009-feat-roles-and-paid-gate-plan.md` D15).
 */
import { userId, type UserId } from './ids.js';

/** The authenticated (or anonymous) actor the access-policy predicates evaluate against. Immutable. */
export interface Viewer {
    /** The viewer's app-user ULID, or ABSENT for a signed-out/unresolved viewer. Never a bare string. */
    readonly id?: UserId;
}

/**
 * Build a {@link Viewer} from a platform's raw identity signal. Never throws: an empty/invalid `id` is treated as
 * absent (a malformed id must never accidentally satisfy an ownership check downstream) rather than raising. Pure.
 *
 * @param params - The raw viewer id (optional).
 * @returns The resulting {@link Viewer}.
 */
export function makeViewer(params: { id?: string }): Viewer {
    if (params.id === undefined || params.id.length === 0) {
        return {};
    }

    return { id: userId(params.id) };
}
