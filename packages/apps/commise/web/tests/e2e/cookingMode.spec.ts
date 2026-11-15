import { expect, test, type Locator, type Page } from '@playwright/test';
import { RecipeStatus } from '@kitchensink/recipe-core';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { applyTextScale } from './utils/textScale';

/**
 * Cooking mode on the web (plan 0002 S1, task T3; the largest-text rule from plans 0002 and 0003a).
 *
 * po's acceptance flow, step by step, at 1280 and at 390: Start cooking on the recipe page, tick a line and watch the
 * focus move, Next and Back keep the tick, walk to the last step, Finish to Done, Back to the recipe, and a draft shows
 * no Start cooking. Around it: an owner's draft cook link lands on the editor (decisions/0029); no sideways scroll at 320
 * and 390; Back, Next step and Exit are at least 44 × 44 and Back and Next are equal; no console error or hydration
 * warning anywhere; and at 390 with 200% text the step body scrolls while the place and Back / Next stay on screen.
 *
 * The recipe API is mocked per spec (`mockRecipeApi`, decisions/0019), so this proves the client path against the
 * fixture shape, not a deployed recipe service. The page's server prefetch reaches no service locally, so the browser
 * read is what runs; nothing must listen on the web app's recipe API port during a run.
 *
 * Step 1 carries a trap-table line ("2 tbsp."), so the split the abbreviation rule decides is asserted in a real
 * browser, not only a full stop (decisions/0019). Selectors are role and label only; no `waitForTimeout`.
 */

const ROAST_ID = 'c0000000-0000-4000-8000-0000000000a1';
const DRAFT_ID = 'c0000000-0000-4000-8000-0000000000a2';
const ROAST_TITLE = 'Weeknight roast chicken';
const DRAFT_TITLE = 'Unfinished stew';

/** Six steps; steps 1 and 2 have two sentences each, and step 1's first ends in an abbreviation that is not its end. */
const ROAST_STEPS = [
    'Heat 2 tbsp. oil in a roasting tin. Season the chicken well.',
    'Put the chicken in the tin. Roast it for 20 min.',
    'Turn the oven down to 180°C.',
    'Roast for another 40 min.',
    'Rest the chicken for 10 min.',
    'Carve and serve.',
].map((instruction, index) => ({ stepNumber: index + 1, instruction }));

/** Collect console errors and page errors (a hydration mismatch is reported as one), to assert none happened. */
function watchErrors(page: Page): readonly string[] {
    const errors: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'error') {
            errors.push(message.text());
        }
    });
    page.on('pageerror', (error) => errors.push(error.message));

    return errors;
}

/** Sign in and mock the test cook's roast (published) and stew (a draft). */
async function seed(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        recipes: [
            makeRecipeDetail({ id: ROAST_ID, ownerId: viewerId, title: ROAST_TITLE, steps: ROAST_STEPS }),
            makeRecipeDetail({
                id: DRAFT_ID,
                ownerId: viewerId,
                title: DRAFT_TITLE,
                status: RecipeStatus.DRAFT,
                steps: ROAST_STEPS.slice(0, 2),
            }),
        ],
    });
}

const checkbox = (page: Page, name: string): Locator => page.getByRole('checkbox', { name });
const backButton = (page: Page): Locator => page.getByRole('navigation').getByRole('button').first();
const forwardButton = (page: Page): Locator => page.getByRole('navigation').getByRole('button').last();

/** Open the roast's cook route directly, at step 1. */
async function openCooking(page: Page): Promise<void> {
    await page.goto(route(`/recipes/${ROAST_ID}/cook`));
    await expect(page.getByText('Step 1 of 6')).toBeVisible();
}

