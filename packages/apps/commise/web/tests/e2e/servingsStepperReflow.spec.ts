import { expect, test, type Page } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * The recipe page's servings stepper stays on screen at the narrowest width and the largest text (issue 219, WCAG
 * 1.4.10 Reflow).
 *
 * At 320 px with 200% text the stepper's `+` ended at 352 px, so the whole page scrolled sideways. The measurements
 * are taken in a real browser, because jsdom lays nothing out. The text size is set the way `variantSurfaceReflow`
 * sets it: the root font at 200%, which grows the rem-sized buttons, gaps and padding with it.
 */

const RECIPE_ID = 'db000000-0000-4000-8000-0000000000f1';

async function seed(page: Page, servings: number): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        recipes: [makeRecipeDetail({ id: RECIPE_ID, ownerId: viewerId, title: 'Stepper Reflow Soup', servings })],
    });
}

// A one-digit, a two-digit and a three-digit count: the count's box is a minimum width, so the longest count is the
// widest the row gets, and the three-digit one is the case that would push `+` off a row that fits only two digits.
const SERVINGS = [2, 12, 120] as const;

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
                    await page.addStyleTag({ content: `html { font-size: ${String(textScale * 100)}% !important; }` });

                    const stepper = page.getByRole('group', { name: 'Servings' }).first();

                    await expect(stepper).toBeVisible();

                    const boxes = await stepper.getByRole('button').evaluateAll((buttons) =>
                        buttons.map((button) => {
                            const { left, right } = button.getBoundingClientRect();

                            return { left, right };
                        }),
                    );
                    const overflow = await page.evaluate(
                        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    );

                    // Both ends of the control: a `+` pushed off the right edge is the defect, and a `-` pushed off the
                    // left edge by a row that wraps the wrong way would be its mirror.
                    expect(boxes).toHaveLength(2);

                    for (const box of boxes) {
                        expect(box.left, 'a stepper button starts left of the viewport').toBeGreaterThanOrEqual(0);
                        expect(box.right, 'a stepper button ends right of the viewport').toBeLessThanOrEqual(
                            viewport.width,
                        );
                    }

                    expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
                });
            });
        }
    }
}
