import { expect, test, type Locator, type Page } from '@playwright/test';
import { RecipeStatus } from '@kitchensink/recipe-core';
import { fonts, typeRole } from '@commise/ui/tokens/typography';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { resolveServiceUrls } from './utils/serviceUrls';
import { applyTextScale } from './utils/textScale';

/**
 * Cooking mode on the web (plan 0002 S1, task T3; the largest-text rule from plans 0002 and 0003a).
 *
 * po's acceptance flow, step by step, at 1280 and at 390: Start cooking on the recipe page, tick a line and watch the
 * focus move, Next and Back keep the tick, walk to the last step, Finish to Done, Back to the recipe, and a draft shows
 * no Start cooking. Around it: an owner's draft cook link lands on the editor (decisions/0029); no sideways scroll at 320
 * and 390; Back, Next step and Exit are at least 44 x 44 and Back and Next are equal; the keyboard pass (D13); the focus
 * line is set in the readingLarge face; the Next preview is one line on a short screen and wraps on a tall one; and at 390
 * with 200% text the step body scrolls while the place and Back / Next stay on screen.
 *
 * The recipe API is mocked per spec (`mockRecipeApi`, decisions/0019), so this proves the client path against the
 * fixture shape, not a deployed recipe service. The page's server prefetch reaches no service locally, so the browser
 * read is what runs; nothing must listen on the web app's recipe API port during a run.
 *
 * Step 1 carries a trap-table line ("2 tbsp."), so the split the abbreviation rule decides is asserted in a real
 * browser, not only a full stop (decisions/0019). Selectors are role and label only; no `waitForTimeout`. The place line
 * is read as the name of the step's region, which the screen sets to the place, so the screen-reader live region (which
 * says the place too) never makes a locator ambiguous.
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

const FIRST_LINE = 'Heat 2 tbsp. oil in a roasting tin.';
const SECOND_LINE = 'Season the chicken well.';

/** Done holds a press for its first moments (`DONE_SETTLE_MS`, 400); this is comfortably past it. */
const PAST_DONE_SETTLE_MS = 1000;

/**
 * Collect console errors and page errors (a hydration mismatch is reported as one), to assert none happened. The one
 * exception is a failed fetch of the FOOD service: the recipe page asks it for nutrition, and no food service runs in a
 * mocked spec. A failed fetch of anything else (a script chunk, the recipe API) is still an error. Call it after
 * {@link seed}: signing in lands on Home before the recipe routes are mocked, and that is not the flow under test.
 */
function watchErrors(page: Page): readonly string[] {
    const errors: string[] = [];
    const foodOrigin = new URL(resolveServiceUrls(process.env).food).origin;
    page.on('console', (message) => {
        if (message.type() === 'error' && !message.location().url.startsWith(foodOrigin)) {
            errors.push(`${message.text()} (${message.location().url})`);
        }
    });
    page.on('pageerror', (error) => errors.push(error.message));

    return errors;
}

/** Sign in and mock the test cook's roast (published) and stew (a draft). */
async function seed(page: Page, extra: readonly ReturnType<typeof makeRecipeDetail>[] = []): Promise<void> {
    // The page loads Vercel's analytics script, which only a Vercel host serves; a local build answers 404 for it.
    await page.route('**/_vercel/insights/**', (request) =>
        request.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
    );
    // `/health` is the service clients' contract-skew probe. A CI run boots no server for it, and a body with no hash
    // reads as indeterminate, so this answer hides no real skew.
    await page.route('**/health', (request) =>
        request.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }),
    );
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
            ...extra.map((recipe) => ({ ...recipe, ownerId: viewerId })),
        ],
    });
}

const checkbox = (page: Page, name: string): Locator => page.getByRole('checkbox', { name });
const backButton = (page: Page): Locator => page.getByRole('navigation').getByRole('button', { name: /^Back/u });
const forwardButton = (page: Page): Locator =>
    page.getByRole('navigation').getByRole('button', { name: /^(Next step|Start step|Finish)/u });
const nextButton = (page: Page, step: number): Locator =>
    page.getByRole('button', { name: `Next step, step ${String(step)}` });

/** The step's region, named by the place ("Step 2 of 6"). */
const stepRegion = (page: Page, step: number, total: number): Locator =>
    page.getByRole('region', { name: `Step ${String(step)} of ${String(total)}`, exact: true });

/** The next step's pinned preview: the paragraph holding that step's first words, in the foot. */
const previewOf = (page: Page, words: string): Locator =>
    page.getByRole('main').getByRole('paragraph').filter({ hasText: words });

