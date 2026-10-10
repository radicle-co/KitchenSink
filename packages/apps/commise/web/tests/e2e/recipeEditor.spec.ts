import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { route } from './utils/basePath';
import { E2E_INGREDIENT_IDS, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * The one-page recipe editor (UI overhaul slice 7; build spec §7, §13 slice 7; owner decisions D1, D2, D7). REPLACES
 * `recipeEditWizard.spec.ts` and `recipeWizardActionBar.spec.ts`: the wizard is retired, and their coverage moves here —
 * the action bar is reachable and never covered, a refused Publish lands where the refusal is, and the draft survives.
 *
 * What only a browser shows: where a section jump puts its heading under the sticky chrome and that focus lands on it,
 * that a jump is instant under reduced motion, that a focused field is never under the header or the action bar, that
 * the editor saves through the outbox at checkpoints (and a published recipe only at Save changes, as ONE write), and
 * that a reload in the same tab keeps a new recipe's draft (D7, `sessionStorage`). Both themes (D15).
 *
 * The recipe-service contract is intercepted (`utils/recipeApi`); selectors are role and label only (repo policy).
 */

const SCHEMES = ['light', 'dark'] as const;

/** Every recipe write the page sends: creates and updates, in order. */
function recipeWrites(page: Page): { readonly method: string; readonly path: string }[] {
    const writes: { method: string; path: string }[] = [];

    page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        const method = request.method();

        if (
            (method === 'POST' && path.endsWith('/api/v1/recipes')) ||
            (method === 'PATCH' && /\/api\/v1\/recipes\/[^/]+$/u.test(path))
        ) {
            writes.push({ method, path });
        }
    });

    return writes;
}

/** The bottom edge of the sticky chrome above the sections: the header, and below 960 the index strip or bar. */
async function chromeBottom(page: Page): Promise<number> {
    return page.evaluate(() => {
        const header = document.getElementById('recipe-editor-header')?.getBoundingClientRect().bottom ?? 0;
        const stuck = [...document.querySelectorAll('nav, button')]
            .map((node) => node.getBoundingClientRect())
            .filter((box) => box.top >= header - 1 && box.top <= header + 1 && box.height > 0)
            .map((box) => box.bottom);

        return Math.max(header, ...stuck);
    });
}

/** Jump to a section through whichever index presentation this width shows. */
async function jumpTo(page: Page, section: string): Promise<void> {
    const bar = page.getByRole('button', { name: /^Sections\. Current:/ });

    if (await bar.isVisible()) {
        await bar.click();
        await page.getByRole('dialog', { name: 'Sections' }).getByRole('link', { name: section }).click();

        return;
    }

    await page.getByRole('navigation', { name: 'Recipe sections' }).getByRole('link', { name: section }).click();
}

/**
 * Assert a section's heading took focus and settles just under the sticky chrome. Polled: a smooth jump is still on
 * its way when the click returns.
 */
async function expectHeadingAtChrome(page: Page, heading: Locator): Promise<void> {
    await expect(heading).toBeFocused();
    await expect
        .poll(async () => {
            const box = await heading.boundingBox();
            const gap = box === null ? Number.NaN : box.y - (await chromeBottom(page));

            return gap >= -1 && gap < 80;
        })
        .toBe(true);
}

/**
 * A viewport short enough that every section but the last can reach the top: a page cannot scroll past its own end,
 * so on a tall viewport a section near the end of a new recipe stops wherever the page ends.
 */
const SHORT_VIEWPORT_HEIGHT = 500;

