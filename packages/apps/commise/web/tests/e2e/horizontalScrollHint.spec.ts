import { expect, test, type Page } from '@playwright/test';

import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';
import { chevronOf, expectChevron, overflows, scrollTo } from './utils/scrollHint';

/**
 * The horizontal-scroll hint on a browse rail (`docs/design/uiOverhaul/horizontalScrollHint.md`), in a real browser:
 * a chevron at the inline-end edge while the rail overflows and rests at its start; gone on the first scroll; back at
 * the start; never drawn for a rail that fits; and mirrored in a right-to-left page. The chip row and the section bar
 * have their hint asserted in `recipeListChips.spec.ts` and `recipeDetailCooking.spec.ts`.
 *
 * The chevron is decorative (`aria-hidden`), so it is read from the rail's next sibling and its computed opacity, which
 * is what `toBeVisible` cannot see. Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

/** Open Discover with `count` public recipes by another cook, so every curated rail has that many cards. */
async function openDiscover(page: Page, count: number): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        recipes: Array.from({ length: count }, (_unused, index) =>
            makeRecipeDetail({
                id: `ec000000-0000-4000-8000-0000000001${String(10 + index)}`,
                ownerId: 'usr_other',
                title: `Rail dish ${String(index + 1)}`,
                visibility: 'public',
            }),
        ),
    });

    await page.goto(route('/discover'));
    await expect(page.getByRole('article', { name: 'Rail dish 1' }).first()).toBeVisible();
}

test.describe('the rail scroll hint', () => {
    test('shows at rest on a rail that overflows, goes on the first scroll, and returns at the start', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 900 });
        await openDiscover(page, 6);

        const rail = page.getByRole('region', { name: 'Trending recipes' });
        const chevron = chevronOf(rail);

        expect(await overflows(rail)).toBe(true);
        await expectChevron(chevron, 'shown');

        // More than half a card, so the track's mandatory snap settles on the next card and not back at the start.
        await scrollTo(rail, 300);
        await expectChevron(chevron, 'hidden');

        await scrollTo(rail, 100000);
        await expectChevron(chevron, 'hidden');

        await scrollTo(rail, 0);
        await expectChevron(chevron, 'shown');
    });

    test('is not drawn for a rail whose cards fit', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await openDiscover(page, 1);

        const rail = page.getByRole('region', { name: 'Trending recipes' });

        expect(await overflows(rail)).toBe(false);
        await expectChevron(chevronOf(rail), 'hidden');
    });

    test('agrees with Previous and Next: the chevron shows exactly while Previous is disabled and the rail overflows', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await openDiscover(page, 8);

        const rail = page.getByRole('region', { name: 'Trending recipes' });
        const row = page.getByRole('heading', { level: 2, name: 'Trending' }).locator('xpath=ancestor::section[1]');
        const previous = row.getByRole('button', { name: 'Previous' });

        await expectChevron(chevronOf(rail), 'shown');
        await expect(previous).toHaveAttribute('aria-disabled', 'true');

        await row.getByRole('button', { name: 'Next' }).click();
        await expectChevron(chevronOf(rail), 'hidden');
        await expect(previous).toHaveAttribute('aria-disabled', 'false');
    });

    test('sits at the left edge in a right-to-left page, and follows the same rule', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 900 });
        await openDiscover(page, 6);
        await page.evaluate(() => {
            document.documentElement.dir = 'rtl';
        });

        const rail = page.getByRole('region', { name: 'Trending recipes' });
        const chevron = chevronOf(rail);

        await expectChevron(chevron, 'shown');
        const railBox = await rail.boundingBox();
        const chevronBox = await chevron.boundingBox();

        expect(railBox).not.toBeNull();
        expect(chevronBox).not.toBeNull();
        // The inline-end edge of a right-to-left rail is its LEFT edge.
        expect(chevronBox!.x - railBox!.x).toBeLessThan(railBox!.width / 2);

        // A right-to-left scroller counts scrollLeft negative from its start.
        await scrollTo(rail, -300);
        await expectChevron(chevron, 'hidden');

        await scrollTo(rail, 0);
        await expectChevron(chevron, 'shown');
    });
});
