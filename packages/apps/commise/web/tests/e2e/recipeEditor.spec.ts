import { expect, test } from '@playwright/test';
import type { Locator, Page, Route } from '@playwright/test';

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
                await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });

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
            await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });

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
            await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });

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
            await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
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
            await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });

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
            await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
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
                // Cuisine is required to publish (2026-10-13), and Save changes on a published recipe is a publish.
                cuisine: 'Italian',
                status: 'published',
                currentVersion: 3,
            });
            const store = await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', recipes: [seed] });
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
                // Cuisine is required to publish (2026-10-13). It is set so the ONE thing to fix stays the missing
                // ingredient, which is what this test counts.
                cuisine: 'Italian',
                status: 'draft',
                ingredients: [],
                currentVersion: 1,
            });
            const store = await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', recipes: [seed] });

            await page.goto(route('/recipes/ec000000-0000-4000-8000-000000000011/edit'));
            await page.getByRole('button', { name: 'Publish', exact: true }).click();

            // The action bar's polite line says it (§7.8). The same words are also Photos & publish's Ready line, a
            // button to the first section that needs it (§7.7 item 3), which is always there.
            await expect(page.getByRole('status').filter({ hasText: 'Fix 1 thing to publish' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Fix 1 thing to publish' })).toBeVisible();
            // E7 (§7.8): focus goes to the first invalid FIELD, not its section's heading. A recipe with no ingredients
            // has one, the add-ingredient field (`firstInvalidFieldOf`).
            await expect(page.getByRole('combobox', { name: 'Add an ingredient' })).toBeFocused();
            expect(store.get('ec000000-0000-4000-8000-000000000011')?.status).toBe('draft');
        });

        test('a recipe with a line that has no match says so, and still publishes (owner D20)', async ({ page }) => {
            const viewerId = await readViewerAppId(page);
            const id = 'ec000000-0000-4000-8000-000000000012';
            const seed = makeRecipeDetail({
                id,
                ownerId: viewerId,
                title: 'Saffron Rice',
                // Cuisine is required to publish (2026-10-13).
                cuisine: 'Spanish',
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
            const store = await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', recipes: [seed] });

            await page.goto(route(`/recipes/${id}/edit`));

            // The sentence is in the action bar and, as a quiet note, in Photos & publish.
            const sentence = page.getByText(
                'Ready to publish. 1 ingredient has no match, so its nutrition is left out.',
            );
            await expect(sentence).toHaveCount(2);

            const publish = page.getByRole('button', { name: 'Publish', exact: true });
            await expect(publish).toBeEnabled();
            await publish.click();

            await expect.poll(() => store.get(id)?.status).toBe('published');
        });

        test('× never asks, and the action bar is never covered', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });

            await page.goto(route('/recipes/new'));
            const publish = page.getByRole('button', { name: 'Publish', exact: true });
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
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
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
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
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
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
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

    /**
     * Finding 1 of the 2026-10-10 review: Back queues the create as the editor unmounts; Forward reopens the editor on
     * `?draft=local:…` while that create is still on the wire. The reopened editor never heard the create's answer, and
     * its next checkpoint, once the synced record had left the outbox, created the recipe a second time. The create's
     * response is held until after Forward, so the race is the test's, not the network's.
     */
    test('⛔ Back then Forward while the create is on the wire: one recipe, and the edit made after Forward is saved', async ({
        page,
    }) => {
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
        const writes = recipeWrites(page);
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route('**/api/v1/recipes', async (request) => {
            if (request.request().method() === 'POST') {
                await held;
            }

            await request.fallback();
        });

        await page.goto(route('/recipes'));
        await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
        await page.getByRole('button', { name: 'New recipe' }).click();
        await expect(page).toHaveURL(/\/recipes\/new/u);
        await page.getByLabel('Title').fill('E2E Forward Soup');
        await expect(page).toHaveURL(/draft=local/u);
        await page.goBack();
        await expect(page).toHaveURL(/\/recipes$/u);
        await expect.poll(() => writes.map((write) => write.method)).toEqual(['POST']);

        await page.goForward();
        await expect(page.getByLabel('Title')).toHaveValue('E2E Forward Soup', { timeout: 30_000 });
        await page.getByLabel('Description').fill('Typed after Forward.');
        await jumpTo(page, 'Steps');
        release();
        await expect.poll(() => writes.map((write) => write.method)).toEqual(['POST', 'PATCH']);
        // A later checkpoint is where the second create used to go out.
        await jumpTo(page, 'Photos & publish');
        await page.getByLabel('Description').fill('Typed after Forward, again.');
        await jumpTo(page, 'Ingredients');
        await expect.poll(() => writes.filter((write) => write.method === 'PATCH').length).toBeGreaterThan(1);

        await page.goto(route('/recipes'));
        await expect(page.getByRole('article', { name: 'E2E Forward Soup' })).toHaveCount(1);
        expect(writes.filter((write) => write.method === 'POST')).toHaveLength(1);
    });
});