for (const colorScheme of SCHEMES) {
    test.describe(`the one-page editor (${colorScheme})`, () => {
        test.use({ colorScheme });

        test.beforeEach(async ({ page }) => {
            await signInWithTicket(page);
        });

        for (const width of [320, 768, 1280]) {
            test(`a section jump puts its heading under the chrome and focuses it at ${width}`, async ({ page }) => {
                await page.setViewportSize({ width, height: SHORT_VIEWPORT_HEIGHT });
                const viewerId = await readViewerAppId(page);
                await mockRecipeApi(page, { viewerId, tier: 'premium' });

                await page.goto(route('/recipes/new'));
                await expect(page.getByRole('heading', { level: 1, name: 'New recipe' })).toBeVisible();

                await jumpTo(page, 'Steps');
                await expectHeadingAtChrome(page, page.getByRole('heading', { level: 2, name: 'Steps' }));
                // The hash names the section, in place: Back still leaves the editor (A16).
                await expect(page).toHaveURL(/#steps$/u);

                // ⛔ No horizontal scroll at any width (§13).
                expect(await page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth)).toBe(
                    true,
                );
            });
        }

        test('a jump is instant under reduced motion (D2)', async ({ page }) => {
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.setViewportSize({ width: 1280, height: SHORT_VIEWPORT_HEIGHT });
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, tier: 'premium' });

            await page.goto(route('/recipes/new'));
            await jumpTo(page, 'Steps');

            // Read once, at once: a smooth scroll would still be on its way.
            const heading = page.getByRole('heading', { level: 2, name: 'Steps' });
            const y = await heading.evaluate((node) => node.getBoundingClientRect().top);
            expect(y - (await chromeBottom(page))).toBeLessThan(80);
        });

        test('a focused field is never under the header or the action bar', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, tier: 'premium' });

            await page.goto(route('/recipes/new'));
            const title = page.getByLabel('Title');
            await title.focus();

            const field = await title.boundingBox();
            const bar = await page.getByRole('group', { name: 'Recipe actions' }).boundingBox();

            expect(field).not.toBeNull();
            expect(field!.y).toBeGreaterThanOrEqual((await chromeBottom(page)) - 1);
            expect(field!.y + field!.height).toBeLessThanOrEqual((bar?.y ?? 844) + 1);
        });

        test('a new recipe saves itself once titled: created at a checkpoint, and the status says so', async ({
            page,
        }) => {
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, tier: 'premium' });
            const writes = recipeWrites(page);

            await page.goto(route('/recipes/new'));
            // No stored recipe before the first input (A4). The header is the only place a save status shows.
            await expect(page.getByText(/^(Saved|Saving)/u)).toHaveCount(0);

            await page.getByLabel('Title').fill('E2E Checkpoint Soup');
            // A section change is a checkpoint (A3).
            await jumpTo(page, 'Ingredients');

            await expect.poll(() => writes.map((write) => write.method)).toEqual(['POST']);
            await expect(page.getByText('Saved', { exact: true })).toBeVisible();
            // Once created, the URL names it, without a navigation: it stays on the new route, `?draft=` moving from
            // the local ref to the server id (Next's own shallow update; a reload or Back then opens its edit route).
            await expect(page).toHaveURL(/\/recipes\/new\?draft=(?!local)[^&#]+/u);
        });

        test('a reload in the same tab keeps a new recipe`s draft (D7)', async ({ page }) => {
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, tier: 'premium' });

            await page.goto(route('/recipes/new'));
            await page.getByLabel('Description').fill('Kept through a reload.');
            // The device draft is written one second after typing stops.
            await expect(page).toHaveURL(/draft=local/u, { timeout: 5_000 });
            await page.waitForFunction(() =>
                Object.keys(window.sessionStorage).some((key) => key.startsWith('editor.draft.v1.')),
            );

            await page.reload();

            await expect(page.getByLabel('Description')).toHaveValue('Kept through a reload.');
        });

        /**
         * Finding 2 of the 2026-10-09 review: the outbox journal lives in the tab's session storage beside the draft
         * (ADR-0057 §1). A create on the wire when the tab reloads has an UNKNOWN outcome; the reloaded page finds the
         * record, parks it, and tells the cook — it never sends the create a second time.
         */
        test('⛔ a reload while the create is on the wire never sends it twice: the cook is told instead', async ({
            page,
        }) => {
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, tier: 'premium' });
            const writes = recipeWrites(page);
            // The create never answers: it is on the wire when the tab reloads.
            await page.route('**/api/v1/recipes', async (request) => {
                if (request.request().method() !== 'POST') {
                    await request.fallback();
                }
            });

            await page.goto(route('/recipes/new'));
            await page.getByLabel('Title').fill('E2E Reload Soup');
            await jumpTo(page, 'Ingredients');
            await expect.poll(() => writes.map((write) => write.method)).toEqual(['POST']);

            await page.reload();

            await expect(page.getByLabel('Title')).toHaveValue('E2E Reload Soup');
            await expect(page.getByText("Couldn't confirm your save").first()).toBeVisible();
            await jumpTo(page, 'Steps');
            expect(writes.map((write) => write.method)).toEqual(['POST']);
        });

        test('a published recipe keeps its changes in this tab, and Save changes is ONE write', async ({ page }) => {
            const viewerId = await readViewerAppId(page);
            const seed = makeRecipeDetail({
                id: 'ec000000-0000-4000-8000-00000000001c',
                ownerId: viewerId,
                title: 'Published Pie',
                status: 'published',
                currentVersion: 3,
            });
            const store = await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [seed] });
            const writes = recipeWrites(page);

            await page.goto(route('/recipes/ec000000-0000-4000-8000-00000000001c/edit'));
            const save = page.getByRole('button', { name: 'Save changes' });
            await expect(save).toBeDisabled();

            await page.getByLabel('Description').fill('Flakier.');
            await jumpTo(page, 'Steps');

            // D1: a published recipe's changes stay on the device until Save changes — no checkpoint reaches the server.
            await expect(page.getByText('Changes kept in this tab')).toBeVisible();
            expect(writes).toEqual([]);

            await save.click();

            await expect(page.getByRole('heading', { level: 1, name: 'Published Pie' })).toBeVisible();
            expect(writes.map((write) => write.method)).toEqual(['PATCH']);
            expect(store.get('ec000000-0000-4000-8000-00000000001c')?.currentVersion).toBe(4);
        });

        test('a refused Publish says how many things to fix and takes the cook to the first', async ({ page }) => {
            const viewerId = await readViewerAppId(page);
            const seed = makeRecipeDetail({
                id: 'ec000000-0000-4000-8000-000000000011',
                ownerId: viewerId,
                title: 'Incomplete Recipe',
                status: 'draft',
                ingredients: [],
                currentVersion: 1,
            });
            const store = await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [seed] });

            await page.goto(route('/recipes/ec000000-0000-4000-8000-000000000011/edit'));
            await page.getByRole('button', { name: 'Publish' }).click();

            await expect(page.getByText('Fix 1 thing to publish')).toBeVisible();
            await expect(page.getByRole('heading', { level: 2, name: 'Ingredients' })).toBeFocused();
            expect(store.get('ec000000-0000-4000-8000-000000000011')?.status).toBe('draft');
        });

        test('a recipe with a line that has no match says so, and still publishes (owner D20)', async ({ page }) => {
            const viewerId = await readViewerAppId(page);
            const id = 'ec000000-0000-4000-8000-000000000012';
            const seed = makeRecipeDetail({
                id,
                ownerId: viewerId,
                title: 'Saffron Rice',
                status: 'draft',
                currentVersion: 1,
                ingredients: [
                    {
                        ingredientId: E2E_INGREDIENT_IDS.salt,
                        name: 'Salt',
                        foodId: 'food_salt',
                        quantity: { kind: 'exact', value: 1 },
                        unit: 'tsp',
                        isUserEntered: false,
                        resolutionStatus: 'RESOLVED',
                    },
                    {
                        ingredientId: '00000000-0000-4000-8000-0000000000e1',
                        name: 'Saffron',
                        quantity: { kind: 'exact', value: 1 },
                        unit: 'pinch',
                        isUserEntered: false,
                        resolutionStatus: 'FAILED',
                        unresolvedReason: 'sources_errored',
                    },
                ],
            });
            const store = await mockRecipeApi(page, { viewerId, tier: 'premium', recipes: [seed] });

            await page.goto(route(`/recipes/${id}/edit`));

            // The sentence is in the action bar and, as a quiet note, in Photos & publish.
            const sentence = page.getByText(
                'Ready to publish. 1 ingredient has no match, so its nutrition is left out.',
            );
            await expect(sentence).toHaveCount(2);

            const publish = page.getByRole('button', { name: 'Publish' });
            await expect(publish).toBeEnabled();
            await publish.click();

            await expect.poll(() => store.get(id)?.status).toBe('published');
        });

        test('× never asks, and the action bar is never covered', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, tier: 'premium' });

            await page.goto(route('/recipes/new'));
            const publish = page.getByRole('button', { name: 'Publish' });
            const box = await publish.boundingBox();
            // Hit-tested: the topmost element at the button's centre is the button (or inside it).
            const topmost = await page.evaluate(
                ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? '',
                { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 },
            );
            expect(topmost).toContain('Publish');

            await page.getByLabel('Title').fill('Left without asking');
            await page.getByRole('button', { name: 'Close editor' }).click();

            await expect(page.getByRole('alertdialog')).toHaveCount(0);
            await expect(page).toHaveURL(/\/recipes(?:\/[^/]+)?(?:\?|$)/u);
        });
    });
}