/** Open the roast's cook route directly, at step 1. */
async function openCooking(page: Page): Promise<void> {
    await page.goto(route(`/recipes/${ROAST_ID}/cook`));
    await expect(stepRegion(page, 1, 6)).toBeVisible();
}

/** The page does not scroll sideways. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
}

/** A control's box is at least 44 x 44. */
async function expectTarget(control: Locator): Promise<void> {
    const box = await control.boundingBox();

    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

/** An element's computed line height in px, and its box height. */
async function lineMetrics(node: Locator): Promise<{ readonly lineHeight: number; readonly height: number }> {
    return node.evaluate((element) => ({
        lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
        height: element.getBoundingClientRect().height,
    }));
}

for (const width of [1280, 390] as const) {
    test.describe(`cooking mode, step by step, at ${String(width)}`, () => {
        test.use({ viewport: { width, height: width === 1280 ? 800 : 844 } });

        test('cooks the roast from Start cooking to Done and back to the recipe (po’s flow)', async ({ page }) => {
            await seed(page);
            const errors = watchErrors(page);
            // Fake time, so Done's settle hold is stepped past rather than waited for. Installed after sign-in.
            await page.clock.install();

            // 1. Open the roast and press Start cooking. Step 1 shows its focus line.
            await page.goto(route(`/recipes/${ROAST_ID}`));
            await expect(page.getByRole('heading', { level: 1, name: ROAST_TITLE })).toBeVisible();
            await page.getByRole('button', { name: 'Start cooking' }).click();
            await expect(page).toHaveURL(new RegExp(`/recipes/${ROAST_ID}/cook$`, 'u'));
            await expect(stepRegion(page, 1, 6)).toContainText('Line 1 of 2');
            await expect(checkbox(page, FIRST_LINE)).toBeVisible();

            // 2. Tick line 1. The focus moves to line 2.
            await checkbox(page, FIRST_LINE).click();
            await expect(stepRegion(page, 1, 6)).toContainText('Line 2 of 2');
            await expect(stepRegion(page, 1, 6)).toContainText('You ticked 1 line');
            await expect(checkbox(page, SECOND_LINE)).toBeVisible();

            // 3. Next step to step 2, then Back to step 1. Line 1 is still ticked.
            await nextButton(page, 2).click();
            await expect(stepRegion(page, 2, 6)).toBeVisible();
            await page.getByRole('button', { name: 'Back to step 1' }).click();
            await expect(stepRegion(page, 1, 6)).toContainText('You ticked 1 line');
            await expect(stepRegion(page, 1, 6)).toContainText('Line 2 of 2');

            // 4. Next step through to step 6, then Finish. Done shows "All 6 steps done".
            for (let step = 2; step <= 6; step++) {
                await nextButton(page, step).click();
                await expect(stepRegion(page, step, 6)).toBeVisible();
            }

            await page.getByRole('button', { name: 'Finish' }).click();
            await expect(page.getByRole('heading', { level: 1, name: 'All 6 steps done' })).toBeFocused();

            // 5. Back to the recipe, once the settle hold is past. The recipe page shows Start cooking.
            await page.clock.runFor(PAST_DONE_SETTLE_MS);
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
                await nextButton(page, step).click();
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
        await expect(stepRegion(page, 1, 6)).toBeVisible();

        await page.getByRole('button', { name: 'Exit cooking mode' }).click();

        await expect(page).toHaveURL(new RegExp(`/recipes/${ROAST_ID}$`, 'u'));
        await expect(page.getByRole('heading', { level: 1, name: ROAST_TITLE })).toBeVisible();
    });
});

// D13: the whole screen is reachable and moves focus sensibly from the keyboard alone.
test.describe('cooking mode from the keyboard (D13)', () => {
    test('moves focus to the next action after each press, and after Cook again', async ({ page }) => {
        await seed(page);
        await page.clock.install();
        await openCooking(page);

        // Space on the first line ticks it and the focus line becomes line 2.
        await checkbox(page, FIRST_LINE).focus();
        await page.keyboard.press('Space');
        await expect(checkbox(page, SECOND_LINE)).toBeFocused();

        // Space on the last line leaves nothing to tick: the focus goes to the forward control, now "Start step 2".
        await page.keyboard.press('Space');
        await expect(page.getByRole('button', { name: 'Start step 2' })).toBeFocused();

        // Through to Done from the keyboard, then Cook it again once the settle hold is past.
        await page.keyboard.press('Enter');
        await expect(stepRegion(page, 2, 6)).toBeVisible();

        for (let step = 3; step <= 6; step++) {
            await nextButton(page, step).focus();
            await page.keyboard.press('Enter');
            await expect(stepRegion(page, step, 6)).toBeVisible();
        }

        await page.getByRole('button', { name: 'Finish' }).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('heading', { level: 1, name: 'All 6 steps done' })).toBeFocused();
        await page.clock.runFor(PAST_DONE_SETTLE_MS);
        await page.getByRole('button', { name: 'Cook it again' }).focus();
        await page.keyboard.press('Enter');

        // Step 1 again with nothing ticked: focus is on its forward control, and the polite region speaks the step.
        await expect(nextButton(page, 2)).toBeFocused();
        // The region mounts empty and is filled a moment later, on a timer, so the fake clock lets it fill.
        await page.clock.runFor(PAST_DONE_SETTLE_MS);
        await expect(page.getByRole('status').filter({ hasText: 'Heat 2 tbsp. oil in a roasting tin.' })).toHaveCount(
            1,
        );
    });
});

test.describe('the focus line type', () => {
    test('is set in the readingLarge face, not the page face', async ({ page }) => {
        await seed(page);
        await openCooking(page);

        const family = await checkbox(page, FIRST_LINE).evaluate((node) => getComputedStyle(node).fontFamily);
        const firstFamily = (stack: string): string => (stack.split(',')[0] ?? '').trim().replaceAll('"', '');

        expect(firstFamily(family)).toBe(firstFamily(fonts[typeRole.readingLarge.face]));
    });
});

for (const width of [320, 390] as const) {
    test.describe(`cooking mode at ${String(width)}`, () => {
        test.use({ viewport: { width, height: 640 } });

        test('does not scroll sideways on a step, on the next-coming step, or on Done', async ({ page }) => {
            await seed(page);
            await openCooking(page);
            await expectNoSidewaysScroll(page);

            await checkbox(page, FIRST_LINE).click();
            await checkbox(page, SECOND_LINE).click();
            await expect(stepRegion(page, 1, 6)).toContainText('Up next · step 2');
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

/** A long first step: it fits a 390 x 844 screen at 1x text and overflows it at 2x (qse's fixture condition). */
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
    {
        stepNumber: 2,
        instruction:
            'Serve the onions on warm toast with a spoonful of the pan juices poured over the top and a pinch of flaky salt.',
    },
];
const NEXT_STEP_WORDS = 'Serve the onions on warm toast';

/** Open the long recipe's cook route at step 1, whose lines are unticked, so the next step shows pinned in the foot. */
async function openLong(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        recipes: [makeRecipeDetail({ id: LONG_ID, ownerId: viewerId, title: 'Soft onions', steps: LONG_STEPS })],
    });
    await page.goto(route(`/recipes/${LONG_ID}/cook`));
    await expect(stepRegion(page, 1, 2)).toBeVisible();
}

// qse item 8: the Next preview is one line on a short frame and wraps on a tall one.
test.describe('the Next preview by screen height (qse item 8)', () => {
    test.describe('at 390 by 690', () => {
        test.use({ viewport: { width: 390, height: 690 } });

        test('shows the next step on one line', async ({ page }) => {
            await openLong(page);
            await expect(previewOf(page, NEXT_STEP_WORDS)).toHaveCount(1);
            const { lineHeight, height } = await lineMetrics(previewOf(page, NEXT_STEP_WORDS));

            expect(height).toBeLessThanOrEqual(lineHeight + 1);
        });
    });

    test.describe('at 390 by 900', () => {
        test.use({ viewport: { width: 390, height: 900 } });

        test('lets a long next step wrap', async ({ page }) => {
            await openLong(page);
            await expect(previewOf(page, NEXT_STEP_WORDS)).toHaveCount(1);
            const { lineHeight, height } = await lineMetrics(previewOf(page, NEXT_STEP_WORDS));

            expect(height).toBeGreaterThan(lineHeight + 1);
        });
    });
});

/** 200% text. */
const TEXT_SCALE = 2;

/** Whether the element is inside the scrolling step body, as the frame marks it. */
const isInScrollRegion = (locator: Locator): Promise<boolean> =>
    locator.evaluate((node) => node.closest('[data-cooking-scroll]') !== null);

// D47: the cook's text size, not the pixels, decides where the preview lives.
test.describe('the Next preview by window height in text (D47)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('keeps the preview in the pinned foot at 100% text, 844 being 52.75 rem tall', async ({ page }) => {
        await openLong(page);

        await expect(previewOf(page, NEXT_STEP_WORDS)).toHaveCount(1);
        expect(await isInScrollRegion(previewOf(page, NEXT_STEP_WORDS))).toBe(false);
    });
});

