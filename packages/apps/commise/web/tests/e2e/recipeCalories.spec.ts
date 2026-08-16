import { expect, test } from '@playwright/test';

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
 * ⛔ SELECTORS: `getByRole`/`getByLabel` only (repo policy — `data-testid` and `waitForTimeout` are banned).
 * The chip is a `role="img"` NAMED by its accessible label, deliberately, so it is reachable through the real
 * accessible-name computation rather than by reading an attribute (see `RecipeCalorieChip`'s docstring for
 * the ARIA rule that makes an `aria-label` on a bare `<span>` evaporate). The skeleton is located by its
 * visually-hidden TEXT, because it is deliberately NOT a live region — one per card would announce
 * "loading calories" once per card on entry.
 */
test.describe('recipe list — deferred calorie figures', () => {
    test('renders cards with calorie skeletons first, then fills in the figures', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);

        const pasta = makeRecipeDetail({
            id: 'rec_cal_1',
            ownerId: viewerId,
            title: 'Weeknight Pasta',
            nutrition: { calories: 420, proteinG: 12, carbsG: 40, fatG: 18, isComplete: true },
        });
        const roast = makeRecipeDetail({
            id: 'rec_cal_2',
            ownerId: viewerId,
            title: 'Sunday Roast',
            nutrition: { calories: 615, proteinG: 30, carbsG: 20, fatG: 35, isComplete: true },
        });

        // Hold the batch open until the cards have been asserted present. This is what makes the test about
        // ORDER rather than about the end state: without the gate, a fast local mock could resolve before the
        // first assertion and the spec would pass even if the page had blocked on the batch.
        let releaseBatch: (() => void) | undefined;
        const batchHeld = new Promise<void>((resolve) => {
            releaseBatch = resolve;
        });

        await mockRecipeApi(page, { recipes: [pasta, roast] });
        await page.route('**/api/v1/recipes/nutrition-batch', async (batchRoute) => {
            await batchHeld;
            await batchRoute.fallback();
        });

        await page.goto(route('/en/recipes'));

        // ── The promise of the design: the cards are on screen while the figures are still in flight.
        await expect(page.getByRole('button', { name: 'Weeknight Pasta' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sunday Roast' })).toBeVisible();
        await expect(page.getByText('Loading calories').first()).toBeVisible();
        await expect(page.getByRole('img', { name: '420 cal' })).toHaveCount(0);

        releaseBatch?.();

        // ── Then the figures land, each on its own card, and every skeleton is gone.
        await expect(page.getByRole('img', { name: '420 cal' })).toBeVisible();
        await expect(page.getByRole('img', { name: '615 cal' })).toBeVisible();
        await expect(page.getByText('Loading calories')).toHaveCount(0);
    });

    // ⛔ THE INVARIANT, in a real browser: a failed lookup is a terminal answer, never a spinner. On a card
    // that renders as nothing, so the assertion that matters is the ABSENCE of the skeleton alongside the
    // PRESENCE of the card — a crash would take both.
    test('leaves no spinner behind when the nutrition batch fails', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);

        await mockRecipeApi(page, {
            recipes: [makeRecipeDetail({ id: 'rec_cal_3', ownerId: viewerId, title: 'Weeknight Pasta' })],
        });
        await page.route('**/api/v1/recipes/nutrition-batch', (batchRoute) =>
            batchRoute.fulfill({ status: 503, json: { message: 'food service unavailable' } }),
        );

        await page.goto(route('/en/recipes'));

        await expect(page.getByRole('button', { name: 'Weeknight Pasta' })).toBeVisible();
        // The read seam retries once behind ~1s of backoff, so the skeleton legitimately outlives the first
        // failure; `toHaveCount(0)` retries until the terminal answer lands, without a banned fixed sleep.
        await expect(page.getByText('Loading calories')).toHaveCount(0);
        await expect(page.getByRole('img', { name: /cal$/ })).toHaveCount(0);
    });
});
