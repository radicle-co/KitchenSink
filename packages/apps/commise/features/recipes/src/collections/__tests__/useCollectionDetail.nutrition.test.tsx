/**
 * `useCollectionDetail` — the deferred calorie lookup's WHICH ids (ADR-0021 §6), moved here from mobile's
 * `screenNutrition.native.test.tsx`, whose mock of the hooks barrel the shared session no longer reaches (web's
 * `CollectionDetailContainer.nutrition.test.tsx` keeps its end-to-end cases): the batch covers EVERY member, as ONE
 * page. The window of members shown grows on tap, and batching it would re-batch on every "load more" and blink the
 * figures already on screen back to skeletons.
 *
 * The lookup hook is doubled so the ids it is given are what is asserted; its own behaviour is
 * `useRecipeNutritionBatches.test.tsx`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import type { CollectionWithRecipes } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { SnackbarHost } from '@commise/ui/snackbar';
import type { FC, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCollectionDetail } from '../useCollectionDetail.js';

const { nutritionMock } = vi.hoisted(() => ({ nutritionMock: vi.fn() }));

vi.mock('../../hooks/useRecipeNutritionBatches.js', () => ({ useRecipeNutritionBatches: nutritionMock }));

beforeEach(() => {
    nutritionMock.mockReset().mockReturnValue(() => null);
});

const collectionOf = (ids: readonly string[]): CollectionWithRecipes => ({
    id: 'col_1',
    ownerId: 'usr_1',
    name: 'Dinners',
    visibility: RecipeVisibility.PUBLIC,
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-01T09:00:00.000Z',
    recipes: ids.map((id) => ({ id, title: id }) as CollectionWithRecipes['recipes'][number]),
});

function render(collection: CollectionWithRecipes) {
    const client = createFakeRecipeServiceClient();
    const queryClient = new QueryClient();
    const wrapper: FC<{ readonly children: ReactNode }> = ({ children }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <SnackbarHost>{children}</SnackbarHost>
            </RecipeServiceProvider>
        </QueryClientProvider>
    );

    return renderHook(
        () =>
            useCollectionDetail({
                collection,
                refreshNotice: undefined,
                paidFeatures: 'granted',
                viewChoice: 'list',
                onViewChoice: vi.fn(),
                nav: { onDeleted: vi.fn(), onCloned: vi.fn(), onCreateRecipe: vi.fn() },
            }),
        { wrapper },
    );
}

describe('useCollectionDetail — which ids the calorie lookup batches', () => {
    it('batches EVERY member as ONE page', () => {
        const ids = Array.from({ length: 12 }, (_unused, index) => `rec_${index}`);

        render(collectionOf(ids));

        expect(nutritionMock).toHaveBeenCalledWith([ids]);
    });
});
