'use client';

/**
 * @module @commise/features-recipes/actions - what a recipe surface decides Private from (ADR-0073): the recipe's rule, the
 * cook's slot standing, and the refusal that is KNOWN.
 *
 * The standing is read from the server (`usePrivateSlots`), because the number and the limit are the server's alone. The
 * read is asked only under the slots rule: an imported public-web recipe is decided by Premium, and a count would be
 * fetched for nothing.
 *
 * ⛔ A DISPLAY FACT. A loading or failed read is never a refusal (`recipePrivateRefusalOf`): the write goes out and the
 * server decides it under its own lock.
 *
 * @pattern Adapter - the private-slots query to the pure rule's vocabulary (`slotStandingOf`)
 */
import type { PaidFeatureState } from '@commise/features-account';
import type { RecipeSourceType } from '@kitchensink/recipe-core';
import { usePrivateSlots } from '@kitchensink/recipe-service-client/hooks';

import type { PrivateRefusal } from './privateGate.js';
import {
    privateRuleOf,
    recipePrivateRefusalOf,
    slotStandingOf,
    usesSlots,
    type PrivateRule,
    type SlotStanding,
} from './recipePrivateGate.js';

/** Options for {@link useRecipePrivate}. */
export interface UseRecipePrivateOptions {
    /** The recipe's label, `undefined` for one never saved. */
    readonly sourceType: RecipeSourceType | undefined;
    /** The profile's own answer (`knownPaidFeaturesOf`): `undefined` while unknown, a failed read included. */
    readonly knownPaidFeatures: Exclude<PaidFeatureState, 'loading'> | undefined;
}

/** What the editor session and surface are wired with. */
export interface RecipePrivate {
    readonly rule: PrivateRule;
    readonly standing: SlotStanding;
    /** Why the server is KNOWN to refuse a change to private for this cook, if it is: what the editor must not send. */
    readonly refusal: PrivateRefusal | undefined;
}

/**
 * The Private facts for one recipe surface.
 *
 * @param options - The recipe's label and the profile's own answer.
 * @returns The rule, the standing and the known refusal.
 * @sideEffect Subscribes to `GET /api/v1/recipes/private-slots` under the slots rule.
 */
export function useRecipePrivate(options: UseRecipePrivateOptions): RecipePrivate {
    const rule = privateRuleOf(options.sourceType);
    const usage = usePrivateSlots({ enabled: usesSlots(rule) });
    const standing = usesSlots(rule) ? slotStandingOf(usage.data, usage.isPending) : ({ kind: 'unknown' } as const);

    return {
        rule,
        standing,
        refusal: recipePrivateRefusalOf({ rule, standing, state: options.knownPaidFeatures ?? 'loading' }),
    };
}
