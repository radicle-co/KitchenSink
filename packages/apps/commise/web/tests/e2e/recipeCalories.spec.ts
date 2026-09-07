import { expect, test, type Page } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The deferred calorie lookup (ADR-0021), end to end through the real web UI — the tier that proves the
 * thing a component test structurally cannot: that the cards RENDER FIRST and the figures arrive AFTER,
 * over a real HTTP round trip, in a real browser, through the real Suspense boundaries.
 *
 * The whole design exists to keep a recipe card off the critical path of a food-service call. A component
 * test can assert each state in isolation; only this tier can assert the ORDER — cards present while the
 * batch is still in flight, then figures — which is the actual product promise. It is also the only place
 * the batch's request/response really crosses the wire, so a wrong URL, verb or body shape fails here rather
 * than in production.
 *
 * ⛔ THE RECIPE IDS ARE UUIDs, AND THAT IS LOAD-BEARING — not cosmetic tidiness.
 *
 * `recipeNutritionRequestSchema` is `z.array(z.uuid())`, and `RecipeServiceClient.getRecipeNutrition` PARSES
 * its outbound body against that schema before the call (`this.request(...)`). A readable slug id
 * (`rec_cal_1`) therefore throws `InvalidRequestError` **client-side, with no HTTP request at all** — so
 * `page.route('**\/api/v1/recipes/nutrition-batch')` never fires, the figure never lands, and, worse, a spec
 * asserting only the ABSENCE of a skeleton goes green having exercised nothing but a schema rejection. This
 * file's first cut did exactly that. It is the same trap `E2E_INGREDIENT_IDS` documents for ingredient ids,
 * one endpoint over — which is why every test below also asserts that the request REACHED the wire.
 *
 * ⛔ SELECTORS: role/label first (repo policy — `data-testid` and `waitForTimeout` are banned).
 *  - **The chip** is a `role="img"` NAMED by its accessible label, so it is reached through the real
 *    accessible-name computation rather than by reading an attribute (`getByLabelText` reads the ATTRIBUTE,
 *    and passed against a real defect where ARIA dropped the label from a role-less `<span>` entirely).
 *  - **`exact: true` on every chip name.** Playwright matches an accessible name as a case-insensitive
 *    SUBSTRING by default, so a bare `{ name: '420 cal' }` also matches `"420 cal, may be out of date"` and
 *    `"About 420 cal, …"` — i.e. it cannot tell a fresh figure from a stale or approximate one, which is
 *    precisely the distinction ADR-0021 §2/§4 makes load-bearing.
 *  - **The skeleton** is located by its visually-hidden TEXT, and asserted with `toBeAttached`, never
 *    `toBeVisible`. It is deliberately NOT a `role="status"` live region (a grid renders one per card; N live
 *    regions announce N times and never announce the answer), so there is no role to query, and its only
 *    handle is `sr-only` text — which is a 1×1 clipped box whose "visibility" is a property of Playwright's
 *    heuristic rather than of this feature. `toBeAttached` states the claim that is actually being made (the
 *    placeholder is MOUNTED while the batch is in flight) and cannot turn red because a hidden-text
 *    convention changed. The card around it is asserted visible separately.
 */

/**
 * Recipe ids for this suite. UUID-shaped (v4 layout) because the published request schema demands it — see
 * the module docstring; a slug here silently removes the whole feature from the test.
 */
const RECIPE_ID = {
    pasta: 'aaaaaaaa-1111-4111-8111-111111111111',
    roast: 'bbbbbbbb-2222-4222-8222-222222222222',
    soup: 'cccccccc-3333-4333-8333-333333333333',
} as const;

/** Wire-shaped `known` reading, spelled out rather than derived — the response envelope is STRICT. */
function known(
    caloriesPerServing: number,
    over: { readonly isComplete?: boolean; readonly freshness?: 'fresh' | 'stale' } = {},
): Record<string, unknown> {
    return {
        state: 'known',
        caloriesPerServing,
        // The `known` member is `.strict()` and requires all three macros: an omitted key is dropped by
        // `route.fulfill({ json })`, the client's response parse fails, and the card renders BLANK — a
        // silent pass-shaped failure. Stated in full so that can never happen by accident.
        proteinG: 12,
        carbsG: 40,
        fatG: 18,
        isComplete: over.isComplete ?? true,
        freshness: over.freshness ?? 'fresh',
    };
}

