import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * U13 — the batched ambiguity-review story on recipe detail, driven through the real detail view (Next
 * dev server + Clerk session + client hooks) with the recipe-service contract intercepted.
 *
 * What only this tier proves: the AMBIGUOUS badge and the entry notice render from a REAL detail
 * response's `resolutionStatus`; opening the surface re-derives the shortlist through the live suggest;
 * one pick over two sibling lines writes exactly ONE `POST /corrections` carrying the PHRASE and the
 * picked food (gap 18); and the clone flow's one-time banner distinguishes unbound private-food lines
 * from ordinary ambiguity (R20). Selectors are role/label/text only.
 */
test.describe('recipe detail — the ambiguity review surface (U13)', () => {
    test('badge + entry render; one pick over siblings writes ONE correction and confirms', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const ambiguous = makeRecipeDetail({
            id: 'rec_ambiguous',
            ownerId: viewerId,
            title: 'Ambiguity Probe',
            ingredients: [
                {
                    ingredientId: 'ing_a',
                    name: 'apple sauce',
                    quantity: { kind: 'exact', value: 1 },
                    unit: 'cup',
                    isUserEntered: false,
                    resolutionStatus: 'AMBIGUOUS',
                },
                {
                    ingredientId: 'ing_b',
                    name: 'Apple Sauce',
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'tbsp',
                    isUserEntered: false,
                    resolutionStatus: 'AMBIGUOUS',
                },
            ],
        });

        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [ambiguous] });

        const corrections: unknown[] = [];
        page.on('request', (request) => {
            if (request.url().endsWith('/api/v1/ingredients/corrections') && request.method() === 'POST') {
                corrections.push(request.postDataJSON());
            }
        });

        await page.goto(route('/recipes/rec_ambiguous'));
        await expect(page.getByRole('heading', { name: 'Ambiguity Probe' })).toBeVisible();

        // Both LINES badge; the entry counts lines, not groups.
        await expect(page.getByText('Needs a pick')).toHaveCount(2);
        await expect(
            page.getByText('2 ingredients could match more than one food. Review them to sharpen the nutrition.'),
        ).toBeVisible();

        // Open the surface: the two siblings FOLD to one row carrying the binds-many caption.
        await page.getByRole('button', { name: 'Review ingredient matches' }).click();
        await expect(page.getByText('Applies to 2 lines in this recipe.')).toBeVisible();

        // The row's shortlist is the LIVE suggest's — pick the catalog candidate.
        await page.getByRole('button', { name: 'Pepper, black, ground' }).click();
        await expect(page.getByText('Saved — future recipes will use this match.')).toBeVisible();

        // ⛔ ONE correction, keyed on the (folded) phrase — the whole gap-18 claim.
        expect(corrections).toHaveLength(1);
        expect(corrections[0]).toMatchObject({ phrase: 'apple sauce', surfacing: 'recipe_line' });
    });

    test('cloning a recipe with private-food lines shows the one-time re-matching banner (R20)', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const withPrivate = makeRecipeDetail({
            id: 'rec_private_src',
            ownerId: 'usr_someone_else',
            title: 'Private Blend Bowl',
            visibility: 'public',
            ingredients: [
                {
                    ingredientId: 'ing_priv',
                    name: 'grandma blend',
                    quantity: { kind: 'exact', value: 1 },
                    unit: 'cup',
                    isUserEntered: false,
                    resolutionStatus: 'RESOLVED_UNAVAILABLE',
                },
            ],
        });

        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [withPrivate] });

        await page.goto(route('/recipes/rec_private_src'));
        // The viewer treatment on the source: name-only, neutral badge — never an error.
        await expect(page.getByText('Details unavailable')).toBeVisible();

        await page.getByRole('button', { name: /Clone/u }).click();

        // The clone's detail renders the one-time banner with the count, and it dismisses.
        await expect(
            page.getByText('1 ingredients need re-matching — the original used the author’s own foods.'),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Dismiss' }).click();
        await expect(
            page.getByText('1 ingredients need re-matching — the original used the author’s own foods.'),
        ).toHaveCount(0);
    });
});