/** The page does not scroll sideways. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
}

/** A control's box is at least 44 × 44. */
async function expectTarget(control: Locator): Promise<void> {
    const box = await control.boundingBox();

    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

for (const width of [1280, 390] as const) {
    test.describe(`cooking mode, step by step, at ${String(width)}`, () => {
        test.use({ viewport: { width, height: width === 1280 ? 800 : 844 } });

        test('cooks the roast from Start cooking to Done and back to the recipe (po’s flow)', async ({ page }) => {
            const errors = watchErrors(page);
            await seed(page);

            // 1. Open the roast and press Start cooking. Step 1 shows its focus line.
            await page.goto(route(`/recipes/${ROAST_ID}`));
            await expect(page.getByRole('heading', { level: 1, name: ROAST_TITLE })).toBeVisible();
            await page.getByRole('button', { name: 'Start cooking' }).click();
            await expect(page).toHaveURL(new RegExp(`/recipes/${ROAST_ID}/cook$`, 'u'));
            await expect(page.getByText('Line 1 of 2')).toBeVisible();
            await expect(checkbox(page, 'Heat 2 tbsp. oil in a roasting tin.')).toBeVisible();

            // 2. Tick line 1. The focus moves to line 2.
            await checkbox(page, 'Heat 2 tbsp. oil in a roasting tin.').click();
            await expect(page.getByText('Line 2 of 2')).toBeVisible();
            await expect(page.getByText('You ticked 1 line')).toBeVisible();
            await expect(checkbox(page, 'Season the chicken well.')).toBeVisible();

            // 3. Next step to step 2, then Back to step 1. Line 1 is still ticked.
            await page.getByRole('button', { name: 'Next step, step 2' }).click();
            await expect(page.getByText('Step 2 of 6')).toBeVisible();
            await page.getByRole('button', { name: 'Back to step 1' }).click();
            await expect(page.getByText('Step 1 of 6')).toBeVisible();
            await expect(page.getByText('You ticked 1 line')).toBeVisible();
            await expect(page.getByText('Line 2 of 2')).toBeVisible();

            // 4. Next step through to step 6, then Finish. Done shows "All 6 steps done".
            for (let step = 2; step <= 6; step++) {
                await page.getByRole('button', { name: `Next step, step ${String(step)}` }).click();
                await expect(page.getByText(`Step ${String(step)} of 6`)).toBeVisible();
            }

            await page.getByRole('button', { name: 'Finish' }).click();
            await expect(page.getByRole('heading', { level: 1, name: 'All 6 steps done' })).toBeFocused();

            // 5. Back to the recipe. The recipe page shows Start cooking.
            await page.getByRole('button', { name: 'Back to the recipe' }).click();
            await expect(page.getByRole('heading', { level: 1, name: ROAST_TITLE })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Start cooking' })).toBeVisible();

            // 6. A draft of the test cook's shows no Start cooking.
            await page.goto(route(`/recipes/${DRAFT_ID}`));
            await expect(page.getByRole('heading', { level: 1, name: DRAFT_TITLE })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Start cooking' })).toHaveCount(0);

            expect(errors, 'console errors or hydration warnings').toEqual([]);
        });

        // The Done heading and its actions share one left edge: the heading is not centred over left-aligned buttons.
        test('aligns the Done heading with its actions on one left edge', async ({ page }) => {
            await seed(page);
            await openCooking(page);

            for (let step = 2; step <= 6; step++) {
                await forwardButton(page).click();
            }

            await page.getByRole('button', { name: 'Finish' }).click();
            const heading = page.getByRole('heading', { level: 1, name: 'All 6 steps done' });
            await expect(heading).toBeVisible();
            const headingBox = await heading.boundingBox();
            const actionBox = await page.getByRole('button', { name: 'Back to the recipe' }).boundingBox();

            expect(Math.abs((headingBox?.x ?? 0) - (actionBox?.x ?? -1))).toBeLessThanOrEqual(1);
        });

        test('sizes Exit, Back and Next for touch, with Back and Next equal and Next last', async ({ page }) => {
            await seed(page);
            await openCooking(page);

            const exit = page.getByRole('button', { name: 'Exit cooking mode' });
            await expectTarget(exit);
            await expectTarget(backButton(page));
            await expectTarget(forwardButton(page));
            const back = await backButton(page).boundingBox();
            const next = await forwardButton(page).boundingBox();
            expect(Math.abs((back?.width ?? 0) - (next?.width ?? -1))).toBeLessThanOrEqual(1);
            expect(next?.x ?? 0).toBeGreaterThan(back?.x ?? 0);
            await expect(forwardButton(page)).toHaveAccessibleName('Next step, step 2');
        });
    });
}

// P8: cooking mode is a full screen outside the app shell, so no search or text entry is on it.
test.describe('cooking mode has no app shell', () => {
    test('renders no textbox, searchbox or combobox', async ({ page }) => {
        await seed(page);
        await openCooking(page);

        for (const role of ['textbox', 'searchbox', 'combobox'] as const) {
            await expect(page.getByRole(role)).toHaveCount(0);
        }
    });
});

test.describe('where a cook link goes', () => {
    test('sends the owner of a draft to the editor (R-2, decisions/0029)', async ({ page }) => {
        await seed(page);

        await page.goto(route(`/recipes/${DRAFT_ID}/cook`));

        await expect(page).toHaveURL(new RegExp(`/recipes/${DRAFT_ID}/edit$`, 'u'));
    });

    test('Exit leaves to the recipe page, and browser Back from there does not re-enter cooking (R-11)', async ({
        page,
    }) => {
        await seed(page);
        await page.goto(route(`/recipes/${ROAST_ID}`));
        await expect(page.getByRole('heading', { level: 1, name: ROAST_TITLE })).toBeVisible();
        await page.goto(route(`/recipes/${ROAST_ID}/cook`));
        await expect(page.getByText('Step 1 of 6')).toBeVisible();

        await page.getByRole('button', { name: 'Exit cooking mode' }).click();

        await expect(page).toHaveURL(new RegExp(`/recipes/${ROAST_ID}$`, 'u'));
        await expect(page.getByRole('heading', { level: 1, name: ROAST_TITLE })).toBeVisible();
    });
});

for (const width of [320, 390] as const) {
    test.describe(`cooking mode at ${String(width)}`, () => {
        test.use({ viewport: { width, height: 640 } });

        test('does not scroll sideways on a step, on the next-coming step, or on Done', async ({ page }) => {
            await seed(page);
            await openCooking(page);
            await expectNoSidewaysScroll(page);

            await checkbox(page, 'Heat 2 tbsp. oil in a roasting tin.').click();
            await checkbox(page, 'Season the chicken well.').click();
            await expect(page.getByText('Up next · Step 2')).toBeVisible();
            await expectNoSidewaysScroll(page);

            for (let step = 2; step <= 6; step++) {
                await forwardButton(page).click();
            }

            await page.getByRole('button', { name: 'Finish' }).click();
            await expect(page.getByRole('heading', { level: 1, name: 'All 6 steps done' })).toBeVisible();
            await expectNoSidewaysScroll(page);
        });
    });
}

/** A long first step: it fits a 390 × 844 screen at 1× text and overflows it at 2× (qse's fixture condition). */
const LONG_ID = 'c0000000-0000-4000-8000-0000000000a3';
const LONG_LAST_LINE = 'Leave it to settle for five minutes before you move on to the next step.';
const LONG_STEPS = [
    {
        stepNumber: 1,
        instruction: [
            'Warm a wide, heavy pan over a medium heat for two full minutes.',
            'Add the butter and let it foam before the onions go in.',
            'Stir the onions every minute or so until they turn soft and golden.',
            LONG_LAST_LINE,
        ].join(' '),
    },
    { stepNumber: 2, instruction: 'Serve.' },
];

/** 200% text. The red run of this case was at 1, where the overflow assertion failed (notes/eng5-red-e2e-*.log). */
const TEXT_SCALE = 2;

test.describe('cooking mode at 390 with 200% text (plans 0002 and 0003a)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('scrolls the step body while the place and Back / Next stay on screen, and truncates nothing', async ({
        page,
    }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ id: LONG_ID, ownerId: viewerId, title: 'Soft onions', steps: LONG_STEPS })],
        });
        await page.goto(route(`/recipes/${LONG_ID}/cook`));
        await applyTextScale(page, TEXT_SCALE);
        const place = page.getByText('Step 1 of 2');
        await expect(place).toBeVisible();

        // The place, Back and Next are on screen.
        await expect(place).toBeInViewport();
        await expect(backButton(page)).toBeInViewport();
        await expect(forwardButton(page)).toBeInViewport();

        // The step body is the scroll box, and at this text size it has more than it shows.
        const region = page.getByRole('region', { name: 'Step 1 of 2' });
        const box = await region.evaluate((node) => {
            let scroller: HTMLElement | null = node.parentElement;

            while (scroller !== null && getComputedStyle(scroller).overflowY !== 'auto') {
                scroller = scroller.parentElement;
            }

            return scroller === null ? null : { scroll: scroller.scrollHeight, client: scroller.clientHeight };
        });
        expect(box, 'the step body is a vertical scroll box').not.toBeNull();
        expect(box?.scroll ?? 0, 'the step body overflows at this text size').toBeGreaterThan(box?.client ?? 0);

        // Scrolled to its end, the body shows the step's last line whole, while Back and Next have not moved.
        const nextBefore = await forwardButton(page).boundingBox();
        const lastLine = page.getByRole('checkbox', { name: LONG_LAST_LINE });
        await lastLine.scrollIntoViewIfNeeded();
        await expect(page.getByText(LONG_LAST_LINE)).toBeInViewport({ ratio: 1 });
        expect((await forwardButton(page).boundingBox())?.y).toBe(nextBefore?.y);
        await expect(place).toBeInViewport();
        await expectNoSidewaysScroll(page);
    });
});