/** What one intercepted batch endpoint recorded. */
interface BatchIntercept {
    /** The `recipeIds` of every batch request that actually CROSSED THE WIRE, in order. */
    readonly requests: readonly (readonly string[])[];
}

/**
 * Intercept `POST /api/v1/recipes/nutrition-batch`, recording every request and answering with an explicit
 * map.
 *
 * The map is stated per test rather than derived from the mock's recipe store on purpose: omission, staleness
 * and `unaccounted` are properties of the RESPONSE, not of a recipe, and the store cannot express them. It is
 * registered AFTER `mockRecipeApi`, so it wins (Playwright runs matching routes in reverse registration
 * order).
 *
 * @param page - The Playwright page.
 * @param nutrition - The response's `nutrition` map. An id left out of it is OMITTED, which is the wire's
 *   way of saying "not for you" (ADR-0021 §3).
 * @param gate - Held until resolved before answering, so a test can assert the in-flight state first.
 * @returns The live record of requests that reached the endpoint.
 * @sideEffect Registers a `page.route` handler.
 */
async function interceptNutritionBatch(
    page: Page,
    nutrition: Readonly<Record<string, unknown>>,
    gate?: Promise<void>,
): Promise<BatchIntercept> {
    const requests: string[][] = [];

    await page.route('**/api/v1/recipes/nutrition-batch', async (batchRoute) => {
        const body = JSON.parse(batchRoute.request().postData() ?? '{}') as { recipeIds?: readonly string[] };
        requests.push([...(body.recipeIds ?? [])]);

        if (gate !== undefined) {
            await gate;
        }

        await batchRoute.fulfill({ json: { nutrition } });
    });

    return { requests };
}

