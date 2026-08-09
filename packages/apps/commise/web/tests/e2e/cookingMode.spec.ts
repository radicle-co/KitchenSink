import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Cooking Mode web journey (feature 008 / T-019, US-001…US-005 + US-007) — driven through the real UI:
 * Next dev server, a live Clerk session, the recipe-detail route's own "Start cooking" entry point, and
 * `CookingModeContainer` → `CookingModeScreen` → `useCookingSession` wired to the REAL browser
 * `localStorage` session store. Only the recipe-service HTTP contract is intercepted (`utils/recipeApi`);
 * the recipe service's own behaviour is covered by its e2e + k6 tiers.
 *
 * Cooking Mode adds no endpoint, so the fixture is just a recipe: three steps (so "first", "middle" and
 * "last" are genuinely different states), the middle one carrying a 120-second timer (long enough that a
 * countdown TICK is observable without ever sleeping — the readout crossing 2:00 → 1:5x IS the proof it
 * is counting), and two ingredients with units, so yield scaling has something to actually rescale.
 *
 * Selectors are role/label only (repo policy): the step position is a heading, navigation and timers are
 * buttons, each countdown is an ARIA `timer` named by its step, each ingredient line is a `checkbox`
 * named by its scaled quantity, the yield control is a `radiogroup` of named `radio`s, and the
 * cook-times-are-not-scaled advisory is an `alert`. No `data-testid`, and no `page.waitForTimeout()` —
 * every wait below is a retrying web-first assertion.
 *
 * Requirement → test:
 * - US-001 entry + FR-032 one step at a time → "enters Cooking Mode from the recipe and shows the first step"
 * - FR-033 forward/backward without losing position, and the 24h resume → "advances, steps back…"
 * - FR-034 step timers → "starts a step timer and the countdown ticks down"
 * - FR-032a ingredient checkoff + FR-034a scaling (spec D-002 advisory) → "checks off an ingredient…"
 * - Finishing clears the session (vs exiting, which preserves it) → "finishing the last step ends the session"
 */
const RECIPE_ID = 'rec_cook';

/** The middle step's instruction — also the accessible NAME of the timer it starts (`CookingTimer.label`). */
const TIMED_STEP = 'Simmer the sauce, stirring now and then.';

/** Seed the recipe-service mock with a three-step, two-ingredient recipe and open its detail page. */
async function openRecipeDetail(page: Page): Promise<void> {
    const viewerId = await readViewerAppId(page);
    const recipe = makeRecipeDetail({
        id: RECIPE_ID,
        ownerId: viewerId,
        title: 'Weeknight Pasta',
        ingredients: [
            { ingredientId: 'ing_salt', name: 'Salt', quantity: 1, unit: 'tsp', isUserEntered: false },
            { ingredientId: 'ing_pasta', name: 'Pasta', quantity: 200, unit: 'g', isUserEntered: false },
        ],
        steps: [
            { stepNumber: 1, instruction: 'Bring a large pot of salted water to the boil.' },
            { stepNumber: 2, instruction: TIMED_STEP, timerSeconds: 120 },
            { stepNumber: 3, instruction: 'Drain the pasta and serve.' },
        ],
    });
    await mockRecipeApi(page, { viewerId, recipes: [recipe] });

    await page.goto(route(`/recipes/${RECIPE_ID}`));
    await expect(page.getByRole('link', { name: 'Start cooking' })).toBeVisible();
}

/** Enter Cooking Mode from the recipe-detail page — the only web entry point into it. */
async function startCooking(page: Page): Promise<void> {
    await page.getByRole('link', { name: 'Start cooking' }).click();
}

