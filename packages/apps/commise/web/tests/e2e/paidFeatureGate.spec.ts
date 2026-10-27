import { expect, test, type Page } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeCollection, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * The paid-features gate on every paid surface, in every state (plan 2026-10-14-009 D14; owner ruling 2026-10-13: "If
 * the user is NOT admin, NOT superuser, NOT vip, NOT premium and the gate flag is false, no paid feature is accessible
 * and no upsell button is visible"; amended 2026-10-15: an admin is not entitled either, and is gated like any other
 * user — only superuser, vip and premium get the paid features).
 *
 * Driven through the real web UI with the recipe-service contract and `/api/v1/users/me` intercepted
 * (`utils/recipeApi`), because the state under test is identity's `account.paidFeatures`, which a deployed sandbox
 * answers with whatever its gate is set to — `paidFeatureRoles.spec.ts` covers the real roles against the real
 * service. Role/label selectors only.
 *
 * REWRITTEN for ADR-0073 and the owner ruling of 2026-10-26: a RECIPE the cook wrote is no longer a paid feature. A free
 * cook keeps up to the server's limit of recipes private (a slot), whatever the gate says; only an imported public-web
 * recipe still needs Pro, and COLLECTIONS are unchanged. Public is never final.
 *
 * UPDATED for the owner ruling of 2026-10-26 (ADR-0073 section 12, spec 001 FR-003b): a DRAFT holds no slot. A new recipe is
 * a draft, so its field counts nothing and refuses nothing; the count and the refusal belong to a PUBLISHED recipe (edit
 * one) and to a draft whose Publish was refused. ⚠️ Playwright against a deployed target: not run by the change that wrote
 * this edit.
 */
async function openEditorAs(page: Page, paidFeatures: 'granted' | 'upsell' | 'hidden'): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, { viewerId, paidFeatures });
    await page.goto(route('/recipes/new'));
    await expect(page.getByRole('heading', { level: 1, name: 'New recipe' })).toBeVisible();
}

test.describe('private slots — the editor’s “Who can see it” (a recipe the cook wrote)', () => {
    test('granted (Pro): Private is a choice, with no count, no Pro badge and no sheet', async ({ page }) => {
        await openEditorAs(page, 'granted');

        await page.getByRole('radio', { name: 'Private' }).check();

        await expect(page.getByRole('radio', { name: 'Private' })).toBeChecked();
        await expect(page.getByText(/private slots/u)).toHaveCount(0);
        await expect(page.getByText('Pro', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('dialog', { name: 'Keep more recipes private' })).toHaveCount(0);
        await expect(page.getByRole('dialog', { name: 'Private needs Pro for this recipe' })).toHaveCount(0);
    });

    for (const state of ['upsell', 'hidden'] as const) {
        test(`${state}: a NEW recipe is a draft, so Private says it uses no slot until it is published - no count, no Pro badge, no sheet`, async ({
            page,
        }) => {
            await openEditorAs(page, state);

            await page.getByRole('radio', { name: /^Private/u }).check();

            await expect(page.getByRole('radio', { name: /^Private/u })).toBeChecked();
            await expect(page.getByText('A private draft uses no slot. Publishing it uses one.')).toBeVisible();
            await expect(page.getByText(/private slots left/u)).toHaveCount(0);
            await expect(page.getByText('Pro', { exact: true })).toHaveCount(0);
            await expect(page.getByRole('dialog', { name: 'Keep more recipes private' })).toHaveCount(0);
            await expect(page.getByRole('dialog', { name: 'Private needs Pro for this recipe' })).toHaveCount(0);
        });
    }
});

test.describe('private slots — every slot used', () => {
    const OWN_PUBLIC_ID = 'ec000000-0000-4000-8000-0000000001ff';

    /** The editor for a free cook who holds `limit` private recipes (a limit of `limit`): a NEW recipe, which is a draft. */
    async function openFullEditor(
        page: Page,
        paidFeatures: 'upsell' | 'hidden',
        target: 'new' | 'ownPublished',
    ): Promise<void> {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const limit = 2;
        const held = Array.from({ length: limit }, (_, index) =>
            makeRecipeDetail({
                id: `ec000000-0000-4000-8000-00000000010${index}`,
                ownerId: viewerId,
                title: `Held ${index}`,
                visibility: 'private',
                status: 'published',
            }),
        );
        const ownPublished = makeRecipeDetail({
            id: OWN_PUBLIC_ID,
            ownerId: viewerId,
            title: 'Own Dish',
            visibility: 'public',
            status: 'published',
        });
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures,
            recipes: [...held, ownPublished],
            privateSlotLimit: limit,
        });

        if (target === 'new') {
            await page.goto(route('/recipes/new'));
            await expect(page.getByRole('heading', { level: 1, name: 'New recipe' })).toBeVisible();
        } else {
            await page.goto(route(`/recipes/${OWN_PUBLIC_ID}/edit`));
            await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();
        }
    }

    test('⛔ a NEW recipe (a draft) shows NO refusal even with every slot used: a private draft takes no slot', async ({
        page,
    }) => {
        await openFullEditor(page, 'upsell', 'new');

        await page.getByRole('radio', { name: /^Private/u }).check();

        await expect(page.getByRole('radio', { name: /^Private/u })).toBeChecked();
        await expect(page.getByText('Not available. All 2 of your private slots are in use.')).toHaveCount(0);
        await expect(page.getByText('A private draft uses no slot. Publishing it uses one.')).toBeVisible();
    });

    test('a PUBLISHED recipe refuses Private with the total and three ways forward; choosing it changes nothing', async ({
        page,
    }) => {
        await openFullEditor(page, 'upsell', 'ownPublished');

        await expect(page.getByText('Not available. All 2 of your private slots are in use.')).toBeVisible();
        const ways = page.getByRole('group', { name: 'To keep this recipe private' });
        await expect(ways.getByRole('button')).toHaveText([
            /Make a private recipe public\s*It frees its slot/u,
            /Delete a private recipe\s*It frees its slot/u,
            /Get Pro\s*Private recipes with no limit/u,
        ]);

        await page.getByRole('radio', { name: /^Private/u }).click({ force: true });

        await expect(page.getByRole('radio', { name: /^Public/u })).toBeChecked();
    });

    test('“Get Pro” opens the Pro sheet; “Make a private recipe public” goes to My recipes', async ({ page }) => {
        await openFullEditor(page, 'upsell', 'ownPublished');

        await page.getByRole('button', { name: /Get Pro/u }).click();
        await expect(page.getByRole('dialog', { name: 'Keep more recipes private' })).toBeVisible();
        await page.getByRole('button', { name: 'Not now' }).click();

        await page.getByRole('button', { name: /Make a private recipe public/u }).click();
        await expect(page).toHaveURL(/\/recipes\/?$/u);
    });

    test('⛔ hidden: the refusal offers no Pro way - no sale where none is shown', async ({ page }) => {
        await openFullEditor(page, 'hidden', 'ownPublished');

        await expect(page.getByText('Not available. All 2 of your private slots are in use.')).toBeVisible();
        await expect(page.getByRole('button', { name: /Get Pro/u })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Delete a private recipe/u })).toBeVisible();
    });
});