/**
 * Leaving the editor and coming back (2026-10-09 review). Browser Back or a shell link unmounts the web editor, which
 * had no checkpoint for it (staff-architect, Blocking): a titled new recipe was never created. And the URL the editor
 * kept after its first save was written with Next's own history state, so Next never learned it (code-reviewer High
 * 4): a reload opened a blank editor, and Back restored the new-recipe page, where typing made a second recipe. One
 * colour scheme: nothing here is drawn differently in the other.
 */
test.describe('leaving the one-page editor and coming back', () => {
    test.beforeEach(async ({ page }) => {
        await signInWithTicket(page);
    });

    test('⛔ browser Back from a titled new recipe creates it: it is in My recipes', async ({ page }) => {
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        const writes = recipeWrites(page);

        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
        // Into the editor by the app's own control, so Back is the router's (a client navigation that unmounts it).
        await page.getByRole('button', { name: 'New recipe' }).click();
        await expect(page).toHaveURL(/\/recipes\/new/u);
        await page.getByLabel('Title').fill('E2E Back Button Soup');
        await page.goBack();

        await expect(page).toHaveURL(/\/recipes$/u);
        await expect.poll(() => writes.map((write) => write.method)).toEqual(['POST']);
        await expect(page.getByRole('article', { name: 'E2E Back Button Soup' })).toBeVisible();
    });

    test('⛔ a reload after the first save opens the same recipe, never a blank one', async ({ page }) => {
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        const writes = recipeWrites(page);

        await page.goto(route('/recipes/new'));
        await page.getByLabel('Title').fill('E2E Reloaded Soup');
        await jumpTo(page, 'Ingredients');
        await expect.poll(() => writes.map((write) => write.method)).toEqual(['POST']);
        await expect(page).toHaveURL(/draft=(?!local)/u);

        await page.reload();

        await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}\/edit/u, { timeout: 30_000 });
        await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();
        await expect(page.getByLabel('Title')).toHaveValue('E2E Reloaded Soup');
        await page.getByLabel('Description').fill('Edited after the reload.');
        await jumpTo(page, 'Steps');
        await expect.poll(() => writes.map((write) => write.method)).toEqual(['POST', 'PATCH']);
    });

    test('⛔ Back to the editor after the first save edits that recipe: typing never makes a second one', async ({
        page,
    }) => {
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, tier: 'premium' });
        const writes = recipeWrites(page);

        await page.goto(route('/recipes/new'));
        await page.getByLabel('Title').fill('E2E Returning Soup');
        await jumpTo(page, 'Ingredients');
        await expect.poll(() => writes.map((write) => write.method)).toEqual(['POST']);
        // × leaves for the recipe; Back returns to the entry the editor kept.
        await page.getByRole('button', { name: 'Close editor' }).click();
        // The recipe's own page, by id (a dev server may still be compiling the route when the click returns).
        await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/u, { timeout: 30_000 });
        await page.goBack();

        await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}\/edit/u, { timeout: 30_000 });
        await expect(page.getByLabel('Title')).toHaveValue('E2E Returning Soup');
        await page.getByLabel('Description').fill('Typed after coming back.');
        await jumpTo(page, 'Steps');
        await expect.poll(() => writes.filter((write) => write.method === 'POST')).toHaveLength(1);
        await expect.poll(() => writes.map((write) => write.method)).toEqual(['POST', 'PATCH']);
    });
});
