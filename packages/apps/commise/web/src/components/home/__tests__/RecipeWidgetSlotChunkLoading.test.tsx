// @vitest-environment jsdom
/**
 * The slot's code-split seam, with the REAL `next/dynamic` (the sibling `RecipeWidgetSlot.test.tsx` replaces it so
 * the data states stay deterministic, which hides this seam). Once the recent-recipes read has resolved the slot's
 * `<Suspense>` fallback is gone, but the widget's chunk may still be loading. `next/dynamic` with `ssr: false` and no
 * `loading` committed a BLANK frame there, so Home showed skeleton, then nothing, then the widget, and the page
 * shifted. The block must show its loading card until the widget replaces it.
 *
 * `next/dynamic` builds its lazy proxy once per module, so the chunk is deferred once for the whole file: ONE test
 * walks pending → resolved.
 */
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { recipeHomeWidgetDescriptor } from '@commise/features-recipes';
import { renderWithRecipeClient } from '@commise/test-utils';
import type { Recipe } from '@kitchensink/recipe-core';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { RecipeWidgetSlot } from '../RecipeWidgetSlot';

afterEach(cleanup);

const recipe: Recipe = {
    id: 'rec_1',
    ownerId: 'usr_1',
    title: 'Weeknight Pasta',
    description: 'A quick dinner',
    prepTimeMinutes: 10,
    cookTimeMinutes: 15,
    totalTimeMinutes: 25,
    servings: 2,
    difficulty: 'medium',
    visibility: 'private',
    status: 'published',
    sourceType: 'user_created',
    hasSubstantiveEdit: false,
    dietaryFlags: [],
    tags: ['dinner'],
    currentVersion: 1,
    averageRating: 4.5,
    ratingCount: 12,
    usesPremiumCapability: true,
    coverPhotoUrl: 'https://cdn.commise.app/recipes/rec_1/cover.jpg',
    createdAt: '2026-04-18T12:00:00.000Z',
    updatedAt: '2026-04-19T09:30:00.000Z',
};

describe('RecipeWidgetSlot widget chunk (real next/dynamic)', () => {
    it('keeps the loading card, never a blank block, between the read resolving and the chunk arriving', async () => {
        let resolveChunk!: (module: Awaited<ReturnType<typeof recipeHomeWidgetDescriptor.load>>) => void;
        const chunk = new Promise<Awaited<ReturnType<typeof recipeHomeWidgetDescriptor.load>>>((resolve) => {
            resolveChunk = resolve;
        });
        vi.spyOn(recipeHomeWidgetDescriptor, 'load').mockImplementation(() => chunk);
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'listRecipes').mockResolvedValue({
            data: [recipe],
            total: 1,
            page: 1,
            pageSize: 1,
            hasMore: false,
        });

        await act(async () => {
            renderWithRecipeClient(<RecipeWidgetSlot />, client);
        });

        // The read has resolved; the chunk has not.
        expect(screen.getByText('Recent recipes')).toBeTruthy();
        expect(screen.getByRole('status').textContent).toContain('Loading recipes');
        expect(screen.getByRole('link', { name: 'See all recipes' })).toBeTruthy();
        expect(screen.queryByText('Weeknight Pasta')).toBeNull();

        await act(async () => {
            resolveChunk(
                await vi.importActual<Awaited<ReturnType<typeof recipeHomeWidgetDescriptor.load>>>(
                    '@commise/features-recipes/widget/web',
                ),
            );
        });

        expect(screen.getByText('Weeknight Pasta')).toBeTruthy();
        expect(screen.queryByRole('status')).toBeNull();
    });
});
