/**
 * @module RecentRecipeGrid.card — the design-system card of the RecentRecipeGrid in its compact variant, at phone
 * width: rated, premium, private and draft recipes.
 */
import type { ComponentProps } from 'react';

import type { RecentRecipeGrid } from '@commise/features-recipes';

import { defineCard } from '../../../../src/cards/defineCard.js';

type RecipeSummary = ComponentProps<typeof RecentRecipeGrid>['recipes'][number];

const noop = (): void => undefined;

function recipe(id: string, title: string, overrides: Partial<RecipeSummary>): RecipeSummary {
    return {
        id,
        title,
        totalTimeMinutes: 45,
        servings: 4,
        ratingCount: 0,
        usesPremiumCapability: false,
        updatedAt: '2026-10-14T18:00:00.000Z',
        createdAt: '2026-10-01T18:00:00.000Z',
        tags: [],
        currentVersion: 1,
        visibility: 'public',
        status: 'published',
        ...overrides,
    };
}

const recipes = [
    recipe('r1', 'Weeknight lemon pasta', {
        totalTimeMinutes: 25,
        difficulty: 'easy',
        averageRating: 4.6,
        ratingCount: 38,
        cuisine: 'Italian',
    }),
    recipe('r2', 'Sunday sourdough loaf', {
        totalTimeMinutes: 480,
        servings: 2,
        difficulty: 'hard',
        averageRating: 4.9,
        ratingCount: 112,
        updatedAt: '2026-10-15T09:00:00.000Z',
    }),
    recipe('r3', 'Smoky chickpea stew', { difficulty: 'medium', usesPremiumCapability: true, visibility: 'private' }),
    recipe('r4', 'Lemon tart', { status: 'draft', servings: 8 }),
];

export default defineCard({
    group: 'Recipes',
    height: 520,
    platforms: 'both',
    uses: ['RecentRecipeGrid'],
    staging: { phoneViewport: true },
    render: ({ RecentRecipeGrid }, { platform }) => (
        <div className="col" style={{ maxWidth: 358 }}>
            <RecentRecipeGrid
                recipes={recipes}
                variant="compact"
                onSelectRecipe={noop}
                {...(platform === 'web' ? { hrefOf: (id: string) => `#${id}` } : {})}
            />
        </div>
    ),
});
