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
 * - curated U9 (the six-ingredient bound) → "at six ingredients, the note replaces the search and takes focus", and on
 *   a phone, where the bar is in the Sheet (curated U15), "at six ingredients on a phone, …inside the Sheet"
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
 * A discovery sentence is ONE element: the frame's count line, which is both the visible "12 recipes for “lamb”" and the
 * polite live region that announces it (slice 5, `buildSpec.md` §4.4). A no-result title is two: the same words are also
 * the no-result state's own heading. Asserting the exact count proves each is on screen once and keeps Playwright's
 * strict mode satisfied.
 *
 * @param page - The discovery page.
 * @param sentence - The exact sentence.
 * @returns The locator for it.
 */
function discoverySentence(page: Page, sentence: string): Locator {
    return page.getByText(sentence, { exact: true });
}

/**
 * A window wide enough for Discover's filter PANEL (a 960 container in a window that is not short, `filterPresentationOf`),
 * where the facets are always on screen; and a phone, where they live in the Filters sheet.
 */
const PANEL_VIEWPORT = { width: 1440, height: 900 } as const;

/** The filter panel (an `aside` named "Filters"), when the window is wide enough to draw it. */
const filtersPanel = (page: Page): Locator => page.getByRole('complementary', { name: 'Filters' });

/** The note that takes the ingredient search's place once the filter holds six foods (curated U9). */
const CAP_NOTE = 'You can filter by up to 6 ingredients. Remove one to add another.';

/** Sign in and open discovery from a shared URL that already filters on five foods, one below the cap. */
async function seedFiveSharedFoods(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        recipes: [makeRecipeDetail({ id: E2E_RECIPE_IDS.ramen, ownerId: 'usr_other', title: 'Weeknight Ramen Bowl' })],
    });
    const shared = Array.from(
        { length: 5 },
        (_, index) => `foodId=food_shared_${String(index)}&foodName=Food+${String(index)}`,
    ).join('&');

    await page.goto(route(`/discover?${shared}`));
}