test.describe('paid features — an imported public-web recipe in the editor (Pro is still its rule)', () => {
    const WEB_ID = 'ec000000-0000-4000-8000-0000000000f3';

    async function openWebRecipe(page: Page, paidFeatures: 'granted' | 'upsell' | 'hidden'): Promise<void> {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const web = makeRecipeDetail({
            id: WEB_ID,
            ownerId: viewerId,
            title: 'Web Stew',
            visibility: 'public',
            sourceType: 'imported_public',
        });
        await mockRecipeApi(page, { viewerId, paidFeatures, recipes: [web] });
        await page.goto(route(`/recipes/${WEB_ID}/edit`));
        await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();
    }

    test('upsell: Private carries the Pro badge and opens the Pro sheet; Public stays chosen', async ({ page }) => {
        await openWebRecipe(page, 'upsell');

        await expect(page.getByText('Pro', { exact: true })).toBeVisible();
        await page.getByRole('radio', { name: /^Private/u }).click();

        await expect(page.getByRole('dialog', { name: 'Private needs Pro for this recipe' })).toBeVisible();
        await page.getByRole('button', { name: 'Not now' }).click();
        await expect(page.getByRole('radio', { name: /^Public/u })).toBeChecked();
    });

    test('⛔ hidden: says “Who can see it: Public”, with no Private, no Pro and no upsell', async ({ page }) => {
        await openWebRecipe(page, 'hidden');

        await expect(page.getByText('Who can see it')).toBeVisible();
        await expect(page.getByText('Anyone can find it in Discover')).toBeVisible();
        await expect(page.getByRole('radio', { name: 'Private' })).toHaveCount(0);
        await expect(page.getByRole('radio', { name: 'Public' })).toHaveCount(0);
        await expect(page.getByText('Pro', { exact: true })).toHaveCount(0);
    });
});

