/**
 * U34 — the closed meal-type axis, end to end in a real browser, and the one-page editor's unattended save.
 *
 * ⛔ **What only this tier can see.** The component tests prove each surface in isolation against mocked
 * neighbours; they cannot prove that a meal type chosen in Details reaches the WIRE. The same goes for the editor's
 * unattended save: `useRecipeEditor`'s own tests own the checkpoint policy and `expectedVersion`, but only a live
 * request shows a PATCH leaving the browser with nobody having pressed anything.
 *
 * REWRITTEN for slice 7. The wizard's Review step and the five-minute auto-save are retired:
 *  - the meal-type cases now save through Save changes (the seed is published, so that is its one write, D1), and the
 *    chip row clears a choice by pressing it again, so there is no "No meal type" option to choose;
 *  - "Review shows the live draft" became the Preview sheet's case (the Preview is back, drawn from the draft);
 *    "no Preview affordance" and "Review states an unstated field" were deleted with the Review step;
 *  - the auto-save cases became checkpoint cases: a NEVER-PUBLISHED draft writes when the tab hides, a published
 *    recipe writes nothing without Save changes however long it sits, and an untouched draft writes nothing. The
 *    "deadline for a cook who never stops typing" case went with the interval it tested; the checkpoint triggers are
 *    `useRecipeEditor.test.tsx`'s.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */
import { expect, test, type Page, type Request } from '@playwright/test';

import { mockRecipeApi, makeRecipeDetail, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { openRecipeEditor } from './utils/recipeEditor';

const SEEDED = makeRecipeDetail({
    id: 'ec000000-0000-4000-8000-000000000014',
    title: 'Weeknight Pasta',
    currentVersion: 3,
});

/** Sign in, mock the API around one seeded recipe (published unless `over` says otherwise), and open its editor. */
async function openEditor(page: Page, over: Partial<typeof SEEDED> = {}): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [{ ...SEEDED, ...over }] });
    await openRecipeEditor(page, 'ec000000-0000-4000-8000-000000000014');
    await expect(page.getByLabel('Title')).toBeVisible();
}

/** Hide the tab, as switching away does: TanStack's focus manager reads `visibilityState` on `visibilitychange`. */
async function hideTab(page: Page): Promise<void> {
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        window.dispatchEvent(new Event('visibilitychange'));
    });
}

/** Whether a request is a write to the seeded recipe. */
const isRecipePatch = (request: Request): boolean =>
    request.method() === 'PATCH' &&
    /\/api\/v1\/recipes\/ec000000-0000-4000-8000-000000000014(?:\?|$)/u.test(request.url());

test.describe('recipe meal type — a closed axis beside two free-text ones (U34)', () => {
    test('offers the vocabulary, and sends the chosen value', async ({ page }) => {
        await openEditor(page);

        const group = page.getByRole('radiogroup', { name: 'Meal type' });

        await expect(group.getByRole('radio', { name: 'Breakfast' })).toBeVisible();
        await expect(group.getByRole('radio', { name: 'Dinner' })).toBeVisible();

        const patched = page.waitForRequest(isRecipePatch);

        await group.getByRole('radio', { name: 'Dinner' }).click();
        await page.getByRole('button', { name: 'Save changes' }).click();

        const body = (await patched).postDataJSON() as { mealType?: string | null; tags?: readonly string[] };

        expect(body.mealType).toBe('dinner');
    });

    test('keeps tags free text — choosing a meal type writes into no list', async ({ page }) => {
        // ⛔ The mockup wrote its Dietary chips into the SAME array as its Categories. Three axes, three
        // fields, no aliasing — asserted where the actual request body can be read.
        await openEditor(page);

        await page.getByRole('radiogroup', { name: 'Meal type' }).getByRole('radio', { name: 'Lunch' }).click();

        const patched = page.waitForRequest(isRecipePatch);

        await page.getByRole('button', { name: 'Save changes' }).click();

        const body = (await patched).postDataJSON() as { mealType?: string | null; tags?: readonly string[] };

        expect(body.mealType).toBe('lunch');
        expect(body.tags ?? []).not.toContain('lunch');
    });

    test('clears back to "not stated" with an explicit wire null, so the choice is reversible', async ({ page }) => {
        // The crux of the three-state mapping: an OMIT means "unchanged" on a PATCH, so without the null
        // sentinel a cook who ever chose a meal type could never get back to having stated none.
        await openEditor(page, { mealType: 'dinner' });

        const dinner = page.getByRole('radiogroup', { name: 'Meal type' }).getByRole('radio', { name: 'Dinner' });
        await expect(dinner).toBeChecked();
        // Pressing the chosen chip again clears it: the row has no "none" option of its own.
        await dinner.click();
        await expect(dinner).not.toBeChecked();

        const patched = page.waitForRequest(isRecipePatch);

        await page.getByRole('button', { name: 'Save changes' }).click();

        const body = (await patched).postDataJSON() as { mealType?: string | null };

        expect(body.mealType).toBeNull();
    });
});

