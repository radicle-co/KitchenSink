import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { mockFoodApi } from './utils/foodApi';

/**
 * Ingredient-typeahead trigger threshold (REQ-057) and the partial-nutrition disclosure gate (REQ-034),
 * driven through the real create wizard (Next dev server + Clerk session + client hooks + routing) with the
 * recipe contract and food's search intercepted (`utils/recipeApi`, `utils/foodApi`). REQ-057: the trailing
 * "Add an ingredient" field MUST NOT surface a suggestion below the minimum, even though the mocked search would
 * return a match for any query.
 * REQ-034: the recipe-detail "nutrition includes USDA database items" notice renders ONLY when the recipe
 * carries at least one user-entered (freeform) ingredient — the all-catalog negative case is covered by
 * `recipeCrud.spec.ts`. Selectors are role/label only (per repo policy). Serial (Clerk-authed).
 */
test.describe('ingredient typeahead trigger + partial-nutrition disclosure (REQ-057 / REQ-034)', () => {
    test('gates suggestions below 2 characters; a freeform ingredient triggers the disclosure notice', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        await mockFoodApi(page);

        await page.goto(route('/recipes/new'));
        await expect(page.getByText('Step 1 of 4')).toBeVisible();
        await page.getByLabel('Title').fill('E2E Herb Blend');
        await page.getByLabel('Description').fill('A pantry-forward herb blend.');
        await page.getByLabel('Cuisine').selectOption('French');
        await page.getByLabel('Servings').fill('4');
        await page.getByLabel('Prep time (minutes)').fill('5');
        await page.getByLabel('Cook time (minutes)').fill('0');
        await page.getByRole('radio', { name: 'Easy' }).click();
        await page.getByRole('button', { name: 'Next: Ingredients' }).click();

        // Step 2 (Ingredients).
        await expect(page.getByText('Step 2 of 4')).toBeVisible();
        const search = page.getByRole('combobox', { name: 'Add an ingredient' });

        // 003-FR-010a (plan U37) — below the three-character minimum no suggestion is ever offered, even
        // though the mocked search would return the catalog "Salt" fixture for any non-empty query, AND the
        // list says why instead of rendering an empty panel. Asserted at BOTH one and two
        // characters: the old floor was two, so a case at one character alone would pass on a revert.
        await search.fill('s');
        await expect(
            page.getByText('Keep typing — 3 characters or more. Anything shorter matches half the pantry.'),
        ).toBeVisible();
        await expect(page.getByRole('option', { name: 'Salt', exact: true })).toHaveCount(0);

        await search.fill('sa');
        await expect(
            page.getByText('Keep typing — 3 characters or more. Anything shorter matches half the pantry.'),
        ).toBeVisible();
        await expect(page.getByRole('option', { name: 'Salt', exact: true })).toHaveCount(0);
        // ⛔ And the query-keyed ways on stay suppressed: "Find nutrition for “sa”" would fire the very search the
        // minimum gates, and "as written" would put a line named "sa" in the recipe.
        await expect(page.getByRole('option', { name: /^Find nutrition for/ })).toHaveCount(0);
        await expect(page.getByRole('option', { name: /as written/ })).toHaveCount(0);

        // At three characters the (debounced) search settles and the catalog match appears.
        // U5 (analytics): the pick must fire ONE fire-and-forget POST to the ingest door carrying a
        // pick outcome. Intercepted (never a real backend here) and awaited via waitForRequest — the
        // emission is async after the tap, so the click and the wait race together.
        await page.route('**/ingest/v1/events', async (intercepted) => {
            await intercepted.fulfill({
                status: 202,
                contentType: 'application/json',
                body: JSON.stringify({ accepted: 1, landed: 1 }),
            });
        });
        await search.fill('sal');
        const ingestRequest = page.waitForRequest(
            (request) => request.url().includes('/ingest/v1/events') && request.method() === 'POST',
        );
        await page
            .getByRole('group', { name: 'Food catalog' })
            .getByRole('option', { name: 'Salt', exact: true })
            .click();
        const ingest = await ingestRequest;
        const ingestBody = ingest.postDataJSON() as {
            events: { outcome: { kind: string }; query: string }[];
        };
        expect(ingestBody.events).toHaveLength(1);
        expect(ingestBody.events[0]?.outcome.kind).toBe('pick');

        // Add a second ingredient as written (REQ-032a/b — not backed by the food database) — this is what
        // gates the REQ-034 disclosure notice on.
        await search.fill('dried thyme blend');
        await page.getByRole('option', { name: 'Use “dried thyme blend” as written, without nutrition' }).click();

        await page.getByRole('button', { name: 'Next: Instructions' }).click();
        await expect(page.getByText('Step 3 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Add step' }).click();
        await page.getByLabel('Step 1 instruction').fill('Combine and store airtight.');

        await page.getByRole('button', { name: 'Next: Review' }).click();
        await expect(page.getByText('Step 4 of 4')).toBeVisible();
        await page.getByRole('button', { name: 'Publish' }).click();

        await expect(page.getByRole('heading', { name: 'E2E Herb Blend' })).toBeVisible();
        // REQ-034 — the recipe now has a user-entered ingredient (the blend, as written), so the custom note shows (§S15).
        await expect(page.getByRole('region', { name: 'Nutrition (per serving)' })).toContainText(
            'Custom ingredients count only the nutrition you entered for them.',
        );
    });
});
