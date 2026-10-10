import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import { route } from './utils/basePath';
import { E2E_RECIPE_IDS, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Curated U15, re-aimed by slice 5 of the UI overhaul (`docs/design/uiOverhaul/buildSpec.md` §4.4): Discover's facets live
 * in ONE place. At a 960 container in a window that is not short they are a sticky PANEL (an `aside` named "Filters")
 * beside the results; anywhere else they are the design-system Sheet behind a `Filters` button, with the applied filters
 * as chips under it. The groups never exist twice. (This replaces the inline bar of `ingredientSpecialization.md` §S8.1a.)
 *
 * What only this tier can prove: the layout follows the real window, a facet tap writes the URL without closing the
 * Sheet (a remounted bar would close it on every tap), the results behind the Sheet follow, focus comes back to the
 * trigger, and nothing scrolls sideways at 320 px. The component suite covers each state; this covers the story.
 */

const PHONE = { width: 320, height: 640 };

/** A window the panel fits in: a 960 container, and not short. */
const WIDE = { width: 1440, height: 900 };

/** The Sheet's apply button: "Show 3 recipes", "Show 1 recipe", or "Show recipes" while the count is unknown. */
const SHOW = /^Show (?:\d+ )?recipes?$/u;

/** One vegan and one non-vegan public recipe, both matching the query `e`, so a facet visibly narrows the list. */
async function seed(page: Page): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        recipes: [
            makeRecipeDetail({
                id: E2E_RECIPE_IDS.ramen,
                ownerId: 'usr_other',
                title: 'Weeknight Ramen Bowl',
                dietaryFlags: ['vegan'],
            }),
            makeRecipeDetail({ id: E2E_RECIPE_IDS.shortRibs, ownerId: 'usr_other', title: 'Braised Short Ribs' }),
        ],
    });
}

/** Assert that neither the page nor an open dialog scrolls sideways (WCAG 2.2 SC 1.4.10). */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
    const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        dialogs: Array.from(document.querySelectorAll('[role="dialog"]'), (box) => box.scrollWidth - box.clientWidth),
    }));

    expect(overflow.page, 'the page scrolls sideways').toBeLessThanOrEqual(0);

    for (const dialog of overflow.dialogs) {
        expect(dialog, 'the dialog scrolls sideways').toBeLessThanOrEqual(0);
    }
}