test.describe('the Preview, drawn from the draft (build spec §7.7 item 4)', () => {
    test('shows the live draft, including an edit made moments earlier', async ({ page }) => {
        await openEditor(page);

        await page.getByLabel('Title').fill('Weeknight Pasta Deluxe');
        await page.getByRole('button', { name: 'Preview' }).click();

        const preview = page.getByRole('dialog', { name: 'Preview' });

        await expect(preview).toBeVisible();
        await expect(preview.getByRole('heading', { level: 1, name: 'Weeknight Pasta Deluxe' })).toBeVisible();
    });
});

test.describe('the editor saves unattended at a checkpoint, and never a published recipe (slice 7, D1)', () => {
    test('a never-published draft PATCHes when the tab hides, with nobody pressing anything', async ({ page }) => {
        await openEditor(page, { status: 'draft' });

        const patched = page.waitForRequest(isRecipePatch);

        // The ONLY interaction: an edit, then the cook switches away. The tab hiding is a checkpoint (A3).
        await page.getByLabel('Title').fill('Weeknight Pasta, edited and left alone');
        await hideTab(page);

        const body = (await patched).postDataJSON() as { expectedVersion?: number; status?: string; title?: string };

        // ⛔ THE LOST-UPDATE GUARD, observed on the wire: an unattended write carries the version the last answer
        // returned, so a change made on another device conflicts instead of being clobbered.
        expect(body.expectedVersion).toBe(3);
        expect(body.title).toBe('Weeknight Pasta, edited and left alone');
        // ⛔ And it does not touch publication state: a checkpoint sends no status at all, so it can never publish.
        expect(body.status).toBeUndefined();
    });

    test('a published recipe writes nothing without Save changes, however long it sits and wherever the cook goes', async ({
        page,
    }) => {
        // ⛔ A FAKE CLOCK, not a wait: installed BEFORE navigation because it can only patch timers the page has not
        // yet created. Ten minutes covers any timer-driven save the editor might have grown.
        await page.clock.install();
        await openEditor(page);

        let patchCount = 0;

        page.on('request', (request: Request) => {
            if (isRecipePatch(request)) {
                patchCount += 1;
            }
        });

        await page.getByLabel('Title').fill('Weeknight Pasta, edited and left alone');
        await page.clock.fastForward('10:00');
        await hideTab(page);

        // D1: the change stays on the device until Save changes, and the header says so.
        await expect(page.getByText('Changes kept in this tab')).toBeVisible();
        expect(patchCount).toBe(0);
    });

    test('an untouched draft writes nothing, however the cook moves through it', async ({ page }) => {
        // Opening a recipe and reading it must write nothing. Asserted after real interaction, never a fixed sleep.
        await page.setViewportSize({ width: 1280, height: 800 });
        await openEditor(page, { status: 'draft' });

        let patchCount = 0;

        page.on('request', (request: Request) => {
            if (isRecipePatch(request)) {
                patchCount += 1;
            }
        });

        // Interact WITHOUT editing: jump through the sections (each a checkpoint) and hide the tab. With nothing
        // changed, no checkpoint has anything to send.
        const index = page.getByRole('navigation', { name: 'Recipe sections' });

        for (const section of ['Steps', 'Photos & publish', 'Details']) {
            await index.getByRole('link', { name: section }).click();
            await expect(page.getByRole('heading', { level: 2, name: section })).toBeFocused();
        }

        await hideTab(page);
        await expect(page.getByLabel('Title')).toHaveValue('Weeknight Pasta');

        expect(patchCount).toBe(0);
    });
});