test.describe('cooking mode at 390 with 200% text (plans 0002 and 0003a)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('scrolls the step body while the place and Back / Next stay on screen, and truncates nothing', async ({
        page,
    }) => {
        await openLong(page);
        await applyTextScale(page, TEXT_SCALE);
        const region = stepRegion(page, 1, 2);

        // The step, Back and Next are on screen.
        await expect(region).toBeInViewport();
        await expect(backButton(page)).toBeInViewport();
        await expect(forwardButton(page)).toBeInViewport();

        // The step body is the scroll box, and at this text size it has more than it shows.
        const box = await region.evaluate((node) => {
            let scroller: HTMLElement | null = node.parentElement;

            while (scroller !== null && getComputedStyle(scroller).overflowY !== 'auto') {
                scroller = scroller.parentElement;
            }

            return scroller === null ? null : { scroll: scroller.scrollHeight, client: scroller.clientHeight };
        });
        expect(box, 'the step body is a vertical scroll box').not.toBeNull();
        expect(box?.scroll ?? 0, 'the step body overflows at this text size').toBeGreaterThan(box?.client ?? 0);

        // D47: the frame is under 40 rem tall at this text size, so the preview is the step body's last item, whole,
        // while Back and Next stay in the foot.
        await expect(previewOf(page, NEXT_STEP_WORDS)).toHaveCount(1);
        expect(await isInScrollRegion(previewOf(page, NEXT_STEP_WORDS))).toBe(true);
        expect(await isInScrollRegion(forwardButton(page))).toBe(false);
        expect(await isInScrollRegion(backButton(page))).toBe(false);
        const { lineHeight, height } = await lineMetrics(previewOf(page, NEXT_STEP_WORDS));
        expect(height, 'the preview in the step is not cut to one line').toBeGreaterThan(lineHeight + 1);

        // Scrolled to its end, the body shows the step's last line whole, while Back and Next have not moved.
        const nextBefore = await forwardButton(page).boundingBox();
        const lastLine = checkbox(page, LONG_LAST_LINE);
        await lastLine.scrollIntoViewIfNeeded();
        await expect(lastLine).toBeInViewport({ ratio: 1 });
        expect((await forwardButton(page).boundingBox())?.y).toBe(nextBefore?.y);
        await expect(backButton(page)).toBeInViewport();
        await expectNoSidewaysScroll(page);
    });
});