test.describe('cooking mode (feature 008)', () => {
    test('enters Cooking Mode from the recipe and shows the first step', async ({ page }) => {
        await signInWithTicket(page);
        await openRecipeDetail(page);

        await startCooking(page);

        await expect(page).toHaveURL(new RegExp(`${route(`/recipes/${RECIPE_ID}/cook`)}$`));
        await expect(page.getByRole('heading', { name: 'Step 1 of 3' })).toBeVisible();
        await expect(page.getByText('Bring a large pot of salted water to the boil.')).toBeVisible();
        // The first step states its boundary rather than hiding the control (FR-033).
        await expect(page.getByRole('button', { name: 'Previous step' })).toHaveAttribute('aria-disabled', 'true');
    });

    test('advances, steps back, and keeps its place across leaving and re-entering', async ({ page }) => {
        await signInWithTicket(page);
        await openRecipeDetail(page);
        await startCooking(page);
        await expect(page.getByRole('heading', { name: 'Step 1 of 3' })).toBeVisible();

        // Forward through the recipe. The last step swaps the Next zone for the finish affordance.
        await page.getByRole('button', { name: 'Next step' }).click();
        await expect(page.getByRole('heading', { name: 'Step 2 of 3' })).toBeVisible();
        await page.getByRole('button', { name: 'Next step' }).click();
        await expect(page.getByRole('heading', { name: 'Step 3 of 3' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Next step' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Finish cooking' })).toBeVisible();

        // Backward, without losing the position reached (FR-033).
        await page.getByRole('button', { name: 'Previous step' }).click();
        await expect(page.getByRole('heading', { name: 'Step 2 of 3' })).toBeVisible();
        await expect(page.getByText(TIMED_STEP)).toBeVisible();

        // Leaving mid-cook keeps the session resumable (US-007 / FR-033): re-entering lands back on the
        // step the cook left, not at the top of the recipe.
        await page.getByRole('button', { name: 'Exit cooking mode' }).click();
        await expect(page.getByRole('link', { name: 'Start cooking' })).toBeVisible();

        await startCooking(page);
        await expect(page.getByRole('heading', { name: 'Step 2 of 3' })).toBeVisible();
    });

    test('starts a step timer and the countdown ticks down', async ({ page }) => {
        await signInWithTicket(page);
        await openRecipeDetail(page);
        await startCooking(page);

        await page.getByRole('button', { name: 'Next step' }).click();
        await expect(page.getByRole('heading', { name: 'Step 2 of 3' })).toBeVisible();

        await page.getByRole('button', { name: 'Start timer' }).click();

        const countdown = page.getByRole('timer', { name: TIMED_STEP });
        await expect(countdown).toBeVisible();
        // Counting down, observed rather than assumed: the readout starts at 2:00 and must reach 1:5x on
        // its own. A retrying assertion is what makes this deterministic without a fixed sleep.
        await expect(countdown).toHaveText(/^1:5\d$/);

        // Pause/resume is stated in WORDS, not colour (NFR-004): the control becomes its own inverse. That
        // a paused countdown holds its remainder is proven deterministically in the domain's unit tier —
        // asserting "the text did not change" here could only ever be a snapshot of one instant.
        await page.getByRole('button', { name: 'Pause timer' }).click();
        await expect(page.getByRole('button', { name: 'Resume timer' })).toBeVisible();
        await page.getByRole('button', { name: 'Resume timer' }).click();
        await expect(page.getByRole('button', { name: 'Pause timer' })).toBeVisible();

        await page.getByRole('button', { name: 'Cancel timer' }).click();
        await expect(page.getByRole('timer', { name: TIMED_STEP })).toHaveCount(0);
    });

    test('checks off an ingredient and rescales the yield without scaling cook times', async ({ page }) => {
        await signInWithTicket(page);
        await openRecipeDetail(page);
        await startCooking(page);
        await expect(page.getByRole('heading', { name: 'Step 1 of 3' })).toBeVisible();

        // The ingredient list opens over the step and is dismissible without leaving it (FR-032a).
        await page.getByRole('button', { name: 'Ingredients' }).click();

        const salt = page.getByRole('checkbox', { name: '1 tsp Salt' });
        await expect(salt).not.toBeChecked();
        await salt.click();
        await expect(salt).toBeChecked();
        await expect(page.getByRole('status', { name: '1 of 2 checked' })).toBeVisible();
        // Still on the same step — checking an ingredient never navigates.
        await expect(page.getByRole('heading', { name: 'Step 1 of 3' })).toBeVisible();

        // Yield scaling rescales QUANTITIES only, and says so (FR-034a / spec D-002).
        await expect(page.getByRole('radio', { name: '1x' })).toBeChecked();
        await page.getByRole('radio', { name: '2x' }).click();

        // Scoped to `main`: Next.js always renders its own empty `role="alert"` route announcer
        // (`#__next-route-announcer__`) outside the page content, so a bare `getByRole('alert')`
        // matches two elements and trips Playwright's strict mode.
        await expect(page.getByRole('main').getByRole('alert')).toHaveText(
            'Quantities are scaled. Cook times are not — check for doneness as you go.',
        );
        // The rescaled line keeps its checked state — checkoff is per ingredient, not per quantity.
        await expect(page.getByRole('checkbox', { name: '2 tsp Salt' })).toBeChecked();
        await expect(page.getByRole('checkbox', { name: '400 g Pasta' })).not.toBeChecked();

        await page.getByRole('button', { name: 'Close ingredients' }).click();
        await expect(page.getByRole('checkbox', { name: '2 tsp Salt' })).toHaveCount(0);
    });

    test('finishing the last step ends the session, so the next cook starts from the top', async ({ page }) => {
        await signInWithTicket(page);
        await openRecipeDetail(page);
        await startCooking(page);
        await expect(page.getByRole('heading', { name: 'Step 1 of 3' })).toBeVisible();

        await page.getByRole('button', { name: 'Next step' }).click();
        await page.getByRole('button', { name: 'Next step' }).click();
        await expect(page.getByRole('heading', { name: 'Step 3 of 3' })).toBeVisible();

        await page.getByRole('button', { name: 'Finish cooking' }).click();
        await expect(page.getByRole('link', { name: 'Start cooking' })).toBeVisible();

        // FINISHING clears the stored session (unlike exiting, which preserves it) — the contrast with the
        // resume assertion above is the whole point: cooking the recipe again begins at step one.
        await startCooking(page);
        await expect(page.getByRole('heading', { name: 'Step 1 of 3' })).toBeVisible();
    });
});