test.describe('recipe filters on the Sheet, on a phone (curated U15)', () => {
    test.use({ viewport: PHONE });

    test('opens the filters in a sheet, applies a facet, and returns focus to the trigger', async ({ page }) => {
        await seed(page);
        await page.goto(route('/discover?query=e'));

        const trigger = page.getByRole('button', { name: 'Filters' });
        await expect(trigger).toBeVisible();
        // The groups sit nowhere on the page until the Sheet opens: no panel at this width.
        await expect(page.getByRole('complementary', { name: 'Filters' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Braised Short Ribs' })).toBeVisible();
        await expectNoSidewaysScroll(page);

        await trigger.click();

        const sheet = page.getByRole('dialog', { name: 'Filters' });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole('heading', { name: 'Filters' })).toBeFocused();
        await expectNoSidewaysScroll(page);

        // A facet applies at once: the URL takes it, and the Sheet stays open for the next one.
        const vegan = sheet.getByRole('button', { name: 'vegan 1' });
        await vegan.click();
        await expect(page).toHaveURL(/dietaryFlags=vegan/u);
        await expect(vegan).toHaveAttribute('aria-pressed', 'true');
        await expect(sheet).toBeVisible();

        // The apply button fills the footer (R9, `docs/design/rowEditorOpenDecisions.md`) and says what it will show. The
        // footer is a block box, not a flex column, so only a real layout shows the wrapper stretching.
        const done = sheet.getByRole('button', { name: SHOW });
        const sheetWidth = (await sheet.boundingBox())?.width ?? 0;

        // Positive control: the sheet spans the phone, so the ratio below is not taken against a collapsed box.
        expect(sheetWidth).toBeGreaterThan(300);
        expect((await done.boundingBox())?.width ?? 0, 'the apply button does not fill the footer').toBeGreaterThan(
            sheetWidth * 0.75,
        );

        await done.click();

        await expect(sheet).toBeHidden();
        await expect(page.getByRole('button', { name: 'Filters, 1 active' })).toBeFocused();
        // The applied filter is a chip under the button, removable without reopening the Sheet.
        await expect(page.getByRole('button', { name: 'Remove vegan filter' })).toBeVisible();
        await expect(page.getByRole('article', { name: 'Braised Short Ribs' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Weeknight Ramen Bowl' })).toBeVisible();
    });

    test('closes through Close and through Escape, with focus back on the trigger each time', async ({ page }) => {
        await seed(page);
        await page.goto(route('/discover?query=e'));
        const trigger = page.getByRole('button', { name: 'Filters' });
        const sheet = page.getByRole('dialog', { name: 'Filters' });

        await trigger.click();
        await sheet.getByRole('button', { name: 'Close filters' }).click();
        await expect(sheet).toBeHidden();
        await expect(trigger).toBeFocused();

        await trigger.click();
        await expect(sheet).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
        await expect(trigger).toBeFocused();
    });

    test('closes the sheet when the window widens, and the panel takes its place', async ({ page }) => {
        await seed(page);
        await page.goto(route('/discover?query=e'));

        await page.getByRole('button', { name: 'Filters' }).click();
        await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();

        await page.setViewportSize(WIDE);

        await expect(page.getByRole('dialog', { name: 'Filters' })).toHaveCount(0);
        const panel = page.getByRole('complementary', { name: 'Filters' });
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('group', { name: 'Dietary' })).toBeVisible();
        // One home for the facets: the button is gone with the Sheet.
        await expect(page.getByRole('button', { name: /^Filters/u })).toHaveCount(0);
    });
});

test.describe('recipe filters, in the panel (slice 5)', () => {
    test.use({ viewport: WIDE });

    test('keeps the panel beside the results on a laptop, with no button, and a facet narrows them', async ({
        page,
    }) => {
        await seed(page);
        await page.goto(route('/discover?query=e'));

        const panel = page.getByRole('complementary', { name: 'Filters' });
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('group', { name: 'Dietary' })).toBeVisible();
        await expect(page.getByRole('button', { name: /^Filters/u })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Braised Short Ribs' })).toBeVisible();

        await panel.getByRole('button', { name: 'vegan 1' }).click();

        await expect(page).toHaveURL(/dietaryFlags=vegan/u);
        await expect(page.getByRole('article', { name: 'Braised Short Ribs' })).toHaveCount(0);
        await expect(page.getByRole('article', { name: 'Weeknight Ramen Bowl' })).toBeVisible();
        // The panel's Clear all brings the other recipe back.
        await panel.getByRole('button', { name: 'Clear all' }).click();
        await expect(page.getByRole('article', { name: 'Braised Short Ribs' })).toBeVisible();
    });
});

test.describe('recipe filters, a phone turned sideways (curated U15)', () => {
    // 844 × 390: the inline bar put the first result at y = 921 here, so the window's height counts too.
    test.use({ viewport: { width: 844, height: 390 } });

    test('puts the filters on the Sheet, because the window is short', async ({ page }) => {
        await seed(page);
        await page.goto(route('/discover?query=e'));

        await expect(page.getByRole('button', { name: 'Filters' })).toBeVisible();
        await expect(page.getByRole('complementary', { name: 'Filters' })).toHaveCount(0);

        await page.getByRole('button', { name: 'Filters' }).click();
        await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
        await expectNoSidewaysScroll(page);
    });
});

/**
 * The pinned-footer limit on the filter Sheet (`docs/design/compactHeightLayout.md` §3, item B; `isFooterUnpinned` in
 * `@commise/ui/layout`): the apply button ("Show n recipes", still called `done` below) stays pinned while the title row and the footer take at most half the Sheet. Past that it
 * scrolls with the facets, and Close stays pinned in the title row.
 *
 * 640 × 360 is a phone held sideways. From 640 px the Sheet is the centred dialog, capped at 85% of the window's height,
 * and the window is too short for the inline bar. Both cases use that window, so the text scale alone moves Done. The
 * component suite pins the rule (`SheetFooterPinning.test.tsx`); this proves it in a real layout engine, on the one web
 * page that uses the Sheet. Pinned or not is read from what the cook sees: whether Done moves when the facets scroll.
 */
test.describe('the filter Sheet’s Done at 640 × 360 (compactHeightLayout.md §3, item B)', () => {
    const WINDOW = { width: 640, height: 360 };

    test.use({ viewport: WINDOW });

    /** The heights the rule reads, and how far the facets scroll, from the open Sheet's own nodes. */
    interface SheetChrome {
        /** The title row, which holds Close. */
        readonly top: number;
        /** The footer, which holds Done. */
        readonly footer: number;
        /** The Sheet's frame: the title row and the facets' region. */
        readonly frame: number;
        /** How far the facets' region can scroll. */
        readonly overflow: number;
        /** How far it has scrolled. */
        readonly scrolled: number;
    }

    /**
     * Read the chrome around Done. The facets' region is Done's first ancestor that scrolls, the footer is that region's
     * last child, the frame is the region's parent, and Close sits in the title row.
     */
    const chromeOf = async (done: Locator, close: Locator): Promise<SheetChrome> => {
        const [region, top] = await Promise.all([
            done.evaluate((element) => {
                let node = element.parentElement;

                while (node !== null && getComputedStyle(node).overflowY !== 'auto') {
                    node = node.parentElement;
                }

                if (node === null) {
                    throw new Error('Done sits in no region that scrolls');
                }

                return {
                    footer: node.lastElementChild?.getBoundingClientRect().height ?? 0,
                    frame: node.parentElement?.getBoundingClientRect().height ?? 0,
                    overflow: node.scrollHeight - node.clientHeight,
                    scrolled: node.scrollTop,
                };
            }),
            close.evaluate((element) => element.parentElement?.getBoundingClientRect().height ?? 0),
        ]);

        return { ...region, top };
    };

    /** A box's top edge, in px from the top of the window. */
    const topOf = async (locator: Locator): Promise<number> => (await locator.boundingBox())?.y ?? Number.NaN;

    /** A box's bottom edge, in px from the top of the window. */
    const bottomOf = async (locator: Locator): Promise<number> => {
        const box = await locator.boundingBox();

        return (box?.y ?? Number.NaN) + (box?.height ?? Number.NaN);
    };

    /** Open the Sheet with the root font at `scale`, wait for the facets to overflow it, and record what the rule read. */
    async function openSheet(
        page: Page,
        scale: number,
        testInfo: TestInfo,
    ): Promise<{
        readonly sheet: Locator;
        readonly done: Locator;
        readonly close: Locator;
        readonly chrome: SheetChrome;
    }> {
        await seed(page);
        await page.goto(route('/discover?query=e'));
        await page.addStyleTag({ content: `html { font-size: ${String(scale * 100)}% !important; }` });
        await page.getByRole('button', { name: 'Filters' }).click();
        const sheet = page.getByRole('dialog', { name: 'Filters' });
        const done = sheet.getByRole('button', { name: SHOW });
        const close = sheet.getByRole('button', { name: 'Close filters' });

        await expect(sheet).toBeVisible();
        // The facets come from the search the browser settles after the page is up, so the Dietary group can arrive
        // after the Sheet opens and grow it. Nothing is measured until it has.
        await expect(sheet.getByRole('button', { name: 'vegan 1' })).toBeVisible();
        // The facets overflow, so whether Done moves when they scroll tells a pinned footer from one that is not.
        await expect
            .poll(async () => (await chromeOf(done, close)).overflow, 'the facets fit the Sheet')
            .toBeGreaterThan(0);
        const chrome = await chromeOf(done, close);

        testInfo.annotations.push({ type: 'measured', description: JSON.stringify(chrome) });

        return { sheet, done, close, chrome };
    }

    /** Scroll the facets to their end as the cook does, with the wheel over them, and answer how far they went. */
    async function scrollFacetsToEnd(page: Page, done: Locator, close: Locator): Promise<number> {
        await page.mouse.move(WINDOW.width / 2, WINDOW.height / 2);
        await page.mouse.wheel(0, 10_000);
        await expect
            .poll(async () => {
                const { overflow, scrolled } = await chromeOf(done, close);

                return overflow - scrolled;
            }, 'the facets did not scroll to their end')
            .toBeLessThanOrEqual(1);

        return (await chromeOf(done, close)).scrolled;
    }

    test('at 100% text Done stays pinned to the Sheet’s foot while the facets scroll beneath it', async ({
        page,
    }, testInfo) => {
        const { sheet, done, close, chrome } = await openSheet(page, 1, testInfo);

        expect(chrome.top + chrome.footer, 'the chrome takes more than half the Sheet').toBeLessThanOrEqual(
            chrome.frame / 2,
        );
        expect(await bottomOf(done), 'Done is not inside the Sheet at rest').toBeLessThanOrEqual(await bottomOf(sheet));
        const atRest = await topOf(done);

        expect(await scrollFacetsToEnd(page, done, close)).toBeGreaterThan(0);
        expect(await topOf(done), 'Done moved with the facets').toBeCloseTo(atRest, 0);
    });

    test('at 200% text Done unpins: it scrolls with the facets into reach, Close stays pinned, and Done still closes the Sheet', async ({
        page,
    }, testInfo) => {
        const { sheet, done, close, chrome } = await openSheet(page, 2, testInfo);

        expect(chrome.top + chrome.footer, 'the chrome takes no more than half the Sheet').toBeGreaterThan(
            chrome.frame / 2,
        );
        // Unpinned, Done is the last thing in the facets' region, so at rest it ends below the Sheet's foot. Polled: the
        // footer starts pinned and moves once the Sheet has been measured.
        await expect
            .poll(
                async () => (await bottomOf(done)) - (await bottomOf(sheet)),
                'Done is still pinned at the Sheet’s foot',
            )
            .toBeGreaterThan(0);
        const atRest = await topOf(done);
        const scrolled = await scrollFacetsToEnd(page, done, close);

        // And it moved up exactly as far as the facets scrolled.
        expect(scrolled).toBeGreaterThan(0);
        expect(atRest - (await topOf(done)), 'Done did not move with the facets').toBeCloseTo(scrolled, 0);

        // In reach: at the end of the facets Done is whole inside the Sheet and the window, and nothing covers it.
        expect(await topOf(done), 'Done starts above the Sheet').toBeGreaterThanOrEqual(await topOf(sheet));
        expect(await bottomOf(done), 'Done ends below the Sheet').toBeLessThanOrEqual(await bottomOf(sheet));
        expect(await bottomOf(done), 'Done ends below the window').toBeLessThanOrEqual(WINDOW.height);
        expect(
            await done.evaluate((element) => {
                const box = element.getBoundingClientRect();
                const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);

                return hit !== null && element.contains(hit);
            }),
            'something covers Done',
        ).toBe(true);

        // The exit never unpins: with the facets at their end, Close is still in the Sheet's title row.
        expect(await topOf(close), 'Close scrolled out of the Sheet').toBeGreaterThanOrEqual(await topOf(sheet));
        expect(await bottomOf(close), 'Close left the title row').toBeLessThanOrEqual(
            (await topOf(sheet)) + chrome.top,
        );

        await done.click();

        await expect(sheet).toBeHidden();
        await expect(page.getByRole('button', { name: 'Filters' })).toBeFocused();
    });
});
