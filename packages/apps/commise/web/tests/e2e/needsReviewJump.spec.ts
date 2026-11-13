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
const SOURCE_LINE = '2 tsp smoked paprika, or to taste';
const FIRST_SOURCE_LINE = '1 tsp fine salt';

/**
 * Line 0: healthy, so a surface that ignored the address and opened the FIRST row would show this line's text. Its food
 * differs from the doubted line's for the same reason.
 */
const healthyLine = {
    ingredientId: '77777777-7777-4777-8777-777777777770',
    name: 'salt',
    quantity: { kind: 'exact', value: 1 },
    unit: 'tsp',
    isUserEntered: false,
    sourceLine: FIRST_SOURCE_LINE,
} as const;

/** Line 1 (the SECOND line): the one the gate doubted. Its address is `#ingredients/{VERSION}.1`. */
const doubtedLine = {
    ingredientId: '77777777-7777-4777-8777-777777777771',
    name: 'paprika',
    quantity: { kind: 'exact', value: 2 },
    unit: 'tsp',
    isUserEntered: false,
    resolutionStatus: 'NEEDS_REVIEW',
    sourceLine: SOURCE_LINE,
} as const;
const DOUBTED_POSITION = 1;
const LINK_NAME = 'Needs review: paprika';

/** The recipe the owner opens: a healthy line, then the doubted one. */
const ownerRecipe = (viewerId: string) =>
    makeRecipeDetail({
        id: RECIPE_ID,
        ownerId: viewerId,
        title: 'Jump Probe',
        currentVersion: VERSION,
        ingredients: [healthyLine, doubtedLine],
    });

/** Where the row editor opens at each width: the sheet on a phone, inline in the row from 600. */
const FRAMES = [
    { name: 'phone (sheet)', viewport: { width: 390, height: 844 }, dialogs: 1 },
    { name: 'desktop (inline)', viewport: { width: 1280, height: 900 }, dialogs: 0 },
] as const;

/**
 * The open row editor, in the frame the width calls for. ⛔ Not "whichever exists": a surface that opened the wrong frame
 * must fail here, so the sheet is `dialog` (exactly one at a phone width, none inline) and the inline panel lives in the
 * Ingredients section.
 */
