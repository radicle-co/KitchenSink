import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Recipe search (T110, US1 acceptance #5 / FR-006 — "search and filter recipes"), driven through the real
 * web UI (Next dev server + Clerk session + client hooks + routing) with the recipe-service HTTP contract
 * intercepted (`utils/recipeApi`). The real backend's ranking, facets, and filter SQL are covered by the
 * recipe-service's own unit/integration/e2e/k6 tiers; what only an E2E can prove is that the term the user
 * TYPES reaches the API and that what the API RETURNS is what renders. Both specs below turn on exactly
 * that: the mock narrows server-side on the `query` param, so a UI that dropped the term would keep
 * rendering the non-matching recipe and fail. Selectors are role/label only; no `data-testid`, no
 * `waitForTimeout`.
 *
 * Requirement → test:
 * - FR-006 (search public recipes by keyword) → "narrows public recipes to the typed term"
 * - FR-006, no-hit path → "shows the no-match state when nothing matches the term"
 * - FR-006 (filter by facet) → "narrows public recipes to a selected dietary facet"
 * - US1 ("view their recipes in a searchable list") → "narrows the caller's own recipe list to the term"
 *
 * The filter half turns on the same falsifiable core as the keyword half: `utils/recipeApi` narrows
 * SERVER-side on the facet params (`dietaryFlags`/`tags`/`maxTotalTime`), so a UI that dropped a filter param
 * would keep rendering the non-matching recipe and fail. The bar's chips carry `facets` counts and their
 * `aria-pressed` state, queried by accessible name only.
 */
test.describe('recipe search (T110)', () => {
    test('narrows public recipes to the typed term', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: 'rec_paella', ownerId: 'usr_other', title: 'Seafood Paella' }),
                makeRecipeDetail({ id: 'rec_pasta', ownerId: 'usr_other', title: 'Weeknight Pasta' }),
            ],
        });

        // BROWSE — an untyped search is "no filter", so discovery lists every public recipe. This is the
        // "before" that gives the narrowing below its meaning.
        await page.goto(route('/discover'));
        await expect(page.getByRole('heading', { name: 'Discover recipes' })).toBeVisible();
        await expect(page.getByRole('article', { name: 'Seafood Paella' })).toBeVisible();
        await expect(page.getByRole('article', { name: 'Weeknight Pasta' })).toBeVisible();
        await expect(page.getByText('2 recipes')).toBeVisible();

        // SEARCH — typing a term narrows the result set to the match. The non-match disappearing is the
        // assertion that matters: it can only happen if `query=paella` actually reached the API.
        await page.getByRole('searchbox', { name: 'Search public recipes' }).fill('paella');
        await expect(page.getByRole('article', { name: 'Weeknight Pasta' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Seafood Paella' })).toBeVisible();
        await expect(page.getByText('1 recipe')).toBeVisible();
    });

    test('shows the empty state when nothing matches the term', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ id: 'rec_paella', ownerId: 'usr_other', title: 'Seafood Paella' })],
        });

        await page.goto(route('/discover'));
        await expect(page.getByRole('article', { name: 'Seafood Paella' })).toBeVisible();

        // A search with no hits is a NO-MATCH, not an error and not the browse-empty state — the no-match
        // guidance shows and the failure copy does NOT. (Asserted by copy rather than by `role=alert`, which
        // Next's permanent route-announcer `<div role="alert" id="__next-route-announcer__">` occupies on
        // every page.) "No matching recipes" ≠ the browse-empty "No recipes found": the caller searched.
        await page.getByRole('searchbox', { name: 'Search public recipes' }).fill('tiramisu');
        await expect(page.getByText('No matching recipes')).toBeVisible();
        await expect(page.getByRole('article', { name: 'Seafood Paella' })).toHaveCount(0);
        await expect(page.getByText('We couldn’t load recipes.')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    });

    test('narrows public recipes to a selected dietary facet', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({
                    id: 'rec_salad',
                    ownerId: 'usr_other',
                    title: 'Gourmet Garden Salad',
                    dietaryFlags: ['vegan'],
                    totalTimeMinutes: 15,
                }),
                makeRecipeDetail({
                    id: 'rec_lamb',
                    ownerId: 'usr_other',
                    title: 'Mediterranean Grilled Lamb',
                    dietaryFlags: [],
                    totalTimeMinutes: 45,
                }),
            ],
        });

        // BROWSE — both public recipes list, and the dietary facet chip carries its server count.
        await page.goto(route('/discover'));
        await expect(page.getByRole('article', { name: 'Gourmet Garden Salad' })).toBeVisible();
        await expect(page.getByRole('article', { name: 'Mediterranean Grilled Lamb' })).toBeVisible();

        // FILTER — selecting the vegan chip narrows the set to vegan recipes. The non-vegan lamb disappearing
        // is the assertion that matters: it can only happen if `dietaryFlags=vegan` actually reached the API.
        const veganChip = page.getByRole('button', { name: 'vegan, 1 recipe' });
        await expect(veganChip).toHaveAttribute('aria-pressed', 'false');
        await veganChip.click();

        await expect(page.getByRole('button', { name: 'vegan, 1 recipe' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('article', { name: 'Mediterranean Grilled Lamb' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Gourmet Garden Salad' })).toBeVisible();
        await expect(page.getByText('1 recipe')).toBeVisible();

        // The URL now carries the filter (shareable / reload-safe).
        await expect(page).toHaveURL(/dietaryFlags=vegan/);
    });

    test('echoes the query in the results header and re-sorts on demand (W4/S3+S5)', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: 'rec_paella', ownerId: 'usr_other', title: 'Seafood Paella' }),
                makeRecipeDetail({ id: 'rec_pasta', ownerId: 'usr_other', title: 'Weeknight Pasta' }),
            ],
        });

        await page.goto(route('/discover'));

        // S5 — an active query names the result set it is FOR (not just a bare count).
        await page.getByRole('searchbox', { name: 'Search public recipes' }).fill('paella');
        await expect(page.getByText('Showing 1 recipe for “paella”')).toBeVisible();

        // S3 — the sort control is a single-select radiogroup; choosing Quickest moves the selection there.
        const sort = page.getByRole('radiogroup', { name: 'Sort by' });
        await expect(sort.getByRole('radio', { name: 'Relevance' })).toHaveAttribute('aria-checked', 'true');
        await sort.getByRole('radio', { name: 'Quickest' }).click();
        await expect(sort.getByRole('radio', { name: 'Quickest' })).toHaveAttribute('aria-checked', 'true');
        await expect(sort.getByRole('radio', { name: 'Relevance' })).toHaveAttribute('aria-checked', 'false');
    });

    test('narrows the caller’s own recipe list to the term', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: 'rec_pasta', ownerId: viewerId, title: 'Weeknight Pasta' }),
                makeRecipeDetail({ id: 'rec_soup', ownerId: viewerId, title: 'Lentil Soup' }),
            ],
        });

        // The library list is a DIFFERENT search path from discovery: `useRecipes` has no server-side
        // query param, so the list narrows the loaded page client-side by title.
        await page.goto(route('/recipes'));
        await expect(page.getByRole('article', { name: 'Weeknight Pasta' })).toBeVisible();
        await expect(page.getByRole('article', { name: 'Lentil Soup' })).toBeVisible();

        await page.getByRole('searchbox', { name: 'Search recipes' }).fill('soup');
        await expect(page.getByRole('article', { name: 'Weeknight Pasta' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Lentil Soup' })).toBeVisible();
        await expect(page.getByText('1 recipe')).toBeVisible();
    });
});