test.describe('private slots — the recipe page’s ⋯ menu', () => {
    async function openOwnRecipe(
        page: Page,
        paidFeatures: 'granted' | 'upsell' | 'hidden',
        sourceType: 'user_created' | 'imported_public' = 'user_created',
    ): Promise<void> {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const own = makeRecipeDetail({
            id: 'ec000000-0000-4000-8000-0000000000f1',
            ownerId: viewerId,
            title: 'Gate Stew',
            visibility: 'public',
            sourceType,
        });
        await mockRecipeApi(page, { viewerId, paidFeatures, recipes: [own] });
        await page.goto(route('/recipes/ec000000-0000-4000-8000-0000000000f1'));
        await expect(page.getByRole('heading', { name: 'Gate Stew' })).toBeVisible();
        await page.getByRole('button', { name: /^More actions for /u }).click();
    }

    for (const state of ['granted', 'upsell', 'hidden'] as const) {
        test(`${state}: Make private makes a recipe the cook wrote private - a slot, not Pro`, async ({ page }) => {
            await openOwnRecipe(page, state);

            await page.getByRole('menuitem', { name: 'Make private' }).click();

            await expect(page.getByText('Private', { exact: true })).toBeVisible();
            await expect(page.getByRole('dialog', { name: 'Keep more recipes private' })).toHaveCount(0);
            await expect(page.getByRole('dialog', { name: 'Private needs Pro for this recipe' })).toHaveCount(0);
        });
    }

    test('upsell, an imported public-web recipe: Make private opens the Pro sheet', async ({ page }) => {
        await openOwnRecipe(page, 'upsell', 'imported_public');

        await page.getByRole('menuitem', { name: 'Make private' }).click();

        await expect(page.getByRole('dialog', { name: 'Private needs Pro for this recipe' })).toBeVisible();
    });

    test('⛔ hidden, an imported public-web recipe: the menu offers no Make private', async ({ page }) => {
        await openOwnRecipe(page, 'hidden', 'imported_public');

        await expect(page.getByRole('menuitem', { name: 'Version history' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Make private' })).toHaveCount(0);
    });
});

test.describe('paid features — a collection’s ⋯ menu', () => {
    async function openOwnCollection(page: Page, paidFeatures: 'granted' | 'upsell' | 'hidden'): Promise<void> {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures,
            collections: [
                makeCollection({ id: 'col_gate', ownerId: viewerId, name: 'Gate dinners', visibility: 'public' }),
            ],
        });
        await page.goto(route('/collections/col_gate'));
        await page.getByRole('button', { name: 'More actions for Gate dinners' }).click();
    }

    test('granted: Make private applies at once, with Undo', async ({ page }) => {
        await openOwnCollection(page, 'granted');

        await page.getByRole('menuitem', { name: 'Make private' }).click();

        await expect(page.getByText('Collection is now private.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    });

    test('upsell: Make private opens the Pro sheet', async ({ page }) => {
        await openOwnCollection(page, 'upsell');

        await page.getByRole('menuitem', { name: 'Make private' }).click();

        await expect(page.getByRole('dialog', { name: 'Private collections are part of Pro.' })).toBeVisible();
    });

    test('⛔ hidden: the menu offers no Make private', async ({ page }) => {
        await openOwnCollection(page, 'hidden');

        await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Make private' })).toHaveCount(0);
    });
});

/**
 * Plan 2026-10-14-009 Q5 (UX SPECIFY 2026-10-15), REWRITTEN for ADR-0073 and the owner ruling of 2026-10-26: public is NEVER
 * final. Making a private recipe public is confirmed first where there is a cost worth saying - it frees one of the cook's
 * private slots, and a free slot is all it takes to make it private again - and an imported public-web recipe under the
 * upsell is told Pro is needed to return. Nothing ever says the recipe cannot go private again.
 */
test.describe('private slots — making a private recipe public', () => {
    const PRIVATE_ID = 'ec000000-0000-4000-8000-0000000000f2';

    async function openPrivateRecipe(
        page: Page,
        paidFeatures: 'upsell' | 'hidden',
        path: string,
        sourceType: 'user_created' | 'imported_public' = 'user_created',
    ): Promise<void> {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        const own = makeRecipeDetail({
            id: PRIVATE_ID,
            ownerId: viewerId,
            title: 'Secret Stew',
            visibility: 'private',
            sourceType,
        });
        await mockRecipeApi(page, { viewerId, paidFeatures, recipes: [own] });
        await page.goto(route(path));
    }

    test('hidden, in the editor: Public asks first and says it frees a slot; confirmed, Private is still offered', async ({
        page,
    }) => {
        await openPrivateRecipe(page, 'hidden', `/recipes/${PRIVATE_ID}/edit`);
        await expect(page.getByRole('radio', { name: /^Private/u })).toBeChecked();
        await expect(
            page.getByText('This frees one of your private slots. To make it private again, you need a free slot.'),
        ).toBeVisible();

        await page.getByRole('radio', { name: /^Public/u }).click();

        const dialog = page.getByRole('alertdialog', { name: 'Make this recipe public?' });
        await expect(dialog).toBeVisible();
        await expect(
            dialog.getByText(
                'Anyone can see a public recipe and save a copy. It frees one of your private slots, and you can make it private again while you have a free slot.',
            ),
        ).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Keep private' })).toBeFocused();
        await dialog.getByRole('button', { name: 'Make public' }).click();

        await expect(dialog).toHaveCount(0);
        // Public is never final: the cook can choose Private again while a slot is free.
        await page.getByRole('radio', { name: /^Private/u }).click();
        await expect(page.getByRole('radio', { name: /^Private/u })).toBeChecked();
        await expect(page.getByText(/won.t be able|may not be able/u)).toHaveCount(0);
    });

    test('upsell, an imported public-web recipe: the Public card says Pro is needed; Keep private leaves it private', async ({
        page,
    }) => {
        await openPrivateRecipe(page, 'upsell', `/recipes/${PRIVATE_ID}/edit`, 'imported_public');
        await expect(page.getByText("To make it private again, you'll need Pro.")).toBeVisible();

        await page.getByRole('radio', { name: /^Public/u }).click();
        const dialog = page.getByRole('alertdialog', { name: 'Make this recipe public?' });
        await dialog.getByRole('button', { name: 'Keep private' }).click();

        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole('radio', { name: /^Private/u })).toBeChecked();
    });

    test('hidden, on the recipe page: Make public asks first, then makes it public, and Make private is still offered', async ({
        page,
    }) => {
        await openPrivateRecipe(page, 'hidden', `/recipes/${PRIVATE_ID}`);
        await expect(page.getByRole('heading', { name: 'Secret Stew' })).toBeVisible();
        await page.getByRole('button', { name: /^More actions for /u }).click();

        await page.getByRole('menuitem', { name: 'Make public' }).click();

        const dialog = page.getByRole('alertdialog', { name: 'Make this recipe public?' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: /Pro/u })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Make public' }).click();

        await expect(dialog).toHaveCount(0);
        // Public now, and the way back is a free slot, not Pro.
        await page.getByRole('button', { name: /^More actions for /u }).click();
        await expect(page.getByRole('menuitem', { name: 'Make private' })).toBeVisible();
    });
});

/**
 * Plan 2026-10-14-009 T1: the same confirm for a PRIVATE COLLECTION. A downgraded owner's ⋯ Make public asks first, in
 * the words that say what going public costs, and Keep private leaves the collection as it was.
 */
test.describe('paid features — a downgraded owner making a private collection public', () => {
    async function openPrivateCollection(page: Page, paidFeatures: 'upsell' | 'hidden'): Promise<void> {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            paidFeatures,
            collections: [
                makeCollection({ id: 'col_gate', ownerId: viewerId, name: 'Gate dinners', visibility: 'private' }),
            ],
        });
        await page.goto(route('/collections/col_gate'));
        await page.getByRole('button', { name: 'More actions for Gate dinners' }).click();
        await page.getByRole('menuitem', { name: 'Make public' }).click();
    }

    test('⛔ hidden: Make public asks first; confirmed, it is public with no way back', async ({ page }) => {
        await openPrivateCollection(page, 'hidden');

        const dialog = page.getByRole('alertdialog', { name: 'Make this collection public?' });
        await expect(dialog).toBeVisible();
        await expect(
            dialog.getByText(
                "Anyone can see a public collection and save a copy. You won't be able to make this one private again.",
            ),
        ).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Keep private' })).toBeFocused();
        await expect(dialog.getByRole('button', { name: /Pro/u })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Make public' }).click();

        await expect(dialog).toHaveCount(0);
        await expect(page.getByText('Collection is now public.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    });

    test('upsell: Keep private leaves the collection private', async ({ page }) => {
        await openPrivateCollection(page, 'upsell');

        const dialog = page.getByRole('alertdialog', { name: 'Make this collection public?' });
        await expect(
            dialog.getByText(
                "Anyone can see a public collection and save a copy. To make this one private again, you'll need Pro.",
            ),
        ).toBeVisible();
        await dialog.getByRole('button', { name: 'Keep private' }).click();

        await expect(dialog).toHaveCount(0);
        await expect(page.getByText('Collection is now public.')).toHaveCount(0);
        await expect(page.getByText('Private', { exact: true })).toBeVisible();
    });
});
