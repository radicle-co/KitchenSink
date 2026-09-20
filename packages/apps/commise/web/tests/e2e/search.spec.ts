import { expect, test, type Locator, type Page } from '@playwright/test';

import { route } from './utils/basePath';
import {
    E2E_INGREDIENT_IDS,
    E2E_RECIPE_IDS,
    makeRecipeDetail,
    mockRecipeApi,
    readViewerAppId,
} from './utils/recipeApi';
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
 *
 * **The "BROWSE" precondition, post-U7.** With neither a query nor a filter active, discovery no longer shows
 * a flat result list: it shows the CURATED RAILS default (Trending / New / Quick — three sorts of the same
 * public corpus, so one recipe legitimately appears in several rails at once, and there is no single result
 * count). Each browse step therefore asserts that the rails surface rendered and that each seeded recipe is
 * ON it (`.first()` — the name is deliberately not unique across rails), and leaves the strict, falsifiable
 * assertions to the post-filter half: the non-match reaching `toHaveCount(0)` across the WHOLE page and the
 * result count reading "1 recipe" can only happen if the criterion actually reached the API.
 */
/**
 * A discovery results sentence is rendered TWICE by design: once as the visible results header (or the no-match
 * title), and once in the frame's polite `status` region that announces results when they settle. Asserting exactly
 * two proves both — the viewer sees it and a screen reader hears it — and keeps Playwright's strict mode satisfied.
 *
 * @param page - The discovery page.
 * @param sentence - The exact header sentence.
 */
function discoverySentence(page: Page, sentence: string): Locator {
    return page.getByText(sentence, { exact: true });
}

