'use client';

/**
 * @module cookingRead — what the cooking screen's read is, from the facts a route adapter has, and the hold that keeps a
 * cook on their step. The rules know nothing of TanStack, Clerk or the recipe service: an adapter hands over plain
 * facts, and `useCookingRead` hands back the `CookingScreenRead` the screen draws.
 */
import { isOwner, makeViewer, type RecipeDetail } from '@kitchensink/recipe-core';
import { useState } from 'react';

import type { CookingRecipe, CookingScreenRead } from './cookingViewProps.js';

/** The facts a route adapter holds about one recipe read. */
export interface CookingReadSource {
    readonly recipeId: string;
    /** Who is cooking, or `undefined` before the session says. A different subject is a different cook. */
    readonly subject: string | undefined;
    readonly recipe: CookingRecipe | undefined;
    /** Why the read has no recipe, when it failed: the recipe is gone, or the device is offline. */
    readonly failure: { readonly gone: boolean; readonly offline: boolean } | undefined;
    /** Whether the viewer is known, and whether they own the recipe. `ready` waits for the viewer. */
    readonly viewer: { readonly known: boolean; readonly isOwner: boolean };
    readonly retry: () => void;
}

/**
 * What the read is.
 *
 * @param source - The facts the adapter holds.
 * @returns `ready` for a recipe whose viewer is known; else `gone` or `failed` for a failure with no recipe; else
 *     `pending`. Pure.
 */
export function cookingReadOf({ recipe, failure, viewer, retry }: CookingReadSource): CookingScreenRead {
    if (recipe !== undefined && viewer.known) {
        return { kind: 'ready', recipe, viewerIsOwner: viewer.isOwner };
    }

    if (recipe === undefined && failure !== undefined) {
        return failure.gone ? { kind: 'gone' } : { kind: 'failed', offline: failure.offline, retry };
    }

    return { kind: 'pending', retry };
}

/**
 * The read facts for a recipe the query has settled: the one place the two route adapters turn a recipe and a viewer into
 * a {@link CookingReadSource}, so who owns the recipe is decided once.
 *
 * @param recipe - The settled recipe.
 * @param viewer - Who is looking, by the detail page's one viewer rule, and whether that is known yet.
 * @param retry - Reads the recipe again.
 * @param failure - Why the query's LAST read failed, when it did: the cache still holds the earlier recipe, but a read
 *     that failed has nothing current to cook (po P10: after leaving, the cook link shows gone or failed). The hold in
 *     {@link useCookingRead} keeps a cook already on a step, so only a fresh mount sees the failure.
 * @returns The facts for {@link useCookingRead}. Pure.
 */
export function cookingReadSourceOf(
    recipe: RecipeDetail,
    viewer: { readonly id: string | undefined; readonly known: boolean },
    retry: () => void,
    failure?: CookingReadSource['failure'],
): CookingReadSource {
    return {
        recipeId: recipe.id,
        subject: viewer.id,
        recipe:
            failure === undefined
                ? { id: recipe.id, title: recipe.title, status: recipe.status, steps: recipe.steps }
                : undefined,
        failure,
        viewer: {
            known: viewer.known,
            isOwner: viewer.known && viewer.id !== undefined && isOwner(recipe, makeViewer({ id: viewer.id })),
        },
        retry,
    };
}

/** The key one cook's session of one recipe is held under. */
const holdKeyOf = ({ recipeId, subject }: CookingReadSource): string => `${recipeId}|${subject ?? ''}`;

/**
 * The read for the screen, with the first `ready` held. A cook on a step keeps cooking when a refetch returns a draft,
 * blank steps, a missing recipe or a failure (S20, R-15); the hold lets go only when the recipe or the cook changes.
 *
 * @pattern Adapter — the route's plain facts to the screen's read, with the hold over the pure {@link cookingReadOf}
 * @param source - The facts the adapter holds, on every render.
 * @returns The read to draw.
 */
export function useCookingRead(source: CookingReadSource): CookingScreenRead {
    const key = holdKeyOf(source);
    const read = cookingReadOf(source);
    const [held, setHeld] = useState<{ readonly key: string; readonly read: CookingScreenRead } | null>(null);

    // State replaced during render when the first ready for a key arrives; no ref, no effect.
    if (read.kind === 'ready' && held?.key !== key) {
        setHeld({ key, read });

        return read;
    }

    return held?.key === key ? held.read : read;
}