/** Search for salt and add it by keyboard, the sixth food. */
async function addSaltByKeyboard(page: Page): Promise<void> {
    await page.getByRole('searchbox', { name: 'Has ingredient' }).fill('sal');
    const salt = page.getByRole('button', { name: 'Filter by Salt' });
    await expect(salt).toBeVisible();
    await salt.focus();
    await page.keyboard.press('Enter');
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
        await expect(page.getByRole('heading', { name: 'Discover', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Trending' })).toBeVisible();
        await expect(page.getByRole('article', { name: 'Seafood Paella' }).first()).toBeVisible();
        await expect(page.getByRole('article', { name: 'Weeknight Pasta' }).first()).toBeVisible();

        // SEARCH — typing a term narrows the result set to the match. The non-match disappearing is the
        // assertion that matters: it can only happen if `query=paella` actually reached the API.
        await page.getByRole('searchbox', { name: 'Search recipes' }).fill('paella');
        await expect(page.getByRole('article', { name: 'Weeknight Pasta' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Seafood Paella' })).toBeVisible();
        // With a term typed the header names it (`resultsForQuery`); a bare count is a filter-only narrowing's.
        await expect(discoverySentence(page, '1 recipe for “paella”')).toHaveCount(1);
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
        // every page.) The title NAMES the term, so it is not the browse-empty "No public recipes yet.": the caller searched.
        // The state is the heading and the count line, and ends in the Trending rail (`discoverNoResults.spec.ts`).
        await page.getByRole('searchbox', { name: 'Search recipes' }).fill('tiramisu');
        await expect(discoverySentence(page, 'No recipes for “tiramisu”')).toHaveCount(2);
        await expect(page.getByRole('heading', { name: 'Trending' })).toBeVisible();
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
        // the filter panel, beside the browse/results split) carries its server count.
        await page.setViewportSize(PANEL_VIEWPORT);
        await page.goto(route('/discover'));
        await expect(page.getByRole('article', { name: 'Gourmet Garden Salad' }).first()).toBeVisible();
        await expect(page.getByRole('article', { name: 'Mediterranean Grilled Lamb' }).first()).toBeVisible();

        // FILTER — selecting the vegan chip narrows the set to vegan recipes. The non-vegan lamb disappearing
        // is the assertion that matters: it can only happen if `dietaryFlags=vegan` actually reached the API.
        const veganChip = filtersPanel(page).getByRole('button', { name: 'vegan 1' });
        await expect(veganChip).toHaveAttribute('aria-pressed', 'false');
        await veganChip.click();

        await expect(veganChip).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('article', { name: 'Mediterranean Grilled Lamb' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Gourmet Garden Salad' })).toBeVisible();
        await expect(discoverySentence(page, '1 recipe')).toHaveCount(1);

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
        await page.setViewportSize(PANEL_VIEWPORT);
        await page.goto(route('/discover'));
        await expect(page.getByRole('article', { name: 'Pan-Seared Scallops' }).first()).toBeVisible();
        await expect(page.getByRole('article', { name: 'Braised Short Ribs' }).first()).toBeVisible();

        // FILTER — Total time is the one time choice the panel leads with; Prep and Cook sit behind "More time filters".
        // Selecting the "Under 15 min" COOK bucket narrows to the quick-cooking recipe. The 90-minute braise disappearing
        // is the assertion that matters: it can only happen if `maxCookTime=15` actually reached the API.
        await filtersPanel(page).getByText('More time filters').click();
        const cookTimeGroup = filtersPanel(page).getByRole('radiogroup', { name: 'Cook time' });
        const under15 = cookTimeGroup.getByRole('radio', { name: 'Under 15 min' });
        await expect(under15).not.toBeChecked();
        await under15.click();

        await expect(under15).toBeChecked();
        await expect(page.getByRole('article', { name: 'Braised Short Ribs' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Pan-Seared Scallops' })).toBeVisible();
        await expect(discoverySentence(page, '1 recipe')).toHaveCount(1);

        // The URL now carries the filter (shareable / reload-safe).
        await expect(page).toHaveURL(/maxCookTime=15/);
    });

    test('narrows public recipes to a selected ingredient (FR-006 gap #3)', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                // Default ingredients (`utils/recipeApi.ts`'s `makeRecipeDetail`) are bound to the food `food_salt`
                // ("Salt") the mocked `/api/v1/ingredients/search` always returns, regardless of the typed query.
                makeRecipeDetail({ id: E2E_RECIPE_IDS.ramen, ownerId: 'usr_other', title: 'Weeknight Ramen Bowl' }),
                makeRecipeDetail({
                    id: E2E_RECIPE_IDS.fruitSalad,
                    ownerId: 'usr_other',
                    title: 'Tropical Fruit Salad',
                    ingredients: [
                        {
                            ingredientId: E2E_INGREDIENT_IDS.mango,
                            name: 'Mango',
                            foodId: 'food_mango',
                            quantity: { kind: 'exact', value: 1 },
                            unit: 'each',
                            isUserEntered: false,
                        },
                    ],
                }),
            ],
        });

        // BROWSE — both public recipes are on the curated surface before any filter is applied.
        await page.setViewportSize(PANEL_VIEWPORT);
        await page.goto(route('/discover'));
        await expect(page.getByRole('article', { name: 'Weeknight Ramen Bowl' }).first()).toBeVisible();
        await expect(page.getByRole('article', { name: 'Tropical Fruit Salad' }).first()).toBeVisible();

        // FILTER — typing an ingredient name surfaces the catalog match; picking it narrows the set. The
        // non-matching salad disappearing is the assertion that matters: it can only happen if
        // the salt FOOD id actually reached the API as a filter.
        // The option is addressed by its ACTION name ("Filter by Salt"), which is what makes it distinguishable
        // from the search box that now holds the typed query — a bare "Salt" would also match the field.
        await page.getByRole('searchbox', { name: 'Has ingredient' }).fill('sal');
        const saltResult = page.getByRole('button', { name: 'Filter by Salt' });
        await expect(saltResult).toBeVisible();
        await saltResult.click();

        await expect(page.getByRole('article', { name: 'Tropical Fruit Salad' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Weeknight Ramen Bowl' })).toBeVisible();
        await expect(discoverySentence(page, '1 recipe')).toHaveCount(1);

        // The picked ingredient renders as a removable chip, and the URL now carries it (shareable / reload-safe).
        const chip = page.getByRole('button', { name: 'Remove Salt' });
        await expect(chip).toBeVisible();
        await expect(page).toHaveURL(/foodId=food_salt/u);

        // Removing the chip clears the last criterion, so the surface returns to the curated browse default
        // (rails over the full public set), not a flat list — hence `.first()` again.
        await chip.click();
        await expect(page.getByRole('article', { name: 'Tropical Fruit Salad' }).first()).toBeVisible();
        await expect(page.getByRole('article', { name: 'Weeknight Ramen Bowl' }).first()).toBeVisible();
        await expect(chip).toHaveCount(0);
    });

    /**
     * Curated U15 (`docs/design/ingredientSpecialization.md` §S1, filter bar row): a filter takes a ROOT, so the bar
     * drops a variant's parts. The UI sends the root's id and neither the option nor the chip shows a part; the mock
     * matches a line by its `foodId`, which on a variant-bound line is its root. That the service expands a root to its
     * variants is recipe-service's own test (curated U9).
     */
    test('filters by a root and keeps the recipe whose line is bound to one of its variants (curated U15)', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({
                    id: E2E_RECIPE_IDS.shortRibs,
                    ownerId: 'usr_other',
                    title: 'Braised Brisket',
                    ingredients: [
                        {
                            ingredientId: 'db000000-0000-4000-8000-0000000000d1',
                            name: 'beef brisket',
                            // A variant-bound line's `foodId` is its live ROOT (curated U9).
                            foodId: 'food_beef_brisket',
                            variant: {
                                id: 'fdc:169432',
                                parts: [
                                    { attribute: 'cut', text: 'flat half' },
                                    { attribute: 'cookingMethod', text: 'braised' },
                                ],
                            },
                            quantity: { kind: 'exact', value: 2 },
                            unit: 'lb',
                            isUserEntered: false,
                        },
                    ],
                }),
                makeRecipeDetail({ id: E2E_RECIPE_IDS.ramen, ownerId: 'usr_other', title: 'Weeknight Ramen Bowl' }),
            ],
        });
        // Registered after the mock, so it wins: the ingredient search answers the brisket ROOT's binding.
        await page.route(
            (url) => url.pathname.endsWith('/api/v1/ingredients/search'),
            (request) =>
                request.fulfill({
                    json: [
                        {
                            id: 'db000000-0000-4000-8000-0000000000d1',
                            name: 'beef brisket',
                            foodId: 'food_beef_brisket',
                            isUserEntered: false,
                            createdAt: '2026-01-01T00:00:00.000Z',
                        },
                    ],
                }),
        );

        await page.setViewportSize(PANEL_VIEWPORT);
        await page.goto(route('/discover'));
        await page.getByRole('searchbox', { name: 'Has ingredient' }).fill('brisket');
        const option = page.getByRole('button', { name: 'Filter by beef brisket' });
        await expect(option).toHaveText('beef brisket');
        await option.click();

        await expect(page.getByRole('article', { name: 'Weeknight Ramen Bowl' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Braised Brisket' })).toBeVisible();
        const chip = page.getByRole('button', { name: 'Remove beef brisket' });
        await expect(chip).toBeVisible();
        await expect(chip).not.toContainText('flat half');
        await expect(page).toHaveURL(/foodId=food_beef_brisket/u);
    });

    /**
     * Curated U9 and spec §S8.1a "Focus at the cap": search filters on at most six foods. A shared URL fills five,
     * the cook adds the sixth by keyboard, and the note that replaces the search box takes focus (SC 2.4.3). Removing
     * a chip brings the box back with focus. Inline, at the project's laptop size; the phone's Sheet is below.
     */
    test('at six ingredients, the note replaces the search and takes focus (curated U9)', async ({ page }) => {
        await page.setViewportSize(PANEL_VIEWPORT);
        await seedFiveSharedFoods(page);
        await expect(page.getByRole('button', { name: 'Remove Food 4' })).toBeVisible();

        const search = page.getByRole('searchbox', { name: 'Has ingredient' });
        await addSaltByKeyboard(page);

        const note = page.getByText(CAP_NOTE, { exact: true });
        await expect(note).toBeFocused();
        await expect(search).toHaveCount(0);
        await expect(page).toHaveURL(/foodId=food_salt/u);

        await page.getByRole('button', { name: 'Remove Salt' }).click();

        await expect(search).toBeFocused();
        await expect(note).toHaveCount(0);
    });

    /**
     * The same cap on a phone, where the bar sits in the Sheet (curated U15, spec §S8.1a "Check inside the web Sheet"):
     * the note takes the search box's place and focus inside the Sheet, wraps at 320 px with no sideways scroll, and
     * removing a chip brings the box back with focus.
     */
    test('at six ingredients on a phone, the note replaces the search inside the Sheet (curated U9)', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await seedFiveSharedFoods(page);
        await page.getByRole('button', { name: 'Filters, 5 active' }).click();
        const sheet = page.getByRole('dialog', { name: 'Filters' });

        await addSaltByKeyboard(page);

        const note = sheet.getByText(CAP_NOTE, { exact: true });
        await expect(note).toBeFocused();
        await expect(sheet.getByRole('searchbox', { name: 'Has ingredient' })).toHaveCount(0);
        await expect(page).toHaveURL(/foodId=food_salt/u);
        const overflow = await page.evaluate(() => ({
            page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            sheet: Array.from(document.querySelectorAll('[role="dialog"]'), (box) => box.scrollWidth - box.clientWidth),
        }));
        expect(overflow).toEqual({ page: 0, sheet: [0] });

        await sheet.getByRole('button', { name: 'Remove Salt' }).click();

        await expect(sheet.getByRole('searchbox', { name: 'Has ingredient' })).toBeFocused();
        await expect(note).toHaveCount(0);
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
        await page.getByRole('searchbox', { name: 'Search recipes' }).fill('paella');
        await expect(discoverySentence(page, '1 recipe for “paella”')).toHaveCount(1);

        // S3 — the sort is a "Sort: {choice}" menu of four radio items with a check on the one in use; choosing Quickest
        // moves the selection there and names it on the button.
        await page.getByRole('button', { name: 'Sort: Relevance' }).click();
        await expect(page.getByRole('menuitemradio', { name: 'Relevance' })).toHaveAttribute('aria-checked', 'true');
        await page.getByRole('menuitemradio', { name: 'Quickest' }).click();
        await page.getByRole('button', { name: 'Sort: Quickest' }).click();
        await expect(page.getByRole('menuitemradio', { name: 'Quickest' })).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByRole('menuitemradio', { name: 'Relevance' })).toHaveAttribute('aria-checked', 'false');
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
        const searchBox = page.getByRole('searchbox', { name: 'Search recipes' });
        await searchBox.fill('paella');
        const previous = page.getByRole('article', { name: 'Seafood Paella' });
        await expect(previous).toBeVisible();
        await expect(discoverySentence(page, '1 recipe for “paella”')).toHaveCount(1);

        await searchBox.fill('pasta');
        await heldSearch;

        await expect(
            page.getByRole('region', { name: 'Search results' }).getByRole('article', { name: 'Seafood Paella' }),
        ).toBeVisible();
        await expect(searchBox).toHaveValue('pasta');
        await expect(discoverySentence(page, '1 recipe for “paella”')).toHaveCount(1);
        await expect(page.getByRole('status', { name: 'Loading recipes' })).toHaveCount(0);

        releaseSearch();

        const next = page.getByRole('article', { name: 'Weeknight Pasta' });
        await expect(next).toBeVisible();
        await expect(previous).toHaveCount(0);
        await expect(discoverySentence(page, '1 recipe for “pasta”')).toHaveCount(1);
        await expect(discoverySentence(page, '1 recipe for “paella”')).toHaveCount(0);
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

        await page.getByRole('searchbox', { name: 'Search your recipes' }).fill('soup');
        await expect(page.getByRole('article', { name: 'Weeknight Pasta' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Lentil Soup' })).toBeVisible();
        await expect(page.getByText('1 recipe')).toBeVisible();
    });
});
