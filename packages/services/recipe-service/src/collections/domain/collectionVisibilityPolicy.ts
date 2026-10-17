/**
 * The pure collection-visibility policy (owner 2026-10-13): a PRIVATE collection is a Premium feature.
 *
 * @pattern Specification — the sibling of `recipes/domain/visibilityPolicy.ts` (same inputs-only, decision-out shape),
 *   deliberately a policy module and not a route Guard: `POST /api/v1/collections` stays open to every authenticated
 *   cook, and what is authorized is a FIELD VALUE (ADR-0023's reasoning). It is the ONE place the collection tier rule
 *   lives, so a future paid-feature gate or role set is added here without touching the service.
 *
 * Rules:
 * - `public` is allowed for everyone (containment's refusal of a contained principal's publish stays in the service).
 * - `private` is allowed for a premium cook; for a free-tier cook only when the collection is ALREADY private (the
 *   gate is on the transition TO private, never on existing state, as for recipes after a premium lapse).
 * - A contained test principal may always be private: containment forbids it publishing, so refusing private on tier
 *   would leave it no legal state. This is a deliberate difference from the recipe matrix.
 * - The default (no visibility requested) is private for a premium cook and public for a free-tier one; a contained
 *   principal's default is always private.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';

import { isContained, type ContainmentSubject } from '../../common/containmentPolicy.js';

/** What is known about who is acting, for a collection visibility decision. */
export interface CollectionVisibilitySubject extends ContainmentSubject {
    /** Whether the acting principal holds the premium entitlement. */
    readonly isPremium: boolean;
}

/** The complete input to a collection visibility decision. */
export interface CollectionVisibilityInput extends CollectionVisibilitySubject {
    /** The visibility being requested. */
    readonly requested: RecipeVisibility;
    /** The collection's current visibility, when it already exists (an update). */
    readonly current?: RecipeVisibility;
}

/** Allowed, or denied with a human-readable reason (surfaced as the error message). */
export type CollectionVisibilityDecision =
    { readonly allowed: true; readonly reason: string } | { readonly allowed: false; readonly reason: string };

/**
 * The visibility a new collection gets when the request names none. Pure.
 *
 * @param subject - Who is creating it.
 * @returns `private` for a premium or contained cook, `public` for a free-tier one.
 */
export function defaultCollectionVisibility(subject: CollectionVisibilitySubject): RecipeVisibility {
    if (isContained(subject) || subject.isPremium) {
        return RecipeVisibility.PRIVATE;
    }

    return RecipeVisibility.PUBLIC;
}

/**
 * Whether a collection may hold the requested visibility. Pure.
 *
 * @param input - The tier, containment facts, the request and (on update) the current visibility.
 * @returns The decision.
 */
export function evaluateCollectionVisibility(input: CollectionVisibilityInput): CollectionVisibilityDecision {
    if (input.requested === RecipeVisibility.PUBLIC) {
        return { allowed: true, reason: 'Any cook may make a collection public.' };
    }

    if (input.isPremium) {
        return { allowed: true, reason: 'Premium cooks may make a collection private.' };
    }

    if (isContained(input)) {
        return { allowed: true, reason: 'A contained test principal may only be private.' };
    }

    if (input.current === RecipeVisibility.PRIVATE) {
        return { allowed: true, reason: 'The collection is already private.' };
    }

    return { allowed: false, reason: 'Private collections are a Premium feature; upgrade to make this one private.' };
}