// A-012/E24 (B1 item 5): the Preview is a page-sized sheet from `sm`, not the 85% centred dialog: the whole visible
// height, and up to the detail column (72 rem = 1152 px). `size="page"` in `@commise/ui/sheet`.
test.describe('the editor Preview sheet at 1280', () => {
    test('is as tall as the viewport and as wide as the detail column, under the preview banner', async ({ page }) => {
        await signInWithTicket(page);
        await page.setViewportSize({ width: 1280, height: 800 });
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });

        await page.goto(route('/recipes/new'));
        await page.getByLabel('Title').fill('E2E Preview Soup');
        await page.getByRole('button', { name: 'Preview', exact: true }).click();

        const dialog = page.getByRole('dialog', { name: 'Preview' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('Preview. This is how it looks to others.')).toBeVisible();

        const box = await dialog.boundingBox();
        expect(box).not.toBeNull();
        // The 85% dialog was 680 px here; a page is the viewport (sub-pixel slack).
        expect(Math.abs((box?.height ?? 0) - 800)).toBeLessThanOrEqual(1);
        // Wider than the house `max-w-lg` dialog (512), capped at the detail column (1152).
        expect(box?.width ?? 0).toBeGreaterThan(512);
        expect(box?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1152 + 1);
    });
});

// B1 (UI walk 2026-10-13): the editor's form fields. Written to run against the same mocked recipe API as above; not run
// here (the sandbox's Clerk instance is shared with CI).
test.describe('the editor form fields (A-007, A-008, A-009, E15, P3, P4)', () => {
    test.beforeEach(async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
    });

    test('A-007: the add-ingredient field has a visible label and hint, and is a rectangle, not an underline', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(route('/recipes/new'));

        const field = page.getByRole('combobox', { name: 'Add an ingredient' });
        await expect(page.getByText('Add an ingredient', { exact: true })).toBeVisible();
        await expect(
            page.getByText('Type the amount first, then pick the food. For example: 2 tbsp olive oil.'),
        ).toBeVisible();
        await expect(field).toBeVisible();

        const radius = await field.evaluate((node) => getComputedStyle(node).borderTopLeftRadius);
        const bottomEdge = await field.evaluate((node) => getComputedStyle(node).borderBottomWidth);
        const topEdge = await field.evaluate((node) => getComputedStyle(node).borderTopWidth);
        expect(radius).toBe('12px');
        expect(topEdge).toBe('1px');
        expect(bottomEdge).toBe('1px');
    });

    test('E15: "3 garlic cloves" reads as 3 cloves of garlic', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(route('/recipes/new'));

        await page.getByRole('combobox', { name: 'Add an ingredient' }).fill('3 garlic cloves');

        await expect(page.getByText('3 cloves · garlic')).toBeVisible();
    });

    // The placement is picked in JavaScript from `<main>`'s measured width (`useMainContainerClass`, a ResizeObserver
    // source that reads `narrow` until `<main>` is measured), so it moves a frame or more after a load or a resize, and
    // the button is unmounted from one place and mounted in the other. Each layout is therefore read until it holds
    // (for a bounded 5 s, so a layout that never arrives still fails here), and an absent box fails rather than reading
    // as 0.
    test('P4: from 600 Paste a list sits beside the add field, level with the input; at 320 it is under it', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(route('/recipes/new'));

        const field = page.getByRole('combobox', { name: 'Add an ingredient' });
        const paste = page.getByRole('button', { name: 'Paste a list' });

        const boxOf = async (locator: Locator): Promise<{ y: number; height: number }> => {
            const box = await locator.boundingBox();

            if (box === null) {
                throw new Error('P4: an element under test has no box (not rendered, or mid-swap)');
            }

            return box;
        };

        await expect(async () => {
            const [wideField, widePaste] = await Promise.all([boxOf(field), boxOf(paste)]);
            const fieldMiddle = wideField.y + wideField.height / 2;
            const pasteMiddle = widePaste.y + widePaste.height / 2;
            expect(Math.abs(fieldMiddle - pasteMiddle)).toBeLessThanOrEqual(2);
        }).toPass({ timeout: 5_000 });

        await page.setViewportSize({ width: 320, height: 800 });
        await expect(async () => {
            const [narrowField, narrowPaste] = await Promise.all([boxOf(field), boxOf(paste)]);
            expect(narrowPaste.y).toBeGreaterThan(narrowField.y + narrowField.height - 1);
        }).toPass({ timeout: 5_000 });
    });

    test('A-008: Add step moves focus into the new step, so typing lands there and adds no more steps', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(route('/recipes/new'));

        const before = await page.getByRole('textbox', { name: /^Step \d+$/u }).count();
        await page.getByRole('button', { name: 'Add step' }).click();
        await page.keyboard.type('Fold in the cheese');

        const steps = page.getByRole('textbox', { name: /^Step \d+$/u });
        await expect(steps).toHaveCount(before + 1);
        await expect(steps.last()).toHaveValue('Fold in the cheese');
    });

    test('A-009: Prep time and Cook time share a line at 320', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 800 });
        await page.goto(route('/recipes/new'));

        const prep = await page.getByRole('group', { name: 'Prep time' }).boundingBox();
        const cook = await page.getByRole('group', { name: 'Cook time' }).boundingBox();

        expect(Math.abs((prep?.y ?? 0) - (cook?.y ?? Number.POSITIVE_INFINITY))).toBeLessThanOrEqual(1);
        expect((cook?.x ?? 0) + (cook?.width ?? 0)).toBeLessThanOrEqual(320);
    });

    test('P3: Cuisine is a combobox over the curated list: type to narrow, pick one', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(route('/recipes/new'));

        const cuisine = page.getByRole('combobox', { name: 'Cuisine' });
        await cuisine.fill('fre');
        await page.getByRole('option', { name: 'French' }).click();

        await expect(cuisine).toHaveValue('French');
    });
});

