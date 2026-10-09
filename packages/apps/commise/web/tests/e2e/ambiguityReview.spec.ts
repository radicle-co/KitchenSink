import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockFoodApi, ownFoodLedger } from './utils/foodApi';
import { mockRebind } from './utils/rebindApi';
import { E2E_CATALOG_FOOD, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * U13 — the ambiguity-review story on recipe detail, driven through the real detail view (Next dev server + Clerk
 * session + client hooks) with the recipe-service contract and food's progressive search intercepted.
 *
 * What only this tier proves: the AMBIGUOUS badge and the entry notice render from a REAL detail response's
 * `resolutionStatus`; opening the surface re-derives each line's shortlist through food's own search (plan 002 S5), the
 * cook's own foods first; one pick on one of two same-named lines sends ONE rebind for THAT line and no correction (owner
 * ruling 2026-10-02, "Fix one line at a time"; ADR-0045: the rebind teaches the correction); the review is the owner's
 * alone; and a private-food line reads as a private ingredient whose clone keeps it and says so once (plan 002 R9).
 * Selectors are role/label/text only.
 */
test.describe('recipe detail — the ambiguity review surface (U13)', () => {
    /** Two lines with the same name: the pick must fix the one it was made on, and only that one. */
    const sauceLines = [
        {
            ingredientId: 'ing_cup',
            name: 'apple sauce',
            quantity: { kind: 'exact', value: 1 },
            unit: 'cup',
            isUserEntered: false,
            resolutionStatus: 'AMBIGUOUS',
        },
        {
            ingredientId: 'ing_spoon',
            name: 'apple sauce',
            quantity: { kind: 'exact', value: 2 },
            unit: 'tbsp',
            isUserEntered: false,
            resolutionStatus: 'AMBIGUOUS',
        },
    ] as const;

    test('badge + entry render; one pick on one of two same-named lines re-points THAT line alone', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const ambiguous = makeRecipeDetail({
            id: 'rec_ambiguous',
            ownerId: viewerId,
            title: 'Ambiguity Probe',
            currentVersion: 3,
            ingredients: [...sauceLines],
        });

        const store = await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [ambiguous] });
        const searches = await mockFoodApi(page, {
            catalog: () => [{ id: E2E_CATALOG_FOOD.foodId, name: E2E_CATALOG_FOOD.name, score: 0.9 }],
            authored: ownFoodLedger([{ id: 'food_mine_sauce', name: 'apple sauce, homemade', score: 0.8 }]),
        });
        const rebinds = await mockRebind(page, store, {
            foodNames: { [E2E_CATALOG_FOOD.foodId]: E2E_CATALOG_FOOD.name },
        });

        const corrections: unknown[] = [];
        page.on('request', (request) => {
            if (request.url().endsWith('/api/v1/ingredients/corrections') && request.method() === 'POST') {
                corrections.push(request.postDataJSON());
            }
        });

        await page.goto(route('/recipes/rec_ambiguous'));
        await expect(page.getByRole('heading', { name: 'Ambiguity Probe' })).toBeVisible();

        // Both LINES badge; the entry counts lines.
        await expect(page.getByText('Needs a pick')).toHaveCount(2);
        await expect(
            page.getByText('2 ingredients could match more than one food. Review them to sharpen the nutrition.'),
        ).toBeVisible();

        // Open the surface: the two same-named lines are TWO rows, each named by its own amount.
        await page.getByRole('button', { name: 'Review ingredient matches' }).click();
        const cupRow = page.getByRole('group', { name: '1 cup apple sauce' });
        const spoonRow = page.getByRole('group', { name: '2 tbsp apple sauce' });

        // Each row's shortlist is food's search for the line's name: the cook's own food first, then the catalog's.
        await expect(spoonRow.getByRole('button')).toHaveText(['apple sauce, homemade', E2E_CATALOG_FOOD.name]);
        await expect(cupRow.getByRole('button')).toHaveText(['apple sauce, homemade', E2E_CATALOG_FOOD.name]);
        expect(searches).toContainEqual({ route: 'progressive', query: 'apple sauce' });

        await spoonRow.getByRole('button', { name: E2E_CATALOG_FOOD.name }).click();
        await expect(page.getByText('Saved — future recipes will use this match.')).toBeVisible();

        // ⛔ The tablespoon line now names the food; the cup line is untouched and still under review.
        await expect(page.getByRole('checkbox', { name: `2 tbsp ${E2E_CATALOG_FOOD.name}` })).toBeVisible();
        await expect(spoonRow).toHaveCount(0);
        await expect(cupRow.getByRole('button', { name: E2E_CATALOG_FOOD.name })).toBeVisible();
        await expect(page.getByText('Needs a pick')).toHaveCount(1);

        // ⛔ ONE rebind, for the line the pick was made on, at the version read; no correction of its own.
        expect(rebinds.map((each) => [each.path, each.body])).toEqual([
            [
                '/api/v1/recipes/rec_ambiguous/ingredients/1/rebind',
                { expectedVersion: 3, target: { kind: 'catalogFood', foodId: E2E_CATALOG_FOOD.foodId } },
            ],
        ]);
        expect(corrections).toEqual([]);
    });

    test('a viewer who does not own the recipe is offered no review: only the owner can re-point a line', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const someoneElses = makeRecipeDetail({
            id: 'rec_ambiguous_public',
            ownerId: 'usr_someone_else',
            title: 'Someone Else’s Probe',
            visibility: 'public',
            ingredients: [...sauceLines],
        });

        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [someoneElses] });

        await page.goto(route('/recipes/rec_ambiguous_public'));
        await expect(page.getByRole('heading', { name: 'Someone Else’s Probe' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save a copy' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Review ingredient matches' })).toHaveCount(0);
    });

    test('a private-food line reads as a private ingredient, and its copy says so once (plan 002)', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const withPrivate = makeRecipeDetail({
            id: 'rec_private_src',
            ownerId: 'usr_someone_else',
            title: 'Private Blend Bowl',
            visibility: 'public',
            ingredients: [
                {
                    // Plan 002 R9: a food this viewer may not see reaches them with no name.
                    ingredientId: 'ing_priv',
                    quantity: { kind: 'exact', value: 1 },
                    unit: 'cup',
                    isUserEntered: false,
                    resolutionStatus: 'RESOLVED_UNAVAILABLE',
                },
            ],
        });

        await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [withPrivate] });

        await page.goto(route('/recipes/rec_private_src'));
        // The stand-in IS the line's name, and names the row's checkbox — never "undefined".
        await expect(page.getByRole('checkbox', { name: '1 cup Private ingredient' })).toBeVisible();
        await expect(page.getByText('Details unavailable')).toHaveCount(0);

        // Save a copy (slice 6). A copy opens in the editor first (FR-005b); leaving it untouched lands on the copy's
        // page, where the one-time banner lives.
        await page.getByRole('button', { name: 'Save a copy' }).click();
        await expect(page).toHaveURL(/\/recipes\/rec_clone_[^/]+\/edit/);
        await page.getByRole('button', { name: 'Close editor' }).click();

        // The copy KEEPS the binding, so the banner says the line uses the original cook's private food.
        const banner = page.getByText(
            'One ingredient uses the original cook’s private food, so you can’t see its name or nutrition. Its amount is kept.',
        );

        await expect(banner).toBeVisible();
        await expect(page.getByRole('checkbox', { name: '1 cup Private ingredient' })).toBeVisible();
        await page.getByRole('button', { name: 'Dismiss' }).click();
        await expect(banner).toHaveCount(0);
    });
});
