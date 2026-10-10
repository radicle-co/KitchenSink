import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { PSEUDO_LOCALE, pseudoString } from '@commise/i18n';

import { BASE_PATH } from './utils/basePath';
import { makeCollection, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * CONTROL LABELS STAY ON ONE LINE — at 320 px, in the `en-XA` pseudo-locale (+35%, accented), every design-system
 * control label renders on a single line and no page scrolls sideways (`docs/design/uiOverhaul/buildSpec.md` §13;
 * `docs/architecture/uiOverhaulBlueprint.md` Part B, "Pseudo-localisation"). A control that only fits its English
 * label wraps, or pushes the page wider, the day a longer locale ships; this is where that shows first.
 *
 * ## How a "line" is measured
 *
 * NOT `element.getClientRects()`: a `<button>` or an `inline-flex` box returns ONE rect however many lines its label
 * wraps to. The label's own TEXT is measured instead — a `Range` over its text nodes yields one rect per line box —
 * and the rects are grouped by their top edge. The first test proves the measure can see a wrap, by squeezing a real
 * control until its label must break, so a measure that went blind would fail here rather than pass everything.
 *
 * ⚠️ One line is not the whole bar: a label can stay on one line by overflowing its control, and the fix for a wrap is
 * never `nowrap`. So every page also asserts `scrollWidth === innerWidth`.
 *
 * ## Scope (named, not implied)
 *
 * The controls a screen renders today: Button (primary, secondary, ghost, destructive confirm), the ConfirmDialog, and
 * the More-actions Popover. Chip, ChipRow, SegmentedControl, SearchField, Stepper and the UndoSnackbar have no screen
 * consumer yet (slices 3–5 adopt them); they are measured when a screen first renders them.
 *
 * The app is built with `COMMISE_PSEUDO_LOCALE=1` for this tier (`_ci.yml` `build`; `playwright.config.ts` locally),
 * the only build that routes `en-XA` (`pseudoLocaleBuildGate.test.ts`).
 */

test.use({ viewport: { width: 320, height: 640 } });

const RECIPE_ID = 'ec000000-0000-4000-8000-000000000012';
const RECIPE_TITLE = 'Ember Roast Chicken';

/** A path under the pseudo-locale, whatever locale the rest of the run uses. */
const pseudoRoute = (path: string): string => `${BASE_PATH}/${PSEUDO_LOCALE}${path}`;

/** How many lines a control's label text occupies, and whether the control overflows its own box. */
interface LabelLayout {
    readonly lines: number;
    readonly overflows: boolean;
    /** The label's widest line and the room its control's parent gives it, in px — the numbers a fix needs. */
    readonly labelWidth: number;
    readonly room: number;
}

/**
 * Measure a control's label: one rect per line box from a `Range` over its text nodes, grouped by top edge.
 *
 * @param control - The control.
 * @returns Its label's line count and whether its content overflows it.
 */
async function labelLayout(control: Locator): Promise<LabelLayout> {
    return control.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const texts: Text[] = [];

        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            if ((node.textContent ?? '').trim() !== '') {
                texts.push(node as Text);
            }
        }

        const first = texts[0];
        const last = texts[texts.length - 1];

        if (first === undefined || last === undefined) {
            return { lines: 0, overflows: false, labelWidth: 0, room: 0 };
        }

        const range = document.createRange();
        range.setStart(first, 0);
        range.setEnd(last, last.length);

        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
        const tops = rects.map((rect) => Math.round(rect.top));
        const lines = tops.filter((top, index) => tops.findIndex((other) => Math.abs(other - top) <= 2) === index);
        const parent = element.parentElement;
        const parentStyle = parent === null ? null : getComputedStyle(parent);
        const room =
            parent === null || parentStyle === null
                ? 0
                : parent.clientWidth -
                  Number.parseFloat(parentStyle.paddingLeft) -
                  Number.parseFloat(parentStyle.paddingRight);

        return {
            lines: lines.length,
            overflows: element.scrollWidth > element.clientWidth + 1,
            labelWidth: Math.round(range.getBoundingClientRect().width),
            room: Math.round(room),
        };
    });
}

/**
 * Assert every named control's label sits on one line inside its control.
 *
 * @param controls - The controls, by the English label they were named with.
 */
async function expectOneLine(controls: Readonly<Record<string, Locator>>): Promise<void> {
    for (const [label, control] of Object.entries(controls)) {
        await expect(control, label).toBeVisible();

        const layout = await labelLayout(control);

        expect(
            layout.lines,
            `"${label}" wraps at 320 px in en-XA (label ${layout.labelWidth}px, parent room ${layout.room}px)`,
        ).toBe(1);
        expect(layout.overflows, `"${label}" overflows its control at 320 px in en-XA`).toBe(false);
    }
}