/**
 * Discard never leaves a record behind (plan 2026-10-13-004: the stuck "Syncing 1" after Discard). The recipe-service
 * contract is intercepted (`utils/recipeApi`), so these hold only where no live recipe-service is reachable: a live one
 * at `NEXT_PUBLIC_RECIPE_API_URL` makes the server render prefetch past the browser mocks (the SSR prefetch problem).
 *
 * Not run by the author's session: the coordinator runs Playwright.
 */
test.describe('Discard leaves nothing syncing', () => {
    test.beforeEach(async ({ page }) => {
        await signInWithTicket(page);
    });

    /** Open the ⋯ menu, choose the discard item, and confirm. */
    async function confirmDiscard(page: Page, item: string, dialogName: string): Promise<void> {
        await page.getByRole('button', { name: 'More editor actions' }).click();
        await page.getByRole('menuitem', { name: item }).click();
        await page
            .getByRole('alertdialog', { name: dialogName })
            .getByRole('button', { name: 'Discard', exact: true })
            .click();
    }

    /**
     * REWRITTEN for the owner ruling 2026-10-17, "Don't allow users to delete while saving". This test held the create
     * past a Discard WAIT (a busy confirm, then a delete queued behind the create). That wait is gone: while the create is
     * on the wire the Discard item is unavailable and says why; when the reply is lost the create parks with an unknown
     * outcome, the item comes back, and Discard withdraws the create and warns that the recipe may already be saved.
     */
    test('⛔ a create on the wire: Discard is unavailable ("Saving…"), comes back when the reply is lost, and leaves nothing syncing', async ({
        page,
    }) => {
        test.setTimeout(90_000);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted' });
        const writes = recipeWrites(page);
        const deletes: string[] = [];
        page.on('request', (request) => {
            if (request.method() === 'DELETE' && /\/api\/v1\/recipes\//u.test(request.url())) {
                deletes.push(request.url());
            }
        });
        // The create never answers until the test drops it: it is on the wire for as long as the test says.
        let held: Route | undefined;
        await page.route('**/api/v1/recipes', async (interception) => {
            if (interception.request().method() === 'POST') {
                held = interception;

                return;
            }

            await interception.fallback();
        });

        await page.goto(route('/recipes/new'));
        await page.getByLabel('Title').fill('E2E Discard Soup');
        await jumpTo(page, 'Ingredients');
        await expect.poll(() => writes.map((write) => write.method)).toEqual(['POST']);

        // On the wire: the item stays in the menu, reads as unavailable, and says why to a screen reader.
        await page.getByRole('button', { name: 'More editor actions' }).click();
        const discardItem = page.getByRole('menuitem', { name: 'Discard draft' });

        await expect(discardItem).toHaveAttribute('aria-disabled', 'true');
        await expect(discardItem).toHaveAccessibleDescription('Saving…');
        await page.keyboard.press('Escape');

        // The reply is lost: the create parks with an unknown outcome, and the item comes back.
        await held?.abort('failed');
        await page.getByRole('button', { name: 'More editor actions' }).click();
        await expect(discardItem).not.toHaveAttribute('aria-disabled', 'true');
        await page.keyboard.press('Escape');

        await confirmDiscard(page, 'Discard draft', 'Discard this draft?');

        await expect(page).not.toHaveURL(/\/recipes\/new/u, { timeout: 30_000 });
        // The create parked and Discard withdrew it: nothing is left syncing, and no delete was ever sent.
        await expect(page.getByText(/Syncing \d+ change/u)).toHaveCount(0);
        await page.waitForFunction(() =>
            Object.keys(window.sessionStorage)
                .filter((key) => key.startsWith('sync.outbox.v1.'))
                .every(
                    (key) =>
                        (
                            JSON.parse(window.sessionStorage.getItem(key) ?? '{"records":[]}') as {
                                records: unknown[];
                            }
                        ).records.length === 0,
                ),
        );
        expect(writes.map((write) => write.method)).toEqual(['POST']);
        expect(deletes).toEqual([]);
    });

    test('⛔ a published recipe whose Save changes was refused: Discard takes the failure with it', async ({
        page,
    }) => {
        const viewerId = await readViewerAppId(page);
        const id = 'ec000000-0000-4000-8000-0000000000d1';
        const seed = makeRecipeDetail({
            id,
            ownerId: viewerId,
            title: 'Discard Pie',
            // Cuisine is required to publish (2026-10-13), and Save changes on a published recipe is a publish.
            cuisine: 'Italian',
            status: 'published',
            currentVersion: 3,
        });
        await mockRecipeApi(page, { viewerId, paidFeatures: 'granted', recipes: [seed] });
        // Save changes is refused: the write parks, and the device keeps the changes.
        await page.route(`**/api/v1/recipes/${id}`, async (interception) => {
            if (interception.request().method() === 'PATCH') {
                await interception.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ code: 'INTERNAL', message: 'down' }),
                });

                return;
            }

            await interception.fallback();
        });

        await page.goto(route(`/recipes/${id}/edit`));
        await page.getByLabel('Description').fill('Flakier.');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByText(/couldn.t save your latest changes/iu)).toBeVisible();

        // Reopen: the editor finds the parked write and says so; Discard withdraws it.
        await page.goto(route(`/recipes/${id}/edit`));
        await expect(page.getByText(/couldn.t save your latest changes/iu)).toBeVisible();
        await confirmDiscard(page, 'Discard changes', 'Discard your changes?');
        await expect(page).not.toHaveURL(/\/edit/u);

        // Reopen again: nothing parked, so no failure alert.
        await page.goto(route(`/recipes/${id}/edit`));
        await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();
        await expect(page.getByText(/couldn.t save your latest changes/iu)).toHaveCount(0);
    });
});
