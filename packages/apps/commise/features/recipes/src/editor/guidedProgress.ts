'use client';

/**
 * @module @commise/features-recipes/editor — whether the editor guides a first recipe (build spec §7.2 "Guided
 * progress"; owner decision D1): the cook has NEVER PUBLISHED. It is read from the library for real, never from a cache
 * entry that happens to be warm — opened from Home, by URL or after a reload the key is cold, and a cache-only read
 * answered "not first" for exactly the cooks the guidance is for.
 *
 * The answer is latched at the first settled read. The create the editor itself sends invalidates the library, and a
 * refetch that now lists the cook's own draft must not take the guidance away mid-session.
 */
import { RecipeStatus } from '@kitchensink/recipe-core';
import { recipeQueries, type LibraryChunk } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * Whether a library chunk proves the cook has never published. "Published" is `firstPublishedAt` (ADR-0058: a
 * published recipe set back to a draft keeps it) or a published `status`. Past the first chunk the answer is unknown,
 * so it is no.
 *
 * @param chunk - The first chunk of the library.
 * @returns `true` only when no recipe in the whole library is published. Pure.
 */
export function neverPublished(chunk: LibraryChunk): boolean {
    if (chunk.hasMore) {
        return false;
    }

    return !chunk.data.some(
        (recipe) => recipe.firstPublishedAt !== undefined || recipe.status === RecipeStatus.PUBLISHED,
    );
}

/**
 * Whether the editor guides a first recipe: `false` until the library read settles, then fixed for the session.
 *
 * @returns The latched answer. A failed read never guides.
 * @sideEffect Reads the library (a real query, so a cold cache is fetched).
 */
export function useGuidedFirstRecipe(): boolean {
    const client = useRecipeServiceClient();
    const read = useInfiniteQuery(recipeQueries(client).library({ sortBy: 'updatedAt' }));
    const [latched, setLatched] = useState<boolean | undefined>(undefined);
    const firstChunk = read.data?.pages[0];

    // React's own derived-state pattern: the first settled chunk fixes the answer, and no later render changes it.
    if (latched === undefined && firstChunk !== undefined) {
        setLatched(neverPublished(firstChunk));
    }

    return latched ?? false;
}
