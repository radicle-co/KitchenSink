import { expect, test, type Page } from '@playwright/test';

import { FAB_FLOATS_FROM_HEIGHT_PX } from '@commise/ui/create-fab-policy';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';

/**
 * Home on a very short window (320 by 200 CSS px is a 1280 by 800 window at 400% zoom): the New recipe button must
 * never hide a control the keyboard reaches (WCAG 2.2 SC 2.4.11 Focus Not Obscured, Minimum). Designer finding and
 * ruling, web only, 2026-11-02 (`nativeBoards/designAnswers.md`): below `FAB_FLOATS_FROM_HEIGHT_PX` (400) of viewport
 * height the button stops floating and sits in the page header, and the room under it (`--fab-reserved-bottom`, the
 * document's scroll padding, `<main>`'s foot) is nothing. From that height up it floats, as before.
 *
 * Each case drives the real page with the keyboard (Tab until "See all" holds focus) and compares BOXES: it fails if
 * the focused link's rectangle meets the button's. The button's `position` pins which side of the rule the viewport is
 * on, so a case cannot pass by accident of layout.
 *
 * What only this tier proves: the threshold's media query, the variant on the button's classes, the document's scroll
 * padding and the page's own foot are each pinned on their own (`tailwindTheme.integration.test.ts`, `fabReserve.test.ts`,
 * `fabSurfaceClass.test.ts`); only a browser shows whether together they leave the focused link clear.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */
const MAX_TABS = 80;

/** One CSS px above the threshold, where the button floats. */
const JUST_ABOVE = FAB_FLOATS_FROM_HEIGHT_PX + 1;

/** Open Home with a recent recipe (so the widget and its "See all" show), at a given window height. */
async function openHome(page: Page, height: number): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);
    await mockRecipeApi(page, {
        viewerId,
        paidFeatures: 'upsell',
        recipes: [
            makeRecipeDetail({
                id: 'ec000000-0000-4000-8000-00000000000c',
                ownerId: viewerId,
                title: 'Charred Broccolini',
            }),
        ],
    });
    await page.setViewportSize({ width: 320, height });
    await page.goto(route('/'));
}

/** Tab from the top until "See all" is focused, and return the two boxes. */
async function focusSeeAll(page: Page) {
    const seeAll = page.getByRole('link', { name: /see all/i }).first();
    const create = page.getByRole('button', { name: 'New recipe' });

    await expect(seeAll).toBeVisible();
    await expect(create).toBeVisible();

    // The browser scrolls a focused control into view, honouring the document's scroll-padding.
    for (let presses = 0; presses < MAX_TABS; presses += 1) {
        if (await seeAll.evaluate((element) => element === document.activeElement)) {
            break;
        }

        await page.keyboard.press('Tab');
    }

    await expect(seeAll).toBeFocused();

    return { create, linkBox: await seeAll.boundingBox(), buttonBox: await create.boundingBox() };
}

type Box = { x: number; y: number; width: number; height: number };

/** Whether two boxes share no area. */
const apart = (a: Box, b: Box): boolean =>
    a.y + a.height <= b.y || b.y + b.height <= a.y || a.x + a.width <= b.x || b.x + b.width <= a.x;

test.describe('Home on a short window: the New recipe button never covers a focused control', () => {
    test('below 400 px tall the button is in the page flow, and a focused "See all" is clear of it', async ({
        page,
    }) => {
        await openHome(page, FAB_FLOATS_FROM_HEIGHT_PX - 200);
        const { create, linkBox, buttonBox } = await focusSeeAll(page);

        await expect(create).toHaveCSS('position', 'static');
        expect(linkBox).not.toBeNull();
        expect(buttonBox).not.toBeNull();

        if (linkBox !== null && buttonBox !== null) {
            expect(
                apart(linkBox, buttonBox),
                `See all ${JSON.stringify(linkBox)} meets ${JSON.stringify(buttonBox)}`,
            ).toBe(true);
        }
    });

    // Designer ruling (`nativeBoards/designAnswers.md`, 438f7e542): below 400 px tall the button has its own row under the
    // page header, after the greeting and the date, 16 below the date, start-aligned, with no shadow. It is never in the
    // H1 row (at 320 by 200 the old placement overlapped the greeting, when the profile button also sat there; the
    // avatar left the title row on 2026-11-11, N3, so the greeting is all that is left to keep clear of).
    test('below 400 px tall the button has its own row under the date, 16 px below it, start-aligned, with no shadow', async ({
        page,
    }) => {
        await openHome(page, FAB_FLOATS_FROM_HEIGHT_PX - 200);
        const create = page.getByRole('button', { name: 'New recipe' });
        const greeting = page.getByRole('heading', { level: 1 });
        const date = page.getByText(/^\w+day, \w+ \d{1,2}/u).first();
        await expect(create).toBeVisible();
        const [createBox, greetingBox, dateBox] = [
            await create.boundingBox(),
            await greeting.boundingBox(),
            await date.boundingBox(),
        ];

        await expect(create).toHaveCSS('box-shadow', 'none');

        if (createBox === null || greetingBox === null || dateBox === null) {
            throw new Error('A header control has no box.');
        }

        expect(createBox.y).toBeGreaterThanOrEqual(dateBox.y + dateBox.height + 15);
        expect(createBox.y).toBeLessThanOrEqual(dateBox.y + dateBox.height + 17);
        expect(createBox.x).toBeLessThanOrEqual(greetingBox.x + 1);
        expect(apart(createBox, greetingBox)).toBe(true);
    });

    test('just above 400 px tall the button floats, and a focused "See all" scrolls clear of it', async ({ page }) => {
        await openHome(page, JUST_ABOVE);
        const { create, linkBox, buttonBox } = await focusSeeAll(page);

        await expect(create).toHaveCSS('position', 'fixed');
        expect(linkBox).not.toBeNull();
        expect(buttonBox).not.toBeNull();

        if (linkBox !== null && buttonBox !== null) {
            expect(
                apart(linkBox, buttonBox),
                `See all ${JSON.stringify(linkBox)} meets ${JSON.stringify(buttonBox)}`,
            ).toBe(true);
        }
    });
});