test.describe('recipe list — deferred calorie figures', () => {
    test('renders cards with calorie skeletons first, then fills in the figures', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);

        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: RECIPE_ID.pasta, ownerId: viewerId, title: 'Weeknight Pasta' }),
                makeRecipeDetail({ id: RECIPE_ID.roast, ownerId: viewerId, title: 'Sunday Roast' }),
            ],
        });

        // Hold the batch open until the cards have been asserted present. This is what makes the test about
        // ORDER rather than about the end state: without the gate, a fast local mock could resolve before the
        // first assertion and the spec would pass even if the page had blocked on the batch.
        let releaseBatch = (): void => undefined;
        const batchHeld = new Promise<void>((resolve) => {
            releaseBatch = resolve;
        });
        const batch = await interceptNutritionBatch(
            page,
            { [RECIPE_ID.pasta]: known(420), [RECIPE_ID.roast]: known(615) },
            batchHeld,
        );

        await page.goto(route('/recipes'));

        // ── The promise of the design: the cards are on screen while the figures are still in flight.
        await expect(page.getByRole('button', { name: 'Weeknight Pasta' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sunday Roast' })).toBeVisible();
        await expect(page.getByText('Loading calories').first()).toBeAttached();
        await expect(page.getByRole('img', { name: '420 cal', exact: true })).toHaveCount(0);

        releaseBatch();

        // ── Then the figures land, each on its own card, and every skeleton is gone.
        await expect(page.getByRole('img', { name: '420 cal', exact: true })).toBeVisible();
        await expect(page.getByRole('img', { name: '615 cal', exact: true })).toBeVisible();
        await expect(page.getByText('Loading calories')).toHaveCount(0);

        // ⛔ ONE REQUEST FOR THE WHOLE PAGE, carrying BOTH ids — the central claim of ADR-0021 §6 ("N
        // boundaries over one promise cost one fetch"), and the one that fails silently: per-card promises
        // render identically and issue N requests. Asserting the recorded body is also what makes every
        // assertion above non-vacuous, since a client-side schema rejection reaches this endpoint zero times.
        expect(batch.requests).toHaveLength(1);
        expect([...(batch.requests[0] ?? [])].sort()).toStrictEqual([RECIPE_ID.pasta, RECIPE_ID.roast].sort());
    });

    // ⛔ THE THREE-WAY DISTINCTION, in a real browser (ADR-0021 §2/§3). `known`, `unaccounted` and OMITTED are
    // three different facts, two of which render identically (nothing) — which is exactly why they are so easy
    // to conflate in code and so hard to catch in review. The card that renders nothing must still be a whole,
    // present card with no skeleton left running: absence of a figure, never absence of an answer.
    test('renders a figure, a blank for an unaccounted reading, and a blank for an omitted recipe', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);

        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: RECIPE_ID.pasta, ownerId: viewerId, title: 'Weeknight Pasta' }),
                makeRecipeDetail({ id: RECIPE_ID.roast, ownerId: viewerId, title: 'Sunday Roast' }),
                makeRecipeDetail({ id: RECIPE_ID.soup, ownerId: viewerId, title: 'Tomato Soup' }),
            ],
        });
        const batch = await interceptNutritionBatch(page, {
            [RECIPE_ID.pasta]: known(420),
            [RECIPE_ID.roast]: { state: 'unaccounted', reason: 'no_resolved_ingredients' },
            // `soup` is deliberately ABSENT from the map — the wire's non-disclosing representation of a
            // recipe the caller may not read. It must render blank, and it must NOT borrow `unaccounted`'s
            // meaning (which would claim food had failed) or leave a skeleton up.
        });

        await page.goto(route('/recipes'));

        const pasta = page.getByRole('button', { name: 'Weeknight Pasta' });
        const roast = page.getByRole('button', { name: 'Sunday Roast' });
        const soup = page.getByRole('button', { name: 'Tomato Soup' });

        // All three cards are whole and present — without this, "no chip" would also be satisfied by a card
        // that crashed its boundary and rendered nothing at all.
        await expect(pasta).toBeVisible();
        await expect(roast).toBeVisible();
        await expect(soup).toBeVisible();

        await expect(pasta.getByRole('img', { name: '420 cal', exact: true })).toBeVisible();

        // Both blanks, asserted INSIDE their own card so a page-level absence cannot satisfy them.
        for (const card of [roast, soup]) {
            await expect(card.getByRole('img', { name: /\d+ cal/ })).toHaveCount(0);
            await expect(card.getByText('Loading calories')).toHaveCount(0);
        }

        expect(batch.requests).toHaveLength(1);
    });

    // ⛔ KTD-3b — "serve stale, MARKED" — and the half of it that shipped unmarked for two releases: the
    // caveat must reach the COMPUTED ACCESSIBLE NAME, not merely the styling. `exact: true` is what proves it:
    // the plain name must NOT match a qualified chip, and the qualified name must match in full.
    test('marks a stale and an incomplete reading in the accessible name, not only in styling', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);

        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({ id: RECIPE_ID.pasta, ownerId: viewerId, title: 'Weeknight Pasta' }),
                makeRecipeDetail({ id: RECIPE_ID.roast, ownerId: viewerId, title: 'Sunday Roast' }),
                makeRecipeDetail({ id: RECIPE_ID.soup, ownerId: viewerId, title: 'Tomato Soup' }),
            ],
        });
        await interceptNutritionBatch(page, {
            [RECIPE_ID.pasta]: known(420),
            [RECIPE_ID.roast]: known(615, { freshness: 'stale' }),
            [RECIPE_ID.soup]: known(250, { isComplete: false }),
        });

        await page.goto(route('/recipes'));

        // Fresh + complete: the visible text IS the whole truth, so name and text agree.
        const fresh = page.getByRole('img', { name: '420 cal', exact: true });
        await expect(fresh).toBeVisible();
        await expect(fresh).toHaveText('420 cal');

        // Stale: the caveat lives in the NAME while the visible text stays the bare figure (the second
        // channel is the italic, which a screen reader cannot hear).
        const stale = page.getByRole('img', { name: '615 cal, may be out of date', exact: true });
        await expect(stale).toBeVisible();
        await expect(stale).toHaveText('615 cal');
        // …and it is therefore DISTINGUISHABLE: the unqualified name must not match it.
        await expect(page.getByRole('img', { name: '615 cal', exact: true })).toHaveCount(0);

        // Incomplete: the approximation marker is visible (`~`) AND spelled out in the name — a whole
        // sentence, not the figure with a suffix concatenated on (see `messages.ts`).
        const approximate = page.getByRole('img', {
            name: 'About 250 cal, some items aren’t counted yet',
            exact: true,
        });
        await expect(approximate).toBeVisible();
        await expect(approximate).toHaveText('~250 cal');
        await expect(page.getByRole('img', { name: '250 cal', exact: true })).toHaveCount(0);
    });

    // ⛔ THE INVARIANT, in a real browser: a failed lookup is a terminal answer, never a spinner. On a card
    // that renders as nothing, so the assertion that matters is the ABSENCE of the skeleton alongside the
    // PRESENCE of the card — a crash would take both.
    test('leaves no spinner behind when the nutrition batch fails', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);

        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ id: RECIPE_ID.pasta, ownerId: viewerId, title: 'Weeknight Pasta' })],
        });

        const attempts: string[] = [];
        await page.route('**/api/v1/recipes/nutrition-batch', (batchRoute) => {
            attempts.push(batchRoute.request().method());

            return batchRoute.fulfill({ status: 503, json: { message: 'food service unavailable' } });
        });

        await page.goto(route('/recipes'));

        await expect(page.getByRole('button', { name: 'Weeknight Pasta' })).toBeVisible();
        // The read seam retries once behind ~1s of backoff (`NUTRITION_BATCH_RETRIES`), so the skeleton
        // legitimately outlives the first failure; `toHaveCount(0)` retries until the terminal answer lands,
        // without a banned fixed sleep.
        await expect(page.getByText('Loading calories')).toHaveCount(0);
        await expect(page.getByRole('img', { name: /\d+ cal/ })).toHaveCount(0);

        // ⛔ The endpoint was actually REACHED and actually failed. Without this the two assertions above are
        // satisfied by a batch that was never sent at all (a rejected request body, a surface that stopped
        // mounting the slot), which is a green test over a deleted feature.
        expect(attempts.length).toBeGreaterThan(0);
        expect(attempts).toContain('POST');
    });
});

