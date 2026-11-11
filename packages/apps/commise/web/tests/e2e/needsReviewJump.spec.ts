import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';
import { ingredientOpen } from './utils/recipeEditor';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * The "Needs review" jump, through the real web app with the recipe-service contract intercepted: on the owner's recipe
 * detail a doubtful line carries a "Needs review: {food}" link to the editor, which opens with THAT line's row editor
 * already open (a bottom sheet in a phone-width container, inline from 600), headed by the Needs review badge, the
 * cook's own words ("You wrote") and "Counted as". Cancel restores the fields as they were at open; Done keeps edits.
 * A viewer who does not own the recipe sees the plain badge and no link.
 *
 * What only this tier proves: the link's address survives a real navigation, the editor resolves it against the
 * server read's own line keys, and the frame the row editor opens in is the right one at each width. The per-state rules
 * are pinned by the component tests (`RecipeEditorSurface.rowEditor.test.tsx`, `cookRows.test.tsx`). Selectors are
 * role, label and text only.
 */
const RECIPE_ID = 'ec000000-0000-4000-8000-000000000a01';
const SOMEONE_ELSES_ID = 'ec000000-0000-4000-8000-000000000a02';
const VERSION = 3;
const SOURCE_LINE = '2 cups plain flour, sifted twice';

const doubtedLine = {
    ingredientId: '77777777-7777-4777-8777-777777777771',
    name: 'flour',
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    isUserEntered: false,
    resolutionStatus: 'NEEDS_REVIEW',
    sourceLine: SOURCE_LINE,
} as const;

/** Where the row editor opens at each width: the sheet on a phone, inline in the row from 600. */
const FRAMES = [
    { name: 'phone (sheet)', viewport: { width: 390, height: 844 } },
    { name: 'desktop (inline)', viewport: { width: 1280, height: 900 } },
] as const;

/** The open row editor: the dialog when the sheet is up, else the Ingredients section the inline panel sits in. */
async function openEditor(page: Page): Promise<Locator> {
    await expect(page.getByLabel('Amount', { exact: true })).toBeVisible();
    const sheet = page.getByRole('dialog');

    return (await sheet.count()) > 0 ? sheet : page.getByRole('region', { name: 'Ingredients' });
}

for (const frame of FRAMES) {
    test.describe(`the Needs review jump — ${frame.name}`, () => {
        test.use({ viewport: frame.viewport });

        test('the link opens the addressed line’s editor; Cancel restores it and Done keeps edits', async ({
            page,
        }) => {
            await signInWithTicket(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                recipes: [
                    makeRecipeDetail({
                        id: RECIPE_ID,
                        ownerId: viewerId,
                        title: 'Jump Probe',
                        currentVersion: VERSION,
                        ingredients: [doubtedLine],
                    }),
                ],
            });

            await page.goto(route(`/recipes/${RECIPE_ID}`));
            await expect(page.getByRole('heading', { name: 'Jump Probe' })).toBeVisible();

            // The address is the line's version and position, read at the version the detail was served at.
            const link = page.getByRole('link', { name: 'Needs review: flour' });
            await expect(link).toHaveAttribute(
                'href',
                new RegExp(`/recipes/${RECIPE_ID}/edit#ingredients/${VERSION}\\.0$`, 'u'),
            );
            await link.click();

            await expect(page).toHaveURL(new RegExp(`/recipes/${RECIPE_ID}/edit`, 'u'));
            let editor = await openEditor(page);
            await expect(editor.getByText('Needs review', { exact: true }).first()).toBeVisible();
            await expect(editor.getByText('You wrote', { exact: true })).toBeVisible();
            await expect(editor.getByText(SOURCE_LINE)).toBeVisible();
            await expect(editor.getByText('Counted as', { exact: true })).toBeVisible();
            await expect(editor.getByRole('button', { name: 'Change', exact: true })).toBeVisible();
            await expect(editor.getByLabel('Amount', { exact: true })).toHaveValue('2');

            // Cancel puts the fields back as they were at open.
            await editor.getByLabel('Amount', { exact: true }).fill('5');
            await expect(editor.getByLabel('Amount', { exact: true })).toHaveValue('5');
            await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(page.getByLabel('Amount', { exact: true })).toHaveCount(0);
            await expect(ingredientOpen(page, 'flour')).toHaveAccessibleName(/^Edit 2 cup flour/u);

            await ingredientOpen(page, 'flour').click();
            editor = await openEditor(page);
            await expect(editor.getByLabel('Amount', { exact: true })).toHaveValue('2');

            // Done keeps them.
            await editor.getByLabel('Amount', { exact: true }).fill('7');
            await editor.getByRole('button', { name: 'Done', exact: true }).click();
            await expect(page.getByLabel('Amount', { exact: true })).toHaveCount(0);
            await expect(ingredientOpen(page, 'flour')).toHaveAccessibleName(/^Edit 7 cup flour/u);

            await ingredientOpen(page, 'flour').click();
            editor = await openEditor(page);
            await expect(editor.getByLabel('Amount', { exact: true })).toHaveValue('7');
        });
    });
}

test.describe('the Needs review badge for a viewer who does not own the recipe', () => {
    test('shows the plain badge and no link to the editor', async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [
                makeRecipeDetail({
                    id: SOMEONE_ELSES_ID,
                    ownerId: 'usr_someone_else',
                    title: 'Someone Else’s Jump Probe',
                    visibility: 'public',
                    ingredients: [doubtedLine],
                }),
            ],
        });

        await page.goto(route(`/recipes/${SOMEONE_ELSES_ID}`));
        await expect(page.getByRole('heading', { name: 'Someone Else’s Jump Probe' })).toBeVisible();
        // The positive control beside the negative: the badge is there, the link is not.
        await expect(page.getByText('Needs review', { exact: true }).first()).toBeVisible();
        await expect(page.getByRole('link', { name: /^Needs review/u })).toHaveCount(0);
    });
});
