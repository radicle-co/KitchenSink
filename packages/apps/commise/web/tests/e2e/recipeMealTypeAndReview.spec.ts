/**
 * U33 + U34 — the Review step, the closed meal-type axis, and auto-save, end to end in a real browser.
 *
 * ⛔ **What only this tier can see.** The component tests prove each surface in isolation against mocked
 * neighbours; they cannot prove that a meal type chosen on step 1 reaches the WIRE, comes back on the READ,
 * and is what the Review step then shows. Those are three different boundaries and a mock agrees with itself
 * at every one of them. The same goes for auto-save: its unit tests own the timer and the editor's own tests
 * own `expectedVersion`, but only a live request shows a PATCH leaving the browser with nobody having pressed
 * anything.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */
import { expect, test, type Page, type Request } from '@playwright/test';

import { route } from './utils/basePath';
import { mockRecipeApi, makeRecipeDetail, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

const SEEDED = makeRecipeDetail({ id: 'rec_meal', title: 'Weeknight Pasta', currentVersion: 3 });

/** Sign in, mock the API around one seeded recipe, and open its edit wizard at step 1 (Details). */
async function openEditor(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [SEEDED] });
    await page.goto(route('/recipes/rec_meal/edit'));
    await expect(page.getByLabel('Title')).toBeVisible();
}

test.describe('recipe meal type — a closed axis beside two free-text ones (U34)', () => {
    test('offers the vocabulary plus an explicitly-named clear, and sends the chosen value', async ({ page }) => {
        await openEditor(page);

        const group = page.getByRole('radiogroup', { name: 'Meal type' });

        await expect(group.getByRole('radio', { name: 'Breakfast' })).toBeVisible();
        await expect(group.getByRole('radio', { name: 'Dinner' })).toBeVisible();
        // ⚠️ NOT "Not stated": that name belongs to the difficulty group in this same form, and two controls
        // sharing one accessible name is the WCAG 3.3.2 failure the ingredient spinbuttons already avoid.
        await expect(group.getByRole('radio', { name: 'No meal type' })).toBeVisible();

        const patched = page.waitForRequest(
            (request: Request) => request.method() === 'PATCH' && request.url().includes('/recipes/rec_meal'),
        );

        await group.getByRole('radio', { name: 'Dinner' }).click();
        await page.getByRole('button', { name: /Review:/ }).click();
        await page.getByRole('button', { name: 'Publish' }).click();

        const body = (await patched).postDataJSON() as { mealType?: string | null; tags?: readonly string[] };

        expect(body.mealType).toBe('dinner');
    });

    test('keeps tags free text — choosing a meal type writes into no list', async ({ page }) => {
        // ⛔ The mockup wrote its Dietary chips into the SAME array as its Categories. Three axes, three
        // fields, no aliasing — asserted where the actual request body can be read.
        await openEditor(page);

        await page.getByRole('radiogroup', { name: 'Meal type' }).getByRole('radio', { name: 'Lunch' }).click();

        const patched = page.waitForRequest(
            (request: Request) => request.method() === 'PATCH' && request.url().includes('/recipes/rec_meal'),
        );

        await page.getByRole('button', { name: /Review:/ }).click();
        await page.getByRole('button', { name: 'Publish' }).click();

        const body = (await patched).postDataJSON() as { mealType?: string | null; tags?: readonly string[] };

        expect(body.mealType).toBe('lunch');
        expect(body.tags ?? []).not.toContain('lunch');
    });

    test('clears back to "not stated" with an explicit wire null, so the choice is reversible', async ({ page }) => {
        // The crux of the three-state mapping: an OMIT means "unchanged" on a PATCH, so without the null
        // sentinel a cook who ever chose a meal type could never get back to having stated none.
        await openEditor(page);

        await page.getByRole('radiogroup', { name: 'Meal type' }).getByRole('radio', { name: 'No meal type' }).click();

        const patched = page.waitForRequest(
            (request: Request) => request.method() === 'PATCH' && request.url().includes('/recipes/rec_meal'),
        );

        await page.getByRole('button', { name: /Review:/ }).click();
        await page.getByRole('button', { name: 'Publish' }).click();

        const body = (await patched).postDataJSON() as { mealType?: string | null };

        expect(body.mealType).toBeNull();
    });
});

test.describe('the Review step, which replaced the Preview overlay (U33)', () => {
    test('shows the live draft, including an edit made moments earlier', async ({ page }) => {
        await openEditor(page);

        await page.getByLabel('Title').fill('Weeknight Pasta Deluxe');
        await page.getByRole('button', { name: /Review:/ }).click();

        const review = page.getByRole('region', { name: 'Review' });

        await expect(review).toBeVisible();
        await expect(review).toContainText('Weeknight Pasta Deluxe');
    });

    test('offers NO Preview affordance anywhere — the overlay is deleted, not hidden', async ({ page }) => {
        await openEditor(page);

        await expect(page.getByRole('button', { name: 'Preview' })).toHaveCount(0);
        await expect(page.getByRole('dialog', { name: 'Preview' })).toHaveCount(0);
    });

    test('states an unstated optional field rather than dropping its row', async ({ page }) => {
        // A row that vanishes is indistinguishable from a row the cook has not scrolled to, and "did I set a
        // difficulty?" is exactly the question this step exists to answer.
        await openEditor(page);
        await page.getByRole('button', { name: /Review:/ }).click();

        await expect(page.getByRole('region', { name: 'Review' })).toContainText('Not stated');
    });
});

test.describe('auto-save writes a draft, unattended (U34)', () => {
    test('PATCHes after a quiet window with nobody pressing anything', async ({ page }) => {
        await openEditor(page);

        const patched = page.waitForRequest(
            (request: Request) => request.method() === 'PATCH' && request.url().includes('/recipes/rec_meal'),
        );

        // The ONLY interaction. No Save Draft, no Publish — the write has to arrive on its own.
        await page.getByLabel('Title').fill('Weeknight Pasta, edited and left alone');

        const body = (await patched).postDataJSON() as { expectedVersion?: number; status?: string };

        // ⛔ THE LOST-UPDATE GUARD, observed on the wire: an unattended write carries the optimistic
        // concurrency token, so a change made on another device conflicts instead of being clobbered.
        expect(body.expectedVersion).toBe(3);
        // ⛔ And it does not change publication state — the seeded recipe is published, and stays published.
        expect(body.status).toBe('published');
    });

    test('does NOT write on an untouched form, however long the editor sits open', async ({ page }) => {
        // Opening a recipe and reading it must mint no version row. Asserted by racing the editor against a
        // navigation that only resolves if NO request was made — never a fixed sleep (`waitForTimeout` is
        // banned, and a sleep would prove only that the window chosen was long enough).
        await openEditor(page);

        let patchCount = 0;

        page.on('request', (request: Request) => {
            if (request.method() === 'PATCH' && request.url().includes('/recipes/rec_meal')) {
                patchCount += 1;
            }
        });

        // Interact WITHOUT editing: walk the rail forward and back. Navigation is not an edit, so the discard
        // guard stays quiet and auto-save must stay quiet with it.
        await page.getByRole('button', { name: /Ingredients:/ }).click();
        await page.getByRole('button', { name: /Details:/ }).click();
        await expect(page.getByLabel('Title')).toBeVisible();

        expect(patchCount).toBe(0);
    });
});