test.describe('recipe search (T110)', () => {
    test('narrows public recipes to the typed term', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: E2E_RECIPE_IDS.paella, ownerId: 'usr_other', title: 'Seafood Paella' }),
                makeRecipeDetail({ id: E2E_RECIPE_IDS.pasta, ownerId: 'usr_other', title: 'Weeknight Pasta' }),
            ],
        });

        // BROWSE — an untyped search is "no criteria", so discovery shows the curated rails over every public
        // recipe. This is the "before" that gives the narrowing below its meaning (see the file doc).
        await page.goto(route('/discover'));
        await expect(page.getByRole('heading', { name: 'Discover recipes' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Trending' })).toBeVisible();
        await expect(page.getByRole('article', { name: 'Seafood Paella' }).first()).toBeVisible();
        await expect(page.getByRole('article', { name: 'Weeknight Pasta' }).first()).toBeVisible();

        // SEARCH — typing a term narrows the result set to the match. The non-match disappearing is the
        // assertion that matters: it can only happen if `query=paella` actually reached the API.
        await page.getByRole('searchbox', { name: 'Search public recipes' }).fill('paella');
        await expect(page.getByRole('article', { name: 'Weeknight Pasta' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Seafood Paella' })).toBeVisible();
        // With a term typed the header names it (`resultsForQuery`); a bare count is a filter-only narrowing's.
        await expect(discoverySentence(page, 'Showing 1 recipe for “paella”')).toHaveCount(2);
    });

    test('shows the empty state when nothing matches the term', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ id: E2E_RECIPE_IDS.paella, ownerId: 'usr_other', title: 'Seafood Paella' })],
        });

        await page.goto(route('/discover'));
        await expect(page.getByRole('article', { name: 'Seafood Paella' }).first()).toBeVisible();

        // A search with no hits is a NO-MATCH, not an error and not the browse-empty state — the no-match
        // guidance shows and the failure copy does NOT. (Asserted by copy rather than by `role=alert`, which
        // Next's permanent route-announcer `<div role="alert" id="__next-route-announcer__">` occupies on
        // every page.) "No matching recipes" ≠ the browse-empty "No recipes found": the caller searched.
        await page.getByRole('searchbox', { name: 'Search public recipes' }).fill('tiramisu');
        await expect(discoverySentence(page, 'No matching recipes')).toHaveCount(2);
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
                    id: E2E_RECIPE_IDS.gardenSalad,
                    ownerId: 'usr_other',
                    title: 'Gourmet Garden Salad',
                    dietaryFlags: ['vegan'],
                    totalTimeMinutes: 15,
                }),
                makeRecipeDetail({
                    id: E2E_RECIPE_IDS.lamb,
                    ownerId: 'usr_other',
                    title: 'Mediterranean Grilled Lamb',
                    dietaryFlags: [],
                    totalTimeMinutes: 45,
                }),
            ],
        });

        // BROWSE — both public recipes are on the curated surface, and the dietary facet chip (which lives in
        // the persistent filter bar, above the browse/results split) carries its server count.
        await page.goto(route('/discover'));
        await expect(page.getByRole('article', { name: 'Gourmet Garden Salad' }).first()).toBeVisible();
        await expect(page.getByRole('article', { name: 'Mediterranean Grilled Lamb' }).first()).toBeVisible();

        // FILTER — selecting the vegan chip narrows the set to vegan recipes. The non-vegan lamb disappearing
        // is the assertion that matters: it can only happen if `dietaryFlags=vegan` actually reached the API.
        const veganChip = page.getByRole('button', { name: 'vegan, 1 recipe' });
        await expect(veganChip).toHaveAttribute('aria-pressed', 'false');
        await veganChip.click();

        await expect(page.getByRole('button', { name: 'vegan, 1 recipe' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('article', { name: 'Mediterranean Grilled Lamb' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Gourmet Garden Salad' })).toBeVisible();
        await expect(discoverySentence(page, '1 recipe')).toHaveCount(2);

        // The URL now carries the filter (shareable / reload-safe).
        await expect(page).toHaveURL(/dietaryFlags=vegan/);
    });

    test('narrows public recipes to a selected cook-time bound (REQ-030f)', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({
                    id: E2E_RECIPE_IDS.scallops,
                    ownerId: 'usr_other',
                    title: 'Pan-Seared Scallops',
                    prepTimeMinutes: 5,
                    cookTimeMinutes: 10,
                }),
                makeRecipeDetail({
                    id: E2E_RECIPE_IDS.shortRibs,
                    ownerId: 'usr_other',
                    title: 'Braised Short Ribs',
                    prepTimeMinutes: 5,
                    cookTimeMinutes: 90,
                }),
            ],
        });

        // BROWSE — both public recipes are on the curated surface before any filter is applied.
        await page.goto(route('/discover'));
        await expect(page.getByRole('article', { name: 'Pan-Seared Scallops' }).first()).toBeVisible();
        await expect(page.getByRole('article', { name: 'Braised Short Ribs' }).first()).toBeVisible();

        // FILTER — selecting the "Under 15 min" cook-time bucket narrows to the quick-cooking recipe. The
        // 90-minute braise disappearing is the assertion that matters: it can only happen if
        // `maxCookTime=15` actually reached the API.
        const cookTimeGroup = page.getByRole('group', { name: 'Cook time' });
        const under15 = cookTimeGroup.getByRole('button', { name: 'Under 15 min' });
        await expect(under15).toHaveAttribute('aria-pressed', 'false');
        await under15.click();

        await expect(under15).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('article', { name: 'Braised Short Ribs' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Pan-Seared Scallops' })).toBeVisible();
        await expect(discoverySentence(page, '1 recipe')).toHaveCount(2);

        // The URL now carries the filter (shareable / reload-safe).
        await expect(page).toHaveURL(/maxCookTime=15/);
    });

    test('narrows public recipes to a selected ingredient (FR-006 gap #3)', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                // Default ingredients (`utils/recipeApi.ts`'s `makeRecipeDetail`) carry the catalog id
                // `E2E_INGREDIENT_IDS.salt` ("Salt") the mocked `/api/v1/ingredients/search` always returns,
                // regardless of the typed query.
                makeRecipeDetail({ id: E2E_RECIPE_IDS.ramen, ownerId: 'usr_other', title: 'Weeknight Ramen Bowl' }),
                makeRecipeDetail({
                    id: E2E_RECIPE_IDS.fruitSalad,
                    ownerId: 'usr_other',
                    title: 'Tropical Fruit Salad',
                    ingredients: [
                        {
                            ingredientId: E2E_INGREDIENT_IDS.mango,
                            name: 'Mango',
                            quantity: { kind: 'exact', value: 1 },
                            unit: 'each',
                            isUserEntered: false,
                        },
                    ],
                }),
            ],
        });

        // BROWSE — both public recipes are on the curated surface before any filter is applied.
        await page.goto(route('/discover'));
        await expect(page.getByRole('article', { name: 'Weeknight Ramen Bowl' }).first()).toBeVisible();
        await expect(page.getByRole('article', { name: 'Tropical Fruit Salad' }).first()).toBeVisible();

        // FILTER — typing an ingredient name surfaces the catalog match; picking it narrows the set. The
        // non-matching salad disappearing is the assertion that matters: it can only happen if
        // the salt ingredient id actually reached the API as a filter.
        // The option is addressed by its ACTION name ("Filter by Salt"), which is what makes it distinguishable
        // from the search box that now holds the typed query — a bare "Salt" would also match the field.
        await page.getByRole('searchbox', { name: 'Search ingredients' }).fill('sal');
        const saltResult = page.getByRole('button', { name: 'Filter by Salt' });
        await expect(saltResult).toBeVisible();
        await saltResult.click();

        await expect(page.getByRole('article', { name: 'Tropical Fruit Salad' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Weeknight Ramen Bowl' })).toBeVisible();
        await expect(discoverySentence(page, '1 recipe')).toHaveCount(2);

        // The picked ingredient renders as a removable chip, and the URL now carries it (shareable / reload-safe).
        const chip = page.getByRole('button', { name: 'Remove Salt' });
        await expect(chip).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`ingredientId=${E2E_INGREDIENT_IDS.salt}`, 'u'));

        // Removing the chip clears the last criterion, so the surface returns to the curated browse default
        // (rails over the full public set), not a flat list — hence `.first()` again.
        await chip.click();
        await expect(page.getByRole('article', { name: 'Tropical Fruit Salad' }).first()).toBeVisible();
        await expect(page.getByRole('article', { name: 'Weeknight Ramen Bowl' }).first()).toBeVisible();
        await expect(chip).toHaveCount(0);
    });

    test('echoes the query in the results header and re-sorts on demand (W4/S3+S5)', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: E2E_RECIPE_IDS.paella, ownerId: 'usr_other', title: 'Seafood Paella' }),
                makeRecipeDetail({ id: E2E_RECIPE_IDS.pasta, ownerId: 'usr_other', title: 'Weeknight Pasta' }),
            ],
        });

        await page.goto(route('/discover'));

        // S5 — an active query names the result set it is FOR (not just a bare count).
        await page.getByRole('searchbox', { name: 'Search public recipes' }).fill('paella');
        await expect(discoverySentence(page, 'Showing 1 recipe for “paella”')).toHaveCount(2);

        // S3 — the sort control is a single-select radiogroup; choosing Quickest moves the selection there.
        const sort = page.getByRole('radiogroup', { name: 'Sort by' });
        await expect(sort.getByRole('radio', { name: 'Relevance' })).toHaveAttribute('aria-checked', 'true');
        await sort.getByRole('radio', { name: 'Quickest' }).click();
        await expect(sort.getByRole('radio', { name: 'Quickest' })).toHaveAttribute('aria-checked', 'true');
        await expect(sort.getByRole('radio', { name: 'Relevance' })).toHaveAttribute('aria-checked', 'false');
    });

    /**
     * A newer search pending behind the results on screen (`recipe-search.md`, "Updating Results State"). The
     * discovery criteria are deferred, so the previous results stay — readable, still naming the query they belong
     * to — instead of the skeleton replacing them. The region is deliberately NOT `aria-busy` (JAWS hides busy
     * content), and the pending bar is decorative and hidden from assistive tech, so what is asserted is what a
     * viewer and a screen reader both get: the old card, a header still naming the old query, and no loading status.
     *
     * The second search is HELD by the spec rather than delayed by a clock: the assertions run while it is
     * provably pending, and the spec releases it.
     */
    test('keeps the previous results on screen while a newer search is pending', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: E2E_RECIPE_IDS.paella, ownerId: 'usr_other', title: 'Seafood Paella' }),
                makeRecipeDetail({ id: E2E_RECIPE_IDS.pasta, ownerId: 'usr_other', title: 'Weeknight Pasta' }),
            ],
        });

        let releaseSearch: () => void = () => undefined;
        const released = new Promise<void>((resolve) => {
            releaseSearch = resolve;
        });
        let heldSearchArrived: () => void = () => undefined;
        const heldSearch = new Promise<void>((resolve) => {
            heldSearchArrived = resolve;
        });
        // Registered after `mockRecipeApi`, so Playwright asks it first; `fallback` hands the request to the mock.
        await page.route(
            (url) => url.pathname.endsWith('/api/v1/search/recipes') && url.searchParams.get('query') === 'pasta',
            async (heldRoute) => {
                heldSearchArrived();
                await released;
                await heldRoute.fallback();
            },
        );

        await page.goto(route('/discover'));
        const searchBox = page.getByRole('searchbox', { name: 'Search public recipes' });
        await searchBox.fill('paella');
        const previous = page.getByRole('article', { name: 'Seafood Paella' });
        await expect(previous).toBeVisible();
        await expect(discoverySentence(page, 'Showing 1 recipe for “paella”')).toHaveCount(2);

        await searchBox.fill('pasta');
        await heldSearch;

        await expect(
            page.getByRole('region', { name: 'Search results' }).getByRole('article', { name: 'Seafood Paella' }),
        ).toBeVisible();
        await expect(searchBox).toHaveValue('pasta');
        await expect(discoverySentence(page, 'Showing 1 recipe for “paella”')).toHaveCount(2);
        await expect(page.getByRole('status', { name: 'Loading recipes' })).toHaveCount(0);

        releaseSearch();

        const next = page.getByRole('article', { name: 'Weeknight Pasta' });
        await expect(next).toBeVisible();
        await expect(previous).toHaveCount(0);
        await expect(discoverySentence(page, 'Showing 1 recipe for “pasta”')).toHaveCount(2);
        await expect(discoverySentence(page, 'Showing 1 recipe for “paella”')).toHaveCount(0);
    });

    test('narrows the caller’s own recipe list to the term', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: E2E_RECIPE_IDS.pasta, ownerId: viewerId, title: 'Weeknight Pasta' }),
                makeRecipeDetail({ id: E2E_RECIPE_IDS.lentilSoup, ownerId: viewerId, title: 'Lentil Soup' }),
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