/** Assert the page does not scroll sideways. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
    }));

    expect(scrollWidth).toBe(innerWidth);
}

/** Sign in, and seed one collection plus either one recipe the viewer owns or none. */
async function seed(page: Page, recipes: 'one' | 'none'): Promise<void> {
    await signInWithTicket(page);
    const viewerId = await readViewerAppId(page);

    await mockRecipeApi(page, {
        viewerId,
        tier: 'premium',
        recipes: recipes === 'one' ? [makeRecipeDetail({ id: RECIPE_ID, ownerId: viewerId, title: RECIPE_TITLE })] : [],
        collections: [makeCollection({ id: 'col_labels', ownerId: viewerId, name: 'Weeknight dinners' })],
    });
}

test.describe('control labels at 320 px in en-XA', () => {
    test('the measure sees a wrap: a control squeezed narrower than its label reports more than one line', async ({
        page,
    }) => {
        await seed(page, 'one');
        await page.goto(pseudoRoute(`/recipes/${RECIPE_ID}`));
        await page
            .getByRole('button', { name: pseudoString('More actions for {title}').replace('{title}', RECIPE_TITLE) })
            .click();

        // The ⋯ menu is the design system's `ActionMenu` (§6.4): its entries are menu items.
        const control = page.getByRole('menu').getByRole('menuitem', { name: pseudoString('Delete recipe') });
        await expect(control).toBeVisible();
        expect((await labelLayout(control)).lines).toBe(1);

        // Squeeze it: the label has spaces, so it must break.
        await control.evaluate((element) => {
            element.style.width = '5rem';
            element.style.maxWidth = '5rem';
        });

        expect((await labelLayout(control)).lines).toBeGreaterThan(1);
    });

    test('the empty recipe list does not scroll sideways', async ({ page }) => {
        await seed(page, 'none');
        await page.goto(pseudoRoute('/recipes'));

        await expect(page.getByRole('button', { name: pseudoString('Add your first recipe') })).toBeVisible();
        await expectNoSidewaysScroll(page);
    });

    // Was a known defect, asserted with `test.fail` while "Create your first recipe" wrapped at 320 px. Slice 4's copy
    // ("Add your first recipe", `buildSpec.md` §4.3) fits one line there, so the expectation is now the plain one.
    test('the empty recipe list’s create label stays on one line', async ({ page }) => {
        await seed(page, 'none');
        await page.goto(pseudoRoute('/recipes'));

        await expectOneLine({
            'Add your first recipe': page.getByRole('button', { name: pseudoString('Add your first recipe') }),
        });
    });

    test('recipe detail: the ⋯ menu and the delete ConfirmDialog', async ({ page }) => {
        await seed(page, 'one');
        await page.goto(pseudoRoute(`/recipes/${RECIPE_ID}`));
        await expect(page.getByRole('heading', { level: 1, name: RECIPE_TITLE })).toBeVisible();
        await expectNoSidewaysScroll(page);

        await page
            .getByRole('button', { name: pseudoString('More actions for {title}').replace('{title}', RECIPE_TITLE) })
            .click();
        const menu = page.getByRole('menu');
        await expectOneLine({
            'Delete recipe (menu)': menu.getByRole('menuitem', { name: pseudoString('Delete recipe') }),
        });
        await expectNoSidewaysScroll(page);

        await menu.getByRole('menuitem', { name: pseudoString('Delete recipe') }).click();
        const dialog = page.getByRole('alertdialog', { name: pseudoString('Delete this recipe?') });
        await expectOneLine({
            'Keep recipe': dialog.getByRole('button', { name: pseudoString('Keep recipe') }),
            'Delete recipe (confirm)': dialog.getByRole('button', { name: pseudoString('Delete recipe') }),
        });
        await expectNoSidewaysScroll(page);
    });

    test('collections: the list, a collection, and the collection form', async ({ page }) => {
        await seed(page, 'one');

        await page.goto(pseudoRoute('/collections'));
        await expectOneLine({ 'New collection': page.getByRole('button', { name: pseudoString('New collection') }) });
        await expectNoSidewaysScroll(page);

        await page.goto(pseudoRoute('/collections/col_labels'));
        // Slice 4: the collection's add control is "Add recipes" (it opens the member picker).
        await expectOneLine({
            'Add recipes': page.getByRole('button', { name: pseudoString('Add recipes') }).first(),
        });
        await expectNoSidewaysScroll(page);

        // Slice 4: the `/collections/new` page is deleted; the form is the new-collection sheet over the list.
        await page.goto(pseudoRoute('/collections'));
        await page.getByRole('button', { name: pseudoString('New collection') }).click();
        // Below 840 the sheet has no Cancel (its × closes it, `buildSpec.md` §5.1, F11): only the full-width primary.
        await expectOneLine({
            'Create collection': page.getByRole('button', { name: pseudoString('Create collection'), exact: true }),
        });
        await expectNoSidewaysScroll(page);
    });
});