// The Home widget is a SECOND card surface with its own batch (`RecipeWidgetSlot` caps the ids to the four
// cards it paints) and its own `next/dynamic` + Suspense hop in front of it. It was wired last, so it is the
// one most likely to have been left rendering no nutrition line at all — a state that looks exactly like a
// recipe with no data and is invisible to every list-surface assertion above.
test.describe('home widget — deferred calorie figures', () => {
    test('fills in the figures on the recent-recipes cards', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);

        await mockRecipeApi(page, {
            viewerId,
            tier: 'free',
            recipes: [
                makeRecipeDetail({ id: RECIPE_ID.pasta, ownerId: viewerId, title: 'Weeknight Pasta' }),
                makeRecipeDetail({ id: RECIPE_ID.roast, ownerId: viewerId, title: 'Sunday Roast' }),
            ],
        });
        const batch = await interceptNutritionBatch(page, {
            [RECIPE_ID.pasta]: known(420),
            [RECIPE_ID.roast]: known(615),
        });

        // Reload Home so the widget fetches against the mock (the landing after sign-in fired before
        // interception was installed).
        await page.goto(route('/'));

        const widget = page.getByRole('region', { name: 'Recent recipes' });
        await expect(widget).toBeVisible();
        await expect(widget.getByRole('button', { name: 'Weeknight Pasta' })).toBeVisible();

        await expect(widget.getByRole('img', { name: '420 cal', exact: true })).toBeVisible();
        await expect(widget.getByRole('img', { name: '615 cal', exact: true })).toBeVisible();
        await expect(widget.getByText('Loading calories')).toHaveCount(0);

        expect(batch.requests).toHaveLength(1);
    });
});