/**
 * The ingredients in cooking mode (T-015a): at one column the top bar's Ingredients button opens a sheet over the step and
 * closing it leaves the cook on the same step; from 800 wide the ingredients are a column beside the step with no button.
 * The roast carries one ingredient line ("Salt"), the mocked recipe's default.
 */
test.describe('the ingredients in cooking mode', () => {
    test.describe('at 390', () => {
        test.use({ viewport: { width: 390, height: 844 } });

        test('opens the sheet from the top bar and closes it on the same step', async ({ page }) => {
            await seed(page);
            const errors = watchErrors(page);

            await openCooking(page);
            // One column: the column slot is hidden (display none), and the step is one centred column.
            await expect(page.getByRole('main').getByRole('heading', { level: 2, name: /Ingredients/u })).toBeHidden();
            const step = await stepRegion(page, 1, 6).boundingBox();
            expect(step?.x ?? -1).toBeGreaterThanOrEqual(0);
            expect((step?.x ?? 0) + (step?.width ?? 0)).toBeLessThanOrEqual(390);
            await checkbox(page, FIRST_LINE).click();
            await page.getByRole('button', { name: 'Ingredients' }).click();
            await expect(page.getByRole('dialog')).toBeVisible();
            await expect(page.getByRole('dialog').getByRole('checkbox', { name: /Salt/u })).toBeVisible();

            await page.getByRole('button', { name: 'Close ingredients' }).click();

            await expect(page.getByRole('dialog')).toHaveCount(0);
            await expect(stepRegion(page, 1, 6)).toContainText('You ticked 1 line');
            await expectNoSidewaysScroll(page);
            expect(errors, 'console errors or hydration warnings').toEqual([]);
        });
    });

    test.describe('at 1280', () => {
        test.use({ viewport: { width: 1280, height: 800 } });

        test('draws the column beside the step, with no Ingredients button', async ({ page }) => {
            await seed(page);
            const errors = watchErrors(page);

            await openCooking(page);

            await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toContainText('Ingredients');
            await expect(page.getByRole('checkbox', { name: /Salt/u })).toBeVisible();
            // CSS removes the button from the page and the accessibility tree at this width.
            await expect(page.getByRole('button', { name: 'Ingredients' })).toHaveCount(0);
            await expect(stepRegion(page, 1, 6)).toBeVisible();
            await expectNoSidewaysScroll(page);
            expect(errors, 'console errors or hydration warnings').toEqual([]);
        });
    });
});