async function openEditor(page: Page, dialogs: 0 | 1): Promise<Locator> {
    await expect(page.getByLabel('Amount', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(dialogs);

    return dialogs === 1 ? page.getByRole('dialog') : page.getByRole('region', { name: 'Ingredients' });
}

/** Sign in, mock the API with the owner's two-line recipe, and open its detail. */
async function openDetail(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, { viewerId, recipes: [ownerRecipe(viewerId)] });
    await page.goto(route(`/recipes/${RECIPE_ID}`));
    await expect(page.getByRole('heading', { name: 'Jump Probe' })).toBeVisible();
}

/** The notice that heads a doubted line's editor: its heading, why, and the cook's own words. */
const reviewNotice = (editor: Locator): Locator => editor.getByRole('group', { name: 'Needs review', exact: true });

for (const frame of FRAMES) {
    test.describe(`the Needs review jump — ${frame.name}`, () => {
        test.use({ viewport: frame.viewport });

        test('the link opens the addressed line’s editor; Cancel restores it and Done keeps edits', async ({
            page,
        }) => {
            await openDetail(page);

            // The address is the SECOND line's version and position, read at the version the detail was served at.
            const link = page.getByRole('link', { name: LINK_NAME });
            await expect(link).toHaveAttribute(
                'href',
                new RegExp(`/recipes/${RECIPE_ID}/edit#ingredients/${VERSION}\\.${DOUBTED_POSITION}$`, 'u'),
            );
            await link.click();

            await expect(page).toHaveURL(new RegExp(`/recipes/${RECIPE_ID}/edit`, 'u'));
            let editor = await openEditor(page, frame.dialogs);
            const notice = reviewNotice(editor);
            await expect(notice).toBeVisible();
            await expect(notice).toContainText('You wrote');
            // The second line's words, and not the first row's: a surface that ignored the address would show salt's.
            await expect(notice).toContainText(SOURCE_LINE);
            await expect(editor).not.toContainText(FIRST_SOURCE_LINE);
            await expect(editor.getByLabel('Amount', { exact: true })).toHaveValue('2');
            await expect(editor).toContainText('Counted as');
            await expect(editor.getByRole('button', { name: 'Change', exact: true })).toBeVisible();

            // Cancel puts the fields back as they were at open.
            await editor.getByLabel('Amount', { exact: true }).fill('5');
            await expect(editor.getByLabel('Amount', { exact: true })).toHaveValue('5');
            await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(page.getByLabel('Amount', { exact: true })).toHaveCount(0);
            await expect(ingredientOpen(page, 'paprika')).toHaveAccessibleName(/^Edit 2 tsp paprika/u);

            await ingredientOpen(page, 'paprika').click();
            editor = await openEditor(page, frame.dialogs);
            await expect(editor.getByLabel('Amount', { exact: true })).toHaveValue('2');

            // Done keeps them.
            await editor.getByLabel('Amount', { exact: true }).fill('7');
            await editor.getByRole('button', { name: 'Done', exact: true }).click();
            await expect(page.getByLabel('Amount', { exact: true })).toHaveCount(0);
            await expect(ingredientOpen(page, 'paprika')).toHaveAccessibleName(/^Edit 7 tsp paprika/u);

            await ingredientOpen(page, 'paprika').click();
            editor = await openEditor(page, frame.dialogs);
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
        await expect(page.getByRole('main')).toContainText('Needs review');
        await expect(page.getByRole('link', { name: /^Needs review/u })).toHaveCount(0);
    });
});

test.describe('the Needs review control as one accessible element', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('the pill and its chevron are one link with one full name and one focus stop', async ({ page }) => {
        await openDetail(page);
        const link = page.getByRole('link', { name: LINK_NAME });

        await expect(link).toHaveCount(1);
        await expect(link).toHaveAccessibleName(LINK_NAME);
        // Nothing inside it is a second stop or a second named element: the chevron is decorative.
        expect(await link.evaluate((el) => el.querySelectorAll('a, button, [tabindex], [role="img"]').length)).toBe(0);

        // One Tab onto it, the next leaves it.
        await link.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(link).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(link).not.toBeFocused();
        expect(await link.evaluate((el) => el.contains(document.activeElement))).toBe(false);
    });
});

test.describe('an address that no longer names a line', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('the editor says it could not find the ingredient and the hash falls back to the section', async ({
        page,
    }) => {
        await openDetail(page);
        // A position the recipe does not hold (the line was removed), and a version that moved on, in turn.
        for (const stale of [`${VERSION}.9`, `${VERSION - 1}.${DOUBTED_POSITION}`]) {
            await page.goto(route(`/recipes/${RECIPE_ID}/edit#ingredients/${stale}`));
            await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible();

            await expect(page.getByText('We couldn’t find that ingredient.', { exact: false })).toBeVisible();
            await expect(page.getByLabel('Amount', { exact: true })).toHaveCount(0);
            await expect(page).toHaveURL(/#ingredients$/u);
        }
    });
});

/**
 * After the jump the row editor's Done and Cancel must be reachable: fully inside the viewport, below the sticky header
 * and above the bottom action bar. This is the scroll contract the editor owes an arrival at a line; it is RED until the
 * scroll host's fix lands, and pins it after.
 */
for (const width of [1280, 1024, 768]) {
    test.describe(`after the jump at ${width} px`, () => {
        test.use({ viewport: { width, height: 800 } });

        test('Done and Cancel sit between the sticky header and the bottom action bar', async ({ page }) => {
            await openDetail(page);
            await page.getByRole('link', { name: LINK_NAME }).click();
            const editor = await openEditor(page, 0);
            const viewport = page.viewportSize();
            // The sticky header is a plain <header> (no banner role inside <main>): reach it through its Close control.
            const headerBottom = await page
                .getByRole('button', { name: 'Close editor' })
                .evaluate((el) => (el.closest('header') as HTMLElement).getBoundingClientRect().bottom);
            const bar = await page.getByRole('group', { name: 'Recipe actions' }).boundingBox();

            expect(viewport).not.toBeNull();
            expect(bar).not.toBeNull();

            for (const name of ['Done', 'Cancel']) {
                const box = await editor.getByRole('button', { name, exact: true }).boundingBox();

                expect(box, `${name} is drawn`).not.toBeNull();
                expect(box!.y, `${name} is below the header`).toBeGreaterThanOrEqual(headerBottom);
                expect(box!.y + box!.height, `${name} is above the action bar`).toBeLessThanOrEqual(bar!.y);
                expect(box!.y + box!.height, `${name} is inside the viewport`).toBeLessThanOrEqual(viewport!.height);
                expect(box!.x, `${name} is inside the viewport`).toBeGreaterThanOrEqual(0);
                expect(box!.x + box!.width, `${name} is inside the viewport`).toBeLessThanOrEqual(viewport!.width);
            }
        });
    });
}
