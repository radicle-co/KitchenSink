/**
 * @module RecipeCard.card — the design-system card of the RecipeCard: two grid cards (a public one with a rating,
 * a private PRO one unrated), two rows (the second a draft with no facts) and a compact card, on both platforms.
 */
import type { RecipeCardModel } from '@commise/features-recipes';

import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

const daysAgo = (days: number): string => new Date(Date.now() - days * 864e5).toISOString();

/** A published, public, rated recipe; each card overrides what makes it its own state. */
function recipe(id: string, overrides: Partial<RecipeCardModel>): RecipeCardModel {
    return {
        id,
        title: 'Roast chicken with lemon and thyme',
        totalTimeMinutes: 95,
        servings: 4,
        difficulty: 'easy',
        averageRating: 4.6,
        ratingCount: 128,
        usesPremiumCapability: false,
        createdAt: daysAgo(30),
        updatedAt: daysAgo(2),
        cuisine: 'French',
        tags: ['Sunday', 'Poultry', 'One pan'],
        currentVersion: 3,
        visibility: 'public',
        status: 'published',
        ...overrides,
    };
}

const draft: RecipeCardModel = {
    id: 'r4',
    title: 'Sourdough boule (work in progress)',
    totalTimeMinutes: 0,
    servings: 4,
    ratingCount: 0,
    usesPremiumCapability: false,
    createdAt: daysAgo(30),
    updatedAt: daysAgo(2),
    tags: [],
    currentVersion: 1,
    visibility: 'public',
    status: 'draft',
};

const kcal = <span style={{ font: '14px/1.4 Inter,system-ui', color: 'var(--ink-muted)' }}>540 kcal</span>;

export default defineCard({
    group: 'Recipes',
    height: 1420,
    platforms: 'both',
    uses: ['RecipeCard'],
    render: ({ RecipeCard }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 320 }}>
            <div style={{ display: 'grid' }}>
                <RecipeCard
                    headingLevel={3}
                    onSelect={noop}
                    variant="grid"
                    recipe={recipe('r1', {})}
                    nutrition={kcal}
                />
            </div>
            <div style={{ display: 'grid' }}>
                <RecipeCard
                    headingLevel={3}
                    onSelect={noop}
                    variant="grid"
                    recipe={recipe('r2', {
                        title: 'Grandma’s lasagna',
                        cuisine: 'Italian',
                        difficulty: 'medium',
                        ratingCount: 0,
                        tags: ['Family'],
                        currentVersion: 1,
                        visibility: 'private',
                        usesPremiumCapability: true,
                        averageRating: undefined,
                    })}
                    nutrition={kcal}
                />
            </div>
            <div style={{ display: 'grid' }}>
                <RecipeCard
                    headingLevel={3}
                    onSelect={noop}
                    variant="row"
                    recipe={recipe('r3', { title: 'Weeknight pad thai', cuisine: 'Thai', totalTimeMinutes: 30 })}
                    nutrition={kcal}
                />
            </div>
            <div style={{ display: 'grid' }}>
                <RecipeCard headingLevel={3} onSelect={noop} variant="row" recipe={draft} />
            </div>
            <div style={{ display: 'grid' }}>
                <RecipeCard
                    headingLevel={3}
                    onSelect={noop}
                    variant="compact"
                    recipe={recipe('r5', { title: 'Blueberry pancakes', totalTimeMinutes: 25, cuisine: 'American' })}
                />
            </div>
        </div>
    ),
});
