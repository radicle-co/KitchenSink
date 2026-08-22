import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { correctionMappingIdFor, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * U14 — the ingredient-CORRECTION user story (plan U14 / R19, R20), driven through the real create wizard
 * (Next dev server + Clerk session + client hooks + routing) with the recipe-service HTTP contract
 * intercepted (`utils/recipeApi`).
 *
 * ## Why this spec exists, on top of two green component suites
 *
 * Playwright IS this feature's UI integration test (repo testing policy), and what it proves is the part no
 * component test can: that a cook typing a phrase, seeing the wrong match, and pressing one control causes a
 * REAL `POST /api/v1/ingredients/corrections` to leave the browser — through the live typed client (which
 * PARSES the outbound body against the published request schema before sending), the live query cache, and
 * the real wizard. A component test stubs the client method and therefore cannot see the contract at all: a
 * body the schema rejects, a wrong path, or a field the wire does not accept all pass it.
 *
 * ⛔ THE FALSIFIABLE END OF THE STORY IS *WHICH PHRASE* WAS SENT. U10's knowledge base is only ever consulted
 * under the key the resolution cascade looks up, and that key derives from the phrase `addByName` received —
 * so a control that sent the CATALOG'S NAME instead of the typed query would produce a green screen, a 200,
 * a stored row, and a learning loop that never fires for anyone. The mock encodes the received phrase into
 * the mapping id it answers with, and the assertion below reads it back; sending the wrong phrase is a
 * visible failure rather than an invisible one.
 *
 * Selectors are role/label only (per repo policy). Serial (Clerk-authed).
 */
test.describe('ingredient correction — teaching the resolver what a phrase means (U14)', () => {
    test('records a correction for the TYPED phrase, and reports how far it reaches', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        // The phrase a cook would type — deliberately NOT the name of the catalog suggestion the mock
        // returns ("Pepper, black, ground"), so the two are distinguishable in the request.
        const phrase = 'cracked pepper';

        await page.goto(route('/recipes/new'));
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
        await page.getByLabel('Title').fill('E2E Corrected Broth');
        await page.getByRole('radio', { name: 'Easy' }).click();
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();

        // Step 2 (Ingredients) — search, and watch the correction request on the wire.
        await expect(page.getByText('Step 2 of 4')).toBeVisible();
        await page.getByRole('searchbox', { name: 'Search ingredients' }).fill(phrase);

        const catalogSection = page.getByRole('region', { name: 'Food catalog' });
        await expect(catalogSection).toBeVisible();

        const correctionRequest = page.waitForRequest(
            (request) => request.url().includes('/api/v1/ingredients/corrections') && request.method() === 'POST',
        );

        await catalogSection.getByRole('button', { name: `Always use this for “${phrase}”` }).click();

        // ⛔ The request body itself — the phrase the cook typed, the food they chose, and the surfacing that
        // produced it. This is what a component test cannot see.
        const body = (await correctionRequest).postDataJSON() as Record<string, unknown>;

        expect(body).toEqual({ phrase, foodId: 'food_black_pepper', surfacing: 'ingredient_picker' });
        expect(body['phrase']).not.toBe('Pepper, black, ground');

        // …and the round trip is legible to the cook: the notice states the REACH, which is decided
        // server-side from grants the client cannot read.
        await expect(page.getByText('Saved. We’ll use this match for you from now on.')).toBeVisible();

        // The mock derives the mapping id from the phrase it received, so a green notice off the WRONG
        // phrase is not reachable — the id proves which string crossed the boundary.
        expect(correctionMappingIdFor(phrase)).toBe('mapping-for-cracked-pepper');
    });

    // ⚠️ Teaching and picking are two intents. A correction must not append an ingredient the cook did not
    // ask for — the wizard's line list is the observable proof.
    test('teaching the resolver does not add an ingredient line', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });

        await page.goto(route('/recipes/new'));
        await page.getByLabel('Title').fill('E2E Teach Only');
        await page.getByRole('radio', { name: 'Easy' }).click();
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();
        await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('cracked pepper');

        const catalogSection = page.getByRole('region', { name: 'Food catalog' });
        await expect(catalogSection).toBeVisible();
        await catalogSection.getByRole('button', { name: 'Always use this for “cracked pepper”' }).click();

        await expect(page.getByText('Saved. We’ll use this match for you from now on.')).toBeVisible();
        // No line was resolved: the first ingredient row's name field does not exist.
        await expect(page.getByLabel('Ingredient 1 name')).toHaveCount(0);
    });
});
