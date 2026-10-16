/**
 * @module @commise/features-recipes/detail — the recipe page's pure decisions, shared by both apps' controllers: who the
 * viewer is, whether the page knows enough to draw its body, which primary the action row offers, and how a rating
 * write's failure is named. Each was written twice, once per app, and the two copies had drifted on the first two.
 *
 * @pattern Specification — pure predicates and picks over facts the page already holds
 */
import { isNotFoundError } from '@kitchensink/recipe-service-client';

import type { RecipeRatingError } from '../rating/model.js';

/**
 * The viewer's app-user id as the signed session token states it: the `external_id` claim, the recipe service's own owner
 * key. Pure.
 *
 * ⛔ An empty string is ABSENT, not an id: it would name nobody and still win over the profile.
 *
 * @param sessionClaims - Clerk's session claims (untyped: `external_id` is a custom claim).
 * @returns The id, or `undefined` when the claim is missing, empty or not a string.
 */
export function claimedViewerIdOf(sessionClaims: unknown): string | undefined {
    if (typeof sessionClaims !== 'object' || sessionClaims === null) {
        return undefined;
    }

    const externalId = (sessionClaims as Record<string, unknown>)['external_id'];

    return typeof externalId === 'string' && externalId.length > 0 ? externalId : undefined;
}

/**
 * The viewer's app-user id: the signed token's claim when it states one, else the profile's (owner ruling 2026-10-16;
 * the same rule on both platforms). Pure.
 *
 * @param claimed - The id from {@link claimedViewerIdOf}.
 * @param profileUserId - The profile read's `user.id`, while it has landed.
 * @returns The id, or `undefined` when neither names the viewer (a signed-out viewer).
 */
export function viewerIdOf(claimed: string | undefined, profileUserId: string | undefined): string | undefined {
    return claimed ?? profileUserId;
}

/**
 * Whether the page knows who is looking, so its body may draw. With a viewer id in hand there is nothing to wait for;
 * without one the profile may still name them, so the body waits for it to settle — and paints the owner's actions in
 * the same frame, never a non-owner page that corrects itself. Pure.
 *
 * ⛔ `isLoading`, not "pending": a signed-out viewer's profile query is disabled, so it is pending forever and only its
 * `isLoading` is false.
 *
 * @param viewerId - The id from {@link viewerIdOf}.
 * @param profileLoading - Whether the profile read is in flight.
 * @returns `true` when the body may show.
 */
export function viewerKnown(viewerId: string | undefined, profileLoading: boolean): boolean {
    return viewerId !== undefined || !profileLoading;
}

/** The facts the action row's primary is decided from. */
export interface PrimaryInput {
    readonly viewerIsOwner: boolean;
    readonly viewerCanClone: boolean;
}

/**
 * The action row's primary: Edit recipe for the owner, Save a copy for another cook who may clone, nothing otherwise.
 * Pure.
 *
 * @param input - The viewer's ownership and clone right.
 * @returns The primary, or `undefined` for none.
 */
export function primaryOf({ viewerIsOwner, viewerCanClone }: PrimaryInput): 'edit' | 'saveCopy' | undefined {
    if (viewerIsOwner) {
        return 'edit';
    }

    return viewerCanClone ? 'saveCopy' : undefined;
}

/**
 * How a failed rating write is named to the cook: a not-found (the client's 404 shape) is "not available" (Sc9), never a
 * distinct "forbidden"; anything else is generic. Pure.
 *
 * @param error - The set write's error, else the remove write's.
 * @returns The kind, or `undefined` when nothing failed.
 */
export function ratingErrorKindOf(error: unknown): RecipeRatingError | undefined {
    if (error === null || error === undefined) {
        return undefined;
    }

    return isNotFoundError(error) ? 'notAvailable' : 'generic';
}
