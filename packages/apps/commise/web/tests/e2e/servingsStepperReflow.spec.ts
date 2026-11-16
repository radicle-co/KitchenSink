import { expect, test, type Locator, type Page } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { applyTextScale } from './utils/textScale';

/**
 * The recipe page's servings stepper stays on screen at the narrowest width and the largest text (WCAG 1.4.10
 * Reflow): the page must not scroll sideways at 320 px with 200% text. The measurements
 * are taken in a real browser, because jsdom lays nothing out. The text size is set by `applyTextScale`: the root font
 * at 200%, which grows the rem-sized buttons, gaps and padding with it.
 */

const RECIPE_ID = 'db000000-0000-4000-8000-0000000000f1';

// Enough steps that the page scrolls past the ingredients card at every size: the pinned ingredients bar only appears
// once that card has scrolled out of view.
const STEPS = Array.from({ length: 12 }, (_, index) => ({
    stepNumber: index + 1,
    instruction: `Stir the pot slowly for a while and keep tasting it as it cooks down, step ${String(index + 1)}.`,
}));

async function seed(page: Page, servings: number): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        recipes: [
            makeRecipeDetail({
                id: RECIPE_ID,
                ownerId: viewerId,
                title: 'Stepper Reflow Soup',
                servings,
                steps: STEPS,
            }),
        ],
    });
}

// A one-digit, a two-digit and a three-digit count: the count's box is a minimum width, so the longest count is the
// widest the row gets, and the three-digit one is the case that would push `+` off a row that fits only two digits.
const SERVINGS = [2, 12, 120] as const;

/** The step buttons' boxes, and where the content box of the stepper's row ends (its right edge less its padding). */
async function measure(stepper: Locator) {
    return stepper.evaluate((group) => {
        let row = group.parentElement;

        // The row is the nearest flex ancestor that pads its content: both the heading row and the pinned list row do.
        while (
            row !== null &&
            !(getComputedStyle(row).display === 'flex' && parseFloat(getComputedStyle(row).paddingRight) > 0)
        ) {
            row = row.parentElement;
        }

        const rowBox = row?.getBoundingClientRect();
        const rowPadding = row === null ? 0 : parseFloat(getComputedStyle(row).paddingRight);

        return {
            buttons: [...group.querySelectorAll('button')].map((button) => {
                const { left, right, width, height } = button.getBoundingClientRect();

                return { left, right, width, height };
            }),
            count: (() => {
                const span = group.querySelector('span');

                return span === null
                    ? null
                    : { text: span.textContent, clipped: span.scrollWidth > span.clientWidth + 0.5 };
            })(),
            groupRight: group.getBoundingClientRect().right,
            contentRight: rowBox === undefined ? Number.NaN : rowBox.right - rowPadding,
        };
    });
}

/** The same checks for the stepper in the page and the one in the pinned list. */
function expectFits(where: string, measured: Awaited<ReturnType<typeof measure>>, viewportWidth: number): void {
    expect(measured.buttons, `${where}: both step buttons`).toHaveLength(2);

    for (const box of measured.buttons) {
        // A step button is a 44 CSS px circle at every text size: it is the touch target, and it must not grow with rem.
        expect(box.width, `${where}: a step button is 44 px wide`).toBeCloseTo(44, 0);
        expect(box.height, `${where}: a step button is 44 px tall`).toBeCloseTo(44, 0);
        // Both ends of the control: a `+` pushed off the right edge is the defect, and a `-` pushed off the left edge
        // by a row that wraps the wrong way would be its mirror.
        expect(box.left, `${where}: a stepper button starts left of the viewport`).toBeGreaterThanOrEqual(0);
        expect(box.right, `${where}: a stepper button ends right of the viewport`).toBeLessThanOrEqual(viewportWidth);
    }

    // The count shows whole: a box squeezed below its digits would hide them behind a button.
    expect(measured.count?.clipped, `${where}: the count "${measured.count?.text ?? ''}" is clipped`).toBe(false);
    expect(measured.groupRight, `${where}: the stepper ends past its row's content box`).toBeLessThanOrEqual(
        measured.contentRight + 0.5,
    );
}

for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
]) {
    for (const textScale of [1, 2]) {
        for (const servings of SERVINGS) {
            test.describe(`the servings stepper at ${String(viewport.width)} px, ${String(textScale * 100)}% text and ${String(servings)} servings`, () => {
                test.use({ viewport });

                test('keeps both buttons inside the viewport, and the page does not scroll sideways', async ({
                    page,
                }) => {
                    await seed(page, servings);
                    await page.goto(route(`/recipes/${RECIPE_ID}`));
                    await applyTextScale(page, textScale);

                    const stepper = page.getByRole('group', { name: 'Servings' }).first();

                    await expect(stepper).toBeVisible();
                    expectFits('in the page', await measure(stepper), viewport.width);

                    const overflow = await page.evaluate(
                        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    );

                    expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);

                    // Below a 720 px body, the pinned ingredients bar opens a list with a second stepper in a row of its
                    // own, and it needs the same room.
                    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
                    await page.getByRole('button', { name: /^Ingredients for .*Show list\.$/u }).click();

                    const pinnedStepper = page.getByRole('dialog').getByRole('group', { name: 'Servings' });

                    await expect(pinnedStepper).toBeVisible();
                    expectFits('in the pinned list', await measure(pinnedStepper), viewport.width);
                });
            });
        }
    }
}
